// Tests for ignore_whitespace edit tool patch (v234–v237+).
// Fixtures extracted from real cli.js v2.1.235 bundle to verify anchors survive minifier renames.

import { describe, it, expect } from 'vitest';
import { writeIgnoreWhitespaceEdit } from './ignoreWhitespaceEdit';

/**
 * Edit tool body extracted verbatim from /tmp/cli-v235-pristine.js (Claude Code 2.1.235).
 * Identifiers: file_path=t, old_string=r, new_string=n, replace_all=o
 * count=a, content=s, result=l, errClass=cS, lambda=x (map param)
 */
const V235_EDIT_BODY = 'run:async({file_path:t,old_string:r,new_string:n,replace_all:o})=>{if(!t)throw new cS("edit: file_path is required");if(!r)throw new cS("edit: old_string is required");let i=await ITr(e,t),s;try{let c=await F9.stat(i);if(!c.isFile())throw new cS(`edit: ${t} is not a regular file`);let u=Dtu(e.maxFileBytes);if(u!==null&&c.size>u)throw new cS(`edit: ${t} is ${c.size} bytes, exceeds ${u}-byte limit. Use bash (sed/awk) to edit a large file.`);s=await F9.readFile(i,"utf8")}catch(c){if(c instanceof cS)throw c;throw new cS(`edit: ${Fbn(c,t)}`)}let a=s.split(r).length-1;if(a===0)throw new cS(`edit: old_string not found in \\${t}`);let l;if(o)l=s.split(r).join(n);else{if(a>1)throw new cS(`edit: old_string appears ${a} times in ${t} (must be unique)`);l=s.replace(r,()=>n)}try{await Axs(i,l)}catch(c){throw new cS(`edit: write: ${Fbn(c,t)}`)}return`edited ${t} (${o?a:1} replacement(s))`}';

/**
 * Full inputSchema block from v235 — used by step 1 SCHEMA_RE anchor.
 */
const V235_SCHEMA = 'inputSchema:{type:"object",properties:{file_path:{type:"string"},old_string:{type:"string"},new_string:{type:"string"},replace_all:{type:"boolean"}},required:["file_path","old_string","new_string"]}';

/**
 * Build a minimal cli.js snippet that contains the edit tool registration.
 * Structure matches real v235: tools are `function X(e){return G9t({...run:async...})}` in sequence,
 * with boundary between them being exactly `}})}function` (4 chars). We include a preceding dummy
 * tool so getEditToolLocation can find the prevBoundary before EditTool's run:async.
 */

/** Dummy write-tool body for preceding tool — must have a }})}function boundary after it. */
const DUMMY_RUN_BODY = 'run:async({file_path:x,content:c})=>{if(!x)throw Error(1);await F9.writeFile(x,c);return`wrote ${c.length}`}';

function buildV235Snippet() {
  // Preceding tool boundary: }})} (same structure as real v235 between $tu and Otu)
  const prevBoundary = '}})}';

  return 'function WriteTool(e){return G9t({name:"write",description:"Write a file.",inputSchema:{type:"object"},' + DUMMY_RUN_BODY + ')}' + prevBoundary + 'function EditTool(e){return G9t({name:"edit",description:"Replace old_string with new_string in a file. old_string must be unique unless replace_all.",' + V235_SCHEMA + ',' + V235_EDIT_BODY + ')}})}function NextTool(e){return G};';
}

// ---------------------------------------------------------------------------
// Tests — real v235 fixture
// ---------------------------------------------------------------------------

describe('writeIgnoreWhitespaceEdit (real v235 fixtures)', () => {
  it('patches the v235 edit tool body with ignore_whitespace parameter', () => {
    const result = writeIgnoreWhitespaceEdit(buildV235Snippet());
    expect(result).not.toBeNull();
    // Check that ignore_whitespace was added to schema properties
    expect(result!).toContain('ignore_whitespace:{type:"boolean"');
    // Check that the parameter is in run:async signature
    expect(result!).toContain(',ignore_whitespace:');
  });

  it('patches count logic (step 3) with line-by-line normalization', () => {
    const result = writeIgnoreWhitespaceEdit(buildV235Snippet());
    expect(result).not.toBeNull();
    // Step 3 should use wsFlag ternary around split/trim/join for counting
    expect(result!).toContain('String.fromCharCode(10)');
    expect(result!).toContain('.map(');
    expect(result!).toContain('.trim()');
  });

  it('patches join/replace logic (step 4) with line-by-line normalization', () => {
    const result = writeIgnoreWhitespaceEdit(buildV235Snippet());
    expect(result).not.toBeNull();
    // Step 4 should have both if(o) branch and else branch normalized
    expect(result!).toContain('if(o){');
    expect(result!).toContain('else{');
  });

  it('is idempotent — second pass returns null', () => {
    const first = writeIgnoreWhitespaceEdit(buildV235Snippet());
    expect(first).not.toBeNull();
    const second = writeIgnoreWhitespaceEdit(first!);
    expect(second).toBeNull();
  });

  it('returns null when edit tool body not found', () => {
    const result = writeIgnoreWhitespaceEdit('var unrelated=function(){}');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — synthetic (matching contextLimit-style test pattern)
// ---------------------------------------------------------------------------

describe('writeIgnoreWhitespaceEdit (synthetic patterns)', () => {
  it('handles different minified variable names', () => {
    // Simulate a full edit tool registration with rewritten vars.
    // Must include function boundary for getEditToolLocation AND match all step anchors.
    // Preceding WriteTool provides the }})}function boundary before EditTool (real v235 pattern).
    const snippet = 'function WriteTool(e){return G9t({name:"write",description:"Write a file.",inputSchema:{type:"object"},run:async({file_path:x,content:c})=>{await F9.writeFile(x,c);return\`wrote \${c.length}\`} })}})function EditTool(e){return G9t({name:"edit",description:"Replace old_string with new_string in a file. old_string must be unique unless replace_all.",inputSchema:{type:"object",properties:{file_path:{type:"string"},old_string:{type:"string"},new_string:{type:"string"},replace_all:{type:"boolean"}},required:["file_path","old_string","new_string"]}},run:async({file_path:a,old_string:b,new_string:c,replace_all:d})=>{if(!a)throw new cS("edit: file_path is required");let e=await ITr(f,a),n;try{n=await F9.readFile(e,"utf8")}catch(g){}let p=n.split(b).length-1;if(p===0)throw new cS(`edit: old_string not found in \\${a}`);let q;if(d)q=n.split(b).join(c);else{if(p>1)throw new cS(`edit: old_string appears ${p} times in ${a} (must be unique)`);q=n.replace(b,()=>c)}return q})}})}function Nxt(e){return G};';

    const result = writeIgnoreWhitespaceEdit(snippet);
    expect(result).not.toBeNull();
    expect(result!).toContain('ignore_whitespace');
  });

  it('handles already-patched state', () => {
    // Already-patched state should be skipped by idempotency check
    const snippet = 'replace_all:{type:"boolean"},additionalProperties:{ignore_whitespace:{type:"boolean"}}';
    const result = writeIgnoreWhitespaceEdit(`...${snippet}...`);
    expect(result).toBeNull();
  });

  it('handles long-form description text without full body', () => {
    // This snippet has the description anchor, schema, and minimal body — enough for all steps.
    // Preceding WriteTool provides the }})}function boundary before EditTool (real v235 pattern).
    const snippet = 'function WriteTool(e){return G9t({name:"write",description:"Write a file.",inputSchema:{type:"object"},run:async({file_path:x,content:c})=>{await F9.writeFile(x,c);return\`wrote \${c.length}\`}})}})function EditTool(e){return G9t({name:"edit",description:"Replace old_string with new_string in a file. old_string must be unique unless replace_all.",inputSchema:{type:"object",properties:{file_path:{type:"string"},old_string:{type:"string"},new_string:{type:"string"},replace_all:{type:"boolean"}},required:["file_path","old_string","new_string"]}},run:async({file_path:a,old_string:b,new_string:c,replace_all:d})=>{let e=await ITr(f,a),n;try{n=await F9.readFile(e,"utf8")}catch(g){}let p=n.split(b).length-1;if(p===0)throw new cS(`edit: old_string not found in \\${a}`);let q;if(d)q=n.split(b).join(c);else{if(p>1)throw new cS(`edit: old_string appears ${p} times in ${a} (must be unique)`);q=n.replace(b,()=>c)}return q})}})}function Nxt(e){return H};';

    const result = writeIgnoreWhitespaceEdit(snippet);
    expect(result).not.toBeNull();
    expect(result!).toContain('ignore_whitespace');
  });
});
