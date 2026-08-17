import { describe, it, expect } from 'vitest';
import { writeAdhdOutputStyle } from './adhdOutputStyle';

// Shapes lifted from the pristine 2.1.227 comms prompt and claudeMd wrapper.
const COMMS =
  "Before your first tool call, say in a sentence what you're about to do; " +
  'while working, give brief updates when you find something load-bearing or change direction.' +
  '\n\nBeing readable and being concise are different things, and readable matters more. ' +
  'If the user has to reread your summary or ask you to explain, any time saved by brevity is gone. ' +
  'The way to keep output short is to be selective about what you include, ' +
  'not to compress the writing into fragments, abbreviations, or jargon. ' +
  'What you do include, write in complete sentences with the technical terms spelled out.' +
  '\n\nMatch the response to the question: a simple question gets a direct answer in prose, not headers and sections. ' +
  'Use tables only for short enumerable facts.';

const REMINDER =
  "As you answer the user's questions, you can use the following context:\n${BLOCKS}\n\n" +
  'IMPORTANT: this context may or may not be relevant to your tasks. ' +
  'You should not respond to this context unless it is highly relevant to your task.';

const FILE = `var a=1;${COMMS}${REMINDER}var b=2;`;

describe('writeAdhdOutputStyle', () => {
  it('removes all three verbosity drivers from the comms prompt', () => {
    const out = writeAdhdOutputStyle(FILE);
    expect(out).not.toBeNull();
    expect(out).not.toContain('find something load-bearing');
    expect(out).not.toContain('readable matters more');
    expect(out).not.toContain('in prose, not headers and sections');
  });

  it('drops the claudeMd relevance hedge', () => {
    const out = writeAdhdOutputStyle(FILE)!;
    expect(out).not.toContain('may or may not be relevant');
    expect(out).toContain("user's standing preference");
  });

  it('installs the report-not-story rules', () => {
    const out = writeAdhdOutputStyle(FILE)!;
    expect(out).toContain('File a status report');
    expect(out).toContain('so a reader can start anywhere');
    expect(out).toContain('noun labels ending in a colon');
    expect(out).not.toContain('MUST land under 120 words');
  });

  // Each of these earned its place in the 2026-08-17 corpus review (two Opus 5
  // reviewers over Claude vs Codex finals). Assert them so a future edit has to
  // be deliberate.
  it('keeps the rules the corpus review converged on', () => {
    const out = writeAdhdOutputStyle(FILE)!;
    // Bold as a value index, not applause; label-ranking, not asides.
    expect(out).toContain('skimming only the bold yields the numbers');
    expect(out).toContain('rather than an aside like "worth flagging"');
    // Limits as facts, not confession; fidelity keepers.
    expect(out).toContain('in the same voice as everything else');
    expect(out).toContain('every count with both sides');
    expect(out).toContain('in the browser only');
    // Graceful-failure clauses: without these an obedient model collapses into
    // fragments or deletes caveats along with the voice.
    expect(out).toContain('Long is fine when the length is more facts');
    expect(out).toContain('drop only the narration around them');
    // Never-trimmed failure reports and the no-coined-images rule.
    expect(out).toContain('each thing you could not check');
    expect(out).toContain('coined images');
    // Dropping the tic list let "genuinely" back in at 4 uses per 12 replies.
    expect(out).toContain('genuinely');
    // Closers were 5 of 14 recent finals; the close is state, not an offer.
    expect(out).toContain('name the options and stop');
  });

  it('installs the full rules in the alternate text-output prompt', () => {
    const textOutput =
      "End-of-turn summary: one or two sentences. What changed and what's next. Nothing else.";
    const out = writeAdhdOutputStyle(textOutput)!;
    expect(out).toContain('File a status report');
    expect(out).toContain('Long is fine when the length is more facts');
  });

  it('inserts no backticks or backslashes that could break a JS literal', () => {
    const added = writeAdhdOutputStyle(FILE)!.slice(FILE.indexOf('var a=1;'));
    expect(added).not.toContain('`');
    expect(added).not.toContain('\\');
  });

  it('preserves untouched surrounding code', () => {
    const out = writeAdhdOutputStyle(FILE)!;
    expect(out.startsWith('var a=1;')).toBe(true);
    expect(out.endsWith('var b=2;')).toBe(true);
    expect(out).toContain('Use tables only for short enumerable facts.');
  });

  it('is idempotent', () => {
    const once = writeAdhdOutputStyle(FILE)!;
    expect(writeAdhdOutputStyle(once)).toBe(once);
  });

  it('still applies when only some anchors are present', () => {
    const partial = `var a=1;${REMINDER}var b=2;`;
    const out = writeAdhdOutputStyle(partial);
    expect(out).not.toBeNull();
    expect(out).not.toContain('may or may not be relevant');
  });

  it('fails loudly when no anchor matches at all', () => {
    expect(writeAdhdOutputStyle('var a=1;var b=2;')).toBeNull();
  });
});
