import { getEditToolLocation, writeIgnoreWhitespaceEdit } from './src/patches/ignoreWhitespaceEdit';

const V235_SCHEMA = 'inputSchema:{type:"object",properties:{file_path:{type:"string"},old_string:{type:"string"},new_string:{type:"string"},replace_all:{type:"boolean"}},required:["file_path","old_string","new_string"]}';
const V235_EDIT_BODY = 'run:async({file_path:t,old_string:r,new_string:n,replace_all:o})=>{if(!t)throw new cS("edit: file_path is required");if(!r)throw new cS("edit: old_string is required");let i=await ITr(e,t),s;try{let c=await F9.stat(i);if(!c.isFile())throw new cS(`edit: ${t} is not a regular file`);let u=Dtu(e.maxFileBytes);if(u!==null&&c.size>u)throw new cS(`edit: ${t} is ${c.size} bytes, exceeds ${u}-byte limit. Use bash (sed/awk) to edit a large file.`);s=await F9.readFile(i,"utf8")}catch(c){if(c instanceof cS)throw c;throw new cS(`edit: ${Fbn(c,t)}`)}let a=s.split(r).length-1;if(a===0)throw new cS(`edit: old_string not found in \\${t}`);let l;if(o)l=s.split(r).join(n);else{if(a>1)throw new cS(`edit: old_string appears ${a} times in ${t} (must be unique)`);l=s.replace(r,()=>n)}try{await Axs(i,l)}catch(c){throw new cS(`edit: write: ${Fbn(c,t)}`)}return`edited ${t} (${o?a:1} replacement(s))`}';

function buildV235Snippet() {
  return `var EditTool=function(){return G9t({name:"edit",description:"Replace old_string with new_string in a file. old_string must be unique unless replace_all.",${V235_SCHEMA}},${V235_EDIT_BODY})}function NextTool(e){return G};`;
}

const snippet = buildV235Snippet();
console.log('snippet length:', snippet.length);
console.log('last 80 chars:', JSON.stringify(snippet.substring(snippet.length - 80)));

// Check func boundaries
const loc = getEditToolLocation(snippet);
if (loc) {
  console.log('funcStart:', loc.startIndex, 'funcEndIdx:', loc.endIndex);
  const funcContent = snippet.slice(loc.startIndex, loc.endIndex);
  console.log('funcContent length:', funcContent.length);
  if (funcContent.length > 0) {
    console.log('funcContent first 100:', JSON.stringify(funcContent.substring(0, 100)));
  }
} else {
  // Debug: find body match and MID_BODY
  const BODY_START_RE = /run:async\(\{file_path:([a-zA-Z_$]+),old_string:([a-zA-Z_$]+),new_string:([a-zA-Z_$]+),replace_all:([a-zA-Z_$]+)\}\)=>/;
  const bm = snippet.match(BODY_START_RE);
  console.log('bodyMatch:', bm ? `index=${bm.index}, len=${bm[0].length}` : 'not found');

  // Find all }})}function boundaries
  let idx = 0;
  while (true) {
    const pos = snippet.indexOf('}})}function', idx);
    if (pos === -1) break;
    console.log(`}})}function at ${pos}:`, JSON.stringify(snippet.substring(pos, pos + 25)));
    idx = pos + 1;
  }

  // Check MID_BODY
  const MID_BODY_RE = /`edit: old_string appears \$\{[a-zA-Z_$]+\} times in \$\{[a-zA-Z_$]+\} \(must be unique\)`/;
  const mid = snippet.match(MID_BODY_RE);
  console.log('MID_BODY:', mid ? `found at ${mid.index}` : 'not found');

  // Check the actual backtick format in snippet
  const rawBackticks = snippet.indexOf('old_string appears');
  if (rawBackticks >= 0) {
    console.log('around MID_BODY:', JSON.stringify(snippet.substring(rawBackticks - 5, rawBackticks + 80)));
  }

  // Check what NextTool looks like
  const ntIdx = snippet.indexOf('NextTool(e)');
  if (ntIdx >= 0) {
    console.log('around NextTool:', JSON.stringify(snippet.substring(ntIdx - 5, ntIdx + 40)));
  }
}
