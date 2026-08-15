#!/usr/bin/env node
// Call-slot audit — the prevention gate for the "override calls a value slot as a
// function" bug class (see reference_print_smoke_misses_interactive_prompt_bugs).
// An override that writes `${VAR()}` (or `${VAR(args)}`) is only safe if VAR's
// pristine slot is itself a call. If the binary interpolates that slot as a bare
// value (`${e}`, often a pre-computed `let e=fn();...${e}`), the spliced `${e()}`
// calls a string -> runtime TypeError. The scratchpad-directory override shipped
// exactly this (2.1.186 / PR #19): it broke EVERY interactive TUI turn while
// `claude --print` passed clean, because `--print` returns null before the line.
// None of the other static gates catch it: `${e()}` parses fine, and the
// mis-bind / orphan-var gates check slot bindings, not call-vs-value.
//
// The invariant (deterministic, no TUI needed): the pristine JSON content
// reconstructs each interpolation with the identifier NAME stripped but the
// surrounding syntax kept -> a direct call is `${(...)}` (char after `${` is
// `(`), a bare value is `${}`, a member is `${.x}`. So per prompt, the number of
// DISTINCT vars an override calls must not exceed the number of direct-call
// interpolations the pristine has. scratchpad: 1 called var vs 0 pristine calls
// -> flagged. (This is a necessary condition; it nails the realistic class where
// an author adds a spurious call. A real interactive turn remains the belt+braces
// for the rarer call-the-bare-and-skip-the-real-fn swap.)
//
// Usage: node tools/auditCallSlots.mjs [prompts.json] [set-dir ...]
// Exits non-zero if any override calls more distinct vars than its prompt has
// callable slots, and exits 2 if it could not run at all.
import fs from 'node:fs';

//
// Every maintained set is scanned, not one. This bug class is exactly the
// parallel-set-drift case: `--apply` rebases only the ACTIVE set, so a stale
// `${VAR()}` on a slot that became a bare value survives in the OTHER sets for
// dozens of releases while the active set stays green. Defaulting to a single
// hardcoded set name made the gate blind to the failures it exists to find.
const newestJson = () => {
  try {
    return fs
      .readdirSync('data/prompts')
      .filter(f => /^prompts-\d+\.\d+\.\d+\.json$/.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .pop();
  } catch {
    return null;
  }
};
const VER = process.env.CC_VER || null;
const ourJson =
  process.argv[2] ||
  (VER ? `data/prompts/prompts-${VER}.json` : `data/prompts/${newestJson()}`);
const LCC = `${process.env.HOME}/.tweakcc/lobotomized-claude-code`;
const cliDirs = process.argv.slice(3).map(a => a.replace(/^--set=/, ''));
const overrideDirs = cliDirs.length
  ? cliDirs
  : (() => {
      try {
        return fs
          .readdirSync(LCC)
          .filter(d => d.startsWith('system-prompts-'))
          .filter(d => fs.statSync(`${LCC}/${d}`).isDirectory())
          .map(d => `${LCC}/${d}`);
      } catch {
        return [];
      }
    })();

let OURS;
try {
  OURS = JSON.parse(fs.readFileSync(ourJson, 'utf8'));
} catch (e) {
  // A gate that could not run is a gate that did not run: exit non-zero so it
  // can never be read as "found nothing".
  console.error(`call-slot audit: SKIPPED — prompts JSON '${ourJson}' missing/unreadable (${e.message}).`);
  process.exit(2);
}
if (overrideDirs.length === 0) {
  console.error(`call-slot audit: SKIPPED — no override sets found under ${LCC}.`);
  process.exit(2);
}
const files = [];
for (const dir of overrideDirs) {
  let entries;
  try {
    entries = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch (e) {
    console.error(`call-slot audit: SKIPPED — overrides dir '${dir}' missing (${e.message}).`);
    process.exit(2);
  }
  for (const f of entries) files.push({ dir, f });
}

// id -> max number of direct-call interpolations across that id's JSON entries
// (multisite ids splice the same prompt; the override needs the calls to exist at
// the site it targets, so the lenient max avoids false positives on a variant).
const promptBody = p =>
  p.content || (p.pieces || []).filter(x => typeof x === 'string').join('');
const directCalls = s => (s.match(/\$\{\(/g) || []).length;
const callsById = {};
for (const p of OURS.prompts) {
  if (!p.id) continue;
  const n = directCalls(promptBody(p));
  callsById[p.id] = Math.max(callsById[p.id] ?? 0, n);
}

const findings = [];
for (const { dir, f } of files) {
  const id = f.slice(0, -3);
  // Only named-prompt overrides map to the JSON. inline-* / system-reminder-* use
  // other surfaces (positional remap / registry) and aren't in prompts JSON.
  if (!(id in callsById)) continue;
  const raw = fs.readFileSync(`${dir}/${f}`, 'utf8');
  const body = (raw.match(/^<!--[\s\S]*?-->\n?([\s\S]*)$/) || [, raw])[1];
  // Distinct vars the override CALLS: ${VAR( ... — VAR immediately followed by `(`
  // (a direct call on VAR). Member-calls ${VAR.method( are not a direct call on
  // VAR and are correctly excluded. Skip escaped \${.
  const calledVars = new Set(
    [...body.matchAll(/(?<!\\)\$\{([A-Z][A-Z0-9_]+)\(/g)].map(m => m[1])
  );
  if (!calledVars.size) continue;
  const available = callsById[id];
  if (calledVars.size > available) {
    findings.push(
      `${dir.split('/').pop()}/${id}: override calls ${calledVars.size} distinct var(s) [${[...calledVars].join(', ')}] but pristine has only ${available} direct-call slot(s) — a ${'${VAR()}'} on a bare value slot throws at runtime`
    );
  }
}

if (findings.length) {
  console.error(`CALL-SLOT BUGS: ${findings.length} (override calls a non-callable slot)`);
  for (const m of findings) console.error('  ' + m);
  console.error(
    '\nFix: drop the spurious () so the override interpolates the value (e.g. ${VAR}), matching the pristine. The pristine renders a call as ${(...)} and a value as ${}. See reference_print_smoke_misses_interactive_prompt_bugs.'
  );
  process.exit(1);
}
console.log(
  `call-slot audit: 0 (no override calls a non-callable slot; ${files.length} file(s) across ${overrideDirs.length} set(s))`
);
