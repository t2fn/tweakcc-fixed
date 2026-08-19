// Patch: Add ignore_whitespace support to the edit tool in Claude Code.
// Works across versions by anchoring on stable structural strings rather than
// minified identifiers (function names, variable names) that change between releases.

import { LocationResult, showDiff } from './index';

/** Regex anchor — matches the run function signature regardless of variable names used. */
const BODY_START_RE = /run:async\(\{file_path:[a-zA-Z_$]+,old_string:[a-zA-Z_$]+,new_string:[a-zA-Z_$]+,replace_all:[a-zA-Z_$]+\}\)=>\{if\(![a-zA-Z_$]+\)/;

/** Regex anchor — matches the error message regardless of variable names used. */
const MID_BODY_RE = /`edit: old_string appears \$\{[a-zA-Z_$]+\} times in \$\{[a-zA-Z_$]+\} \(must be unique\)`/;

// Exact-match anchors for steps where we know the stable variable names (t, r, n, o).
// These are tried first for reliability; flexible regex fallbacks handle version drift.
const SCHEMA_EXACT = 'replace_all:{type:"boolean"}},required:["file_path","old_string","new_string"]}';

// ============================================================================
// Location helpers — find edit tool boundaries by stable structural anchors
// ============================================================================

export const getEditToolLocation = (oldFile: string): LocationResult | null => {
  // Find the start of the edit tool's run function body using flexible regex.
  // This matches regardless of what single-letter variable names Anthropic uses.
  const bodyMatch = oldFile.match(BODY_START_RE);
  if (!bodyMatch || bodyMatch.index === undefined) return null;

  // Walk backward to find the `function <name>(e){` start of this tool.
  let searchFrom = Math.max(0, bodyMatch.index - 250);
  const prevBoundary = oldFile.lastIndexOf('}})}function', bodyMatch.index - 10);
  if (prevBoundary !== -1) {
    searchFrom = prevBoundary + '}})}function'.length;
  }

  const funcDefMatch = oldFile.substring(searchFrom).match(/([a-zA-Z_$][\w$]*)\(e\)\{return\s+G9t/);
  if (!funcDefMatch) {
    console.error('patch: ignoreWhitespaceEdit: failed to find edit tool function definition');
    return null;
  }

  const funcName = funcDefMatch[1];
  const actualStart = searchFrom + funcDefMatch.index!;

  // Find the end boundary: next }})}function after MID_BODY (next tool)
  const midMatch = oldFile.match(MID_BODY_RE);
  if (!midMatch || midMatch.index === undefined) {
    console.error('patch: ignoreWhitespaceEdit: failed to find mid-body anchor');
    return null;
  }

  let endSearchFrom = Math.max(midMatch.index + midMatch[0].length, bodyMatch.index + bodyMatch[0].length);
  const nextBoundary = oldFile.indexOf('}})}function', endSearchFrom);
  if (nextBoundary === -1) {
    console.error('patch: ignoreWhitespaceEdit: failed to find edit tool end boundary');
    return null;
  }

  return {
    startIndex: actualStart,
    endIndex: nextBoundary + '}})}function'.length,
    identifiers: [funcName],
  };
};

// ============================================================================
// Core patching logic — step-by-step replacements within the edit tool body.
// Each step tries an exact match first (reliable), then a flexible regex fallback.
// ============================================================================

export const writeIgnoreWhitespaceEdit = (oldFile: string): string | null => {
  // 1. Find the edit tool boundaries dynamically using stable strings
  const location = getEditToolLocation(oldFile);
  if (!location) return null;

  const funcStart = location.startIndex;
  const funcEndIdx = location.endIndex;
  const funcContent = oldFile.slice(funcStart, funcEndIdx);

  // Check if we've already patched this — look for our specific marker
  if (funcContent.includes('additionalProperties:{ignore_whitespace')) {
    console.log('patch: ignoreWhitespaceEdit: already patched, skipping');
    return null;
  }

  const funcName = location.identifiers?.[0] ?? 'edit';
  console.log(
    `patch: ignoreWhitespaceEdit: found ${funcName} function at index ${funcStart}, length ${funcContent.length}`
  );

  let patchedFunc = funcContent;

  // -----------------------------------------------------------------------
  // Step 1: Add ignore_whitespace to input schema properties.
  // Anchor on the stable structural text of the tool's JSON-schema definition.
  // -----------------------------------------------------------------------
  const step1Replacement =
    'replace_all:{type:"boolean"}},additionalProperties:{ignore_whitespace:{type:"boolean"}},required:["file_path","old_string","new_string"]}';

  if (patchedFunc.includes(SCHEMA_EXACT)) {
    patchedFunc = patchedFunc.replace(SCHEMA_EXACT, step1Replacement);
  } else {
    console.error('patch: ignoreWhitespaceEdit: Step 1 failed — schema anchor not found');
    return null;
  }

  // -----------------------------------------------------------------------
  // Step 2: Add ignore_whitespace parameter to the run function signature.
  // Exact match on known variable names (t, r, n, o), with regex fallback for version drift.
  // -----------------------------------------------------------------------
  const step2Exact = 'run:async({file_path:t,old_string:r,new_string:n,replace_all:o})=>';
  const step2Replacement = 'run:async({file_path:t,old_string:r,new_string:n,replace_all:o,ignore_whitespace:v=false})=>';

  if (patchedFunc.includes(step2Exact)) {
    patchedFunc = patchedFunc.replace(step2Exact, step2Replacement);
  } else {
    // Flexible fallback: matches any variable names in the destructuring
    const step2FlexRe = /run:async\(\{file_path:[a-zA-Z_$]+,old_string:[a-zA-Z_$]+,new_string:[a-zA-Z_$]+,replace_all:[a-zA-Z_$]+\}\)=>/;
    if (step2FlexRe.test(patchedFunc)) {
      patchedFunc = patchedFunc.replace(
        step2FlexRe,
        'run:async({file_path:t,old_string:r,new_string:n,replace_all:o,ignore_whitespace:v=false})=>'
      );
    } else {
      console.error('patch: ignoreWhitespaceEdit: Step 2 failed — parameter pattern not found');
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Modify the replacement-count logic to handle ignore_whitespace.
  // The original uses cS as error class (not Nv) in CC >=~2.1.200+.
  // Flexible regex handles any variable/error-class names.
  // -----------------------------------------------------------------------
  const step3Exact = 'let a=s.split(r).length-1;if(a===0)throw new cS(`edit: old_string not found in ${t}`);';

  if (patchedFunc.includes(step3Exact)) {
    const step3Replacement =
      'let a=v?s.split(String.fromCharCode(10)).map((x)=>x.trim()).join(String.fromCharCode(10)).split(v?r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)):r).length-1:s.split(r).length-1;if(a===0)throw new cS(`edit: old_string not found in ${t}`);';
    patchedFunc = patchedFunc.replace(step3Exact, step3Replacement);
  } else {
    // Flexible fallback: match any variable/error-class names
    const step3FlexRe = /let a=[\w$]+\.split\([\w$]+\)\.length-1;if\(a===0\)throw new [\w$]+/;
    if (step3FlexRe.test(patchedFunc)) {
      patchedFunc = patchedFunc.replace(
        step3FlexRe,
        'let a=v?s.split(String.fromCharCode(10)).map((x)=>x.trim()).join(String.fromCharCode(10)).split(v?r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)):r).length-1:s.split(r).length-1;if(a===0)throw new cS(`edit: old_string not found in ${t}`);'
      );
    } else {
      console.error('patch: ignoreWhitespaceEdit: Step 3 failed — count pattern not found');
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Modify the join/replace logic for replace_all and single-match cases.
  // Exact match on known variable names, with flexible regex fallback.
  // -----------------------------------------------------------------------
  const step4Exact = 'let l;if(o)l=s.split(r).join(n);else{if(a>1)throw new cS(`edit: old_string appears ${a} times in ${t} (must be unique)`);l=s.replace(r,()=>n)}';

  if (patchedFunc.includes(step4Exact)) {
    const step4Replacement =
      'let l;if(o){if(v)l=s.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)).split(r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10))).join(n.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)));else l=s.split(r).join(n);}else{if(a>1)throw new cS(`edit: old_string appears ${a} times in ${t} (must be unique)`);l=v?s.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)).replace(r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)),()=>n.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10))):s.replace(r,()=>n);}';
    patchedFunc = patchedFunc.replace(step4Exact, step4Replacement);
  } else {
    // Flexible fallback: match any variable/error-class names
    const step4FlexRe = /let l;if\(o\)l=[\w$]+\.split\([\w$]+\)\.join\([\w$]+\);else\{if\(a>1\)throw new [\w$]+/;
    if (step4FlexRe.test(patchedFunc)) {
      const step4FbRepl = 'let l;if(o){if(v)l=s.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)).split(r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10))).join(n.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)));else l=s.split(r).join(n);}else{if(a>1)throw new cS(' + '`edit: old_string appears ${a} times in ${t} (must be unique)`' + ');l=v?s.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)).replace(r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)),()=>n.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10))):s.replace(r,()=>n);}';
      patchedFunc = patchedFunc.replace(step4FlexRe, step4FbRepl);
    } else {
      console.error('patch: ignoreWhitespaceEdit: Step 4 failed — join pattern not found');
      return null;
    }
  }

  // Reassemble the full file with only the edit tool replaced
  const newFile = oldFile.slice(0, funcStart) + patchedFunc + oldFile.slice(funcEndIdx);

  showDiff(
    oldFile,
    newFile,
    'ignore_whitespace parameter added to edit tool',
    funcStart,
    funcContent.length
  );
  return newFile;
};
