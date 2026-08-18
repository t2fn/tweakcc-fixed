// Patch: Add ignore_whitespace support to the edit tool (kVc function) in Claude Code v2.7.31

import { LocationResult, showDiff } from './index';

const getEditToolLocation = (oldFile: string): LocationResult | null => {
  const pattern = /function kVc\(e\)\{return Q6t\(\{name:"edit"/;
  const match = oldFile.match(pattern);

  if (!match || match.index === undefined) {
    console.error(
      'patch: ignoreWhitespaceEdit: failed to find edit tool function kVc'
    );
    return null;
  }

  return {
    startIndex: match.index,
    endIndex: match.index + match[0].length,
    identifiers: [],
  };
};

export const writeIgnoreWhitespaceEdit = (oldFile: string): string | null => {
  const location = getEditToolLocation(oldFile);
  if (!location) {
    console.error('patch: ignoreWhitespaceEdit: could not find kVc function');
    return null;
  }

  // Find the exact function boundaries using known markers
  const startMarker = 'function kVc(e){return Q6t({name:"edit"';
  const endMarker = '}})}function CVc';

  const funcStart = oldFile.indexOf(startMarker);
  const funcEnd = oldFile.indexOf(endMarker, funcStart);

  if (funcStart === -1 || funcEnd === -1) {
    console.error(
      `patch: ignoreWhitespaceEdit: failed to locate function boundaries. funcStart=${funcStart}, funcEnd=${funcEnd}`
    );
    return null;
  }

  const funcContent = oldFile.slice(funcStart, funcEnd + endMarker.length);

  // Check if we've already patched this — look for our specific marker
  const hasIgnoreWs = funcContent.includes(
    'additionalProperties:{ignore_whitespace'
  );
  if (hasIgnoreWs) {
    console.log('patch: ignoreWhitespaceEdit: already patched, skipping');
    return null;
  }

  console.log(
    `patch: ignoreWhitespaceEdit: found kVc function at index ${funcStart}, length ${funcContent.length}`
  );

  // Step 1: Add ignore_whitespace to input schema properties and required array
  const step1Regex =
    /}},required:\["file_path","old_string","new_string"\]\},run:async/;
  const withSchema = funcContent.replace(step1Regex, match => {
    console.log('patch: ignoreWhitespaceEdit: Step 1 regex matched:', match);
    return `}},additionalProperties:{ignore_whitespace:{type:"boolean"}},required:["file_path","old_string","new_string"]},run:async`;
  });
  if (withSchema === funcContent) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 1 failed - regex did not match'
    );
    return null;
  }

  // Step 2: Add ignore_whitespace parameter to function signature (use 'v' since kVc uses i,c,u,a,l)
  const step2Regex =
    /run:async\(\{file_path:t,old_string:r,new_string:n,replace_all:o\}\)=>/;
  const withParam = withSchema.replace(
    step2Regex,
    'run:async({file_path:t,old_string:r,new_string:n,replace_all:o,ignore_whitespace:v=false})=>'
  );
  if (withParam === withSchema) {
    console.error(
      'patch: ignoreWhitespaceEdit: Step 2 failed - regex did not match'
    );
    return null;
  }

  // Step 3: Modify the replacement logic to handle ignore_whitespace
  const step3Pattern =
    'let a=s.split(r).length-1;if(a===0)throw new Nv(`edit: old_string not found in ${t}`);';
  let patchedFunc = withParam;
  if (withParam.includes(step3Pattern)) {
    // Use string concatenation to build the replacement, inserting actual newline char codes at runtime
    const step3Replacement =
      'let a=v?s.split(String.fromCharCode(10)).map((x)=>x.trim()).join(String.fromCharCode(10)).split(v?r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)):r).length-1:s.split(r).length-1;if(a===0)throw new Nv(`edit: old_string not found in ${t}`);';
    patchedFunc = withParam.replace(step3Pattern, step3Replacement);
  } else {
    console.error('patch: ignoreWhitespaceEdit: Step 3 pattern not found');
    return null;
  }

  // Step 4: Modify the join logic for replace_all case
  const step4Pattern =
    'let l;if(o)l=s.split(r).join(n);else{if(a>1)throw new Nv(`edit: old_string appears ${a} times in ${t} (must be unique)`);l=s.replace(r,()=>n)}';
  let finalFunc = patchedFunc;
  if (patchedFunc.includes(step4Pattern)) {
    const step4Replacement =
      'let l;if(o){if(v)l=s.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)).split(r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10))).join(n.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)));else l=s.split(r).join(n);}else{if(a>1)throw new Nv(`edit: old_string appears ${a} times in ${t} (must be unique)`);l=v?s.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)).replace(r.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10)),()=>n.split(String.fromCharCode(10)).map(x=>x.trim()).join(String.fromCharCode(10))):s.replace(r,()=>n);}';
    finalFunc = patchedFunc.replace(step4Pattern, step4Replacement);
  } else {
    console.error('patch: ignoreWhitespaceEdit: Step 4 pattern not found');
    return null;
  }

  const newFile =
    oldFile.slice(0, funcStart) +
    finalFunc +
    oldFile.slice(funcEnd + endMarker.length);

  showDiff(
    oldFile,
    newFile,
    'ignore_whitespace parameter added to edit tool',
    funcStart,
    funcStart + funcContent.length - endMarker.length
  );
  return newFile;
};
