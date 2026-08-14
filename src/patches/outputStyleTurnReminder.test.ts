import { describe, it, expect } from 'vitest';

import { writeOutputStyleTurnReminder } from './outputStyleTurnReminder';

// The real shape from CC 2.1.231, minified names and all.
const RENDERER =
  'output_style:(e)=>{let t=xve[e.style];if(!t)return[];return vg([bn({content:`${t.name} output style is active. ${e.turnReminder??"Remember to follow the specific guidelines for this style."}`,isMeta:!0})])}';
const FILE = `var a=1;${RENDERER},critical_system_reminder:(e)=>0;var b=2;`;

describe('writeOutputStyleTurnReminder', () => {
  it('drops the guard that silently skips custom styles', () => {
    const out = writeOutputStyleTurnReminder(FILE)!;
    expect(out).not.toContain('if(!t)return[]');
    expect(out).toContain('outputStyleName_tweakcc');
  });

  it('falls back to the configured style name when the style is not built in', () => {
    const out = writeOutputStyleTurnReminder(FILE)!;
    // A built-in still uses its display name; a custom style uses e.style,
    // which is the name from settings.
    expect(out).toContain('t?.name??e.style');
  });

  it('still bails when there is no style at all, rather than emitting an empty reminder', () => {
    const out = writeOutputStyleTurnReminder(FILE)!;
    expect(out).toContain('if(!outputStyleName_tweakcc)return[]');
  });

  it("keeps a style's own turnReminder ahead of the default", () => {
    const out = writeOutputStyleTurnReminder(FILE)!;
    expect(out).toContain('e.turnReminder??');
  });

  it('states what to do rather than what not to do', () => {
    const out = writeOutputStyleTurnReminder(FILE)!;
    const added = out.slice(out.indexOf('output_style:'));
    // The Opus 5 card is specific that bare prohibitions get read as
    // conditional and reasoned past (pp.82-83, p.87), so the reminder must not
    // be phrased as one.
    expect(added).not.toMatch(/\bNEVER\b|\bDo not\b|\bDon't\b/);
    expect(out).toContain('Write this reply the way that style describes');
  });

  it('preserves the surrounding code', () => {
    const out = writeOutputStyleTurnReminder(FILE)!;
    expect(out.startsWith('var a=1;')).toBe(true);
    expect(out.endsWith('var b=2;')).toBe(true);
    expect(out).toContain('critical_system_reminder:(e)=>0');
  });

  it('tolerates minifier renames of every identifier it captures', () => {
    const renamed = FILE.replace(/xve/g, '$Q3')
      .replace(/\bvg\b/g, 'W$1')
      .replace(/\bbn\b/g, '$zz');
    const out = writeOutputStyleTurnReminder(renamed)!;
    expect(out).toBeTruthy();
    expect(out).toContain('$Q3[e.style]');
    expect(out).toContain('W$1([$zz(');
  });

  it('is idempotent: a second run is a no-op, not a double splice', () => {
    const once = writeOutputStyleTurnReminder(FILE)!;
    const twice = writeOutputStyleTurnReminder(once)!;
    expect(twice).toBe(once);
  });

  it('fails loudly when the renderer is gone', () => {
    expect(writeOutputStyleTurnReminder('var a=1;var b=2;')).toBeNull();
  });
});
