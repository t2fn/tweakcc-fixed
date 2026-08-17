// Please see the note about writing patches in ./index

import { showDiff } from './index';

/**
 * Adds Ctrl+Backspace (delete word backward) and Ctrl+Shift+Backspace (delete line backward)
 * to Claude Code's editor/prompt input area.
 *
 * This patch intercepts keyboard events in the text input handler and adds custom handling for:
 * - Ctrl+Backspace: Delete the word before the cursor
 * - Ctrl+Shift+Backspace: Delete from cursor to beginning of line
 *
 * The patch uses multiple fallback patterns to find keyboard event handlers in minified code,
 * since the exact structure varies between Claude Code versions. It handles both traditional
 * `function X(e){}` and arrow-function `X=(e)=>{...}` style handlers.
 */
export const writeCtrlBackspace = (oldFile: string): string | null => {
  // Try multiple patterns to find a keyboard event handler

  const DEBUG = false; // Set to true to see which pattern matches where
  const debugLog = (msg: string) => {
    if (DEBUG) console.log('[ctrlBackspace]', msg);
  };

  // Pattern A: Function assignment with event parameter that references .key comparison
  // Example: ,h=function(e){if(e.key==="Backspace")...} or ;h=function(e){...e.key=="backspace"...}
  // Requires `.key` followed by `===`/`==` and then a key name string literal.
  // The negative lookahead (?![\w]) prevents matching .keyType, .keyCode etc.
  const patternA =
    /(^|[,;{}()[]|&!<>?:])=function\(([$\w]+)\)\{[^}]*?\.key(?![\w])\s*(?:===|==)\s*["'](Backspace|backspace|Enter|enter|Escape|escape|Delete|delete|Tab|tab|Space|space)["']/;

  let match = oldFile.match(patternA);
  if (match && match.index !== undefined) {
    debugLog(
      'Pattern A matched at index ' + match.index + ', param=' + match[2]
    );
    // Verify this is at a proper statement boundary, not inside an expression
    const beforeChar = match[1];
    if (
      beforeChar === '' ||
      beforeChar === ',' ||
      beforeChar === ';' ||
      beforeChar === '{' ||
      beforeChar === '(' ||
      beforeChar === ')' ||
      beforeChar === '[' ||
      beforeChar === ']'
    ) {
      // Find the function body opening brace by counting braces backward from match end.
      const matchEnd = match.index! + match[0].length;
      let braceDepth = 0;
      let funcBodyStart = -1;
      for (let i = matchEnd - 1; i >= match.index; i--) {
        if (oldFile[i] === '}') braceDepth++;
        else if (oldFile[i] === '{') {
          if (braceDepth === 0) {
            funcBodyStart = i + 1; // Insert AFTER the opening brace
            break;
          }
          braceDepth--;
        }
      }
      if (funcBodyStart !== -1) {
        debugLog(
          'Pattern A: injecting at function body start ' + funcBodyStart
        );
        return injectAtFunctionBody(oldFile, funcBodyStart);
      }
    }
  }

  // Pattern B: process.stdin.on("data",...) handler
  const patternB = /process\.stdin\.on\(["']data["'],function\(([$\w]+)\)\{/;
  match = oldFile.match(patternB);
  if (match && match.index !== undefined) {
    debugLog('Pattern B matched at index ' + match.index);
    return injectAtFunctionBody(
      oldFile,
      match.index! + match[0].lastIndexOf('{')
    );
  }

  // Pattern C: Arrow-function keyboard handler
  // Example: _JS=(_He)=>{if(XIt){return}if(_He.key==="escape"){...}}
  // Matches arrow functions assigned to variables that contain key event comparisons.
  // Instead of returning on the first match, collect all candidates and pick the best one:
  interface ArrowCandidate {
    index: number;
    param: string;
    braceStart: number;
    funcBodyEnd: number;
    bodyText: string;
    score: number;
  }

  const patternC = /([$\w]+)\s*=\s*\(([$\w]+)\)\s*=>\s*\{/g;
  let m_c: RegExpExecArray | null;
  const candidates: ArrowCandidate[] = [];
  while ((m_c = patternC.exec(oldFile)) !== null) {
    // Skip matches that appear to be inside string literals — check for odd
    // numbers of quotes before/after the match. If we're inside a string, the
    // brace counting and injection would produce invalid syntax.
    const preChar = oldFile[m_c.index! - 1];
    const postIdx = m_c.index! + m_c[0].length;
    const postChar = oldFile[postIdx];
    if (preChar === "'" || preChar === '"' || preChar === '`') continue;
    if (postChar === "'" || postChar === '"' || postChar === '`') continue;

    // Verify this is a keyboard event handler by checking the body for .key comparisons.
    const braceStart = oldFile.indexOf('{', m_c.index! + m_c[0].length - 1);
    if (braceStart < 0) continue;
    // Find matching closing brace to get full function body
    let depth = 1;
    let funcBodyEnd = -1;
    for (let i = braceStart + 1; i < oldFile.length && depth > 0; i++) {
      if (oldFile[i] === '{') depth++;
      else if (oldFile[i] === '}') {
        depth--;
        if (depth === 0) funcBodyEnd = i;
      }
    }
    if (!funcBodyEnd || funcBodyEnd <= braceStart) continue;
    const bodyText = oldFile.slice(braceStart + 1, funcBodyEnd);

    // Must have .key comparison (not .name or other property) with a string literal.
    // The negative lookahead (?![\w]) prevents matching .keyCode etc.
    if (!/\.key(?![\w])\s*(?:===|==)\s*["']/.test(bodyText)) continue;

    const hasPreventDefault = /preventDefault/.test(bodyText);
    const hasModifierKeys = /ctrlKey|metaKey|shiftKey|\.ctrl\b|\b\.meta\b/.test(
      bodyText
    );
    const hasBackspaceComp = /["'](Backspace|backspace)["']/.test(bodyText);

    // Only consider it a keyboard handler if it has .key comparisons AND at least one indicator
    if (hasPreventDefault || hasModifierKeys || hasBackspaceComp) {
      let score = 0;
      // Strongly prefer functions that handle backspace (our patch is about Ctrl+Backspace)
      if (hasBackspaceComp) score += 1000;
      if (hasModifierKeys) score += 200;
      if (hasPreventDefault) score += 50;
      // Prefer shorter function bodies (more focused handlers, less likely to break things)
      score -= Math.min(bodyText.length / 100, 50);
      candidates.push({
        index: m_c.index!,
        param: m_c[2],
        braceStart,
        funcBodyEnd,
        bodyText,
        score,
      });
    }
  }

  if (candidates.length > 0) {
    // Pick the highest-scoring candidate
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    debugLog(
      'Pattern C: best candidate param=' +
        best.param +
        ' (score=' +
        best.score +
        ') at idx ' +
        best.index
    );
    // Always inject with newlines (multiLine=true) — the single-line variant
    // starts with "// === ..." which swallows the rest of that line as a comment,
    // breaking any original code that follows on the same line.
    return injectAtFunctionBody(oldFile, best.braceStart + 1, best.param, true);
  }

  // Pattern D: Generic function with .key comparison to a string literal.
  // Example: function X(e){if(e.key==="escape")...} or function Y(t){t.key=="Enter"...}
  // Requires `.key` followed by `===`/`==` and a quoted string (not variable).
  // The negative lookahead (?![\w]) prevents matching .keyType, .keyCode etc.
  const patternD =
    /function\s+[\w$]+\([^)]+\)\s*\{[^}]*?\.key(?![\w])\s*(?:===|==)\s*["'][^"']*["']/;
  match = oldFile.match(patternD);
  if (match && match.index !== undefined) {
    debugLog('Pattern D matched at index ' + match.index);
    // Find the opening brace of this function body
    const funcStart = oldFile.indexOf(
      '{',
      match.index! + match[0].lastIndexOf('(')
    );
    if (funcStart >= 0) {
      // Verify it's actually a keyboard handler by checking for preventDefault,
      // modifier keys, or known key names in the full function body.
      let depth = 1;
      let funcEnd = -1;
      for (let i = funcStart + 1; i < oldFile.length && depth > 0; i++) {
        if (oldFile[i] === '{') depth++;
        else if (oldFile[i] === '}') {
          depth--;
          if (depth === 0) funcEnd = i;
        }
      }
      if (funcEnd > funcStart) {
        const fullBody = oldFile.slice(funcStart + 1, funcEnd);
        const isKeyboardHandler =
          /preventDefault|ctrlKey|metaKey|shiftKey/.test(fullBody) ||
          /["'](Backspace|backspace|Enter|enter|Escape|escape|Delete|delete|Tab|tab|Space|space)["']/i.test(
            fullBody
          );
        if (isKeyboardHandler) {
          debugLog(
            'Pattern D: injecting at function body start ' + (funcStart + 1)
          );
          return injectAtFunctionBody(oldFile, funcStart + 1);
        } else {
          debugLog('Pattern D: skipped - not a keyboard handler');
        }
      }
    }
  }

  // Pattern E: Last resort - find any function that processes key events
  // Look for patterns like: e.key==="Backspace" or e.key=="backspace"
  const patternE = /([$\w]+)\.key\s*===\s*["'](?:Backspace|backspace)["']/;
  match = oldFile.match(patternE);
  if (match && match.index !== undefined) {
    // Walk backwards to find the enclosing function or arrow-function body
    let braceDepth = 0;
    let funcStart = -1;
    for (let i = match.index! - 1; i >= 0; i--) {
      if (oldFile[i] === '}') braceDepth++;
      else if (oldFile[i] === '{') {
        if (braceDepth === 0) {
          funcStart = i;
          break;
        }
        braceDepth--;
      }
    }

    // Also check if this is inside an arrow function by looking for => before the brace
    let paramVar = 'e'; // default parameter name for injected code
    if (funcStart !== -1) {
      const beforeBrace = oldFile.slice(Math.max(0, funcStart - 80), funcStart);
      const arrowMatch = beforeBrace.match(/\)\s*=>\s*$/);
      if (arrowMatch) {
        // Find the parameter name from the arrow function signature
        const parenEnd = funcStart - 1;
        let pDepth = 0;
        for (let j = parenEnd; j >= Math.max(0, parenEnd - 200); j--) {
          if (oldFile[j] === ')') pDepth++;
          else if (oldFile[j] === '(') {
            if (pDepth === 1) {
              const paramStr = oldFile.slice(j + 1, parenEnd);
              // Extract the first parameter name
              const paramMatch = paramStr.match(/[\w$]+/);
              if (paramMatch) paramVar = paramMatch[0];
            }
            break;
          }
        }
      } else {
        // Regular function - extract parameter name from signature
        const funcDeclStart = oldFile.lastIndexOf('function', funcStart);
        if (funcDeclStart >= 0) {
          const parenOpen = oldFile.indexOf('(', funcDeclStart);
          const parenClose = oldFile.indexOf(')', parenOpen);
          if (parenOpen > -1 && parenClose > parenOpen) {
            const paramStr = oldFile.slice(parenOpen + 1, parenClose);
            const paramMatch = paramStr.match(/[\w$]+/);
            if (paramMatch) paramVar = paramMatch[0];
          }
        }
      }
    }

    if (funcStart !== -1) {
      return injectAtFunctionBody(oldFile, funcStart + 1, paramVar);
    }
  }

  console.error(
    'patch: ctrlBackspace: failed to find keyboard event handler pattern'
  );
  return null;
};

/**
 * Find the opening brace of a function and inject code after it.
 * @param oldFile The original file content
 * @param insertIdx Index right after the opening `{` where code will be inserted
 * @param paramName Name of the event parameter (e, _He, etc.) - used in injected code
 * @param multiLine If true, inject as multi-line formatted code; if false, inject as single-line
 */
function injectAtFunctionBody(
  oldFile: string,
  insertIdx: number,
  paramName: string = 'e',
  multiLine: boolean = true
): string {
  const insertion = buildCtrlBackspaceCode(paramName, multiLine);
  const newFile =
    oldFile.slice(0, insertIdx) + insertion + oldFile.slice(insertIdx);
  showDiff(oldFile, newFile, insertion, insertIdx, insertIdx);
  return newFile;
}

/**
 * Build the Ctrl+Backspace and Ctrl+Shift+Backspace handling code.
 * @param paramName Name of the event parameter (e.g., 'e', '_He') used in the handler
 * @param multiLine If true, format with newlines/indentation; if false, compress to single line
 */
function buildCtrlBackspaceCode(
  paramName: string,
  multiLine: boolean = true
): string {
  // This code is injected into a keyboard event handler function body.
  // It handles:
  // - Ctrl+Backspace: Delete word backward (skips whitespace, finds word boundary)
  // - Ctrl+Shift+Backspace: Delete line backward (from cursor to start of line)

  if (multiLine) {
    return `
// === Ctrl+Backspace / Ctrl+Shift+Backspace handling ===
// Ctrl+Backspace: Delete word backward
if((${paramName}.ctrlKey||${paramName}.metaKey)&&${paramName}.key==="Backspace"&&!${paramName}.shiftKey){
  ${paramName}.preventDefault&&${paramName}.preventDefault();
  let val=document.activeElement?.value??"";
  let pos=document.activeElement?.selectionStart??0;
  if(val&&pos>0){
    // Skip trailing whitespace before deleting
    while(pos>0&&(val[pos-1]==" "||val[pos-1]=="\\t"))pos--;
    // Find word boundary (go back until space/tab)
    let start=pos;
    while(start>0&&val[start-1]!==" "&&val[start-1]!=="\\t")start--;
    if(start<pos){
      const el=document.activeElement;
      if(el&&el.setSelectionRange)el.setSelectionRange(start,pos);
      // Use DOM API if available (web-based editors), otherwise direct manipulation
      if(typeof document!=="undefined"&&document.execCommand){
        document.execCommand("delete");
      }else if(el){
        let newVal=val.substring(0,start)+val.substring(pos);
        el.value=newVal;
        el.selectionStart=el.selectionEnd=start;
        if(el.dispatchEvent)el.dispatchEvent(new Event("input",{bubbles:true}));
      }
    }
  }
}
// Ctrl+Shift+Backspace: Delete line backward (from cursor to start of current line)
if(${paramName}.ctrlKey&&${paramName}.shiftKey&&${paramName}.key==="Backspace"){
  ${paramName}.preventDefault&&${paramName}.preventDefault();
  let val=document.activeElement?.value??"";
  let pos=document.activeElement?.selectionStart??0;
  if(val&&pos>0){
    // Find line start (go back until newline or beginning)
    let lineStart=pos;
    while(lineStart>0&&val[lineStart-1]!=="\\n")lineStart--;
    if(lineStart<pos){
      const el=document.activeElement;
      if(el&&el.setSelectionRange)el.setSelectionRange(lineStart,pos);
      if(typeof document!=="undefined"&&document.execCommand){
        document.execCommand("delete");
      }else if(el){
        let newVal=val.substring(0,lineStart)+val.substring(pos);
        el.value=newVal;
        el.selectionStart=el.selectionEnd=lineStart;
        if(el.dispatchEvent)el.dispatchEvent(new Event("input",{bubbles:true}));
      }
    }
  }
}`;
  } else {
    // Single-line version for arrow functions embedded in long single lines
    return `// === Ctrl+Backspace / Ctrl+Shift+Backspace handling ===if((${paramName}.ctrlKey||${paramName}.metaKey)&&${paramName}.key==="Backspace"&&!${paramName}.shiftKey){${paramName}.preventDefault&&${paramName}.preventDefault();let val=document.activeElement?.value??"";let pos=document.activeElement?.selectionStart??0;if(val&&pos>0){while(pos>0&&(val[pos-1]==" "||val[pos-1]=="\\t"))pos--;let start=pos;while(start>0&&val[start-1]!==" "&&val[start-1]!=="\\t")start--;if(start<pos){const el=document.activeElement;if(el&&el.setSelectionRange)el.setSelectionRange(start,pos);if(typeof document!=="undefined"&&document.execCommand){document.execCommand("delete");}else if(el){let newVal=val.substring(0,start)+val.substring(pos);el.value=newVal;el.selectionStart=el.selectionEnd=start;if(el.dispatchEvent)el.dispatchEvent(new Event("input",{bubbles:true}));}}}}if(${paramName}.ctrlKey&&${paramName}.shiftKey&&${paramName}.key==="Backspace"){${paramName}.preventDefault&&${paramName}.preventDefault();let val=document.activeElement?.value??"";let pos=document.activeElement?.selectionStart??0;if(val&&pos>0){let lineStart=pos;while(lineStart>0&&val[lineStart-1]!=="\\n")lineStart--;if(lineStart<pos){const el=document.activeElement;if(el&&el.setSelectionRange)el.setSelectionRange(lineStart,pos);if(typeof document!=="undefined"&&document.execCommand){document.execCommand("delete");}else if(el){let newVal=val.substring(0,lineStart)+val.substring(pos);el.value=newVal;el.selectionStart=el.selectionEnd=lineStart;if(el.dispatchEvent)el.dispatchEvent(new Event("input",{bubbles:true}));}}}}`;
  }
}
