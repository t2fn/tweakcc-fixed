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
 * since the exact structure varies between Claude Code versions.
 */
export const writeCtrlBackspace = (oldFile: string): string | null => {
  // Try multiple patterns to find a keyboard event handler

  // Pattern A: Function assignment with event parameter
  // Example: ,h=function(e){...} or ;h=function(e){...} or let h=function(e){...}
  const patternA = /=function\(([$\w]+)\)\{/;

  let match = oldFile.match(patternA);
  if (match && match.index !== undefined) {
    // This is a strong signal of a handler function - inject here
    const funcStart = oldFile.indexOf(
      '{',
      match.index! + match[0].lastIndexOf('=')
    );
    return injectAtFunctionBody(oldFile, funcStart);
  }

  // Pattern B: process.stdin.on("data",...) handler
  const patternB = /process\.stdin\.on\(["']data["'],function\(([$\w]+)\)\{/;
  match = oldFile.match(patternB);
  if (match && match.index !== undefined) {
    return injectAtFunctionBody(
      oldFile,
      match.index! + match[0].lastIndexOf('{')
    );
  }

  // Pattern C: Generic function with keyboard-related variable names
  const patternC = /function\s+[\w$]+\([^)]+\)\s*{[^}]*e\.key/;
  match = oldFile.match(patternC);
  if (match && match.index !== undefined) {
    const funcStart = oldFile.indexOf(
      '{',
      match.index! + match[0].lastIndexOf('(')
    );
    return injectAtFunctionBody(oldFile, funcStart);
  }

  // Pattern D: Last resort - find any function that processes key events
  // Look for patterns like: e.key==="Backspace" or e.key=="backspace"
  const patternD = /([$\w]+)\.key\s*===\s*["'](?:Backspace|backspace)["']/;
  match = oldFile.match(patternD);
  if (match && match.index !== undefined) {
    // Walk backwards to find the enclosing function
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

    if (funcStart !== -1) {
      return injectAtFunctionBody(oldFile, funcStart);
    }
  }

  console.error(
    'patch: ctrlBackspace: failed to find keyboard event handler pattern'
  );
  return null;
};

/**
 * Find the opening brace of a function and inject code after it.
 */
function injectAtFunctionBody(oldFile: string, insertIdx: number): string {
  const insertion = buildCtrlBackspaceCode();
  const newFile =
    oldFile.slice(0, insertIdx) + insertion + oldFile.slice(insertIdx);
  showDiff(oldFile, newFile, insertion, insertIdx, insertIdx);
  return newFile;
}

/**
 * Build the Ctrl+Backspace and Ctrl+Shift+Backspace handling code.
 */
function buildCtrlBackspaceCode(): string {
  // This code is injected into a keyboard event handler function body.
  // It handles:
  // - Ctrl+Backspace: Delete word backward (skips whitespace, finds word boundary)
  // - Ctrl+Shift+Backspace: Delete line backward (from cursor to start of line)

  return `
// === Ctrl+Backspace / Ctrl+Shift+Backspace handling ===
// Ctrl+Backspace: Delete word backward
if((e.ctrlKey||e.metaKey)&&e.key==="Backspace"&&!e.shiftKey){
  e.preventDefault&&e.preventDefault();
  let val=t?.value??"";
  let pos=t?.selectionStart??t?.caretPos??0;
  if(val&&pos>0){
    // Skip trailing whitespace before deleting
    while(pos>0&&(val[pos-1]==" "||val[pos-1]=="\\t"))pos--;
    // Find word boundary (go back until space/tab)
    let start=pos;
    while(start>0&&val[start-1]!==" "&&val[start-1]!=="\\t")start--;
    if(start<pos){
      t.setSelectionRange?.(start,pos);
      // Use DOM API if available (web-based editors), otherwise direct manipulation
      if(typeof document!=="undefined"&&document.execCommand){
        document.execCommand("delete");
      }else{
        let newVal=val.substring(0,start)+val.substring(pos);
        t.value=newVal;
        t.selectionStart=t.selectionEnd=start;
        if(t.dispatchEvent)t.dispatchEvent(new Event("input",{bubbles:true}));
      }
    }
  }
}
// Ctrl+Shift+Backspace: Delete line backward (from cursor to start of current line)
if(e.ctrlKey&&e.shiftKey&&e.key==="Backspace"){
  e.preventDefault&&e.preventDefault();
  let val=t?.value??"";
  let pos=t?.selectionStart??t?.caretPos??0;
  if(val&&pos>0){
    // Find line start (go back until newline or beginning)
    let lineStart=pos;
    while(lineStart>0&&val[lineStart-1]!=="\\n")lineStart--;
    if(lineStart<pos){
      t.setSelectionRange?.(lineStart,pos);
      if(typeof document!=="undefined"&&document.execCommand){
        document.execCommand("delete");
      }else{
        let newVal=val.substring(0,lineStart)+val.substring(pos);
        t.value=newVal;
        t.selectionStart=t.selectionEnd=lineStart;
        if(t.dispatchEvent)t.dispatchEvent(new Event("input",{bubbles:true}));
      }
    }
  }
}`;
}
