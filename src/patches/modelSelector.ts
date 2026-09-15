// Please see the note about writing patches in ./index

import { escapeIdent, getRequireFuncName, showDiff } from './index';
import type { CustomModel } from '../types';

/** Re-export CustomModel for use by other modules */
export type { CustomModel };

// Built-in Claude models shipped with tweakcc. Each carries contextWindow and maxTokens
// so the runtime reader can merge them with user-defined models from settings.json.
// prettier-ignore
export const CUSTOM_MODELS: CustomModel[] = [
  { value: 'claude-opus-4-6',              label: 'Opus 4.6',             description: "Claude Opus 4.6 (February 2026)", contextWindow: 1000000, maxTokens: 32768 },
  { value: 'claude-sonnet-4-6',            label: 'Sonnet 4.6',           description: "Claude Sonnet 4.6 (February 2026)", contextWindow: 1000000, maxTokens: 32768 },
  { value: 'claude-haiku-4-5-20251001',    label: 'Haiku 4.5',            description: "Claude Haiku 4.5 (October 2025)", contextWindow: 65536, maxTokens: 32768 },
  { value: 'claude-opus-4-5-20251101',     label: 'Opus 4.5',             description: "Claude Opus 4.5 (November 2025)", contextWindow: 1000000, maxTokens: 32768 },
  { value: 'claude-sonnet-4-5-20250929',   label: 'Sonnet 4.5',          description: "Claude Sonnet 4.5 (September 2025)", contextWindow: 1000000, maxTokens: 32768 },
  { value: 'claude-opus-4-1-20250805',     label: 'Opus 4.1',             description: "Claude Opus 4.1 (August 2025)", contextWindow: 1000000, maxTokens: 32768 },
  { value: 'claude-opus-4-20250514',      label: 'Opus 4',               description: "Claude Opus 4 (May 2025)", contextWindow: 1000000, maxTokens: 32768 },
  { value: 'claude-sonnet-4-20250514',    label: 'Sonnet 4',             description: "Claude Sonnet 4 (May 2025)", contextWindow: 1000000, maxTokens: 32768 },
  { value: 'claude-3-7-sonnet-20250219',  label: 'Sonnet 3.7',           description: "Claude 3.7 Sonnet (February 2025)", contextWindow: 200000, maxTokens: 8192 },
  { value: 'claude-3-5-sonnet-20241022',  label: 'Sonnet 3.5 (October)', description: "Claude 3.5 Sonnet (October 2024)", contextWindow: 200000, maxTokens: 8192 },
  { value: 'claude-3-5-haiku-20241022',   label: 'Haiku 3.5',            description: "Claude 3.5 Haiku (October 2024)", contextWindow: 65536, maxTokens: 8192 },
  { value: 'claude-3-5-sonnet-20240620',  label: 'Sonnet 3.5 (June)',    description: "Claude 3.5 Sonnet (June 2024)", contextWindow: 200000, maxTokens: 8192 },
  { value: 'claude-3-haiku-20240307',     label: 'Haiku 3',              description: "Claude 3 Haiku (March 2024)", contextWindow: 65536, maxTokens: 8192 },
  { value: 'claude-3-opus-20240229',      label: 'Opus 3',               description: "Claude 3 Opus (February 2024)", contextWindow: 200000, maxTokens: 8192 },
];

const findCustomModelListInsertionPoint = (
  fileContents: string
): { insertionIndex: number; modelListVar: string } | null => {
  // 1. Find the custom model push pattern.
  // The lead boundary must NOT be a literal space: CC 2.1.197 restructured the
  // availableModels enumeration into a for-of loop so the push is now preceded by
  // `;` (`...continue;t.push({value:c,...})`) instead of a space. A negative
  // lookbehind on [$\w] captures the full list var regardless of the preceding
  // punctuation (`;`, ` `, `{`, `,`, …). The sibling opus[1m] helper push wraps its
  // arg as `.push(gda(s)??{value:...})`, so requiring `.push({value:` right after
  // the paren keeps this matching only the real model-list assembly site.
  //
  // `label:` and `description:` are EXPRESSIONS, not literals. CC 2.1.261 started
  // resolving a friendly label first, so the entry became
  // `{value:F,label:re??F,description:re===void 0?"Custom model":`Custom model (${F})`}`
  // — the old `label:[$\w]+,description:"Custom model"` pinned both to their 2.1.259
  // shapes and matched nothing. Anchor on the property NAMES plus the "Custom model"
  // literal wherever it appears in the description expression, and stop there rather
  // than matching to `})`: a template branch can contain `}` (`${F}`), so a
  // closing-brace anchor is a countdown, not a match.
  const pushPattern =
    /(?<![$\w])([$\w]+)\.push\(\{value:[$\w]+,label:[^,]{1,40},description:[^"]{0,40}"Custom model"/;
  const pushMatch = fileContents.match(pushPattern);
  if (!pushMatch || pushMatch.index === undefined) {
    console.error(
      'patch: findCustomModelListInsertionPoint: failed to find custom model push'
    );
    return null;
  }

  // 2. Extract the model list variable name
  const modelListVar = pushMatch[1];

  // The declaration/function head can move farther from the push site across CC builds
  // and when other patches expand this block (notably opusplan1m, which injects ~400
  // bytes BEFORE the custom-model push inside the same function), so keep a generous
  // lookback window. On CC 2.1.140 the head sits ~1500 bytes from the push BEFORE
  // opusplan1m runs and ~1530 bytes after, so 5000 leaves comfortable slack for
  // future CC builds and additional pre-patches.
  const searchStart = Math.max(0, pushMatch.index - 5000);
  const chunk = fileContents.slice(searchStart, pushMatch.index);

  // Declaration can be emitted as let/var/const depending on minifier output,
  // or as one variable in a comma-separated declaration list.
  const declPattern = `(?:(?:let|var|const) |,)${escapeIdent(modelListVar)}=.+?;`;
  const funcPattern = new RegExp(
    `function [$\\w]+\\([^)]*\\)\\{[\\s\\S]{0,5000}?${declPattern}`,
    'g'
  );
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = funcPattern.exec(chunk)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) {
    console.error(
      `patch: findCustomModelListInsertionPoint: failed to find function with ${modelListVar}`
    );
    return null;
  }

  // 5. Return index after the semicolon (end of the match), and the var name
  const insertionIndex = searchStart + lastMatch.index + lastMatch[0].length;
  return { insertionIndex, modelListVar };
};

/**
 * Inject a runtime settings reader at CC startup that loads per-model context
 * windows from settings.json ($CLAUDE_CONFIG_DIR, then ~/.claude). Formats:
 *
 * 1. Primary (recommended): "customModels" array — clean JSON objects
 *    { "customModels": [{ "value": "qwen36-500k:35b", "contextWindow": 500000 }] }
 *
 * 2. Fallback: modelOverrides strings with key=value entries
 *    { "modelOverrides": { "my-model": ["contextWindow=500000", "haiku=small-model"] } }
 *
 * PLACEMENT IS EVERYTHING: on native (sentinel) bundles the reader goes at the
 * TOP OF THE ENTRY MODULE — the only module guaranteed to evaluate at boot.
 * An earlier revision injected at "end of extracted content", which on a
 * 1700-module virtual bundle lands inside the LAST chunk — a lazy module that
 * never evaluates, so globalThis.__tweakccCustomModels stayed undefined and
 * every downstream lookup silently no-op'd (binary looked patched, behaved
 * stock). Any previously misplaced reader is stripped and re-placed here, so
 * re-applying over an affected binary self-heals.
 *
 * This is dynamic — no re-patching needed when users add/remove models.
 */

// The injected reader def+call pair, wherever a previous apply left it.
// The trailing \n? matters: the injector appends a newline after the call, and
// a strip that leaves it behind grows the file by one byte per re-apply.
const patternStaleReader =
  /(?:import\{readFileSync as __tcwReadFileSync\}from"node:fs";\n?)?globalThis\.__tweakccReadSettings=function\(\)\{[\s\S]*?globalThis\.__tweakccCustomModels=m\};\s*globalThis\.__tweakccReadSettings\(\);\n?/;

// Entry-module sentinel in the native virtual bundle (see nativeInstallation.ts
// isClaudeModule for the name set).
const patternEntrySentinel =
  /\n\/\*@@TWEAKCC_MODULE:\d+:(?:\/\$bunfs\/root\/cli|B:\/~Bun\/root\/cli|claude|claude\.exe|src\/entrypoints\/cli\.js)@@\*\/\n/;

// fs accessor for the native entry module (see injection site for why).
const NATIVE_FS_SHIM =
  '(function(){try{return require("fs")}catch(e){}try{if(typeof Bun!=="undefined"&&Bun.spawnSync)return{readFileSync:function(p){var r=Bun.spawnSync(["cat",String(p)]);if(!r||r.exitCode!==0||!r.stdout)throw new Error("cat "+p+" exit "+(r?r.exitCode:"?"));return new TextDecoder().decode(r.stdout)}}}catch(e2){}return null})()';

// Build the reader source. `fsAccess` is the expression yielding an fs-like
// object: a direct ESM named import in the native entry module (bare require
// does NOT exist there — proven at runtime), the createRequire-derived
// variable in esbuild cli.js bundles.
const buildSettingsReader = (fsAccess: string): string =>
  `globalThis.__tweakccReadSettings=function(){var m=globalThis.__tweakccCustomModels;if(!m)m=[];try{var f=${fsAccess};var cs=[];var sep="/";if(process.env.CLAUDE_CONFIG_DIR)cs.push(process.env.CLAUDE_CONFIG_DIR.replace(/[\\/]+$/,"")+sep+"settings.json");var hd=process.env.HOME||process.env.USERPROFILE;if(hd)cs.push(hd.replace(/[\\/]+$/,"")+sep+".claude"+sep+"settings.json");for(var pi=0;pi<cs.length;pi++){try{var d=JSON.parse(f.readFileSync(cs[pi],"utf8"));if(d.customModels)for(var x of d.customModels){var already=m.some(function(e){return e.value===x.value});if(!already)m.push({value:x.value,label:x.label||x.value,description:"",contextWindow:+x.contextWindow>0?+x.contextWindow:void 0,maxTokens:x.maxTokens||16384,subModels:x.subModels&&x.subModels.haiku?{haiku:String(x.subModels.haiku)}:void 0,compactThresholdPct:+x.compactThresholdPct>0&&+x.compactThresholdPct<=100?+x.compactThresholdPct:void 0,compactThresholdTokens:+x.compactThresholdTokens>0?+x.compactThresholdTokens:void 0})}var v=d&&d.modelOverrides;for(var k in v){var vals=v[k];if(Array.isArray(vals)){var ex=null;for(var q=0;q<m.length;q++){if(m[q].value===k){ex=m[q];break}}var nw=null;for(var j=0;j<vals.length;j++){var parts=String(vals[j]).split("=");if(parts[0]==="contextWindow"||parts[0]==="haiku"||parts[0]==="compactThresholdPct"||parts[0]==="compactThresholdTokens"){if(!ex&&!nw)nw={value:k,label:k,description:"",maxTokens:16384};var tgt=ex||nw;if(parts[0]==="contextWindow"){var cw=Number(parts[1]);if(cw>0)tgt.contextWindow=cw}else if(parts[0]==="compactThresholdPct"){var pn=Number(parts[1]);if(pn>0&&pn<=100)tgt.compactThresholdPct=pn}else if(parts[0]==="compactThresholdTokens"){var tn=Number(parts[1]);if(tn>0)tgt.compactThresholdTokens=tn}else if(parts[1]&&!(tgt.subModels&&tgt.subModels.haiku)){tgt.subModels={haiku:parts[1]}}}}if(nw)m.push(nw)}}}catch(u){if(process.env.TWEAKCC_DEBUG)console.error("tweakcc reader: "+cs[pi]+": "+(u&&u.message))}}}catch(t){if(process.env.TWEAKCC_DEBUG)console.error("tweakcc reader: "+(t&&t.message))}if(process.env.TWEAKCC_DEBUG)console.error("tweakcc reader: loaded "+m.length+" custom model(s)");globalThis.__tweakccCustomModels=m};
globalThis.__tweakccReadSettings();`;

const injectSettingsReader = (fileContents: string): string | null => {
  // Strip any previously injected reader copies first — including ones a
  // former apply parked in a lazy chunk — so re-applies relocate it.
  let file = fileContents;
  while (patternStaleReader.test(file)) {
    file = file.replace(patternStaleReader, '');
  }
  if (
    file.includes('__tweakccReadSettings=function') ||
    file.includes('__tcwReadFileSync')
  ) {
    // A reader shape the strip pattern does not recognize — injecting now would
    // duplicate it. Fail loud so the pattern gets updated.
    console.error(
      'patch: modelCustomizations: could not strip a previously injected settings reader — refusing to duplicate it'
    );
    return null;
  }

  if (file.includes('/*@@TWEAKCC_MODULE:')) {
    // Native virtual bundle: top of the ENTRY module. Bun native modules always
    // provide bare `require`; deliberately NOT getRequireFuncName() here — its
    // createRequire scan can latch onto an unrelated chunk's import in the
    // concatenation, a binding the entry module's scope does not have.
    const m = patternEntrySentinel.exec(file);
    if (!m || m.index === undefined) {
      console.error(
        'patch: modelCustomizations: entry-module sentinel not found — refusing to place the settings reader where it would never run'
      );
      return null;
    }
    const at = m.index + m[0].length;
    // The compiled ENTRY module has no require binding and added static
    // `import` statements do not bind (both probed at runtime on 2.1.272).
    // What it DOES have is the Bun global: read settings.json synchronously
    // via `Bun.spawnSync(["cat",…])` (~2ms once at boot). The shim tries bare
    // require first so it keeps working if a future Bun provides it.
    return (
      file.slice(0, at) +
      buildSettingsReader(NATIVE_FS_SHIM) +
      '\n' +
      file.slice(at)
    );
  }

  // Legacy single-module cli.js: the whole file evaluates top-to-bottom, but
  // the esbuild prelude defines the require var first — keep the historical
  // server-init / end-of-file anchor so the reader sits after it.
  let injectionIndex = -1;
  const serverPatterns = [
    /server\s*=\s*globalThis\./,
    /server\s*=\s*serve[({]/,
  ];
  for (const pattern of serverPatterns) {
    const m = pattern.exec(file);
    if (m && m.index !== undefined) {
      injectionIndex = m.index;
      break;
    }
  }
  if (injectionIndex === -1 || injectionIndex >= file.length - 200) {
    const closeBrace = /\}\s*;\s*$/.exec(file);
    injectionIndex = closeBrace ? closeBrace.index : file.length;
  }
  if (injectionIndex <= 0 || injectionIndex >= file.length) {
    console.error(
      'patch: modelCustomizations: failed to find an injection point for the settings reader'
    );
    return null;
  }

  return (
    file.slice(0, injectionIndex) +
    buildSettingsReader(`${getRequireFuncName(file)}("fs")`) +
    file.slice(injectionIndex)
  );
};
export const writeModelCustomizations = (oldFile: string): string | null => {
  // Skip if custom models are already injected (e.g. from a previous
  // tweakcc run baked into the backup, or future native support).
  // The JSON.stringify format uses quoted keys: {"value":"claude-opus-4-6",...}
  const hasCustomModels = oldFile.includes('"value":"claude-opus-4-6"');

  let patchedFile: string;
  if (hasCustomModels) {
    console.log(
      'patch: modelCustomizations: custom models already present — skipping push'
    );
    patchedFile = oldFile;
  } else {
    const found = findCustomModelListInsertionPoint(oldFile);
    if (!found) return null;

    const { insertionIndex, modelListVar } = found;

    // Build the injection: push each built-in Claude model onto the list.
    // JSON.stringify includes all properties (contextWindow, maxTokens) so the
    // selector entries carry the data; per-model context-window enforcement is
    // driven by modelContextWindowSync reading ~/.claude/settings.json at runtime.
    const inject = CUSTOM_MODELS.map(
      model => `${modelListVar}.push(${JSON.stringify(model)});`
    ).join('');

    patchedFile =
      oldFile.slice(0, insertionIndex) + inject + oldFile.slice(insertionIndex);
  }

  // Inject (or relocate) the runtime settings reader. Self-healing: strips any
  // previously injected copy — including ones a former apply parked in a lazy
  // chunk where it never ran — and re-injects at the entry-module top, so
  // re-applying over an affected binary fixes it. Idempotent when already
  // correctly placed (strip + re-inject yields the identical file).
  const readerResult = injectSettingsReader(patchedFile);
  if (readerResult) {
    const at = readerResult.indexOf('globalThis.__tweakccReadSettings');
    showDiff(
      patchedFile,
      readerResult,
      '\n  /* __tweakccReadSettings injected */',
      Math.max(0, at),
      Math.max(0, at) + 100
    );
    patchedFile = readerResult;
  }

  return patchedFile;
};
