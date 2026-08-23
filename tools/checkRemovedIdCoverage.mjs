#!/usr/bin/env node
/**
 * Removed-id coverage gate — a catalogued prompt that LEFT the catalogue while
 * its text is still in the bundle.
 *
 * Every other coverage gate runs forward: it starts from something the
 * extractor captured, or from a shape it knows how to assemble, and asks
 * whether that thing is catalogued. None of them can start from a prompt that
 * used to have an id and quietly stopped having one, because after the fact
 * there is nothing left pointing at it. The previous version's catalogue is the
 * only record that the text was ever ours, and it is thrown away at the moment
 * the new JSON is written.
 *
 * Found on CC 2.1.239. Anthropic folded the eight artifact published-path
 * checks into one shared validator:
 *
 *     // 2.1.238 — each message its own template, each one catalogued
 *     `files: published path ${JSON.stringify(e)} contains a backslash — …`
 *
 *     // 2.1.239 — one validator, the prefix hoisted to a call-site label
 *     function Gem(e, t) { … return { errMsg: `${t} ${JSON.stringify(e)} contains a backslash — …` } }
 *     Gem(e, "files: published path")
 *
 * Every body now opens with a bare `${t}`, so the leading literal piece is a
 * single space and the surviving prose is short. The prose gate drops it,
 * `detectionCoverage` only assembles multi-NODE composites and each of these is
 * one template node, and `checkParamSlotLiterals` surfaced only the one call
 * site whose argument carries prose rather than a label. Six model-facing
 * tool-results left the catalogue in one commit and every gate was green.
 *
 * The check runs the other way. For each id in `prev - cur`, slide a window
 * across the previous body's literal runs and ask where that text is now:
 *
 *   in-catalogue  the text is in the new JSON under some id. A rename or an
 *                 id-collision reshuffle — not a loss, but re-map any override
 *                 by CONTENT before trusting the id.
 *   in-sidecar    the text is a pending classify candidate. It gets a verdict
 *                 and a name this run; nothing to do here.
 *   IN-BUNDLE     the text is in cli.js and NOWHERE else. This is the finding:
 *                 model-facing prose that silently stopped being catalogued.
 *   gone          absent from all three. A real removal — archive the override.
 *
 * Only IN-BUNDLE fails. `gone` is reported so the archive list is computed
 * rather than eyeballed, and reviewed removals are recorded in the allowlist so
 * a stable removal stops being re-reported every bump.
 *
 * Two things the probe has to get right, both of them §12 rows that have cost a
 * bump before:
 *
 *   - Probe ASCII-only. An em dash is `—` in the bundle, so a window
 *     carrying one reads as absent from a file that contains it.
 *   - Step the window by 5, not by its own width. A reword moves the boundary,
 *     and a stride-width sweep can miss a body that is 90% intact.
 *
 * Absence is counted with `String.prototype.includes`, never `grep`: one NUL
 * byte anywhere makes ugrep return false-empty for every pattern.
 *
 *   node tools/checkRemovedIdCoverage.mjs <cli.js> <prev.json> <cur.json> [--update-allowlist]
 */
import fs from 'node:fs';
import path from 'node:path';

const WINDOW = 25;
const STRIDE = 5;
const ALLOWLIST = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'data',
  'removed-id-allowlist.json'
);

const [cliPath, prevPath, curPath, ...flags] = process.argv.slice(2);
const updateAllowlist = flags.includes('--update-allowlist');

if (!cliPath || !prevPath || !curPath) {
  console.error(
    'usage: checkRemovedIdCoverage.mjs <cli.js> <prev.json> <cur.json> [--update-allowlist]'
  );
  process.exit(2);
}
for (const f of [cliPath, prevPath, curPath]) {
  if (!fs.existsSync(f)) {
    console.error(`checkRemovedIdCoverage: missing input ${f} — cannot run`);
    process.exit(2);
  }
}

const readPrompts = f => JSON.parse(fs.readFileSync(f, 'utf8')).prompts || [];

// The `${` and `}` are already in the pieces, so the BARE label goes between
// them, keyed by `identifiers[i]` as a string. Mirrors
// reconstructContentFromPieces in src/systemPromptSync.ts — never re-derive it
// inline differently, a hand-rolled version makes prompts un-matchable.
const reconstruct = p => {
  const pieces = p.pieces || [];
  const identifiers = p.identifiers || [];
  const map = p.identifierMap || {};
  let out = '';
  for (let i = 0; i < pieces.length; i += 1) {
    out += pieces[i];
    if (i < identifiers.length) {
      out += map[String(identifiers[i])] ?? `UNKNOWN_${identifiers[i]}`;
    }
  }
  return out;
};

// Only ASCII runs are probeable: everything else escapes in the bundle.
const isAscii = s => !/[^\x20-\x7e]/.test(s);

const literalRuns = p =>
  (p.pieces || []).filter(x => typeof x === 'string' && x.length >= WINDOW);

const cli = fs.readFileSync(cliPath, 'utf8');
const prev = readPrompts(prevPath);
const cur = readPrompts(curPath);

const curIds = new Set(cur.map(p => p.id).filter(Boolean));
const curBlob = cur.map(reconstruct).join('\n');

// The classify sidecar: a candidate awaiting a verdict this run is not a gap.
const sidecarBlob = (() => {
  const dir = '/tmp';
  let blob = '';
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter(f => /^classify-chunk-\d+\.json$/.test(f))
      .map(f => path.join(dir, f));
  } catch {
    return '';
  }
  for (const f of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    const items = Array.isArray(parsed)
      ? parsed
      : parsed.candidates || parsed.items || [];
    for (const c of items) blob += `\n${c.body || ''}`;
  }
  return blob;
})();

const prevById = new Map();
for (const p of prev) {
  if (!p.id) continue;
  if (!prevById.has(p.id)) prevById.set(p.id, []);
  prevById.get(p.id).push(p);
}

const allowlist = fs.existsSync(ALLOWLIST)
  ? JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'))
  : {};

const classify = id => {
  let inBundle = false;
  for (const p of prevById.get(id) || []) {
    for (const run of literalRuns(p)) {
      for (let off = 0; off + WINDOW <= run.length; off += STRIDE) {
        const w = run.slice(off, off + WINDOW);
        if (!isAscii(w)) continue;
        if (curBlob.includes(w)) return 'in-catalogue';
        if (sidecarBlob.includes(w)) return 'in-sidecar';
        if (cli.includes(w)) inBundle = true;
      }
    }
  }
  return inBundle ? 'IN-BUNDLE' : 'gone';
};

const buckets = { 'in-catalogue': [], 'in-sidecar': [], 'IN-BUNDLE': [], gone: [] };
for (const id of [...prevById.keys()].filter(i => !curIds.has(i)).sort()) {
  buckets[classify(id)].push(id);
}

const removed = buckets['IN-BUNDLE'].length + buckets.gone.length;
console.log(
  `removed-id coverage: ${prevById.size - curIds.size >= 0 ? '' : ''}` +
    `${buckets['in-catalogue'].length} renamed/reshuffled, ` +
    `${buckets['in-sidecar'].length} pending classify, ` +
    `${buckets['IN-BUNDLE'].length} STILL IN BUNDLE, ` +
    `${buckets.gone.length} truly removed (${removed} need a decision)`
);

if (updateAllowlist) {
  for (const id of [...buckets['IN-BUNDLE'], ...buckets.gone]) {
    if (!allowlist[id]) {
      allowlist[id] = { verdict: 'REVIEW', bucket: classify(id), why: '' };
    }
  }
  fs.writeFileSync(ALLOWLIST, `${JSON.stringify(allowlist, null, 2)}\n`);
  console.log(`wrote ${ALLOWLIST} — set each verdict to archived | recovered`);
}

// A recorded verdict silences `gone` only. An IN-BUNDLE finding keeps failing
// until the text is actually catalogued again, exactly like a `model` verdict
// in the detection-coverage allowlist: the whole point of the gate is that the
// prompt is still reaching the model with no id, and writing that down in a
// file does not change it.
const unreviewedGone = buckets.gone.filter(
  id => allowlist[id]?.verdict !== 'archived'
);

if (buckets['IN-BUNDLE'].length) {
  console.log('\nSTILL IN BUNDLE — model-facing text that lost its id:');
  for (const id of buckets['IN-BUNDLE']) console.log(`  ${id}`);
  console.log(
    '\nRead the emission site. If the prompt survived a refactor, record a\n' +
      'classification-cache "model" verdict REUSING this id (probe the exact key\n' +
      'with TWEAKCC_DUMP_CANDIDATES — do not guess it), then re-extract.'
  );
}
if (unreviewedGone.length) {
  console.log('\ntruly removed, no recorded verdict:');
  for (const id of unreviewedGone) console.log(`  ${id}`);
  console.log(
    '\nArchive each override to ~/.tweakcc/orphans-removed-for-<ver>/ and record\n' +
      '{"verdict":"archived"} in data/removed-id-allowlist.json.'
  );
}

if (buckets['IN-BUNDLE'].length) {
  console.log('\nremoved-id coverage: FAIL');
  process.exit(1);
}
console.log(
  `\nremoved-id coverage: PASS (${unreviewedGone.length} removal(s) awaiting archival)`
);
