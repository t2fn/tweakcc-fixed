// FileEditTool Whitespace Normalization Patch - Enhance Edit tool for tabs↔spaces mismatch
//
// Injects whitespace-aware fallback into the edit logic section of bundled code.
// This enables the Edit tool to match and replace text even when indentation style differs
// between what the model sends (e.g., spaces) and what the file uses (e.g., tabs).
//
// Two features controlled by env vars:
// - WHITESPACE_HELPER (env DISABLE_WHITESPACE_HELPER=1): Core tab/space switcharoo + ratio matching
//   Performs full whitespace composition analysis, proportional alignment detection, and cross-char conversion.
//   Example: file has 3-space indent, model sends code with 1-tab indent → converts correctly.
// - TARGET_INDENTATION_MATCHING (env DISABLE_TARGET_INDENTATION_MATCHING=1): The getMatchingLines() function
//   used by applyPrefixSwap/applyPrefixMultiply for finding matching lines in the target file.
//   When disabled, falls back to simple prefix replacement without line-by-line matching.
//
// Patch strategy:
// 1. Inject helper functions BEFORE the edit apply function (NPM: applyEditToFile, Native: xvd call site)
// 2. Modify existing try-catch block around edit call to invoke helpers on failure

import { showDiff } from './index';
import WH_HELPERS from './_wsh_helpers.json' with { type: 'json' };

const MINIFIED_HELPERS = WH_HELPERS.helpers;

// Stable anchor for NPM cli.js: the readable function name survives bundling.
const APPLY_EDIT_ANCHOR = 'applyEditToFile';

/**
 * Convert escaped \n sequences in minified JS to real newlines.
 * Preserves those inside string literals and regex patterns.
 */
function replaceEscapedNewlines(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    // Skip real newline characters (already fine)
    if (c.charCodeAt(0) === 10) continue;

    // Check for escaped \n (backslash followed by 'n')
    if (c === '\\' && i + 1 < s.length && s[i + 1] === 'n') {
      const pos = i;

      // Count quotes before this position to detect string literal context
      let sq = 0,
        dq = 0;
      for (let j = 0; j < pos; j++) {
        if (s[j] === '\\' && j + 1 < s.length) {
          if (s[j + 1] === "'") sq++;
          else if (s[j + 1] === '"') dq++;
          j++; // skip escaped char for quote counting
        } else if (s[j] === "'") {
          sq++;
        } else if (s[j] === '"') {
          dq++;
        }
      }

      const insideString = sq % 2 !== 0 || dq % 2 !== 0;

      // Check bracket depth — should be 0 outside arrays/objects
      let bd = 0;
      for (let j = 0; j < pos; j++) {
        if (s[j] === '[') bd++;
        else if (s[j] === ']') bd--;
      }

      // Method 1: Immediately after a / → likely inside regex pattern
      let likelyInRegex = false;
      if (pos > 0 && s[pos - 1] === '/') {
        likelyInRegex = true;
      }

      // Method 2: Forward scan from position after \n for regex indicators
      if (!likelyInRegex) {
        const afterPos = pos + 2; // skip past the full \\n escape

        // Skip whitespace after the escape
        let j = afterPos;
        while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;

        if (/[+*?$]/.test(s[j])) {
          likelyInRegex = true;
        } else {
          // Scan forward looking for / before hitting an identifier char
          for (let k = afterPos; k < Math.min(afterPos + 15, s.length); k++) {
            if (s[k] === ' ' || s[k] === '\t') continue;
            if (s[k] === '/') {
              likelyInRegex = true;
              break;
            }
            if (/[a-zA-Z0-9_]/.test(s[k])) break;
          }
        }
      }

      // Replace with real newline only when NOT inside string and NOT in regex context
      if (!insideString && bd <= 0 && !likelyInRegex) {
        result += '\n';
        i++; // skip the 'n' character of this escape pair
      } else {
        result += '\\n';
        i++;
        continue; // skip past both chars of the \\n sequence
      }
    } else {
      result += c;
    }
  }
  return result;
}

/**
 * Build helper injection code for both NPM and native variants.
 */
function buildHelpersInjection(): string {
  const raw = MINIFIED_HELPERS;

  const SQ = "'";
  const tW_GATE_WSH: string =
    'tW_DIS_WSH=tW.DISABLE_WHITESPACE_HELPER === ' +
    SQ +
    '1' +
    SQ +
    '||tW.DISABLE_WHITESPACE_HELPER === ' +
    SQ +
    'true' +
    SQ +
    ';';
  const tW_GATE_TIM: string =
    'tW_DIS_TIM=tW.DISABLE_TARGET_INDENTATION_MATCHING === ' +
    SQ +
    '1' +
    SQ +
    '||tW.DISABLE_TARGET_INDENTATION_MATCHING === ' +
    SQ +
    'true' +
    SQ +
    ';';

  return (
    '// === tweakcc: FileEditTool whitespace normalization helpers ===\n' +
    'var tW=typeof process!=="undefined"?process.env:{};\n' +
    tW_GATE_WSH +
    '\n' +
    tW_GATE_TIM +
    '\n' +
    // Prepend our getNonEmptyLines wrapper, then include the rest of raw (minus its
    // first function definition which we replace). The raw starts with:
    //   function getNonEmptyLines(c){return c.split('\n').filter(function(l){...})}
    // We swap that for our version that calls tW_gnel.
    "function tW_gnel(c){return c.split('\\n').filter(function(l){return l.trim().length>0})}\n" +
    replaceEscapedNewlines(raw.slice(98))
  );
}

/**
 * Inject whitespace helper call into the edit catch block.
 * Uses "String not found in file" anchor which survives minification in both NPM and native builds.
 */
function injectCatchHelper(file: string): string {
  // Anchor: the error message that's unique to our try-catch block (survives minification)
  const anchor = 'String not found in file';

  let lastIdx = -1;
  for (let i = 0; i < Math.min(3, 2); i++) {
    const idx = file.indexOf(anchor, lastIdx + 1);
    if (idx === -1) break;
    lastIdx = idx;

    // Look FORWARD from anchor to find the catch block start.
    // The first "String not found" is inside an if-block string literal;
    // the catch block comes AFTER it: ...if(x){"String not found in file");}catch(e){...
    const searchForward = file.slice(
      lastIdx,
      Math.min(file.length, lastIdx + 500)
    );
    const catchIdxInSlice = searchForward.indexOf('catch(');
    if (catchIdxInSlice === -1) continue;

    const absCatchIdx = lastIdx + catchIdxInSlice;

    // Find the throw statement in this catch block
    // Pattern: throw new Error("String not found...) or throw new m2e("String not found...
    const catchBlockContent = file.slice(absCatchIdx, absCatchIdx + 150);
    const throwMatch = catchBlockContent.match(
      /throw\s+new\s+\w+?\(\s*['"]([^'"]+)['"]/
    );
    if (!throwMatch) continue;

    // Check if already patched (look for our function name in vicinity)
    const checkBlock = file.slice(absCatchIdx, lastIdx + 200);
    if (checkBlock.includes('tW_wsAE')) {
      continue; // Already patched
    }

    // Determine the variable names used in this code path by scanning backwards from anchor.
    // In NPM cli.js: "updatedFile=edit.old_string..." → inject using edit.old_string/editedFile
    // In native binary: "<fn>(r,o.old_string..." → inject using r and o.old_string/new_string
    // Search back up to 300 chars from anchor to cover the try block body where .old_string may be.
    const searchStart = Math.max(0, lastIdx - 300);
    const beforeThrow = file.slice(searchStart, lastIdx);

    let varName: string; // the content variable (updatedFile in NPM, r in native)
    let objPrefix: string; // edit. in NPM, o. in native

    if (beforeThrow.match(/\w+\(r,o\.old_string/)) {
      // Native binary pattern: <fn>(r,o.old_string,...) → use r as content var, o. as prefix
      varName = 'r';
      objPrefix = 'o.';
    } else if (beforeThrow.includes('.old_string')) {
      // NPM cli.js pattern: applyEditToFile(updatedFile,edit.old_string,...)
      varName = 'updatedFile';
      objPrefix = 'edit.';
    } else {
      continue; // Can't determine variable names
    }

    // Inject the env-var-gated helper call before the throw statement inside catch block.
    // Find the throw keyword after absCatchIdx.
    const throwMatchPos = file.indexOf('throw', absCatchIdx);
    const insertBefore =
      throwMatchPos >= 0 ? throwMatchPos : absCatchIdx + 'catch('.length;

    // Handle both patterns: the helper call uses varName and objPrefix
    const newHelperCall =
      '\n' +
      '  var tW_wsResult=tW_wsAE(' +
      varName +
      ',' +
      objPrefix +
      'old_string,' +
      objPrefix +
      'new_string);\n' +
      '  if(tW_wsResult!==' +
      varName +
      ')' +
      varName +
      '=tW_wsResult;\n';

    const beforePatched = file;
    file =
      file.slice(0, insertBefore) + newHelperCall + file.slice(insertBefore);

    showDiff(
      beforePatched,
      file,
      'Whitespace helper call in catch block',
      insertBefore,
      insertBefore
    );

    // Orphan removal using proper matching: only remove ) chars that have no
    // preceding ( in the paren stack. This avoids removing legitimate ) chars
    // like from catch(e) even if they appear at pd<=0 due to fix3's depth shift.
    let lastTwoBraces = file.lastIndexOf('}}');
    if (lastTwoBraces >= 0) {
      const matchStack: number[] = [];
      const matchedParens = new Set<number>(); // positions of ) that have a matching ( before them

      for (let i = 0; i < file.length; i++) {
        if (file[i] === '(') {
          matchStack.push(i);
        } else if (file[i] === ')') {
          if (matchStack.length > 0) {
            matchedParens.add(i); // this ) is matched to a preceding (
            matchStack.pop();
          }
        }
      }

      // Find true orphans: ) at pd<=0 that are NOT in matchedParens
      let pd = 0;
      const orphanPositions: number[] = [];
      for (let i = 0; i < file.length; i++) {
        if (file[i] === '(') pd++;
        else if (file[i] === ')') {
          if (pd <= 0 && !matchedParens.has(i)) {
            orphanPositions.push(i); // truly unmatched ) - remove it
          }
          pd--;
        }
      }

      // Remove all true orphans in one pass (backwards to preserve indices during removal)
      for (let i = orphanPositions.length - 1; i >= 0; i--) {
        const pos = orphanPositions[i];
        file = file.slice(0, pos) + '' + file.slice(pos + 1);
      }

      // After removing orphans, check brace depth imbalance. fix3's )→} conversion
      // may leave an unclosed { that needs a } closer before catch to restore the
      // if-block structure: if(cond){...}catch(e){...}.
      lastTwoBraces = file.lastIndexOf('}}');
      let bd = 0;
      for (const ch of file) {
        if (ch === '{') bd++;
        else if (ch === '}') bd--;
      }

      // Find catch( in the MODIFIED file to place brace closers correctly
      const modifiedCatchIdx = file.indexOf('catch(');

      if (bd > 0 && modifiedCatchIdx >= 0) {
        let insertPos = modifiedCatchIdx;
        for (let j = 0; j < bd; j++) {
          file = file.slice(0, insertPos) + '}' + file.slice(insertPos);
          insertPos++;
        }

        showDiff(
          beforePatched,
          file,
          `Added ${bd} brace closer(s) before catch at pos ${modifiedCatchIdx}`,
          insertPos - bd,
          insertPos - 1
        );
      } else if (lastTwoBraces < 0) {
        // Fallback: add closers at end if no }} found (shouldn't happen normally)
        file = file.slice(0, file.length) + '}'.repeat(Math.max(0, bd));
      }
    }

    break; // Only patch the first relevant try-catch we find
  }

  return file;
}

/**
 * Inject whitespace-aware helpers into bundled code and modify try-catch around edit calls.
 * Supports both NPM cli.js (readable function names) and native binary (minified).
 *
 * @param file - The full minified bundled JS content
 * @returns Patched content, or null if anchor not found
 */
export const writeFileEditWhitespace = (file: string): string | null => {
  // Check if already patched
  if (
    file.includes('tW_wsAE') &&
    file.includes('CLAUDE_CODE_WHITESPACE_HELPER')
  )
    return file;

  // Try NPM cli.js strategy first (has readable applyEditToFile anchor)
  const npmResult = patchNpmCli(file);
  if (npmResult) return npmResult;

  // Fall back to native binary strategy
  const nativeResult = patchNativeBinary(file);
  return nativeResult;
};

/**
 * Patch for NPM bundled cli.js with readable function names.
 */
function patchNpmCli(file: string): string | null {
  if (!file.includes(APPLY_EDIT_ANCHOR)) return null;

  // Find the location of applyEditToFile definition in utils section
  const aeIdx = file.indexOf(APPLY_EDIT_ANCHOR);

  // --- INJECTION STEP: Insert helpers before the first occurrence of applyEditToFile ---
  let injectPoint = aeIdx;

  // Search backwards for a semicolon or newline boundary to avoid splitting identifiers
  const before = file.slice(0, injectPoint);
  const semiIdx = before.lastIndexOf(';');
  if (semiIdx >= injectPoint - 200) {
    injectPoint = semiIdx + 1;
  } else {
    const wsMatch = file.slice(Math.max(0, aeIdx - 50), aeIdx).match(/[\s;]+$/);
    if (wsMatch) {
      injectPoint = aeIdx - wsMatch[0].length;
    }
  }

  // Verify helpers don't conflict with existing code at injection point
  const helpersCode = buildHelpersInjection();
  if (
    file
      .slice(injectPoint, injectPoint + helpersCode.length)
      .includes('applyWhitespaceAwareEdit')
  ) {
    return file; // Already patched
  }

  const beforePatch = file;
  file =
    file.slice(0, injectPoint) +
    '\n' +
    helpersCode +
    '\n' +
    file.slice(injectPoint);

  showDiff(
    beforePatch,
    file,
    `Injected ${helpersCode.length} bytes of whitespace helpers (NPM)`,
    injectPoint,
    injectPoint
  );

  // --- CATCH BLOCK STEP: Modify try-catch to gate helper calls with env vars ---
  return injectCatchHelper(file);
}

/**
 * Patch for native binary minified bundle.
 * Uses context-based anchor since applyEditToFile is minified (any identifier).
 */
function patchNativeBinary(file: string): string | null {
  // Find the edit function call site pattern: <fn>(r,o.old_string,...)
  // This is unique to the FileEditTool's try-catch in native builds.
  // We need the function call that appears near "String not found in file" which survives minification.
  // The function name varies across CC versions (xvd, Evp, etc.) so we search generically.
  // Injection only happens at known safe boundaries to avoid breaking Bun's strict single-line parser.

  const anchor = 'String not found in file';
  const anchorIdx = file.indexOf(anchor);
  if (anchorIdx === -1) return null;

  // Search backwards from the error string to find the edit function call in context
  const searchBack = file.slice(Math.max(0, anchorIdx - 500), anchorIdx);
  // Find any function call with old_string/new_string args before "String not found"
  // Pattern: identifier(...old_string...new_string...) where identifier is minified
  const editFuncPattern = /(\w+)\([^)]*old_string[^)]*,[^)]*new_string[^)]*\)/g;
  let lastMatchIdx = -1;
  let bestMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = editFuncPattern.exec(searchBack)) !== null) {
    if (m.index > lastMatchIdx) {
      lastMatchIdx = m.index;
      bestMatch = m;
    }
  }
  if (!bestMatch || lastMatchIdx === -1) return null;

  const absFuncIdx = Math.max(0, anchorIdx - 500) + lastMatchIdx;

  // Verify it's the edit function: must have old_string and new_string as args
  const funcContext = file.slice(absFuncIdx, absFuncIdx + 120);
  if (
    !funcContext.includes('old_string') ||
    !funcContext.includes('new_string')
  ) {
    return null; // Not the edit function — false positive
  }

  // Find injection point: look for the nearest safe function boundary before the edit call.
  // Safe boundaries are positions preceded by '}' (end of previous function) where we can
  // inject without breaking Bun's strict single-line parser.
  const searchFrom = Math.max(0, absFuncIdx - 5000);
  // Match both "function Name(" and minified "functionName(" patterns
  const funcPattern = /function\s*([$\w]+)\s*\(/g;
  let lastSafeFuncStart = -1;
  let funcMatch: RegExpExecArray | null;

  // Search backwards for the last function before our edit call that ends with '}'
  while (
    (funcMatch = funcPattern.exec(file.slice(searchFrom, absFuncIdx))) !== null
  ) {
    const absFuncPos = searchFrom + funcMatch.index;

    // Find the actual body opening brace '{' by skipping past parameter list
    // Parameters may contain parens (for regular params) and braces (for destructuring)
    let scanPos = absFuncPos + funcMatch[0].length;
    while (scanPos < file.length && /[\s)]/.test(file[scanPos])) {
      scanPos++;
    }

    // If next char is '(', skip past the entire parameter list to find '{'
    if (file[scanPos] === '(') {
      let parenDepth = 1;
      scanPos++;
      while (scanPos < file.length && parenDepth > 0) {
        if (file[scanPos] === '(') parenDepth++;
        else if (file[scanPos] === ')') parenDepth--;
        scanPos++;
      }
    }

    // Now scanPos should be at or just past the body opening '{'
    const bodyStart = file.indexOf('{', scanPos);
    if (bodyStart < 0) continue;

    // Count braces from body start to find function end
    let depth = 1;
    let funcEnd = -1;
    for (let i = bodyStart + 1; i < file.length && depth > 0; i++) {
      if (file[i] === '{') depth++;
      else if (file[i] === '}') {
        depth--;
        if (depth === 0) {
          funcEnd = i;
          break;
        }
      }
    }

    // Check if function ends with '}' followed by another function start (safe boundary)
    if (funcEnd >= 0 && funcEnd < absFuncIdx - 50) {
      const afterBrace = file[funcEnd + 1];
      // Safe injection point: any character that's not part of a function body continuation
      // In minified code, functions are typically followed by another function keyword or identifier
      if (afterBrace && !/^[{(;]$/.test(afterBrace)) {
        lastSafeFuncStart = absFuncPos;
      }
    }
  }

  if (lastSafeFuncStart < 0) {
    return null; // No safe injection point found — skip native patching for this CC version
  }

  const injectPoint = lastSafeFuncStart;

  // Verify helpers don't conflict with existing code at injection point
  const helpersCode = buildHelpersInjection();
  if (
    file
      .slice(injectPoint, injectPoint + helpersCode.length)
      .includes('applyWhitespaceAwareEdit')
  ) {
    return file; // Already patched
  }

  const beforePatch = file;
  // Always use \n prefix when injecting into minified single-line code
  // to maintain proper separation from surrounding code
  file =
    file.slice(0, injectPoint) +
    '\n' +
    helpersCode +
    '\n' +
    file.slice(injectPoint);

  showDiff(
    beforePatch,
    file,
    `Injected ${helpersCode.length} bytes of whitespace helpers (Native)`,
    injectPoint,
    injectPoint
  );

  // --- CATCH BLOCK STEP: Modify try-catch to gate helper calls with env vars ---
  return injectCatchHelper(file);
}
