import { describe, it, expect, vi } from 'vitest';
import * as vm from 'node:vm';
import { writeModelContextWindowSync } from './modelContextWindowSync';

// Synthetic fixture mirroring the CC 2.1.268 auto-compact shape (names lp/FGo/
// KBn/ZOn/je as in that release). The anchors must capture names, never
// hardcode them — a second fixture below uses the 2.1.270 names to prove it.
const FIXTURE_268 = [
  'var h_e=200000,VF=200000,Tz=32000,Lse=128000;',
  'function lp(e,n){let r=Rz();if(r!==void 0)return r;if(eDn(e,n))return VF;return Cz(e,n)}',
  'function ZOn(e,n=je(e)){let r=ll(e,n);if(r===void 0)return;if(r>h_e&&!qse(e))return{declared:r,believed:h_e};return{declared:r,believed:r}}',
  'var upt=1e6,KBn={"claude-sonnet-5":{surfaces:{remote_cowork:{default:500000},"local-agent":{default:500000}},default:upt}};',
  'function FGo(e){if(!Tp())return;if(!Object.hasOwn(KBn,e))return;return ZBn(KBn[e])}',
  'var $Go=new Set(["claude-sonnet-4-6","claude-opus-4-6","claude-opus-4-8","claude-opus-5"]);',
  'function $S(e,n,r=gp()){let o=je(e),d=lp(e,r),p=ZOn(e,o),_=p?.declared;',
  'if(d<1e6&&($Go.has(o)||BGo(e,_)||eDn(e,r)))return{window:Math.min(d,VF),configured:VF,source:"model-default"};',
  'let O=A.replacesDefault?void 0:FGo(o);if(O!==void 0)return{window:Math.min(d,O),configured:O,source:"model-default"};',
  'return{window:d,configured:d,source:"unknown-model"}}',
].join('');

// Same architecture, different release's minified names (2.1.270-ish).
const FIXTURE_270 = [
  'var Obe=200000,I1=200000,_z=32000,$se=128000;',
  'function vp(e,n){let r=Ez();if(r!==void 0)return r;if(qNn(e,n))return I1;return Sz(e,n)}',
  'function GNn(e,n=je(e)){let r=cl(e,n);if(r===void 0)return;if(r>Obe&&!qse(e))return{declared:r,believed:Obe};return{declared:r,believed:r}}',
  'var x_t=1e6,v5n={"claude-sonnet-5":{surfaces:{remote_cowork:{default:500000}},default:x_t}};',
  'function kos(e){if(!Bp())return;if(!Object.hasOwn(v5n,e))return;return A5n(v5n[e])}',
  'var wos=new Set(["claude-sonnet-4-6","claude-opus-4-6","claude-opus-4-8","claude-opus-5"]);',
  'function tw(e,n,r=Pp()){let s=je(e),d=vp(e,r);return{window:d,configured:d,source:"auto"}}',
].join('');

const expectParses = (code: string) => {
  // Parse-only check (no execution): a syntax error here means the splice
  // produced invalid JS.
  new vm.Script(code, { filename: 'patched.js' });
};

describe('writeModelContextWindowSync (2.1.267+ resolver architecture)', () => {
  it('injects the per-model lookup into the resolver after the env-override check', () => {
    const out = writeModelContextWindowSync(FIXTURE_268);
    expect(out).not.toBeNull();
    expect(out).toContain(
      'function lp(e,n){let r=Rz();if(r!==void 0)return r;var __tcwL=globalThis.__tweakccCustomModels;'
    );
    // The resolver-side lookup resolves the short id through the captured JE fn.
    expect(out).toContain('__tcwM.value===je(e)');
    // Stock tail of the resolver is untouched.
    expect(out).toContain('if(eDn(e,n))return VF;return Cz(e,n)}');
  });

  it('injects the per-model lookup into the table lookup after its feature gate', () => {
    const out = writeModelContextWindowSync(FIXTURE_268)!;
    expect(out).toContain(
      'function FGo(e){if(!Tp())return;var __tcwL=globalThis.__tweakccCustomModels;'
    );
    // The lookup-side compares the bare param (already a short id).
    expect(out).toContain(
      '__tcwM.value===e){var __tcwW=+__tcwM.contextWindow;if(__tcwW>0)return __tcwW}'
    );
    expect(out).toContain(
      'if(!Object.hasOwn(KBn,e))return;return ZBn(KBn[e])}'
    );
  });

  it('does NOT touch the recognized-models Set (adding to it would clamp to the 200k VF)', () => {
    const out = writeModelContextWindowSync(FIXTURE_268)!;
    expect(out).not.toContain('$Go.add');
    expect(out).toContain(
      'var $Go=new Set(["claude-sonnet-4-6","claude-opus-4-6","claude-opus-4-8","claude-opus-5"]);'
    );
  });

  it('captures names per build: the 2.1.270-shaped fixture gets ITS names injected', () => {
    const out = writeModelContextWindowSync(FIXTURE_270)!;
    expect(out).toContain(
      'function vp(e,n){let r=Ez();if(r!==void 0)return r;var __tcwL='
    );
    expect(out).toContain('function kos(e){if(!Bp())return;var __tcwL=');
    expect(out).not.toContain('function lp(');
  });

  it('produces syntactically valid JS', () => {
    const out = writeModelContextWindowSync(FIXTURE_268)!;
    expectParses(out);
  });

  it('is idempotent: a second apply returns the patched file unchanged', () => {
    const once = writeModelContextWindowSync(FIXTURE_268)!;
    const twice = writeModelContextWindowSync(once);
    expect(twice).toBe(once);
  });

  it('strips the stale recognized-Set injection from an already-patched binary', () => {
    // The superseded approach spliced this after the Set literal; it produced
    // `new Set([...])(function…` — a TypeError at boot — besides the wrong clamp.
    const stale = FIXTURE_268.replace(
      'var $Go=new Set(["claude-sonnet-4-6","claude-opus-4-6","claude-opus-4-8","claude-opus-5"]);',
      'var $Go=new Set(["claude-sonnet-4-6","claude-opus-4-6","claude-opus-4-8","claude-opus-5"])' +
        '(function(){var m=globalThis.__tweakccCustomModels;if(!m)return;for(var i=0;i<m.length;i++){if(m[i].value)try{$Go.add(m[i].value);KBn[m[i].value]={default:m[i].contextWindow||200000}}catch(E){}}})()' +
        ';'
    );
    const out = writeModelContextWindowSync(stale)!;
    expect(out).not.toBeNull();
    expect(out).not.toContain('$Go.add');
    expect(out).toContain(']);'); // Set literal is valid again
    expect(out).toContain('var __tcwL=globalThis.__tweakccCustomModels;');
    expectParses(out);
    // And the result is the same as patching the pristine fixture.
    expect(out).toBe(writeModelContextWindowSync(FIXTURE_268));
  });

  it('strips the stale hardcoded-name table IIFE but keeps the settings-reader call', () => {
    const stale =
      FIXTURE_268 +
      'globalThis.__tweakccReadSettings();(function(){var m=globalThis.__tweakccCustomModels;if(!m)return;for(var i=0;i<m.length;i++){var mw=m[i];if(mw.contextWindow){try{FNn[mw.value]={default:Number(mw.contextWindow)};ZBo.add(mw.value)}}}catch(E){}})();';
    const out = writeModelContextWindowSync(stale)!;
    expect(out).not.toBeNull();
    expect(out).not.toContain('ZBo.add');
    expect(out).toContain('globalThis.__tweakccReadSettings();');
    expect(out).toContain('var __tcwL=');
    expectParses(out);
  });

  it('fails loud (null) when only part of the architecture is recognizable', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Table present, resolver + lookup gone.
    const partial =
      'var upt=1e6,KBn={"claude-sonnet-5":{surfaces:{x:{default:1}},default:upt}};function other(){}';
    expect(writeModelContextWindowSync(partial)).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('needs re-anchoring')
    );
    errSpy.mockRestore();
  });

  it('fails loud (null) when nothing matches at all', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      writeModelContextWindowSync('function unrelated(){return 1}')
    ).toBeNull();
    errSpy.mockRestore();
  });
});

// Executable semantics: run the patched resolver chain in a VM with stubbed
// CC internals and assert the window a custom model actually resolves to.
const EXECUTABLE_FIXTURE = [
  // stubs (Rz=env override, eDn/qNn-style guards, Cz=stock 200k default,
  // je=short-id extractor, Tp/Bp=feature gate, ZBn=table normalizer)
  'function Rz(){return undefined}',
  'function eDn(){return false}',
  'function Cz(){return 200000}',
  'function je(e){return typeof e==="string"?e:e.id}',
  'function Tp(){return true}',
  'function ZBn(x){return typeof x==="number"?x:x.default}',
  'function ll(){return undefined}',
  'function qse(){return false}',
  'function gp(){return undefined}',
  'function BGo(){return false}',
  'function HGo(){return{window:null,replacesDefault:false}}',
  'function cpt(){return undefined}',
  'var h_e=200000,VF=200000,Tz=32000,Lse=128000;',
  'function lp(e,n){let r=Rz();if(r!==void 0)return r;if(eDn(e,n))return VF;return Cz(e,n)}',
  'function ZOn(e,n=je(e)){let r=ll(e,n);if(r===void 0)return;if(r>h_e&&!qse(e))return{declared:r,believed:h_e};return{declared:r,believed:r}}',
  'var upt=1e6,KBn={"claude-sonnet-5":{surfaces:{remote_cowork:{default:500000},"local-agent":{default:500000}},default:upt}};',
  'function FGo(e){if(!Tp())return;if(!Object.hasOwn(KBn,e))return;return ZBn(KBn[e])}',
  'var $Go=new Set(["claude-sonnet-4-6","claude-opus-4-6","claude-opus-4-8","claude-opus-5"]);',
  // the resolver, branch cascade as in the real bundle
  'function $S(e,n,r=gp()){let o=je(e),d=lp(e,r),p=ZOn(e,o),_=p?.declared,v=p!==void 0&&p.believed===p.declared;',
  'if(n!==void 0)return{window:Math.min(d,n),configured:n,source:"settings"};',
  'let A=HGo(o);if(A.window!==null)return{window:Math.min(d,A.window),configured:A.window,source:"clientdata"};',
  'let P=cpt(o);if(P!==void 0)return{window:Math.min(d,P),configured:P,source:"experiment"};',
  'if(d<1e6&&($Go.has(o)||BGo(e,_)||eDn(e,r)))return{window:Math.min(d,VF),configured:VF,source:"model-default"};',
  'let O=A.replacesDefault?void 0:FGo(o);if(O!==void 0)return{window:Math.min(d,O),configured:O,source:"model-default"};',
  'if(Tp()&&!v)return{window:d,configured:d,source:"unknown-model"};',
  'return{window:d,configured:d,source:"auto"}}',
  // threshold chain as in the real bundle: w$e(window,fptResult) applies the
  // percent override (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE → testPctOverride) to the
  // RESOLVED window; t1 computes remaining context. Both consume $S output, so
  // they inherit whatever window the resolver produced.
  'function h1e(){return 8192}',
  'var QBn=20000;',
  'function t1(e,n){let r=Math.min(h1e(e),QBn),o=Tp()?n:void 0,{window:d}=$S(e,o);return d-r}',
  'function w$e(e,n){let r=e-13000,o=n.testPctOverride;if(o!==void 0&&!isNaN(o)&&o>0&&o<=100)return Math.min(Math.floor(e*(o/100)),r);return r}',
  // fpt: the compact-options resolver carrying testPctOverride (the real
  // injection site for compactThresholdPct)
  'function GGo(){return 0.08}',
  'function gl(x){return Number(x)||void 0}',
  'function fpt(e,n,r){let o=process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,d=process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE;return{enabled:Tp(),precomputeBufferFraction:GGo(e,n,r),testPctOverride:o?parseFloat(o):void 0,testBlockingOverride:d?gl(d):void 0}}',
  'globalThis.__resolve=$S;',
  'globalThis.__threshold=function(m,pct){return w$e($S(m,void 0).window,{testPctOverride:pct})};',
  // Full chain: window from $S, pct from fpt (where the per-model injection lives)
  'globalThis.__autoThreshold=function(m){return w$e($S(m,void 0).window,fpt(m,void 0))};',
  'globalThis.__remaining=function(m){return t1(m,void 0)};',
  // Joined WITHOUT separators: the resolver anchor requires `}function`
  // adjacency (as in the real minified bundle), and bare declarations
  // concatenate validly.
].join('');

const runResolver = (code: string, customModels: unknown, model: string) => {
  const sandbox: Record<string, unknown> = {};
  const ctx = vm.createContext(sandbox);
  // The fixture assigns __resolve onto globalThis; inside a vm context the
  // realm's globalThis is the sandbox itself.
  vm.runInContext(
    `globalThis.__tweakccCustomModels=${JSON.stringify(customModels)};${code}`,
    ctx,
    { filename: 'executable-fixture.js' }
  );
  const resolve = sandbox.__resolve as (m: string) => {
    window: number;
    configured: number;
    source: string;
  };
  return resolve(model);
};

/** Run the fixture and return its threshold/remaining helpers bound to it. */
const runChain = (
  code: string,
  customModels: unknown,
  env: Record<string, string> = {}
) => {
  const sandbox: Record<string, unknown> = { process: { env } };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    `globalThis.__tweakccCustomModels=${JSON.stringify(customModels)};${code}`,
    ctx,
    { filename: 'executable-fixture.js' }
  );
  return {
    threshold: sandbox.__threshold as (m: string, pct: number) => number,
    autoThreshold: sandbox.__autoThreshold as (m: string) => number,
    remaining: sandbox.__remaining as (m: string) => number,
    env,
  };
};

describe('writeModelContextWindowSync (executable resolver semantics)', () => {
  const customModels = [
    { value: 'qwen36-500k:35b', label: 'q', contextWindow: 500000 },
  ];

  it('unpatched: a custom model resolves to the 200k unknown-model default (the bug)', () => {
    const r = runResolver(EXECUTABLE_FIXTURE, customModels, 'qwen36-500k:35b');
    expect(r).toEqual({
      window: 200000,
      configured: 200000,
      source: 'unknown-model',
    });
  });

  it('patched: the custom model resolves to its declared window as model-default', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const r = runResolver(patched, customModels, 'qwen36-500k:35b');
    expect(r).toEqual({
      window: 500000,
      configured: 500000,
      source: 'model-default',
    });
  });

  it('patched: built-in Claude models keep stock resolution', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    // sonnet-4-6 is in the recognized Set → stock 200k model-default branch
    const r = runResolver(patched, customModels, 'claude-sonnet-4-6');
    expect(r).toEqual({
      window: 200000,
      configured: 200000,
      source: 'model-default',
    });
    // sonnet-5 is in the per-model table → stock table window
    const r5 = runResolver(patched, customModels, 'claude-sonnet-5');
    expect(r5.source).toBe('model-default');
    expect(r5.configured).toBe(1000000);
  });

  it('patched: without the settings global the resolver is fully stock', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const r = runResolver(patched, undefined, 'qwen36-500k:35b');
    expect(r).toEqual({
      window: 200000,
      configured: 200000,
      source: 'unknown-model',
    });
  });

  it('patched: a model entry without a usable contextWindow falls through to stock', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const r = runResolver(
      patched,
      [{ value: 'qwen36-500k:35b', contextWindow: 0 }],
      'qwen36-500k:35b'
    );
    expect(r.source).toBe('unknown-model');
  });

  it('patched: a percent compact threshold applies to the REAL window (90% of 500k = 450k)', () => {
    // The user-visible requirement: /context and auto-compact must compute the
    // threshold from the patched per-model window, not the 200k default.
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { threshold, remaining } = runChain(patched, customModels);
    expect(threshold('qwen36-500k:35b', 90)).toBe(450000);
    // Remaining context also derives from the patched window minus the
    // output reservation: 500000 - min(8192, 20000).
    expect(remaining('qwen36-500k:35b')).toBe(500000 - 8192);
  });

  it('unpatched: the same threshold math runs on the wrong 200k window (90% = 180k)', () => {
    const { threshold } = runChain(EXECUTABLE_FIXTURE, customModels);
    expect(threshold('qwen36-500k:35b', 90)).toBe(180000);
  });

  it('patched: per-model compactThresholdPct drives the auto-compact trigger (90% of 500k = 450k)', () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdPct: 90,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models);
    expect(autoThreshold('qwen36-500k:35b')).toBe(450000);
  });

  it('patched: per-model pct takes priority over the global env override', () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdPct: 90,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models, {
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '70',
    });
    // 90 (per-model) wins over 70 (env): floor(500000*0.9)
    expect(autoThreshold('qwen36-500k:35b')).toBe(450000);
  });

  it('patched: without a per-model pct the env override still rules', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, customModels, {
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80',
    });
    // qwen36-500k:35b has no compactThresholdPct → env 80% of the patched 500k
    expect(autoThreshold('qwen36-500k:35b')).toBe(400000);
  });

  it('patched: an out-of-range compactThresholdPct falls to the 80% custom default', () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdPct: 150,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models);
    // declared custom models never use the stock window-13000 buffer
    expect(autoThreshold('qwen36-500k:35b')).toBe(400000);
  });

  it('patched: a declared custom model with no pct/tokens/env defaults to 80% of its window', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, customModels);
    expect(autoThreshold('qwen36-500k:35b')).toBe(400000);
  });

  it('patched: compactThresholdTokens sets a fixed trigger (450k of a 500k window)', () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdTokens: 450000,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models);
    expect(autoThreshold('qwen36-500k:35b')).toBe(450000);
  });

  it('patched: fixed tokens win over pct when both are set', () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdPct: 50,
        compactThresholdTokens: 450000,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models);
    // 450k (tokens), not 250k (50% pct)
    expect(autoThreshold('qwen36-500k:35b')).toBe(450000);
  });

  it("patched: tokens above CC's window-13000 safety cap get capped", () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdTokens: 495000,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models);
    expect(autoThreshold('qwen36-500k:35b')).toBe(487000);
  });

  it('patched: tokens larger than the window fall through to the 80% default', () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdTokens: 600000,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models);
    expect(autoThreshold('qwen36-500k:35b')).toBe(400000);
  });

  it('patched: env override still beats the 80% default (explicit global wins)', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, customModels, {
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '70',
    });
    expect(autoThreshold('qwen36-500k:35b')).toBe(350000);
  });

  it('patched: built-in models never see the per-model pct path', () => {
    const models = [
      {
        value: 'qwen36-500k:35b',
        contextWindow: 500000,
        compactThresholdPct: 90,
      },
    ];
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { autoThreshold } = runChain(patched, models);
    // claude-sonnet-4-6 → stock window (200k via Cz stub), stock buffer
    expect(autoThreshold('claude-sonnet-4-6')).toBe(187000);
  });

  it('patched: without a pct override the stock window-minus-13k buffer applies to the real window', () => {
    const patched = writeModelContextWindowSync(EXECUTABLE_FIXTURE)!;
    const { threshold } = runChain(patched, customModels);
    // w$e with no override: window - 13000
    expect(threshold('qwen36-500k:35b', undefined as unknown as number)).toBe(
      487000
    );
  });
});

// Fixture with the compact-threshold resolver (fpt) appended — the real
// bundle always carries it ~2.4KB after the session resolver.
const FIXTURE_WITH_FPT =
  FIXTURE_268 +
  'function GGo(){return 0.08}' +
  'function gl(x){return Number(x)||void 0}' +
  'function fpt(e,n,r){let o=process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,d=process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE;return{enabled:Tp(),precomputeBufferFraction:GGo(e,n,r),testPctOverride:o?parseFloat(o):void 0,testBlockingOverride:d?gl(d):void 0}}';

describe('writeModelContextWindowSync (per-model compact threshold)', () => {
  it('replaces the testPctOverride slot with the per-model lookup, keeping the env fallback', () => {
    const out = writeModelContextWindowSync(FIXTURE_WITH_FPT)!;
    expect(out).toContain(
      'testPctOverride:(function(){try{var __tcpL=globalThis.__tweakccCustomModels;'
    );
    // id extractor captured from the resolver anchor (je), model param from fpt (e)
    expect(out).toContain('var __tcpId=je(e);');
    // env fallback preserved inside the IIFE
    expect(out).toContain('return o?parseFloat(o):void 0})()');
    // sibling slot untouched
    expect(out).toContain('testBlockingOverride:d?gl(d):void 0}');
    expectParses(out);
  });

  it('is idempotent with all three injections present', () => {
    const once = writeModelContextWindowSync(FIXTURE_WITH_FPT)!;
    expect(writeModelContextWindowSync(once)).toBe(once);
  });

  it('upgrades a core-only patched file with the threshold injection', () => {
    // Simulate a binary patched before the threshold feature existed:
    // core injections present, fpt untouched.
    const coreOnly = writeModelContextWindowSync(FIXTURE_268)!;
    const upgraded = writeModelContextWindowSync(
      coreOnly +
        'function GGo(){return 0.08}function gl(x){return Number(x)||void 0}' +
        'function fpt(e,n,r){let o=process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,d=process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE;return{enabled:Tp(),precomputeBufferFraction:GGo(e,n,r),testPctOverride:o?parseFloat(o):void 0,testBlockingOverride:d?gl(d):void 0}}'
    )!;
    expect(upgraded).toContain('__tcpL=globalThis.__tweakccCustomModels');
    // je name recovered from the injected core lookup
    expect(upgraded).toContain('var __tcpId=je(e);');
    expectParses(upgraded);
  });

  it('fails loud when the pct machinery exists but the fpt shape drifted', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const drifted =
      FIXTURE_268 +
      'function fpt(e,n,r){let o=process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;return{testPctOverrideSPLIT:o?parseFloat(o):void 0}}';
    expect(writeModelContextWindowSync(drifted)).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('needs re-anchoring')
    );
    errSpy.mockRestore();
  });
});

describe('writeModelContextWindowSync (legacy hF builds)', () => {
  it('replaces the old constant-expression hF with the dynamic lookup', () => {
    const input =
      'q=1;hF=(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||200000),other=2;';
    const out = writeModelContextWindowSync(input)!;
    expect(out).toContain('hF=(function(){var e=+process.env');
    expect(out).toContain('__tweakccCustomModels');
    expect(out).toContain(',other=2;');
    expectParses(out);
  });

  it('replaces the newer hF IIFE shape and is idempotent on re-apply', () => {
    const input =
      'hF=(function(){var e= +process.env.CLAUDE_CODE_CONTEXT_LIMIT;if(e>0)return e;return 200000})(),z=1;';
    const once = writeModelContextWindowSync(input)!;
    expect(once).toContain('var m=globalThis.__tweakccCustomModels||[]');
    expect(once).toContain(',z=1;');
    expectParses(once);
    const twice = writeModelContextWindowSync(once);
    expect(twice).toBe(once);
  });
});

// Real-binary verification across downloaded CC releases. Opt-in because the
// binaries are ~200MB each: TWEAKCC_MCWS_BINARIES=/tmp/cc-dl (a dir with
// x267/package/claude … x271/package/claude).
const binRoot = process.env.TWEAKCC_MCWS_BINARIES;
const versions = ['267', '268', '269', '270', '271', '272', '273'];

describe.skipIf(!binRoot)('real CC binaries (TWEAKCC_MCWS_BINARIES)', () => {
  it.each(versions)(
    'patches CC 2.1.%s end to end',
    async v => {
      const { readFileSync } = await import('node:fs');
      const raw = readFileSync(`${binRoot}/x${v}/package/claude`, 'latin1');
      const out = writeModelContextWindowSync(raw);
      expect(out, 'patch returned null').not.toBeNull();
      // All three injections landed (window resolver, table lookup, threshold).
      expect(
        out!.match(/var __tcwL=globalThis\.__tweakccCustomModels;/g)!.length
      ).toBe(2);
      expect(
        out!.match(/var __tcpL=globalThis\.__tweakccCustomModels/g)!.length
      ).toBe(1);
      // Nothing else changed: size delta is exactly the three injections.
      const injectionLen = out!.length - raw.length;
      expect(injectionLen).toBeGreaterThan(600);
      expect(injectionLen).toBeLessThan(1400);
      // Idempotent.
      expect(writeModelContextWindowSync(out!)).toBe(out);
    },
    120_000
  );
});
