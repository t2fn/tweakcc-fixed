// Please see the note about writing patches in ./index
//
// Per-main-model role models ("sub-models") for custom providers.
//
// -- The problem --
// CC routes background work (conversation topics, summaries, quick
// classifications) through its small/fast "haiku role", resolved by
// getSmallFastModel: the ANTHROPIC_SMALL_FAST_MODEL env var, then
// ANTHROPIC_DEFAULT_HAIKU_MODEL, then the built-in Haiku default. Those are
// GLOBAL, static knobs — one value for every main model. Gateway/Ollama users
// who switch main models via /model want the background role to follow the
// selection: main "gemma4-31b" → haiku role "gemma3:12b", main "qwen38-500k"
// → haiku role "qwen3.6-flash". Env vars cannot express that.
//
// -- The config --
// customModels entries in $CLAUDE_CONFIG_DIR (or ~/.claude) settings.json gain
// an optional subModels map:
//
//   { "customModels": [
//       { "value": "gemma4-31b", "contextWindow": 262144,
//         "subModels": { "haiku": "gemma3:12b" } } ] }
//
// The model-customizations startup reader passes subModels through into
// globalThis.__tweakccCustomModels. This patch makes CC's haiku-role resolver
// consult it, keyed by the CURRENTLY SELECTED main model. Per-model config
// beats the global env vars (most specific wins); with no subModels entry for
// the selected model, every stock path is untouched.
//
// -- The mechanism (two shape-anchored injections; minified names churn every
//    release, so all anchors CAPTURE names at apply time — house rule) --
//
// 1. Session-model recorder. CC's auto-compact window resolver TW is called
//    with the session's main model on every turn and every /context render
//    (display AND enforcement both go through it). Its head is:
//
//      function TW(e,n,r=PP()){let s=JE(e),d=VP(e,r),m=GNn(e,s),_=m?.declared,…
//
//    We splice `globalThis.__tcwSel=JE(e);` at the body start, recording the
//    short model id at the exact place CC itself extracts it. Recording here
//    (rather than in VP) avoids pollution: VP is also called with non-session
//    models by the step-down comparators (PGe/Otn), TW is not.
//
// 2. Haiku-role lookup. getSmallFastModel's shape (verified unique per build):
//
//      function MG(){let e=ENV.ANTHROPIC_SMALL_FAST_MODEL;
//        if(e!==void 0)return AW(e);
//        if(!HASDED()){let n=PROV();
//          if((n==="bedrock"||n==="vertex")&&USERMODEL()==null&&!X()){…}
//          return DEFAULT_HAIKU()}
//        return HAIKU_ENV()}
//
//    We splice a lookup at the body start: if the recorded session model has
//    a customModels entry with subModels.haiku, return AW(thatId) — going
//    through CC's own normalizer AW so the value flows exactly like the
//    ANTHROPIC_SMALL_FAST_MODEL env path. Before the env checks on purpose:
//    a per-model declaration is more specific than the global env.
//
// Observed names per release (MG / normalizer AW; recorder site TW / id JE):
//   2.1.267: eg / KS ; AS / Be      2.1.270: mg / Aw ; tw / je
//   2.1.268: tg / sw ; $S / je      2.1.271: Hg / pv ; Fw / je
//   2.1.269: mg / Aw ; tw / je
//
// -- Failure semantics --
// Bundles without the ANTHROPIC_SMALL_FAST_MODEL literal predate the haiku-role
// machinery entirely → silent no-op. Bundles WITH the literal but a drifted
// shape → loud null (re-anchor needed). The recorder and the lookup are
// all-or-nothing: one without the other is inert-or-wrong, so a partial match
// fails the whole patch.
//
// -- Extension notes --
// subModels is a map for a reason: sonnet/opus role resolvers and the subagent
// resolver (CLAUDE_CODE_SUBAGENT_MODEL / subagent_model_resolve) can hang off
// the same recorder with their own anchored lookups when needed. The subagent
// resolver has family-step-down/allowlist logic that needs its own study —
// deliberately out of scope for the first cut.

import { debug } from '../utils';

// Session-window resolver TW head. The `?.declared` property literal and the
// three-let head are distinctive without chaining through the VP name — which
// matters: modelContextWindowSync injects INTO the VP body, so a VP-dependent
// anchor would break depending on patch order. Verified unique per build
// (2.1.267-271 raw binaries AND the extracted virtual bundle).
// Captures: 1=TW 2=e-param 3=s-local 4=JE 5=VP 6=GNn
const patternTw =
  /function ([\w$]+)\(([\w$]+),[\w$]+,[\w$]+=[\w$]+\(\)\)\{let ([\w$]+)=([\w$]+)\(\2\),[\w$]+=([\w$]+)\(\2,[\w$]+\),[\w$]+=([\w$]+)\(\2,\3\),[\w$]+=[\w$]+\?\.declared/;

// getSmallFastModel head. The "bedrock"/"vertex"/ANTHROPIC_SMALL_FAST_MODEL
// literals are the stable part. Captures:
//   1=MG 2=env-local 3=ENV-obj 4=AW(normalizer) 5=HASDED 6=prov-local 7=PROV
//   8=USERMODEL 9=X
const patternSmallFast =
  /function ([\w$]+)\(\)\{let ([\w$]+)=([\w$]+)\.ANTHROPIC_SMALL_FAST_MODEL;if\(\2!==void 0\)return ([\w$]+)\(\2\);if\(!([\w$]+)\(\)\)\{let ([\w$]+)=([\w$]+)\(\);if\(\(\6==="bedrock"\|\|\6==="vertex"\)&&([\w$]+)\(\)==null&&!([\w$]+)\(\)\)\{/;

// Markers unique to this patch's two injections (idempotency).
const RECORDER_MARK = '__tcwSel=';
const LOOKUP_MARK = '__tsmL=';

const buildRecorder = (je: string, eParam: string): string =>
  `globalThis.__tcwSel=${je}(${eParam});`;

const buildHaikuLookup = (aw: string): string =>
  `var __tsmL=globalThis.__tweakccCustomModels,__tsmS=globalThis.__tcwSel;if(__tsmL&&__tsmS)for(var __tsmI=0;__tsmI<__tsmL.length;__tsmI++){var __tsmE=__tsmL[__tsmI];if(__tsmE&&__tsmE.value===__tsmS){var __tsmH=__tsmE.subModels&&__tsmE.subModels.haiku;if(typeof __tsmH==="string"&&__tsmH)return ${aw}(__tsmH);break}}`;

/** Splice after the FIRST `{` of the match (the function-body opener). */
const spliceIntoBody = (
  file: string,
  matchIndex: number,
  matchText: string,
  injection: string
): string | null => {
  const braceAt = matchText.indexOf('{');
  if (braceAt === -1) return null;
  const at = matchIndex + braceAt + 1;
  return file.slice(0, at) + injection + file.slice(at);
};

export const writeCustomSubModels = (oldFile: string): string | null => {
  if (!oldFile || oldFile.length === 0) {
    debug('patch: customSubModels: received empty file');
    return null;
  }

  // Pre-machinery bundle (no haiku-role env slot at all) → nothing to route.
  if (!oldFile.includes('ANTHROPIC_SMALL_FAST_MODEL')) {
    debug(
      'patch: customSubModels: ANTHROPIC_SMALL_FAST_MODEL absent — haiku-role machinery not in this build; no-op'
    );
    return oldFile;
  }

  const alreadyRecorded = oldFile.includes(RECORDER_MARK);
  const alreadyLooked = oldFile.includes(LOOKUP_MARK);
  if (alreadyRecorded && alreadyLooked) {
    debug('patch: customSubModels: already patched — no-op');
    return oldFile;
  }

  const twMatch = oldFile.match(patternTw);
  if (!twMatch || twMatch.index === undefined) {
    console.error(
      'patch: customSubModels: failed to find the session resolver head (TW shape) needed to anchor the session-model recorder — needs re-anchoring'
    );
    return null;
  }

  const sfMatch = oldFile.match(patternSmallFast);
  if (!sfMatch || sfMatch.index === undefined) {
    console.error(
      'patch: customSubModels: failed to find getSmallFastModel (haiku-role resolver shape) — needs re-anchoring'
    );
    return null;
  }

  let patched = oldFile;

  // Injection 1 — recorder at the TW body start (skip if already present).
  if (!alreadyRecorded) {
    const next = spliceIntoBody(
      patched,
      twMatch.index,
      twMatch[0],
      buildRecorder(twMatch[4], twMatch[2])
    );
    if (next === null) {
      console.error(
        'patch: customSubModels: could not locate TW body opener for the recorder'
      );
      return null;
    }
    patched = next;
  }

  // Injection 2 — haiku-role lookup at the MG body start. Re-match: the
  // recorder splice shifted offsets after it (MG sits ~5MB before TW in some
  // builds and after it in others — re-matching is order-proof).
  if (!alreadyLooked) {
    const freshSf = patched.match(patternSmallFast);
    if (!freshSf || freshSf.index === undefined) {
      console.error(
        'patch: customSubModels: lost getSmallFastModel anchor after recorder splice'
      );
      return null;
    }
    const next = spliceIntoBody(
      patched,
      freshSf.index,
      freshSf[0],
      buildHaikuLookup(freshSf[4])
    );
    if (next === null) {
      console.error(
        'patch: customSubModels: could not locate MG body opener for the lookup'
      );
      return null;
    }
    patched = next;
  }

  if (!patched.includes(RECORDER_MARK) || !patched.includes(LOOKUP_MARK)) {
    console.error('patch: customSubModels: injections missing from result');
    return null;
  }

  debug(
    `patch: customSubModels: injected session recorder (tw=${twMatch[1]}, je=${twMatch[4]}) and haiku-role lookup (mg=${sfMatch[1]}, aw=${sfMatch[4]})`
  );
  return patched;
};
