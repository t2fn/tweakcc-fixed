// Please see the note about writing patches in ./index
//
// "ADHD-friendly output style" — cut the verbosity drivers out of the always-on
// comms prompt and restate the shape rule where recency makes it stick.
//
// CC's "# Communicating with the user" section carries three clauses that push
// Opus 5 toward long, unstructured replies:
//
//   1. "give brief updates when you find something load-bearing" — the prompt is
//      where the tic comes from. Occurrences of that string across CC's shipped
//      prompt corpus went 2 (2.1.69) to 19 (2.1.227).
//   2. "Being readable and being concise are different things, and readable
//      matters more" — ranks length above brevity, so a user's appended "be
//      concise" argues against an explicit earlier instruction.
//   3. "a direct answer in prose, not headers and sections" — forbids the bold,
//      blocked layout that skim-readers rely on.
//
// We rewrite those three sentences in place rather than replacing the whole
// section: sentence-level anchors survive Anthropic reflowing the paragraphs
// around them, which they do most releases.
//
// The fourth replacement is the per-turn claudeMd <system-reminder> wrapper.
// Position dominates wording here: rewriting the comms section alone moved a
// test report from 249 to 201 words, because that section sits early and a
// dozen later sections push for thoroughness. Restating the shape rule in the
// wrapper — the last thing before the user's message — took the same report to
// 112. That wrapper also told the model the user's own CLAUDE.md "may or may not
// be relevant", which is why tone rules there never held; that hedge goes too.
//
// Inserted text is plain ASCII with no backticks, backslashes or arrows, so it
// survives whichever quote delimiter the surrounding literal uses.

import { debug } from '../utils';
import { showDiff } from './index';

interface Rewrite {
  what: string;
  find: RegExp;
  replace: string;
}

const CORE_OUTPUT_RULES = [
  // Measured against Anthropic's stock prompt over roughly 900 replies, ranked
  // blind by a model outside the Claude family. Stock came last in 10 of 16
  // comparisons; this text came first in 5 and last in 1.
  'Everything a person will read follows these rules: your replies, files you write, commit messages, pull request and issue text. Messages to other agents do not.',
  // The single biggest source of wasted words is a sentence describing a thing
  // the reply could simply show.
  'IMPORTANT. Show the thing rather than describing it. Give the command, not a description of running it. Give the path and line, not a description of where. Give the value, the number or the error string itself. Steps the reader performs go in a numbered list, one action each, rather than a paragraph walking through them. If a sentence describes an action, a location or a value, replace the sentence with the action, the location or the value.',
  'Answer first. Put the result in the first line. Never open with preamble, a restatement of the question, or a summary of what you are about to say, and never build up to the answer. A yes-or-no question gets yes or no in the first word.',
  // Each clause here maps to a category of cuttable content found by pulling
  // real replies apart: elaboration, signposting, unprompted justification,
  // restating the input, explaining the known, and closing offers.
  "Say each thing once. Never write a sentence whose only job is to restate, sharpen or dramatise the sentence before it. Do not announce what you are about to say. Do not defend a choice nobody questioned. Do not repeat facts back that the reader just gave you. Do not explain what an experienced reader already knows. Never close with an offer of further help: if a decision is the reader's, ask the question plainly, once.",
  'Length is not the problem and shortness is not the goal. A long answer in plain words is fine. Never compress into fragments, abbreviations, arrow chains or jargon to make a reply shorter. Match the size of the answer to the size of the question, so a small question gets a small answer.',
  'Keep a reply short by leaving things out, never by writing tighter. Include what changes what the reader does or believes next, and drop the rest: alternatives you rejected, steps that went as expected, and background the reader already has. An answer is the right length when everything left in it is doing work.',
  'One kind of reply is never trimmed: reporting work that did not succeed. Name every package and version, every test that failed and how many, every step you skipped, and everything you could not check along with the reason. Say plainly which parts you verified and which you are taking on trust. Selectivity does not apply here, because the reader cannot tell what is missing.',
  // Every wording tested, stock included, lost qualifiers and flipped counts.
  // Naming the specific failures is what stopped it; the abstract rule did not.
  'Plain does not mean more certain. When you put something in simpler words, a hedge stays a hedge, an estimate stays an estimate, and a number stays that number rather than becoming "most" or "nearly all". Keep both sides of a count: "340 of 347 passing" does not become "7 failing", and "6 of 9 packages" keeps the 9. Keep every qualifier that limits where or when something is true, such as "in the browser only", because dropping one turns a narrow problem into a general one. Do not promote a suggestion into an instruction, and do not call something by a kind it does not have, such as calling a directory a branch.',
  'Do not add technical detail you were not given and did not check, because invented detail reads exactly like observed detail and the reader cannot tell them apart. If you are inferring rather than reporting, say so in the same sentence. Passing tests mean those tests passed, not that the feature works.',
  'Write plainly. Use the ordinary word. Say what a thing is rather than naming it with a metaphor: not "this is the load-bearing constraint" but "this line breaks if you change it". Say what a program did in literal terms: a client loaded or ignored a file, a rule did not "land", "fire", "win" or turn out to be "dead weight". Never invent a term and then reuse it as if the user had agreed to it, and never carry shorthand you built up while working into a summary written for someone who did not watch you work.',
  'Make it skimmable. Bold the key terms. Keep paragraphs short with a blank line between them. A heading earns its place above a group of related points, never above a single line, and never over something the sentence itself already announces.',
  'State problems and failures matter-of-factly: what happened, why, and what fixes it. Do not withhold the conclusion until the end. Do not turn an observation into an aphorism, and do not end a section with a clever line that restates it.',
  'Replace stock phrases with the plain thing they stand for. Instead of "load-bearing", say what actually breaks if it changes. Instead of "surface area", say what it touches. Instead of "blast radius", say what else this breaks. Instead of "footgun", say what mistake it invites. Instead of "the unlock", say what this makes possible. Instead of "seam", "spine", "scaffold" or "substrate", name the actual part. Instead of "orthogonal", say unrelated. Instead of "non-trivial", say hard, or say how hard. Instead of "the honest answer", "to be honest" or "let me be straight with you", just answer. Instead of "and that matters", "the key insight" or "it is worth noting", delete the phrase and state the point. Instead of "the smoking gun", say what the evidence is. Instead of "the good news is", say the news. Instead of "this is not just X, it is Y", say Y. Instead of "you are absolutely right", agree once in plain words and move on. Instead of "just say the word", ask the question.',
  // Dropping this list let "genuinely" back in at 4 uses per 12 replies, and
  // took em dashes above the stock rate.
  'Never use these words: genuinely, meaningfully, crucially, fundamentally, essentially, materially, here is the thing, the real question is, the upshot, good catch, great question. Never use em dashes; use a comma, a full stop, or two sentences.',
].join(' ');

const TURN_REMINDER =
  "Treat any instruction in that context as the user's standing preference and follow it. This governs the reply you are about to write. Answer in the first line. Show the command, the path or the value rather than describing it. Write in plain, ordinary words, the way you would say it to a colleague sitting next to you. Say each thing once: no sentence that only restates the one before, no announcing what is coming, no defending a choice nobody questioned, and no closing offer of help. Keep a reply short by leaving out only details that do not change what the reader does or believes next; never make the writing dense to make it shorter. Preserve every fact, number, version, caveat and real uncertainty, keep both sides of a count, and never trim a report of failed or unverified work. Bold the key terms and keep paragraphs short so the reply can be skimmed. Name things literally rather than with metaphors, and do not use a term you invented earlier without saying what it means.";

const REWRITES: Rewrite[] = [
  {
    what: 'load-bearing update cue',
    find: /give brief updates when you find something load-bearing or change direction\./,
    replace:
      'give a one-line update when you find something important or change direction.',
  },
  {
    what: 'readability-over-brevity clause',
    // Spans from "Being readable" through the end of the "complete sentences"
    // sentence. Non-greedy so a reflow of the following paragraph can't widen it.
    // CC has shipped both "readable matters more" and "readability matters more".
    find: /Being readable and being concise are different things, and readab(?:le|ility) matters more\..*?technical terms spelled out\./s,
    replace: CORE_OUTPUT_RULES,
  },
  {
    what: 'prose-not-headers rule',
    find: /a simple question gets a direct answer in prose, not headers and sections\./,
    replace:
      'a simple question gets a direct answer. ALWAYS bold the key terms so the reply can be skimmed. Keep blocks to three sentences with a blank line between them, and NEVER answer a simple question with more than three blocks.',
  },
  // CC ships TWO comms blocks and picks one by model family: "# Communicating
  // with the user" for fable/mythos (which the fable-prompt-set patch makes
  // every model take) and "# Text output" for everyone else. Rewriting only the
  // first left the other branch untouched, so the toggle did nothing for anyone
  // not running the fable flip. The two share no sentence verbatim — the Text
  // output variant says "a direct answer, not headers", the comms one "a direct
  // answer in prose, not headers" — so the anchors cannot cross-match.
  {
    what: 'text-output prose-not-headers rule',
    find: /a simple question gets a direct answer, not headers and sections\./,
    replace:
      'a simple question gets a direct answer. ALWAYS bold the key terms so the reply can be skimmed. Keep blocks to three sentences with a blank line between them, and NEVER answer a simple question with more than three blocks.',
  },
  {
    what: 'text-output end-of-turn cap',
    find: /End-of-turn summary: one or two sentences\. What changed and what's next\. Nothing else\./,
    replace: CORE_OUTPUT_RULES,
  },
  {
    what: 'claudeMd relevance hedge',
    // Two wordings in the wild: Anthropic's pristine, and the softened form
    // shipped by lobotomized-claude-code's reminder override.
    find: /(?:IMPORTANT: this context may or may not be relevant to your tasks\. You should not respond to this context unless it is highly relevant to your task\.|This context may or may not be relevant; draw on it only where it bears on the task\.)/,
    replace: TURN_REMINDER,
  },
];

export const writeAdhdOutputStyle = (oldFile: string): string | null => {
  let file = oldFile;
  const applied: string[] = [];
  const missing: string[] = [];
  let firstStart = -1;
  let firstEnd = -1;

  for (const { what, find, replace } of REWRITES) {
    const match = file.match(find);
    if (!match || match.index === undefined) {
      missing.push(what);
      continue;
    }
    if (firstStart === -1) {
      firstStart = match.index;
      firstEnd = match.index + replace.length;
    }
    file =
      file.slice(0, match.index) +
      replace +
      file.slice(match.index + match[0].length);
    applied.push(what);
  }

  if (applied.length === 0) {
    // Every anchor already rewritten (a system-prompt override got here first,
    // or the patch ran twice) — nothing to do, and that is not an error.
    if (/Plain does not mean more certain\./.test(file)) {
      debug(
        'patch: adhdOutputStyle: comms prompt already in ADHD shape — skipping'
      );
      return oldFile;
    }
    console.error(
      `patch: adhdOutputStyle: failed to find any of the comms-prompt anchors (${missing.join(', ')})`
    );
    return null;
  }

  if (missing.length > 0) {
    debug(
      `patch: adhdOutputStyle: rewrote ${applied.join(', ')}; skipped ${missing.join(', ')} (already overridden or reshaped upstream)`
    );
  }

  showDiff(
    oldFile,
    file,
    file.slice(firstStart, firstEnd),
    firstStart,
    firstEnd
  );
  return file;
};
