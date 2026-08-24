# FileEditTool Specification (Claude Code "Edit" Tool)

## Overview

The **FileEditTool** is Claude Code's surgical string-replacement editor. It replaces specific substrings in files with new content, preserving file encoding, line endings, and quote style. The tool name exposed to the model is `'Edit'` (constant `FILE_EDIT_TOOL_NAME`).

> **Key distinction:** This is NOT FileWriteTool (which atomically replaces an entire file). Edit does targeted substring replacement — like `sed` but with read-before-edit safety guarantees.

---

## Source Code Locations

| File | Purpose | Lines |
|------|---------|-------|
| `src/tools/FileEditTool/FileEditTool.ts` | Tool definition, buildTool() call, validation (validateInput), main execution flow (call), readFileForEdit helper | ~626 lines |
| `src/tools/FileEditTool/utils.ts` | All editing utilities: normalizeQuotes, findActualString, preserveQuoteStyle, applyEditToFile, getPatchForEdit/Edits, areFileEditsEquivalent, stripTrailingWhitespace, normalizeFileEditInput | ~776 lines |
| `src/tools/FileEditTool/types.ts` | Zod input/output schemas (FileEditInputSchema, FileEditOutputSchema, EditInput) | ~180 lines |
| `src/tools/FileEditTool/constants.ts` | Tool name constant (`'Edit'`), permission patterns for .claude/ access | 12 lines |
| `src/tools/FileEditTool/prompt.ts` | System prompt description telling model to use Read before Edit | ~29 lines |
| `src/tools/FileEditTool/UI.tsx` | React components for diff display, rejection messages, error rendering | ~289 lines |
| `src/constants/tools.ts` | Permission label constant: `FileEditTool: 'Editing'` | 1 line |

**UI Components (referenced by UI.tsx):**
- `src/components/FileEditToolUpdatedMessage.tsx` — renders the diff after successful edit
- `src/components/FileEditToolUseRejectedMessage.tsx` — renders diff when user rejects an edit
- `src/utils/diff.ts` — `getPatchForDisplay`, `getPatchFromContents` (line-number patch formatting)
- `src/utils/file.ts` — `readFileSyncWithMetadata`, `convertLeadingTabsToSpaces`, `writeTextContent`, `detectLineEndingsForString`

---

## Input Schema (Zod-defined, 4 parameters)

```typescript
interface FileEditInput {
  file_path: string;        // Required. Absolute or tilde-expanded path to the target file.
  old_string: string;       // Required. The exact substring to find and replace.
                            // Empty string = new file creation (write content via new_string).
  new_string: string;       // Required. Replacement content. Must differ from old_string.
  replace_all?: boolean;    // Optional. Default false. If true, replaces ALL occurrences.
}
```

### Validation Rules (validateInput, lines 137-362 of FileEditTool.ts)

| errorCode | Condition | Meaning |
|-----------|-----------|---------|
| 0 | Team mem secret guard triggers on the file path | Edit blocked by session memory rule |
| 1 | `old_string === new_string` (after empty-string equivalence check) | No-op edit rejected |
| 2 | Deny rules match (e.g., gitignored files, denied paths) | File is deny-listed |
| 3 | UNC path security skip on Windows | Path starts with `\\` — not editable |
| 4 | File size > MAX_EDIT_FILE_SIZE (1 GiB = 1073741824 bytes) | Too large to edit safely |
| 5 | File is a `.ipynb` Jupyter notebook | Routes to NotebookEdit tool instead |
| 6 | Read-before-edit check fails: file not read, or read was partial (offset/limit set), or mtime changed since last read | Must use Read tool first on this file |
| 7 | Staleness detected: mtime > lastRead.timestamp AND content differs from cached content. Content comparison is a fallback for Windows where timestamps may be unreliable. | File modified externally — re-Read before editing |
| 8 | `old_string` not found in file (exact match, then quote-normalized) | String doesn't exist — check indentation/quotes |
| 9 | Multiple matches of `old_string` found with replace_all=false | Ambiguous replacement — use more context or set replace_all=true |
| 10 | Settings file validation fails | Edit blocked by settings rules |

---

## Output Schema (FileEditOutput, lines ~60-80 of types.ts)

```typescript
interface FileEditOutput {
  filePath: string;          // Absolute path to the edited file
  oldString: string;         // The exact substring that was replaced (actual match from file)
  newString: string;         // Replacement content provided by caller
  originalFile: string;      // Full content of the file BEFORE edit
  structuredPatch: StructuredPatchHunk[]; // Unified diff hunks for display
  userModified?: boolean;    // Whether a skill/user modified the result
  replaceAll?: boolean;      // Whether all occurrences were replaced
}
```

---

## Execution Flow (call(), lines 387-574)

### Step 1: Pre-validation and Skill Discovery
1. Resolve `file_path` to absolute path via `expandPath()`
2. Fire-and-forget skill discovery from edited file's directory (`discoverSkillDirsForPaths`)
3. Activate conditional skills matching the file path pattern
4. Run LSP diagnostics tracker before edit (`diagnosticTracker.beforeFileEdited()`)

### Step 2: Ensure Parent Directory Exists
```typescript
await fs.mkdir(dirname(absoluteFilePath)) // Creates parent dirs if missing
```

### Step 3: Atomic Read-Modify-Write Section
All steps below happen between `readFileForEdit()` and `writeTextContent()` with minimal async yields:

#### A. Read File with Metadata
`readFileForEdit()` calls `readFileSyncWithMetadata()` which returns:
- `content`: Full file text
- `encoding`: Detected from BOM (UTF-8, UTF-16 BE/LE) or defaults to 'utf8'
- `lineEndings`: Detected as `'LF'`, `'CRLF'`, or `'CR'`

#### B. Staleness Double-Check (inside critical section)
```typescript
const lastWriteTime = getFileModificationTime(absoluteFilePath)
const lastRead = readFileState.get(absoluteFilePath)
if (!lastRead || lastWriteTime > lastRead.timestamp) {
  // On Windows, content comparison fallback:
  const isFullRead = lastRead && lastRead.offset === undefined && lastRead.limit === undefined
  const contentUnchanged = isFullRead && originalFileContents === lastRead.content
  if (!contentUnchanged) {
    throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR) // errorCode 7
  }
}
```

#### C. Quote Normalization & String Discovery
```typescript
// findActualString tries exact match first, then normalized (curly→straight quote) match
const actualOldString = findActualString(originalFileContents, old_string) || old_string

// If curly quotes were detected in the file match, apply matching style to new_string
const actualNewString = preserveQuoteStyle(old_string, actualOldString, new_string)
```

**Quote normalization flow:**
1. `normalizeQuotes()` converts curly quotes (`""`, `''`, `'`, `"`) → straight quotes (`"`, `'`)
2. `findActualString()` searches normalized content but returns the **actual substring from file** (preserving original quote characters)
3. `preserveQuoteStyle()` detects if matched text had curly quotes, then transforms `new_string` to use matching curly quotes with opening/closing heuristic (whitespace before = opening quote; letter between letters = apostrophe)

#### D. Patch Generation & Apply Edit
```typescript
const { patch, updatedFile } = getPatchForEdit({
  filePath: absoluteFilePath,
  fileContents: originalFileContents,
  oldString: actualOldString,    // Actual substring found in file (may differ from input)
  newString: actualNewString,     // Quote-style-preserved replacement
  replaceAll: replace_all,        // Boolean
})
```

**Inside `getPatchForEdit()` → `getPatchForEdits()`:**
1. Iterates through edits array, applying each sequentially with `applyEditToFile()`
2. After all edits applied, throws if content unchanged (errorCode 8/9)
3. Generates unified diff patch via `diff` library's `structuredPatch()`
4. **Tabs in patches:** Both old and new file contents are run through `convertLeadingTabsToSpaces()` before diff generation — leading tabs become 2-space indents for display purposes only

#### E. Atomic Write
```typescript
writeTextContent(absoluteFilePath, updatedFile, encoding, endings)
// Uses: fs.writeFileSync with detected encoding + preserved line endings
```

#### F. LSP Notification
```typescript
const lspManager = getLspServerManager()
if (lspManager) {
  clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`)
  lspManager.sendNotification('textDocument/didChange', ...)   // Content modified
  lspManager.sendNotification('textDocument/didSave', ...)     // File saved to disk
}
```

#### G. State Update & Analytics
- Updates `readFileState` timestamp for the edited file (allows subsequent edits)
- Logs analytics events for tool usage metrics
- Returns success result with diff information

---

## Whitespace Handling Architecture

### Current Behavior (IMPORTANT)

The FileEditTool handles whitespace in two distinct phases:

#### Phase 1: String Matching (what gets replaced)
- **Exact substring match first:** `findActualString()` checks if `old_string` exists verbatim in file content
- **Quote normalization fallback only:** If exact match fails, strips curly quotes and retries. Tabs/spaces are NOT normalized during matching.
- **Consequence:** If the model outputs an edit with spaces but the file uses tabs (or vice versa), `findActualString()` will fail because it only normalizes quotes, not whitespace.

#### Phase 2: Patch Display (what gets shown to user)
```typescript
// In getPatchForEdits(), line 345-346:
oldContent: convertLeadingTabsToSpaces(fileContents),   // tabs → spaces for display
newContent: convertLeadingTabsToSpaces(updatedFile),    // tabs → spaces for display
```

`convertLeadingTabsToSpaces()` (src/utils/file.ts:137):
```typescript
export function convertLeadingTabsToSpaces(content: string): string {
  if (!content.includes('\t')) return content  // Fast path for common case
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length))  // Each tab = 2 spaces
}
```

**Key insight:** Tab→space conversion happens ONLY in the diff output, NOT during string matching. This means:
- The unified diff displayed to users shows tabs as spaces (visual inconsistency)
- The model's `old_string` must match the file's actual whitespace exactly for replacement to succeed

### Current Retry Logic (normalizeFileEditInput, utils.ts ~line 500+)

```typescript
export function normalizeFileEditInput(...): FileEdit {
  // For markdown files specifically: strip trailing whitespace from old_string
  if (!['.md', '.mdx'].includes(ext)) return normalized
  
  let retries = 0
  while (retries < 2) {
    try {
      apply edit with strippedTrailingWhitespace(old_string) to file
      if success, break
    } catch {
      // Retry once more with further whitespace normalization for markdown only
    }
    retries++
  }
}
```

The retry logic is **file-extension gated** (`.md`, `.mdx` only). Source code files get no whitespace retry.

---

## Tool Registration (buildTool call, FileEditTool.ts line 86)

```typescript
export const FileEditTool = buildTool({
  name: FILE_EDIT_TOOL_NAME, // 'Edit'
  description: systemPromptFrom(prompt.ts),
  permission: 'Write',         // Requires write permission for file_path
  inputSchema: Zod schema from types.ts (4 params) + edits array variant,
  outputSchema: FileEditOutput type,
  ui: {
    userFacingName,            // Returns 'Update' or 'Create' based on old_string emptiness
    getToolUseSummary,         // Returns display path of file
    renderToolUseMessage,      // FilePathLink component for edit intent
    renderToolResultMessage,   // FileEditToolUpdatedMessage with diff
    renderToolUseRejectedMessage, // EditRejectionDiff with async patch loading
    renderToolUseErrorMessage,  // Graceful error messages ("File must be read first")
  },
  validateInput,               // Lines 137-362: all pre-flight checks
  call,                        // Lines 387-574: main execution
})
```

### Permission Matching
Registered in `src/constants/tools.ts`:
```typescript
FileEditTool: 'Editing',
```
This maps to the `checkWritePermissionForTool` function which uses permission patterns from constants.ts (`.claude/**`, `~/.claude/**`).

---

## Edit Equivalence & Deduplication (`areFileEditsEquivalent`)

Two edits are equivalent if applying either one to the same original content produces identical results. This is used in retry logic:

```typescript
export function areFileEditsEquivalent(edits1: FileEdit[], edits2: FileEdit[]): boolean {
  for (const edit of [...edits1, ...edits2]) {
    // Normalize both old and new strings via stripTrailingWhitespace
    const normalized = normalizeFileEditInput(edit)
    if (!normalized) continue
    
    // Apply to original file content, compare results
    const result1 = applyEditToContent(original, edits1Normalized)
    const result2 = applyEditToContent(original, edits2Normalized)
    return result1 === result2
  }
}
```

This allows the tool to retry with slightly different whitespace representations without double-applying changes.

---

## Surgical Replacement Points (for tweakcc or custom builds)

### Replace Point #1: Tool Name Constant
**File:** `src/tools/FileEditTool/constants.ts` line ~2
**Pattern:** `FILE_EDIT_TOOL_NAME = 'Edit'`
**Replacement:** Change to any string. All tool lookups, permission labels, and skill-loading references use this constant.

### Replace Point #2: Tool Definition (buildTool call)
**File:** `src/tools/FileEditTool/FileEditTool.ts` line ~86
**Anchor pattern for tweakcc regex replacement:**
```
export const FileEditTool = buildTool({
  name: FILE_EDIT_TOOL_NAME,
  description: systemPromptFrom(prompt),
```
Replace the entire `buildTool({...})` call block. Key fields to override:
- `validateInput`: Pre-flight validation (error codes)
- `call`: Main execution flow (read → validate → replace → write → notify)
- `inputSchema`: Zod schema for parameters

### Replace Point #3: Tab-to-Space Conversion in Patch Display
**File:** `src/tools/FileEditTool/utils.ts` lines ~345-346
**Anchor pattern:**
```typescript
oldContent: convertLeadingTabsToSpaces(fileContents),
newContent: convertLeadingTabsToSpaces(updatedFile),
```
Replace `convertLeadingTabsToSpaces()` calls with your own whitespace handling.

### Replace Point #4: Quote Normalization (findActualString)
**File:** `src/tools/FileEditTool/utils.ts` lines ~73-93
**Anchor pattern:**
```typescript
export function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) return searchString
  const normalizedSearch = normalizeQuotes(searchString)
  // ...
}
```
Add whitespace normalization here to handle tabs↔spaces in the matching phase.

### Replace Point #5: Tool Registration Reference
**File:** `src/tools.ts` line ~204
**Anchor pattern:**
```typescript
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
// ...
    FileEditTool,  // registered in tools array
```

### Replace Point #6: Permission Label
**File:** `src/constants/tools.ts` line ~16
**Anchor pattern:**
```typescript
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
// ...
FileEditTool: 'Editing',
```

---

## Building a FileEditTool From Scratch

To create an alternative Edit tool that replaces the built-in one, implement these interfaces:

### Required Module Structure
```
my-edit-tool/
  ├── types.ts          # Zod schemas matching FileEditInput / FileEditOutput shapes
  ├── constants.ts      # TOOL_NAME constant (string)
  ├── validator.ts      # validateInput() function with error throwing
  ├── executor.ts       # call() function accepting input + context + parentMessage
  ├── utils.ts          # findActualString, preserveQuoteStyle, getPatchForEdit
  └── UI.tsx            # renderToolUseMessage, renderToolResultMessage, etc.
```

### Core Functions to Implement

**1. `validateInput(input: FileEditInput, context)` → void (throws on failure)**
- Check file size against MAX_EDIT_FILE_SIZE
- Detect encoding from BOM bytes
- Verify read-before-edit: compare file mtime against cached readFileState timestamp
- Confirm old_string exists in file content (with your quote normalization strategy)
- Handle UNC paths, deny rules, team mem secrets

**2. `call(input: FileEditInput, context)` → Promise<FileEditOutput>**
- Expand path to absolute
- Create parent directories if missing
- Read file with metadata (content + encoding + lineEndings)
- Double-check staleness in critical section
- Find actual string match (your normalization logic)
- Apply quote style preservation to new_string
- Generate patch (unified diff via `diff` library's `structuredPatch()`)
- Write atomically with preserved encoding/line-endings
- Notify LSP servers (`didChange` + `didSave`)
- Update readFileState timestamp

**3. Quote Normalization (`findActualString`, `preserveQuoteStyle`)**
- Normalize curly quotes → straight for matching
- Detect original quote style in file
- Apply detected style to replacement text

**4. Patch Generation (`getPatchForEdit`)**
- Run `applyEditToFile(original, oldString, newString, replaceAll)`
- Generate unified diff via `diff` library
- Convert tabs→spaces for display

### Minimal Working Example (Pseudocode)

```typescript
import { buildTool } from 'src/Tool.js'
import { expandPath } from 'src/utils/path.js'
import { readFileForEdit, writeTextContent } from 'src/utils/file.js'
import { getPatchForEdit } from './utils.js'

const MY_EDIT_TOOL = buildTool({
  name: 'MyEdit',
  description: 'Surgical string replacement editor',
  inputSchema: z.object({
    file_path: z.string(),
    old_string: z.string(),
    new_string: z.string().refine(s => s !== ''),
    replace_all: z.boolean().default(false),
  }),
  outputSchema: /* your output type */,
  
  validateInput(input, ctx) {
    const absPath = expandPath(input.file_path)
    // Your validation logic (size check, read-before-edit, etc.)
  },
  
  async call(input, ctx) {
    const absPath = expandPath(input.file_path)
    const { content: originalFile, encoding, lineEndings } = readFileForEdit(absPath)
    
    // Apply edit
    const { patch, updatedFile } = getPatchForEdit({
      filePath: absPath,
      fileContents: originalFile,
      oldString: input.old_string,
      newString: input.new_string,
      replaceAll: input.replace_all,
    })
    
    writeTextContent(absPath, updatedFile, encoding, lineEndings)
    
    // Return output with patch for display
  },
})
```

---

## Enhancing Whitespace Handling (Tabs ↔ Spaces)

Based on the architecture above, here are the surgical replacement points to improve whitespace accommodation:

### Option A: Pre-matching Whitespace Normalization (Recommended)

Modify `findActualString()` in `src/tools/FileEditTool/utils.ts`:

```typescript
export function findActualString(fileContent: string, searchString: string): string | null {
  // NEW: Try exact match first
  if (fileContent.includes(searchString)) return searchString
  
  // NEW: Try with leading tabs→spaces normalization (for model outputs using spaces)
  const normalizedSearch = normalizeQuotes(searchString).replace(/^ +/m, m => 
    m.split('  ').join('\t')  // pairs of spaces → tab (heuristic)
  )
  if (fileContent.includes(normalizedSearch)) {
    return fileContent.substring(
      fileContent.indexOf(normalizedSearch),
      fileContent.indexOf(normalizedSearch) + searchString.length,
    )
  }
  
  // EXISTING: Try with quote normalization only
  const normalizedFile = normalizeQuotes(fileContent)
  const searchIndex = normalizedFile.indexOf(normalizeQuotes(searchString))
  if (searchIndex !== -1) {
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
  }
  
  return null
}
```

### Option B: Bidirectional Whitespace Matching

In `getPatchForEdit()` → `applyEditToFile()`, normalize both old_string and file content before matching:

1. Convert leading tabs in `fileContent` to spaces (for search)
2. Keep original for actual replacement
3. Match using normalized versions, apply using originals

### Option C: Tab-Aware Indentation Preservation

In `preserveQuoteStyle()`, add an indentation preservation companion:

```typescript
function detectLeadingWhitespace(char: string): { type: 'tab' | 'space', count: number } {
  const tabMatch = char.match(/^(\t+)/)
  if (tabMatch) return { type: 'tab', count: tabMatch[1].length }
  const spaceMatch = char.match(/^( +)/)
  if (spaceMatch) return { type: 'space', count: spaceMatch[1].length / 2 } // assume 2-space indent
  return { type: 'space', count: 0 }
}

function preserveIndentation(oldString: string, newString: string): string {
  const oldWs = detectLeadingWhitespace(oldString)
  const newWs = detectLeadingWhitespace(newString)
  
  if (oldWs.type === 'tab' && newWs.type !== 'tab') {
    // Convert spaces back to tabs for new content
    return newString.replace(/^ +/m, m => '  '.replace(/  /g, '\t').repeat(m.length / 2))
  }
  return newString
}
```

### Option D: Fix Tab→Space Display in Patches

Currently `convertLeadingTabsToSpaces()` converts ALL leading tabs to spaces (2 per tab). For files that use tabs consistently, this makes patches look wrong. Instead:

**In `src/utils/file.ts` line ~137:**
```typescript
// Current: every tab → 2 spaces in diff display
export function convertLeadingTabsToSpaces(content: string): string { ... }

// Improved: preserve original whitespace type but normalize for comparison
export function normalizeWhitespaceForDiff(content: string, useTabs: boolean): string {
  if (useTabs) {
    return content.replace(/^ +/gm, m => '\t'.repeat(Math.round(m.length / 2)))
  }
  return convertLeadingTabsToSpaces(content)
}
```

---

## Integration Points Outside FileEditTool Directory

| Location | What to Change | Why |
|----------|---------------|-----|
| `src/tools.ts` (line ~6, ~204) | Import + register new tool instance | Makes tool available in session |
| `src/bridge/sessionRunner.ts` (line ~83) | Permission label mapping | Shows 'Editing' permission dialog |
| `src/utils/queryHelpers.ts` (line ~359-477) | `fileEditToolUseIds` tracking | Associates tool_use_id with file paths for query context |
| `src/hooks/useDiffInIDE.ts` | Import from utils.js | Generates diffs shown in IDE integrations |
| `.claude/skills/*/SKILL.md` (skill triggers) | Tool name matching via `FILE_EDIT_TOOL_NAME` | Skills that trigger on Edit tool usage |
| `src/tools/FileEditTool/UI.tsx` (line ~23) | Import from utils.js | UI uses findActualString for rejection diffs |

---

## Testing the Replacement

After surgical replacement:

1. **Unit tests:** Run `npm test -- src/tools/FileEditTool/` — expect failures if internal interfaces changed
2. **Integration:** Edit a file with tabs, then edit a file with spaces, verify both work
3. **Diff display:** Check unified diff output preserves original whitespace type (not showing tab→space conversion artifacts)
4. **Quote preservation:** Verify curly quotes still flow through the new normalization path
5. **LSP notification:** Confirm didChange/didSave fire correctly after edits
6. **Staleness detection:** Modify file externally, verify Edit throws "File has been unexpectedly modified"
