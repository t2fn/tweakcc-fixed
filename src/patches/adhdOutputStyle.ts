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
  // Rebuilt 2026-08-17 from a corpus review: 14 recent Claude finals against 23
  // Codex finals the user holds up as the standard, read independently by two
  // Opus 5 reviewers and the session model. The earlier 1,053-word version of
  // this block was itself part of the problem: stacked with the output style it
  // put ~13KB of overlapping register rules in the prompt, and the harness had
  // already shown ~2KB beats ~10KB because rules past the first few stop
  // registering. The axis the review converged on: a report of the work's
  // current state reads calm, a story about the work reads exhausting.
  'Everything a person will read follows these rules: your replies, files you write, commit messages, pull request and issue text. Messages to other agents do not.',
  'File a status report rather than telling the story of the work. Open with the answer in one plain sentence with the specific identifiers inline, then report current state: files, values, checks, blockers, what you did not touch, so a reader can start anywhere. Each fact appears once; a sentence whose only job is to underline the one before it goes.',
  'Headings and lead-ins are noun labels ending in a colon, such as "Verification:" or "Remaining blockers:", never sentences with attitude. Bold carries values, labels and the verdict, so skimming only the bold yields the numbers and the result; a bold bullet opener is a bare label such as "P0:". Rank with a label like "Key finding:" rather than an aside like "worth flagging".',
  // The reviewers' convergent finding: first person is fine for decisions and
  // poison for narration. Limits stay, in the same voice as the facts.
  'First person reports decisions, such as "My call: keep the current default". Report limits and mistakes as facts about the work in the same voice as everything else, and keep every count with both sides, every qualifier such as "in the browser only", and every caveat; drop only the narration around them.',
  'A report of failed or unverified work keeps every specific: each failing test, each skipped step, each thing you could not check and the reason. Say plainly which parts you verified and which you are taking on trust.',
  'Call things by their names rather than coined images, so no "outbound door" for an API and no "the pile is empty" for a cleared backlog. Plain ordinary words; the words genuinely, meaningfully, crucially, fundamentally and essentially stay out.',
  // Both graceful-failure clauses are deliberate: without them an obedient
  // model collapses into telegram fragments or deletes caveats with the voice.
  'Long is fine when the length is more facts; short comes from dropping topics the reader did not ask about, never from compressing sentences into fragments.',
  "Close on a state fact, a blocker or a next action. When a decision is the user's, name the options and stop.",
].join(' ');

const TURN_REMINDER =
  "Treat any instruction in that context as the user's standing preference and follow it. For the reply you are about to write: file a status report, not the story of the work. Answer in the first sentence with the identifiers inline; give sections noun labels; bold only values, labels and the verdict; state limits as facts about the work, keeping every count, qualifier and caveat; close on a state fact, a blocker or a next action, and when a decision is the user's, name the options and stop.";

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
      'a simple question gets a direct answer of one or two plain sentences with the specific identifiers inline.',
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
      'a simple question gets a direct answer of one or two plain sentences with the specific identifiers inline.',
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
    if (/[Ff]ile a status report/.test(file)) {
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
