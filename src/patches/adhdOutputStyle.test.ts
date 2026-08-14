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

  it('installs the extracted plain-output rules', () => {
    const out = writeAdhdOutputStyle(FILE)!;
    expect(out).toContain('Answer first');
    expect(out).toContain('Keep a reply short by leaving things out');
    expect(out).toContain('Plain does not mean more certain');
    expect(out).toContain('reporting work that did not succeed');
    expect(out).toContain('Instead of "load-bearing"');
    expect(out).not.toContain('MUST land under 120 words');
  });

  // Each of these earned its place in testing, and each has been dropped by a
  // rewrite at least once. Assert them so a future edit has to be deliberate.
  it('keeps the rules that measurably changed the output', () => {
    const out = writeAdhdOutputStyle(FILE)!;
    // Replacing description with the command or path was the largest single
    // reduction on a "how do I fix this" task, 434 words down to 361.
    expect(out).toContain('Show the thing rather than describing it');
    // Targets the categories that padding actually fell into.
    expect(out).toContain('Say each thing once');
    expect(out).toContain('Do not defend a choice nobody questioned');
    // Abstract fidelity wording did not hold; the named failures did.
    expect(out).toContain('Keep both sides of a count');
    expect(out).toContain('in the browser only');
    expect(out).toContain('Do not add technical detail you were not given');
    // Dropping this list let "genuinely" back in and pushed em dashes above
    // the unpatched rate.
    expect(out).toContain('genuinely');
    expect(out).toContain('Never use em dashes');
    // A heading over every single line was caused by an earlier, unconditional
    // version of the skimmability rule.
    expect(out).toContain('never above a single line');
  });

  it('installs the full rules in the alternate text-output prompt', () => {
    const textOutput =
      "End-of-turn summary: one or two sentences. What changed and what's next. Nothing else.";
    const out = writeAdhdOutputStyle(textOutput)!;
    expect(out).toContain('Keep a reply short by leaving things out');
    expect(out).toContain('Plain does not mean more certain');
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
