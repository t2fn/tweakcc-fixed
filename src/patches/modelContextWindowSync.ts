// Please see the note about writing patches in ./index
//
// Per-model context windows for custom (Ollama / LM Studio / gateway) models.
//
// -- The problem --
// CC resolves a session's auto-compact window through a per-model pipeline. For
// models it does not recognize it falls back to a 200k default and /context
// reads "200k (default for an unrecognized model)" — even when the user's
// custom model serves 500k+. The user-facing fix is ~/.claude/settings.json:
//
//   { "customModels": [{ "value": "qwen36-500k:35b", "contextWindow": 500000,
//                       "compactThresholdPct": 90 }] }
//
// The model-customizations patch injects a startup reader that loads this into
// globalThis.__tweakccCustomModels; THIS patch makes CC's window resolution
// consult that global, per model, at resolve time. compactThresholdPct (1-100,
// optional) sets the per-model auto-compact trigger as a percentage of the
// window — it takes priority over the global CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
// env var, so "compact at 90%" stays 90% OF THE REAL WINDOW (450k of 500k),
// in /context's display and in the enforcement math alike.
//
// -- The architecture (CC 2.1.267 → 2.1.271 verified; minified names churn
//    EVERY release, so every anchor CAPTURES them at apply time) --
//
//   var CAP=200000,VF=200000,MAXOUT=32000,X=128000;   // window constants
//   function VP(e,n){let r=EZ();if(r!==void 0)return r;       // env override
//     if(QNN(e,n))return VF;return SZ(e,n)}                   // model max window (d)
//   function GNn(e,n=JE(e)){let r=CL(e,n);if(r===void 0)return;
//     if(r>CAP&&!QSE(e))return{declared:r,believed:CAP};      // believed caps at 200k
//     return{declared:r,believed:r}}
//   var TBL={"claude-sonnet-5":{surfaces:{...},default:1e6}}; // per-model table
//   function KOS(e){if(!GATE())return;                        // table lookup
//     if(!Object.hasOwn(TBL,e))return;return NORM(TBL[e])}
//   var SET=new Set(["claude-sonnet-4-6",...]);               // recognized models
//   function TW(e,n,r=PP()){let s=JE(e),d=VP(e,r),...         // the resolver
//     ...
//     if(d<1e6&&(SET.has(s)||...))return{window:min(d,VF),configured:VF,source:"model-default"};
//     let O=A.replacesDefault?void 0:KOS(s);
//     if(O!==void 0)return{window:min(d,O),configured:O,source:"model-default"};
//     ...
//     return{window:d,configured:d,source:"unknown-model"}}   // ← the 200k bug
//
// Observed names per release (resolver VP / lookup KOS / table TBL / id JE):
//   2.1.267: rp  / JBo / FNn / Be     2.1.270: vp  / kos / v5n / je
//   2.1.268: lp  / FGo / KBn / je     2.1.271: ip  / fys / fQn / je
//   2.1.269: vp  / kos / T5n / je
//
// -- Why TWO injections, and why NOT the recognized-models Set --
// A custom model must clear two independent gates to show its real window:
//
//   1. `d = VP(model)` — the model's max window. Unrecognized models get the
//      200k default (metadata `believed` is itself capped at 200k), and every
//      resolver branch clamps to `min(d, ...)`, so without this the window
//      stays 200k no matter what the table says. We inject a per-model lookup
//      right after VP's env-override check (env keeps precedence).
//
//   2. `O = KOS(shortId)` — the per-model table lookup. A hit returns
//      `{window:min(d,O),configured:O,source:"model-default"}`; a miss falls
//      through to `source:"unknown-model"`. We inject the same per-model
//      lookup after KOS's feature gate (gate semantics preserved).
//
// A third, additive injection covers the compact THRESHOLD:
//
//   3. `FPT(model,…)` — builds the auto-compact options, where
//      `testPctOverride` (stock: the CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env) is
//      the percent-of-window trigger consumed by the threshold math
//      (`min(floor(window*pct/100), window-13000)`). We replace the slot with
//      a per-model lookup (customModels[].compactThresholdPct) that falls
//      back to the env expression, so the priority is: per-model config >
//      global env > stock buffer. FPT always sits ~2.4KB after the session
//      resolver TW in the same module (verified 2.1.267-2.1.271), so the
//      id extractor JE resolves there; the lookup is try/catch-wrapped so a
//      future scope split degrades to the env path instead of breaking
//      auto-compact. Applied independently of 1+2 so earlier-patched binaries
//      upgrade to it on re-apply.
//
// Adding the model to the recognized-models Set instead would be WRONG: the
// Set branch fires before the table lookup and returns `min(d,VF)` with
// VF=200000 — it would re-introduce the exact 200k clamp we are removing.
// (Earlier revisions of this patch and of the modelSelector startup reader did
// that with hardcoded per-version names; both are stripped on sight below so
// re-applying over an already-patched binary upgrades cleanly.)
//
// Both injections read globalThis.__tweakccCustomModels lazily at CALL time,
// so there is no startup-order coupling with the settings reader, and /model
// switches pick up the right window per model. Built-in Claude models are
// never in that global, so stock behavior for them is untouched. The global
// 200k constants are contextLimit's territory (CLAUDE_CODE_CONTEXT_LIMIT);
// this patch does not touch them.
//
// -- Older builds --
// Pre-architecture cli.js-era bundles resolved the window through a single
// `hF=(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||200000)` constant; the legacy
// hF path at the bottom covers those (idempotent for binaries patched by
// earlier tweakcc releases).

import { debug } from '../utils';

// Resolver VP immediately followed by metadata GNn. The {declared:,believed:}
// object literals are unminified property names — the distinctive part. The
// `return [^;]{1,100};` slot tolerates VF being any expression (e.g. after
// contextLimit rewrote the constants). Captures:
//   1=VP 2=e-param 3=n-param 4=r-local 5=EZ 6=QNN 7=SZ 8=GNn 9=JE
const patternResolver =
  /function ([\w$]+)\(([\w$]+),([\w$]+)\)\{let ([\w$]+)=([\w$]+)\(\);if\(\4!==void 0\)return \4;if\(([\w$]+)\(\2,\3\)\)return [^;]{1,100};return ([\w$]+)\(\2,\3\)\}function ([\w$]+)\(\2,[\w$]+=([\w$]+)\(\2\)\)\{let [\w$]+=([\w$]+)\(\2,[\w$]+\);if\([\w$]+===void 0\)return;if\([\w$]+>[\w$]+&&![\w$]+\(\2\)\)return\{declared:[\w$]+,believed:[\w$]+\};return\{declared:[\w$]+,believed:[\w$]+\}\}/;

// Per-model window table declaration. The model literal is generalized so a
// future flagship rename (claude-sonnet-6, …) does not break the anchor.
// Capture: 1=TBL
const patternTable = /,([\w$]+)=\{"claude-[\w.-]+":\{surfaces:/;

// Table lookup KOS, chained through the captured TBL name so the match is
// self-validating (hasOwn and the index access must reference the same
// binding). Captures: 1=KOS 2=e-param 3=GATE 4=TBL 5=NORM
const kosPattern = (tbl: string) =>
  new RegExp(
    `function ([\\w$]+)\\(([\\w$]+)\\)\\{if\\(!([\\w$]+)\\(\\)\\)return;if\\(!Object\\.hasOwn\\(${tbl},\\2\\)\\)return;return ([\\w$]+)\\(${tbl}\\[\\2\\]\\)\\}`
  );

// Marker unique to this patch's injections — doubles as the idempotency check.
const INJECT_MARK = '__tcwL=globalThis.__tweakccCustomModels';
// Marker for the per-model compact-threshold injection (applied independently
// so binaries patched before this feature can upgrade to it).
const PCT_MARK = '__tcpL=globalThis.__tweakccCustomModels';

// Compact-threshold resolver (fpt): builds {enabled, precomputeBufferFraction,
// testPctOverride, testBlockingOverride} — testPctOverride (from the
// CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env) is the percent-of-window trigger the
// threshold math consumes. Env-var literals are the stable anchor; verified
// unique per build, always ~2.4KB after the session resolver (same module, so
// the id extractor JE resolves there). Captures: 1=FPT 2=model-param 3=pct-env-local
const patternThreshold =
  /function ([\w$]+)\(([\w$]+),[\w$]+,[\w$]+\)\{let ([\w$]+)=process\.env\.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,([\w$]+)=process\.env\.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE;return\{enabled:[\w$]+\(\),precomputeBufferFraction:[\w$]+\(\2,[\w$]+,[\w$]+\),testPctOverride:\3\?parseFloat\(\3\):void 0,testBlockingOverride:\4\?[\w$]+\(\4\):void 0\}\}/;

// Recover the id-extractor name from an already-injected resolver lookup
// (upgrade path: the pristine resolver anchor no longer matches once the
// core injections are in). Matches the VP-site form `…value===JE(e)`.
const patternInjectedJe = /__tcwM\.value===([\w$]+)\(/;

// Stale injection from the superseded "extend the recognized-models Set"
// approach (spliced after `var SET=new Set([...])`). Harmless to detect, fatal
// to keep: besides the wrong 200k clamp it produced `new Set([...])(function…`
// which throws at module evaluation. Strip on sight.
const patternStaleSetInjection =
  /\(function\(\)\{var m=globalThis\.__tweakccCustomModels;if\(!m\)return;for\(var i=0;i<m\.length;i\+\+\)\{if\(m\[i\]\.value\)try\{[\w$]+\.add\(m\[i\]\.value\);[\w$]+\[m\[i\]\.value\]=\{default:m\[i\]\.contextWindow\|\|200000\}\}catch\(E\)\{\}\}\}\)\(\)/;

// Stale startup-reader IIFE that populated the 2.1.267-era table/set with
// hardcoded minified names (FNn/ZBo). The set-add triggers the same wrong
// 200k clamp; strip on sight.
const patternStaleTableInjection =
  /\(function\(\)\{var m=globalThis\.__tweakccCustomModels;if\(!m\)return;for\(var i=0;i<m\.length;i\+\+\)\{var mw=m\[i\];if\(mw\.contextWindow\)\{try\{[\w$]+\[mw\.value\]=\{default:Number\(mw\.contextWindow\)\};[\w$]+\.add\(mw\.value\)\}\}\}catch\(E\)\{\}\}\)\(\);/;

// Per-model lookup spliced into a function body. `idExpr` is the expression
// yielding the short model id at that site (JE(e) in VP, the bare param in
// KOS). Returns a positive contextWindow or falls through to stock behavior.
const buildLookup = (idExpr: string): string =>
  `var __tcwL=globalThis.__tweakccCustomModels;if(__tcwL)for(var __tcwI=0;__tcwI<__tcwL.length;__tcwI++){var __tcwM=__tcwL[__tcwI];if(__tcwM&&__tcwM.value===${idExpr}){var __tcwW=+__tcwM.contextWindow;if(__tcwW>0)return __tcwW}}`;

// Replacement for fpt's `testPctOverride:ENV?parseFloat(ENV):void 0` slot:
// per-model compactThresholdPct (1-100) wins over the global env override,
// which wins over CC's stock window-13000 buffer. The lookup is wrapped in
// try/catch: JE is captured at the resolver site, and if a future build ever
// put fpt in a scope where that binding does not resolve, the ReferenceError
// degrades to the stock env path instead of breaking auto-compact.
const buildThresholdOverride = (
  je: string,
  modelParam: string,
  pctLocal: string
): string =>
  `(function(){try{var __tcpL=globalThis.__tweakccCustomModels;if(__tcpL){var __tcpId=${je}(${modelParam});for(var __tcpI=0;__tcpI<__tcpL.length;__tcpI++){var __tcpM=__tcpL[__tcpI];if(__tcpM&&__tcpM.value===__tcpId){var __tcpP=+__tcpM.compactThresholdPct;if(__tcpP>0&&__tcpP<=100)return __tcpP}}}}catch(__tcpX){}return ${pctLocal}?parseFloat(${pctLocal}):void 0})()`;

/**
 * Splice `injection` into `file` right after `prefix`, where prefix must be an
 * exact leading substring of the match at matchIndex. Returns null if the
 * prefix does not line up (shape drift within a matched region).
 */
const spliceAfterPrefix = (
  file: string,
  matchIndex: number,
  matchText: string,
  prefix: string,
  injection: string
): string | null => {
  if (!matchText.startsWith(prefix)) return null;
  const at = matchIndex + prefix.length;
  return file.slice(0, at) + injection + file.slice(at);
};

export const writeModelContextWindowSync = (oldFile: string): string | null => {
  if (!oldFile || oldFile.length === 0) {
    debug('patch: modelContextWindowSync: received empty file');
    return null;
  }

  // Upgrade path: strip superseded injections from already-patched binaries
  // before doing anything else (they break boot or re-introduce the clamp).
  let file = oldFile;
  for (const stale of [patternStaleSetInjection, patternStaleTableInjection]) {
    if (stale.test(file)) {
      debug(
        `patch: modelContextWindowSync: stripping stale injection ${stale.source.slice(0, 40)}…`
      );
      file = file.replace(stale, '');
    }
  }

  let patched = file;
  let jeName: string | null = null;
  const coreDone = patched.includes(INJECT_MARK);
  const pctDone = patched.includes(PCT_MARK);

  if (coreDone && pctDone) {
    debug('patch: modelContextWindowSync: already patched — no-op');
    return patched === oldFile ? oldFile : patched;
  }

  // ── Core: window resolution (CC 2.1.267+ native bundles) ───────────────
  if (!coreDone) {
    const resolverMatch = patched.match(patternResolver);
    const tableMatch = patched.match(patternTable);
    const lookupMatch = tableMatch
      ? patched.match(kosPattern(tableMatch[1]))
      : null;

    if (
      resolverMatch?.index !== undefined &&
      lookupMatch?.index !== undefined &&
      tableMatch
    ) {
      const tableName = tableMatch[1];
      // Match-array destructuring: slot 0 is the full match, groups start at 1.
      const [, vpName, eParam, nParam, rLocal, ezName] = resolverMatch;
      jeName = resolverMatch[9];

      // Injection 1 — resolver VP: per-model max window (d). Splice after the
      // env-override early return so CLAUDE_CODE_* env vars keep precedence.
      const vpPrefix = `function ${vpName}(${eParam},${nParam}){let ${rLocal}=${ezName}();if(${rLocal}!==void 0)return ${rLocal};`;
      const afterVp = spliceAfterPrefix(
        patched,
        resolverMatch.index,
        resolverMatch[0],
        vpPrefix,
        buildLookup(`${jeName}(${eParam})`)
      );
      if (afterVp === null) {
        console.error(
          'patch: modelContextWindowSync: resolver prefix drifted inside match'
        );
        return null;
      }

      // Injection 2 — table lookup KOS: per-model configured window, which the
      // resolver reports as source:"model-default". Splice after the feature
      // gate so a disabled gate still disables enforcement. Re-match: the VP
      // splice shifted every offset after it.
      const freshLookup = afterVp.match(kosPattern(tableName));
      if (!freshLookup || freshLookup.index === undefined) {
        console.error(
          'patch: modelContextWindowSync: lost lookup anchor after resolver splice'
        );
        return null;
      }
      const kosPrefix = `function ${freshLookup[1]}(${freshLookup[2]}){if(!${freshLookup[3]}())return;`;
      const afterKos = spliceAfterPrefix(
        afterVp,
        freshLookup.index,
        freshLookup[0],
        kosPrefix,
        buildLookup(freshLookup[2])
      );
      if (afterKos === null) {
        console.error(
          'patch: modelContextWindowSync: lookup prefix drifted inside match'
        );
        return null;
      }

      if (
        !afterKos.includes(INJECT_MARK) ||
        afterKos.length <= patched.length
      ) {
        console.error(
          'patch: modelContextWindowSync: injections missing from result'
        );
        return null;
      }

      debug(
        `patch: modelContextWindowSync: injected per-model window lookups (resolver=${vpName}, lookup=${freshLookup[1]}, gate=${freshLookup[3]}, id=${jeName})`
      );
      patched = afterKos;
    } else if (resolverMatch || lookupMatch || tableMatch) {
      // Half-recognized architecture: applying one injection without the other
      // yields a half-working window (clamped d, or unknown-model label). Fail
      // loud so the drift gets re-anchored instead of silently misreporting.
      console.error(
        'patch: modelContextWindowSync: found only part of the auto-compact resolver shape (resolver=' +
          `${resolverMatch ? 'yes' : 'no'}, table=${tableMatch ? 'yes' : 'no'}, ` +
          `lookup=${lookupMatch ? 'yes' : 'no'}) — needs re-anchoring`
      );
      return null;
    } else {
      // ── Legacy: single-constant hF builds (cli.js era, CC < ~2.1.26x) ──
      // Those predate the fpt/threshold machinery too, so nothing else applies.
      return writeLegacyHfSync(patched);
    }
  } else {
    // Upgrade path: core injections already present (anchors no longer match).
    // Recover the id-extractor name from the injected resolver lookup.
    const jeMatch = patched.match(patternInjectedJe);
    jeName = jeMatch ? jeMatch[1] : null;
  }

  // ── Injection 3 — per-model compact threshold (additive) ───────────────
  // customModels[].compactThresholdPct (1-100) takes priority over the global
  // CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env, which keeps its stock fallback role.
  if (!pctDone) {
    if (patched.includes('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE')) {
      const fptMatch = patched.match(patternThreshold);
      if (!fptMatch || fptMatch.index === undefined) {
        console.error(
          'patch: modelContextWindowSync: compact-threshold resolver (fpt shape) present but drifted — needs re-anchoring'
        );
        return null;
      }
      if (!jeName) {
        console.error(
          'patch: modelContextWindowSync: could not recover the model-id extractor for the threshold injection'
        );
        return null;
      }
      const pctSlot = `testPctOverride:${fptMatch[3]}?parseFloat(${fptMatch[3]}):void 0`;
      const slotAt = fptMatch[0].indexOf(pctSlot);
      if (slotAt === -1) {
        console.error(
          'patch: modelContextWindowSync: testPctOverride slot drifted inside fpt match'
        );
        return null;
      }
      const abs = fptMatch.index + slotAt;
      patched =
        patched.slice(0, abs) +
        `testPctOverride:${buildThresholdOverride(jeName, fptMatch[2], fptMatch[3])}` +
        patched.slice(abs + pctSlot.length);
      debug(
        `patch: modelContextWindowSync: injected per-model compact threshold (fpt=${fptMatch[1]}, id=${jeName})`
      );
    } else {
      debug(
        'patch: modelContextWindowSync: no CLAUDE_AUTOCOMPACT_PCT_OVERRIDE machinery in this build — skipping threshold injection'
      );
    }
  }

  return patched;
};

/**
 * Legacy path: replace the hF context-limit constant with a dynamic lookup.
 * Shapes covered (kept for older installs and idempotent re-applies):
 *   old:    hF=(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||200000)
 *   newer:  hF=(function(){var e=+process.env.CLAUDE_CODE_CONTEXT_LIMIT;...})()
 */
const writeLegacyHfSync = (file: string): string | null => {
  const legacyReplacement = (plusPrefix: string): string =>
    `hF=(function(){var e=${plusPrefix}process.env.CLAUDE_CODE_CONTEXT_LIMIT;if(e>0)return e;var m=globalThis.__tweakccCustomModels||[];for(var i=0;i<m.length;i++){if(m[i].value===BE("model"))return m[i].contextWindow||200000}return 200000})()`;

  const hfFnPattern =
    /hF=\(function\(\)\s*\{var\s+e\s*=\s*\+?process\.env\.CLAUDE_CODE_CONTEXT_LIMIT/;
  const fnMatch = file.match(hfFnPattern);
  if (fnMatch && fnMatch.index !== undefined) {
    // Replace through the end of the IIFE `})()`.
    const tail = file.indexOf('})()', fnMatch.index);
    if (tail === -1) {
      console.error(
        'patch: modelContextWindowSync: legacy hF IIFE tail not found'
      );
      return null;
    }
    const end = tail + '})()'.length;
    if (file.slice(fnMatch.index, end).includes('__tweakccCustomModels')) {
      debug('patch: modelContextWindowSync: legacy hF already patched — no-op');
      return file;
    }
    // Preserve the unary-plus coercion if the original had one (`=+process.env`).
    const plusPrefix = /\+\s*process\.env/.test(fnMatch[0]) ? '+' : '';
    return (
      file.slice(0, fnMatch.index) +
      legacyReplacement(plusPrefix) +
      file.slice(end)
    );
  }

  const hfPattern =
    /hF=\(\+process\.env\.CLAUDE_CODE_CONTEXT_LIMIT\|\|200000\)/;
  const hfMatch = file.match(hfPattern);
  if (hfMatch && hfMatch.index !== undefined) {
    return (
      file.slice(0, hfMatch.index) +
      legacyReplacement('+') +
      file.slice(hfMatch.index + hfMatch[0].length)
    );
  }

  console.error(
    'patch: modelContextWindowSync: failed to find the auto-compact resolver (VP/KOS shape) or the legacy hF constant'
  );
  return null;
};
