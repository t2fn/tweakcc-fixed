// Locks the slot-literal gate against the three ways its first three cuts were
// wrong, all reproduced from the real CC 2.1.233 shapes:
//
//   1. Matching a template to a catalogued prompt by joining quasis and
//      comparing to joined `pieces`. Pieces split on the IDENTIFIER inside a
//      substitution, not on the substitution, so the two can never be equal and
//      the gate reported 0 on a bundle with a real finding.
//   2. Resolving a bare-identifier slot to EVERY declarator of that name in the
//      enclosing function. Minified code reuses one-letter names per block, so
//      unrelated text got attributed to the slot.
//   3. Rejecting the founding literal because its last word ends in a colon.

import { describe, it, expect } from 'vitest';
import { findSlotLiterals, isCandidateText } from './checkSlotLiterals.mjs';

const CATALOGUE = {
  prompts: [
    {
      // The real 2.1.233 entry, trimmed to the shape that matters: four
      // substitutions, `identifiers` binding them to three named slots.
      id: 'system-reminder-team-coordination',
      identifiers: [0, 0, 1, 2],
      identifierMap: {
        0: 'TEAM_OBJECT',
        1: 'TASK_LIST_RESOURCE_LINE',
        2: 'TASK_LIST_COORDINATION_INSTRUCTIONS',
      },
      pieces: [
        '<system-reminder>\nTeam Coordination\n- Name: ${',
        '.agentName}\n- Team config: ${',
        '.teamConfigPath}${',
        '}\n\nRead the team config.${',
        '}\n</system-reminder>',
      ],
    },
  ],
};

const SOURCE = `
function render(e) {
  if (e.type === "other") {
    let n = e.flag ? " some unrelated block-scoped text here" : "";
    use(n);
  }
  if (e.type === "team_context") {
    let r = e.hasTaskListTools ?? probe(),
      n = r ? \`\\n- Task list: \${e.taskListPath}\` : "",
      o = r ? " Check the task list periodically and mark tasks resolved." : "";
    return send(\`<system-reminder>
Team Coordination
- Name: \${e.agentName}
- Team config: \${e.teamConfigPath}\${n}

Read the team config.\${o}
</system-reminder>\`);
  }
}
`;

describe('checkSlotLiterals: candidate text', () => {
  it('accepts the founding literal, whose last word ends in a colon', () => {
    // "\\n- Task list: " normalizes to "- Task list:"; a word test that counts
    // "list:" as a non-word leaves one word and rejects the whole finding.
    expect(isCandidateText('\n- Task list: ')).toBe(true);
  });

  it('rejects a bare joiner', () => {
    expect(isCandidateText(', ')).toBe(false);
    expect(isCandidateText(' — ')).toBe(false);
  });

  it('rejects a single word, however long', () => {
    expect(isCandidateText('  Configuration  ')).toBe(false);
  });

  it('rejects pure punctuation and markup', () => {
    expect(isCandidateText('```\n\n---\n')).toBe(false);
  });
});

describe('checkSlotLiterals: findings', () => {
  const findings = findSlotLiterals(SOURCE, CATALOGUE);

  it('matches a template to its prompt despite pieces splitting on the identifier', () => {
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(f => f.promptId === 'system-reminder-team-coordination')).toBe(true);
  });

  it('finds the uncatalogued task-list resource line', () => {
    const hit = findings.find(f => f.text.includes('Task list'));
    expect(hit).toBeDefined();
    expect(hit.resolvedVia).toBe('identifier n');
  });

  it('names the slot through `identifiers`, not the raw slot index', () => {
    // Slot 2 is the third substitution; identifiers[2] is 1, so the label is
    // TASK_LIST_RESOURCE_LINE. Reading identifierMap[2] directly would report
    // TASK_LIST_COORDINATION_INSTRUCTIONS — the mis-binding class.
    const hit = findings.find(f => f.text.includes('Task list'));
    expect(hit.slot).toBe(2);
    expect(hit.label).toBe('TASK_LIST_RESOURCE_LINE');
  });

  it('does not attribute a same-named declarator from another block', () => {
    // `n` is declared in both `if` bodies. Function-scoped resolution merges
    // them and pins the unrelated string onto this prompt.
    expect(findings.some(f => f.text.includes('unrelated block-scoped'))).toBe(false);
  });

  it('skips slot text that IS catalogued', () => {
    const withUpkeep = {
      prompts: [
        {
          ...CATALOGUE.prompts[0],
          pieces: [
            ...CATALOGUE.prompts[0].pieces,
            ' Check the task list periodically and mark tasks resolved.',
          ],
        },
      ],
    };
    const f = findSlotLiterals(SOURCE, withUpkeep);
    expect(f.some(x => x.text.includes('Check the task list'))).toBe(false);
  });

  it('reports one row per prompt and content, not per emission site', () => {
    const keys = findings.map(f => f.promptId + f.hash);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
