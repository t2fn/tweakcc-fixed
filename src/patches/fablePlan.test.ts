import { describe, it, expect, vi, beforeEach } from 'vitest';

import { writeFablePlan } from './fablePlan';
import { DEFAULT_SETTINGS } from '../defaultSettings';
import { FablePlanConfig } from '../types';

const config = (over: Partial<FablePlanConfig> = {}): FablePlanConfig => ({
  ...DEFAULT_SETTINGS.fablePlan,
  enabled: true,
  ...over,
});

// The six sites the patch needs, in the shapes CC 2.1.228 ships them.
const cli = [
  // 1. alias whitelist, read by the `sM()` membership check
  'h9e=["sonnet","opus","haiku","fable","best","opusplan"],_an=["sonnet","opus","haiku","fable"]});',
  // 2. per-request model resolver
  'function uM(e){let{permissionMode:t,mainLoopModel:r,exceeds200kTokens:n=!1}=e,o=tW();' +
    'if((o==="opusplan"||o==="opusplan[1m]")&&t==="plan"&&!n){return ww()}return r}',
  // 3. builtin-default switch
  'function Gvo(e){let t=T9e();switch(e){case"opus":return zZe(t);case"sonnet":return Kvo(t);' +
    'case"haiku":return mTs(t);case"fable":return pTs(t);case"opusplan":return Kvo(t);default:return null}}',
  // 4. alias -> concrete model
  'function as(e){let t=e.trim(),r=t.toLowerCase(),n=bT(r),o=n?Ma(r).trim():r;if(sM(o))switch(o){' +
    'case"fable":{let i=pcn();return aM(i)}case"opusplan":return n?aM(vJ(yk())):yk();' +
    'case"sonnet":return n?aM(vJ(yk())):yk();case"haiku":return n?aM(vJ(GZe())):GZe();' +
    'case"opus":return n?aM(vJ(ww())):ww();case"best":return Xvu();default:}return null}',
  // 5. `/model` picker options
  'function qB_(e,t){let r=BB_(e),n=X.ANTHROPIC_CUSTOM_MODEL_OPTION;return r}',
  // 6. effort resolver, plus the clear-context gate
  'function xte(e,t){if(!AO(e))return;let r=m1e(e),n=Uet(e),o=Xbt();return o}',
  'let p=it((yt)=>yt.settings.showClearContextOnPlanAccept)??!1,f=2;',
].join('');

describe('writeFablePlan', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('registers the alias in the whitelist that gates every other site', () => {
    // `sM(e){return h9e.includes(e)}` rejects anything absent here, so without
    // this splice the other five are inert.
    const out = writeFablePlan(cli, config());
    expect(out).not.toBeNull();
    expect(out).toContain('"opusplan","fableplan"]');
  });

  it('resolves the plan model only for its own alias', () => {
    const out = writeFablePlan(cli, config())!;
    expect(out).toContain('o==="fableplan"');
    expect(out).toContain('as(t==="plan"?"fable":"opus")');
    // and clears the effort global on the way past every other alias, so
    // switching away cannot leave a stale effort pinned for the session
    expect(out).toContain('globalThis.__tweakccFablePlanEffort=void 0;');
    // CC's own branches survive untouched — this must not change any other model
    expect(out).toContain(
      'if((o==="opusplan"||o==="opusplan[1m]")&&t==="plan"&&!n)'
    );
    expect(out).toContain('return r}');
  });

  it('rests on the exec model in both alias resolvers', () => {
    const out = writeFablePlan(cli, config())!;
    // clones the exec alias's own arm rather than inventing one
    expect(out).toContain('case"fableplan":return n?aM(vJ(ww())):ww();');
    expect(out).toContain('case"fableplan":return zZe(t);');
  });

  it('decides effort where the permission mode is known, not from the model', () => {
    // Regression: effort used to key on the model string handed to the effort
    // resolver. Every call site passes `options.mainLoopModel` — the SESSION
    // model — so during a Fable plan turn it saw the RESTING model (Opus), the
    // substring test missed, and CC displayed "thinking with medium effort".
    // `uM` is the only function handed the permission mode, so it decides both.
    const out = writeFablePlan(cli, config())!;
    expect(out).toContain(
      'globalThis.__tweakccFablePlanEffort=t==="plan"?"xhigh":"medium";'
    );
    expect(out).toContain(
      'if(globalThis.__tweakccFablePlanEffort!==void 0)return globalThis.__tweakccFablePlanEffort;'
    );
    // the model must NOT be consulted for effort any more
    expect(out).not.toContain('String(e).includes(');
  });

  it('offers the clear-context option Claude Code defaults off', () => {
    const out = writeFablePlan(cli, config())!;
    expect(out).toContain('showClearContextOnPlanAccept)??!0');
  });

  it('leaves the clear-context default alone when the user turned it off', () => {
    const out = writeFablePlan(
      cli,
      config({ offerClearContextOnPlanAccept: false })
    )!;
    expect(out).toContain('showClearContextOnPlanAccept)??!1');
  });

  it('honours a different pairing', () => {
    const out = writeFablePlan(
      cli,
      config({ planModel: 'opus', execModel: 'sonnet', planEffort: 'max' })
    )!;
    expect(out).toContain('as(t==="plan"?"opus":"sonnet")');
    expect(out).toContain(
      'globalThis.__tweakccFablePlanEffort=t==="plan"?"max":"medium";'
    );
    expect(out).toContain('"label":"Opus Plan Mode"');
  });

  it('adds the alias to the model picker', () => {
    const out = writeFablePlan(cli, config())!;
    expect(out).toContain('"value":"fableplan"');
    expect(out).toContain('Use Fable in plan mode, Opus otherwise');
  });

  it('is idempotent — a re-apply changes nothing', () => {
    // Five of the six anchors match their own output, so without the
    // already-applied marker a second run injects a second set of splices.
    const once = writeFablePlan(cli, config())!;
    const twice = writeFablePlan(once, config())!;
    expect(twice).toBe(once);
  });

  it('refuses a pairing of a model with itself', () => {
    expect(
      writeFablePlan(cli, config({ planModel: 'opus', execModel: 'opus' }))
    ).toBeNull();
  });

  it('fails loudly when the alias whitelist is gone', () => {
    expect(
      writeFablePlan(cli.replace('"opusplan"],', '],'), config())
    ).toBeNull();
  });

  it('no-ops the effort splice when the resolver is absent', () => {
    // Effort is optional machinery; its absence must not fail the whole patch.
    const withoutEffort = cli.replace(
      'function xte(e,t){if(!AO(e))return;let r=m1e(e),n=Uet(e),o=Xbt();return o}',
      ''
    );
    const out = writeFablePlan(withoutEffort, config());
    expect(out).not.toBeNull();
    expect(out).toContain('"value":"fableplan"');
  });
});
