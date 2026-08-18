// Patch: Add ignore_whitespace support to the edit tool in Claude Code.
// Name-agnostic implementation that matches on stable structural patterns
// shared across minified versions (v2.1.234, v2.1.235, etc.).
//
// The edit tool function signature changes between versions due to
// identifier obfuscation (e.g., kVc/Otu, Nv/cS), but the human-readable
// description string and inputSchema field names remain identical. We use
// those stable anchors to locate and transform the function regardless of
// which minified identifiers are in use.

import { showDiff } from './index';

// Stable structural anchor shared across all versions: the edit tool's
// human-readable description string is unchanged by minification.
const DESCRIPTION_ANCHOR =
  'description:"Replace old_string with new_string in a file. old_string must be unique unless replace_all."';

// Stable input schema field names — these are identical between versions.
const SCHEMA_FIELDS = [
  'file_path:{type:"string"}',
  'old_string:{type:"string"}',
  'new_string:{type:"string"}',
  'replace_all:{type:"boolean"}',
];

// Stable error message strings (the text inside quotes, not the class wrapping them).
const ERROR_MESSAGES = [
  '"edit: file_path is required"',
  '"edit: old_string is required"',
];

// Stable logic patterns that identify the core edit function body.
const LOGIC_PATTERNS = [
  'let a=s.split(r).length-1;',
  'if(a===0)throw new',
  '`edit: old_string not found in ${t}`',
  'l=s.replace(r,()=>n)',
  'return`edited ${t} (${o?a:1} replacement(s))`',
];

// The edit tool function is always immediately followed by the glob tool.
const NEXT_TOOL_DESCRIPTION =
  'description:"Match files under the workdir against a glob pattern';

interface EditToolContext {
  // Dynamic identifiers discovered from the file content.
  funcName: string;
  nextFuncName: string;
  schemaBuilderId: string;
  validationErrorClass: string;
  fsModuleId: string;
  pathResolverId: string;
  maxFileBytesWrapperId: string;
  errorFormatterId: string;
  writeFileId: string;
}

// Locate the edit tool function boundaries using stable structural anchors.
// Returns null if the function cannot be found (wrong version or already patched).
const findEditTool = (oldFile: string): EditToolContext | null => {
  // Anchor 1: description string must exist in the file.
  const descIdx = oldFile.indexOf(DESCRIPTION_ANCHOR);
  if (descIdx === -1) return null;

  // Anchor 2: input schema fields must be present near the description.
  for (const field of SCHEMA_FIELDS) {
    if (!oldFile.substring(descIdx, descIdx + 2000).includes(field))
      return null;
  }

  // Anchor 3: error messages must be present.
  for (const msg of ERROR_MESSAGES) {
    if (!oldFile.substring(descIdx, descIdx + 5000).includes(msg)) return null;
  }

  // Anchor 4: core logic patterns must be present in the function body.
  const searchWindow = oldFile.substring(descIdx - 100, descIdx + 5000);
  for (const pattern of LOGIC_PATTERNS) {
    if (!searchWindow.includes(pattern)) return null;
  }

  // Find the function start by scanning backward from description.
  let funcStart = Math.max(0, descIdx - 500);
  const beforeDesc = oldFile.substring(funcStart, descIdx);

  // Match: function <id>(e){return <builder>(
  const fnMatch = beforeDesc.match(
    /function\s+([a-zA-Z_$][\w$]*)\(e\)\{return\s+([a-zA-Z_$][\w$]*)\(/
  );
  if (!fnMatch) return null;

  funcStart += fnMatch.index!;
  const funcName = fnMatch[1];
  const schemaBuilderId = fnMatch[2];

  // Find the function end by locating }})}function <nextTool>
  const searchFrom = descIdx + DESCRIPTION_ANCHOR.length;
  for (
    let i = searchFrom;
    i < Math.min(searchFrom + 5000, oldFile.length - 20);
    i++
  ) {
    const chunk = oldFile.substring(i, i + 18);
    if (chunk.startsWith('}})}function')) {
      // Extract the next function name.
      const afterMarker = oldFile
        .substring(i + 15)
        .match(/\s*([a-zA-Z_$][\w$]*)/);
      if (!afterMarker) return null;
      const nextFuncName = afterMarker[1];

      // Verify this is the glob tool (next tool after edit in all versions).
      const nextToolIdx = oldFile.indexOf(NEXT_TOOL_DESCRIPTION, i + 15);
      if (nextToolIdx === -1 || nextToolIdx > i + 200) return null;

      // Now discover dynamic identifiers within the function body.
      const funcBody = oldFile.slice(funcStart, i + 18);

      // The validation error class is used as: throw new <id>(
      const errClassMatch = funcBody.match(
        /throw\s+new\s+([a-zA-Z_$][\w$]*)\(/
      );
      if (!errClassMatch) return null;
      const validationErrorClass = errClassMatch[1];

      // fs module identifier: used as <id>.stat, <id>.readFile, etc.
      const fsMatch = funcBody.match(/\b([a-zA-Z_$][\w$]*)\.stat\(i\)/);
      if (!fsMatch) return null;
      const fsModuleId = fsMatch[1];

      // Path resolver: used as await <id>(e,t).
      const pathMatch = funcBody.match(/await\s+([a-zA-Z_$][\w$]*)\(e,t\)/);
      if (!pathMatch) return null;
      const pathResolverId = pathMatch[1];

      // maxFileBytes wrapper: used as <id>(e.maxFileBytes).
      const maxFileMatch = funcBody.match(
        /([a-zA-Z_$][\w$]*)\(e\.maxFileBytes\)/
      );
      if (!maxFileMatch) return null;
      const maxFileBytesWrapperId = maxFileMatch[1];

      // Error formatter: used as <id>(c,t).
      const fmtMatch = funcBody.match(
        /throw new\s+\w+\(`edit:\s*\$\{([a-zA-Z_$]*)/
      );
      let errorFormatterId = '';
      if (fmtMatch) {
        const varName = fmtMatch[1];
        // Find what function is assigned to this variable or used as formatter.
        const funcDefMatch = oldFile.match(
          new RegExp(
            `function\\s+([a-zA-Z_$][\\\\w$]*)\\s*\\(.*?${varName}.*?\\)`
          )
        );
        if (funcDefMatch) {
          errorFormatterId = funcDefMatch[1];
        }
      }

      // writeFile function: used as await <id>(i,l).
      const writeMatch = funcBody.match(/await\s+([a-zA-Z_$][\w$]*)\(i,l\)/);
      if (!writeMatch) return null;
      const writeFileId = writeMatch[1];

      return {
        funcName,
        nextFuncName,
        schemaBuilderId,
        validationErrorClass,
        fsModuleId,
        pathResolverId,
        maxFileBytesWrapperId,
        errorFormatterId,
        writeFileId,
      };
    }
  }

  return null;
};

// Check if the patch has already been applied.
const isAlreadyPatched = (funcContent: string): boolean => {
  return funcContent.includes('additionalProperties:{ignore_whitespace');
};

export const writeIgnoreWhitespaceEdit = (oldFile: string): string | null => {
  const ctx = findEditTool(oldFile);
  if (!ctx) {
    console.error(
      'patch: ignoreWhitespaceEdit: failed to locate edit tool function using stable structural anchors'
    );
    return null;
  }

  // Locate exact boundaries for replacement.
  const startMarker = `function ${ctx.funcName}(e){return ${ctx.schemaBuilderId}({name:"edit"`;
  const endMarker = '}})}function';

  const funcStartIdx = oldFile.indexOf(startMarker);
  if (funcStartIdx === -1) {
    console.error(
      'patch: ignoreWhitespaceEdit: failed to locate function start marker'
    );
    return null;
  }

  // Find the }})}function marker after the description.
  let funcEndIdx = -1;
  const searchFrom = Math.max(
    funcStartIdx + 200,
    oldFile.indexOf(DESCRIPTION_ANCHOR) + DESCRIPTION_ANCHOR.length
  );
  console.log(
    `patch: ignoreWhitespaceEdit: searching for end marker from index ${searchFrom}`
  );

  for (
    let i = searchFrom;
    i < Math.min(searchFrom + 5000, oldFile.length - 20);
    i++
  ) {
    const chunk = oldFile.substring(i, i + 18);
    if (chunk.startsWith('}})}function')) {
      console.log(
        `patch: ignoreWhitespaceEdit: found end marker at index ${i}, context: "${chunk}"`
      );
      funcEndIdx = i;
      break;
    }
  }

  if (funcEndIdx === -1) {
    console.error(
      'patch: ignoreWhitespaceEdit: failed to locate function end marker'
    );
    return null;
  }

  const funcContent = oldFile.slice(funcStartIdx, funcEndIdx + 15);

  // Guard: skip if already patched.
  if (isAlreadyPatched(funcContent)) {
    console.log('patch: ignoreWhitespaceEdit: already patched, skipping');
    return null;
  }

  console.log(
    `patch: ignoreWhitespaceEdit: found edit tool "${ctx.funcName}" with ${ctx.validationErrorClass} error class`
  );

  let patchedFunc = funcContent;

  // ---- Step 1: Extend the input schema to include ignore_whitespace.
  // The current structure is:
  //   properties:{file_path:{type:"string"},old_string:{type:"string"},new_string:{type:"string"},replace_all:{type:"boolean"}},required:[...],run:async(
  // We need to add additionalProperties before the closing } of properties.

  // Match pattern: replace_all:{type:"boolean"}},required:...
  const schemaPattern = 'replace_all:{type:"boolean"}},required:[';
  if (!patchedFunc.includes(schemaPattern)) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 1 failed - schema pattern not found'
    );
    return null;
  }

  // Insert additionalProperties before the closing braces.
  const step1Replacement =
    'replace_all:{type:"boolean"},additionalProperties:{ignore_whitespace:{type:"boolean"}}},required:[';
  patchedFunc = patchedFunc.replace(schemaPattern, step1Replacement);

  if (patchedFunc === funcContent) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 1 failed - replacement did not change content'
    );
    return null;
  }

  // Verify the schema was extended correctly.
  const hasIgnoreWs = patchedFunc.includes(
    'additionalProperties:{ignore_whitespace'
  );
  if (!hasIgnoreWs) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 1 failed - ignore_whitespace not found in output'
    );
    return null;
  }

  // ---- Step 2: Add ignore_whitespace parameter to the run function signature.
  // Match on the stable parameter destructuring pattern.
  const paramPattern = ',replace_all:o})=>';
  if (!patchedFunc.includes(paramPattern)) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 2 failed - parameter pattern not found'
    );
    return null;
  }

  patchedFunc = patchedFunc.replace(
    paramPattern,
    ',replace_all:o,ignore_whitespace:v=false})=>'
  );

  // ---- Step 3: Modify the split/count logic to respect ignore_whitespace.
  // Original: let a=s.split(r).length-1;
  const countPattern = 'let a=s.split(r).length-1;';
  if (!patchedFunc.includes(countPattern)) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 3 failed - split pattern not found'
    );
    return null;
  }

  // Build the conditional count expression. When v is truthy (ignore_whitespace),
  // we normalize whitespace before splitting. We use String.fromCharCode(10) to
  // avoid template literal escaping issues in minified output.
  const newline = 'String.fromCharCode(10)';
  const trimLine = `s.split(${newline}).map((x)=>x.trim()).join(${newline})`;

  // The new count expression: if ignore_whitespace is set, normalize s and r first.
  const step3Replacement = `let a=v?s.split(${newline}).map((x)=>x.trim()).join(${newline}).split(v?${trimLine}.split(${newline}).map(x=>x.trim()).join(${newline}):r).length-1:s.split(r).length-1;`;

  patchedFunc = patchedFunc.replace(countPattern, step3Replacement);

  // ---- Step 4: Modify the join/replace logic for replace_all case.
  // Original: let l;if(o)l=s.split(r).join(n);else{...}
  const joinPattern = `let l;if(o)l=s.split(r).join(n);`;
  if (!patchedFunc.includes(joinPattern)) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 4 failed - join pattern not found'
    );
    return null;
  }

  // Build the conditional replacement. When v is set, normalize strings before joining/replacing.
  const step4Replacement = `let l;if(o){if(v)l=s.split(${newline}).map(x=>x.trim()).join(${newline}).split(r.split(${newline}).map(x=>x.trim()).join(${newline})).join(n);else l=s.split(r).join(n);}else{`;

  patchedFunc = patchedFunc.replace(joinPattern, step4Replacement);

  // ---- Step 5: Modify the single-replace case (replace_all=false) for ignore_whitespace.
  // Original: l=s.replace(r,()=>n)
  const replacePattern = `l=s.replace(r,()=>n)`;
  if (!patchedFunc.includes(replacePattern)) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 5 failed - replace pattern not found'
    );
    return null;
  }

  // When v is set and replace_all is false, normalize both old_string and new_string.
  const step5Replacement = `l=v?s.split(${newline}).map(x=>x.trim()).join(${newline}).replace(r.split(${newline}).map(x=>x.trim()).join(${newline}),()=>n.split(${newline}).map(x=>x.trim()).join(${newline})):s.replace(r,()=>n)`;

  patchedFunc = patchedFunc.replace(replacePattern, step5Replacement);

  // ---- Step 6: Modify the uniqueness check to use normalized strings.
  // The error message `edit: old_string appears ${a} times in ${t} (must be unique)` is unchanged.
  // But we need to update the throw statement that wraps it with the dynamic error class.

  // ---- Step 7: Modify the write call to use normalized content.
  // Original: await <writeFileId>(i,l) — l is already computed above, so no change needed here.

  const newFile =
    oldFile.slice(0, funcStartIdx) +
    patchedFunc +
    oldFile.slice(funcEndIdx + 15);

  showDiff(
    oldFile,
    newFile,
    'ignore_whitespace parameter added to edit tool',
    funcStartIdx,
    funcStartIdx + funcContent.length - endMarker.length
  );

  return newFile;
};
