// Locks the slot-literal bypass and its naming pass, both added for CC 2.1.233.
//
// A slot literal is prose that renders into a catalogued prompt's substitution
// slot. `tools/checkSlotLiterals.mjs` finds them and records a `catalogue` or
// `glue` verdict per content hash; the extractor reads the `catalogue` ones
// twice — once to capture the string at all, once to name the capture.
//
// Every case below is a shape that actually went wrong while landing this:
// pieces split mid-expression rather than at a bare `${`, pieces holding raw
// source where the allowlist holds cooked text, and the subset filter eating a
// capture nested inside its own parent prompt.

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ex = require('./promptExtractor.js');

const HASH_TASK_LIST = 'c0dabec62341035c'; // sha256-16 of norm("\n- Task list: ")

afterEach(() => ex._setSlotLiteralsForTests(null));

describe('slotLiteralCandidates: recovering the literal from a stored piece', () => {
  it('strips a bare trailing `${`', () => {
    expect(ex.slotLiteralCandidates('\n- Task list: ${')).toContain(
      '\n- Task list: '
    );
  });

  it('strips a trailing expression opener, not just `${`', () => {
    // `${[...gZt()].join(", ")}` splits after `${[...`, so a rule that only
    // removed a literal `${` left system-prompt-agent-namer anonymous.
    expect(
      ex.slotLiteralCandidates('\n\nAvoid these (already taken): ${[...')
    ).toContain('\n\nAvoid these (already taken): ');
  });

  it('strips a leading expression remainder', () => {
    expect(ex.slotLiteralCandidates('].join(", ")}tail text')).toContain(
      'tail text'
    );
  });

  it('undoes the two escapes template pieces store raw', () => {
    // pieces hold RAW source; the allowlist hashes the cooked text. Without
    // this the REPL shQuote guidance never matched its own verdict.
    expect(ex.slotLiteralCandidates('use \\`shQuote(s)\\` for \\$HOME')).toContain(
      'use `shQuote(s)` for $HOME'
    );
  });

  it('never returns an empty candidate', () => {
    expect(ex.slotLiteralCandidates('${')).not.toContain('');
  });
});

describe('slotLiteralVerdict', () => {
  it('reads a catalogue verdict for the founding case', () => {
    expect(ex.slotLiteralVerdict('\n- Task list: ')).toBeTruthy();
    expect(ex.slotLiteralVerdict('\n- Task list: ').verdict).toBe('catalogue');
  });

  it('ignores whitespace differences, matching the hash convention', () => {
    expect(ex.slotLiteralVerdict('\n-  Task   list:  ')).toBeTruthy();
  });

  it('returns null for text with no verdict', () => {
    expect(ex.slotLiteralVerdict('a string nobody has ruled on')).toBeNull();
  });

  it('returns null for a glue verdict, which must not be captured', () => {
    // `, shared with ` is recorded glue; a glue verdict is a decision NOT to
    // mint an id, so it must not reach the bypass.
    expect(ex.slotLiteralVerdict(', shared with ')).toBeNull();
  });
});

describe('shouldCapture: the bypass', () => {
  it('captures a below-floor string on a slot-literal verdict', () => {
    // Three words: far under the prose gate, which is the whole problem.
    expect(ex.shouldCapture('\n- Task list: ', '\n- Task list: ', 'let n=r?', 500)).toBe(
      false
    );
    expect(
      ex.shouldCapture('\n- Task list: ', '\n- Task list: ', 'let n=r?', 500, {
        slotLiteral: true,
      })
    ).toBe(true);
  });

  it('still refuses a hard-excluded string', () => {
    const script = '#!/usr/bin/env node\nconsole.log("build tooling")';
    expect(ex.isHardExcluded(script)).toBe(true);
    expect(
      ex.shouldCapture(script, script, 'x=', 500, { slotLiteral: true })
    ).toBe(false);
  });

  it('still refuses inside a drop context', () => {
    // The bypass outranks the cache and the prose gate, never the drop context.
    const lead = 'import ';
    if (ex.leadShowsDropContext(lead)) {
      expect(
        ex.shouldCapture('\n- Task list: ', '\n- Task list: ', lead, 500, {
          slotLiteral: true,
        })
      ).toBe(false);
    }
  });
});

describe('applySlotLiteralNames', () => {
  const ALLOW = {
    [HASH_TASK_LIST]: {
      verdict: 'catalogue',
      id: 'system-reminder-team-coordination-task-list-resource-line',
      name: 'System Reminder: Team coordination — task list resource line',
      desc: 'The task-list path listed among the team resources.',
      text: '\n- Task list: ',
    },
  };

  it('names an anonymous capture from its piece', () => {
    ex._setSlotLiteralsForTests(ALLOW);
    const prompts = [
      { id: '', name: '', description: '', pieces: ['\n- Task list: ${', '.taskListPath}'] },
    ];
    ex.applySlotLiteralNames(prompts);
    expect(prompts[0].id).toBe(
      'system-reminder-team-coordination-task-list-resource-line'
    );
    expect(prompts[0].name).toContain('task list resource line');
  });

  it('never overwrites an established id', () => {
    ex._setSlotLiteralsForTests(ALLOW);
    const prompts = [
      { id: 'already-carried', name: 'x', description: '', pieces: ['\n- Task list: ${'] },
    ];
    ex.applySlotLiteralNames(prompts);
    expect(prompts[0].id).toBe('already-carried');
  });

  it('leaves an unrelated prompt anonymous rather than guessing', () => {
    ex._setSlotLiteralsForTests(ALLOW);
    const prompts = [{ id: '', name: '', description: '', pieces: ['unrelated text'] }];
    ex.applySlotLiteralNames(prompts);
    expect(prompts[0].id).toBe('');
  });

  it('is a no-op when the allowlist is empty', () => {
    ex._setSlotLiteralsForTests({});
    const prompts = [{ id: '', name: '', description: '', pieces: ['\n- Task list: ${'] }];
    ex.applySlotLiteralNames(prompts);
    expect(prompts[0].id).toBe('');
  });
});

describe('the shipped allowlist stays load-bearing', () => {
  const allow = require('../data/slot-literal-allowlist.json');
  const cat = Object.values(allow).filter(v => v.verdict === 'catalogue');

  it('gives every catalogue verdict an id, name and description', () => {
    const bad = cat.filter(v => !v.id || !v.name || !v.desc);
    expect(bad.map(v => v.text)).toEqual([]);
  });

  it('records only the three verdicts the tool defines', () => {
    // `not-a-slot` is not a judgement about the text — it marks a resolver
    // artifact, where the literal is an ARGUMENT to a call whose return value
    // is the real slot value. Only `catalogue` mints an id.
    const kinds = new Set(Object.values(allow).map(v => v.verdict));
    expect([...kinds].sort()).toEqual(['catalogue', 'glue', 'not-a-slot']);
  });

  it('mints ids from `catalogue` only', () => {
    const withId = Object.values(allow).filter(v => v.id);
    expect(withId.every(v => v.verdict === 'catalogue')).toBe(true);
  });

  it('keeps every catalogue id present in the current prompts JSON', () => {
    // The entries are what NAME those prompts; if an id here is missing from
    // the catalogue, the next extraction leaves that capture anonymous.
    const cur = require('../data/prompts/prompts-2.1.233.json');
    const ids = new Set(cur.prompts.map(p => p.id));
    const missing = [...new Set(cat.map(v => v.id))].filter(i => !ids.has(i));
    expect(missing).toEqual([]);
  });
});
