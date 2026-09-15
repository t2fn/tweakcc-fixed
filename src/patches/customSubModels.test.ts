import { describe, it, expect, vi } from 'vitest';
import * as vm from 'node:vm';
import { writeCustomSubModels } from './customSubModels';

// Synthetic fixture mirroring the CC 2.1.268/270 shapes: window resolver (lp),
// session resolver head ($S), and getSmallFastModel (mg) with its env object.
// Names deliberately differ from any single release — anchors must capture.
const FIXTURE = [
  'function Rz(){return undefined}',
  'function eDn(){return false}',
  'function Cz(){return 200000}',
  'function je(e){return typeof e==="string"?e:e.id}',
  'function ll(){return undefined}',
  'function qse(){return false}',
  'function gp(){return undefined}',
  'var h_e=200000,VF=200000;',
  'function lp(e,n){let r=Rz();if(r!==void 0)return r;if(eDn(e,n))return VF;return Cz(e,n)}',
  'function ZOn(e,n=je(e)){let r=ll(e,n);if(r===void 0)return;if(r>h_e&&!qse(e))return{declared:r,believed:h_e};return{declared:r,believed:r}}',
  // window table + lookup (modelContextWindowSync anchors; needed for the
  // order-independence test where that patch runs on this fixture too)
  'function Tp(){return true}',
  'function ZBn(x){return typeof x==="number"?x:x.default}',
  'var upt=1e6,KBn={"claude-sonnet-5":{surfaces:{remote_cowork:{default:500000}},default:upt}};',
  'function FGo(e){if(!Tp())return;if(!Object.hasOwn(KBn,e))return;return ZBn(KBn[e])}',
  // getSmallFastModel shape (env object `a`, normalizer Aw)
  'var a={};',
  'function lot(){return a.ANTHROPIC_SMALL_FAST_MODEL!==void 0||a.ANTHROPIC_DEFAULT_HAIKU_MODEL!==void 0}',
  'function Ie(){return "firstParty"}',
  'function gm(){return null}',
  'function Rle(){return false}',
  'function Rf(){return {}}',
  'function Lp(){return "probe-model"}',
  'function KT(){return null}',
  'function Tr(){return null}',
  'function MM(){return false}',
  'function OM(){return null}',
  'function tt(){return "claude-haiku-4-5"}',
  'function EY(){return a.ANTHROPIC_DEFAULT_HAIKU_MODEL!==void 0?a.ANTHROPIC_DEFAULT_HAIKU_MODEL:"claude-haiku-4-5"}',
  'function sw(e){return e}',
  'function tg(){let e=a.ANTHROPIC_SMALL_FAST_MODEL;if(e!==void 0)return sw(e);if(!lot()){let n=Ie();if((n==="bedrock"||n==="vertex")&&gm()==null&&!Rle()){let r=Rf();if(!r.opus||r.sonnet){let o=Lp();if((KT(o)??Tr(o))&&!MM(o,OM()))return o}}return tt()}return EY()}',
  // session resolver head (tw shape chained through lp)
  'function $S(e,n,r=gp()){let o=je(e),d=lp(e,r),p=ZOn(e,o),_=p?.declared,v=p!==void 0&&p.believed===p.declared;',
  'return{window:d,configured:d,source:"auto"}}',
  'globalThis.__tw=$S;globalThis.__mg=tg;globalThis.__env=a;',
  // Joined WITHOUT separators: anchors require `}function` adjacency.
].join('');

const expectParses = (code: string) => {
  new vm.Script(code, { filename: 'patched.js' });
};

interface SubHarness {
  tw: (m: string) => unknown;
  mg: () => string;
  env: Record<string, string | undefined>;
  sel: () => unknown;
}

const runSubModels = (code: string, customModels: unknown): SubHarness => {
  const sandbox: Record<string, unknown> = {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    `globalThis.__tweakccCustomModels=${JSON.stringify(customModels)};${code}`,
    ctx,
    { filename: 'submodels-fixture.js' }
  );
  return {
    tw: sandbox.__tw as (m: string) => unknown,
    mg: sandbox.__mg as () => string,
    env: sandbox.__env as Record<string, string | undefined>,
    sel: () => sandbox.__tcwSel,
  };
};

describe('writeCustomSubModels (anchor + splice)', () => {
  it('injects the session-model recorder at the resolver body start', () => {
    const out = writeCustomSubModels(FIXTURE);
    expect(out).not.toBeNull();
    expect(out).toContain(
      'function $S(e,n,r=gp()){globalThis.__tcwSel=je(e);let o=je(e),d=lp(e,r)'
    );
  });

  it('injects the haiku-role lookup at getSmallFastModel body start, via the captured normalizer', () => {
    const out = writeCustomSubModels(FIXTURE)!;
    expect(out).toContain(
      'function tg(){var __tsmL=globalThis.__tweakccCustomModels,__tsmS=globalThis.__tcwSel;'
    );
    // returns through the captured Aw-equivalent (sw in this fixture)
    expect(out).toContain('return sw(__tsmH)');
    // stock chain preserved after the injection
    expect(out).toContain(
      'let e=a.ANTHROPIC_SMALL_FAST_MODEL;if(e!==void 0)return sw(e);'
    );
  });

  it('produces syntactically valid JS', () => {
    expectParses(writeCustomSubModels(FIXTURE)!);
  });

  it('is idempotent: second apply returns the file unchanged', () => {
    const once = writeCustomSubModels(FIXTURE)!;
    expect(writeCustomSubModels(once)).toBe(once);
  });

  it('no-ops (unchanged) on bundles without the haiku-role machinery', () => {
    const legacy =
      'function x(){return 1}hF=(+process.env.CLAUDE_CODE_CONTEXT_LIMIT||200000);';
    expect(writeCustomSubModels(legacy)).toBe(legacy);
  });

  it('fails loud (null) when the machinery exists but the resolver anchor drifted', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // mg shape present, resolver/tw gone
    const partial =
      'function tg(){let e=a.ANTHROPIC_SMALL_FAST_MODEL;if(e!==void 0)return sw(e);if(!lot()){let n=Ie();if((n==="bedrock"||n==="vertex")&&gm()==null&&!Rle()){return 1}}return tt()}';
    expect(writeCustomSubModels(partial)).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('needs re-anchoring')
    );
    errSpy.mockRestore();
  });

  it('is order-independent: applies after modelContextWindowSync already injected into the resolver', async () => {
    // The CLI applies window-sync BEFORE sub-models; window-sync's injections
    // split the pristine resolver shape, so the recorder anchor must not
    // depend on it (regression: VP-chained tw anchor broke in that order).
    const { writeModelContextWindowSync } = await import(
      './modelContextWindowSync'
    );
    const windowSynced = writeModelContextWindowSync(FIXTURE)!;
    const out = writeCustomSubModels(windowSynced);
    expect(out).not.toBeNull();
    expect(out).toContain('globalThis.__tcwSel=je(e);');
    expect(out).toContain('var __tsmL=globalThis.__tweakccCustomModels');
    expectParses(out!);
    // And the reverse order also works.
    const subFirst = writeCustomSubModels(FIXTURE)!;
    const both = writeModelContextWindowSync(subFirst)!;
    expect(both).toContain('globalThis.__tcwSel=je(e);');
    expect(both).toContain('var __tcwL=globalThis.__tweakccCustomModels;');
    expectParses(both);
  });
});

describe('writeCustomSubModels (executable semantics)', () => {
  const models = [
    {
      value: 'gemma4-31b',
      contextWindow: 262144,
      subModels: { haiku: 'gemma3:12b' },
    },
    { value: 'qwen38-500k:27b', contextWindow: 500000 },
  ];

  it('records the session model when the window resolver runs', () => {
    const h = runSubModels(writeCustomSubModels(FIXTURE)!, models);
    h.tw('gemma4-31b');
    expect(h.sel()).toBe('gemma4-31b');
  });

  it('routes the haiku role to subModels.haiku of the selected main model', () => {
    const h = runSubModels(writeCustomSubModels(FIXTURE)!, models);
    h.tw('gemma4-31b');
    expect(h.mg()).toBe('gemma3:12b');
  });

  it('follows /model switches: a different main model without subModels restores stock', () => {
    const h = runSubModels(writeCustomSubModels(FIXTURE)!, models);
    h.tw('gemma4-31b');
    expect(h.mg()).toBe('gemma3:12b');
    h.tw('qwen38-500k:27b'); // no subModels entry
    expect(h.mg()).toBe('claude-haiku-4-5'); // stock default-haiku path
  });

  it('per-model subModels beats the global ANTHROPIC_SMALL_FAST_MODEL env', () => {
    const h = runSubModels(writeCustomSubModels(FIXTURE)!, models);
    h.env.ANTHROPIC_SMALL_FAST_MODEL = 'qwen3.8-max';
    h.tw('gemma4-31b');
    expect(h.mg()).toBe('gemma3:12b');
    // ...and the env still rules when the selected model has no subModels
    h.tw('qwen38-500k:27b');
    expect(h.mg()).toBe('qwen3.8-max');
  });

  it('before any resolver run (no session model yet), stock behavior is untouched', () => {
    const h = runSubModels(writeCustomSubModels(FIXTURE)!, models);
    expect(h.sel()).toBeUndefined();
    expect(h.mg()).toBe('claude-haiku-4-5');
  });

  it('with no custom models loaded, stock behavior is untouched', () => {
    const h = runSubModels(writeCustomSubModels(FIXTURE)!, undefined);
    h.tw('gemma4-31b');
    expect(h.mg()).toBe('claude-haiku-4-5');
  });
});

// Real-binary verification across downloaded CC releases (opt-in, same gate as
// modelContextWindowSync): TWEAKCC_MCWS_BINARIES=/tmp/cc-dl
const binRoot = process.env.TWEAKCC_MCWS_BINARIES;
const versions = ['267', '268', '269', '270', '271'];

describe.skipIf(!binRoot)('real CC binaries (TWEAKCC_MCWS_BINARIES)', () => {
  it.each(versions)(
    'patches CC 2.1.%s end to end',
    async v => {
      const { readFileSync } = await import('node:fs');
      const raw = readFileSync(`${binRoot}/x${v}/package/claude`, 'latin1');
      const out = writeCustomSubModels(raw);
      expect(out, 'patch returned null').not.toBeNull();
      expect((out!.match(/globalThis\.__tcwSel=/g) || []).length).toBe(1);
      expect(
        (out!.match(/var __tsmL=globalThis\.__tweakccCustomModels/g) || [])
          .length
      ).toBe(1);
      // idempotent
      expect(writeCustomSubModels(out!)).toBe(out);
    },
    120_000
  );
});
