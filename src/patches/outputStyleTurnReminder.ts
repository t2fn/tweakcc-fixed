// Please see the note about writing patches in ./index
//
// Custom output styles never get their per-turn reminder. Built-in ones do.
//
// CC emits one <system-reminder> per turn saying which output style is active.
// The renderer looks the style up in the built-in table and bails when it is
// missing:
//
//   output_style:(e)=>{let t=xve[e.style];if(!t)return[];
//     return vg([bn({content:`${t.name} output style is active. ${
//       e.turnReminder??"Remember to follow the specific guidelines for this style."
//     }`,isMeta:!0})])}
//
// `xve` holds only Proactive, Explanatory, Learning and the default. Custom
// styles are merged into a COPY of it (`let n={...xve}`) during style loading,
// so the original table never learns about them. CC's own telemetry knows the
// difference: `t in xve ? "…outputStyle:"+t : "…outputStyle:custom"`.
//
// Net effect: select a built-in style and the model is reminded of it every
// turn. Write your own and the style text is injected once into the system
// prompt and never restated. That is the weaker of the two positions, and the
// per-turn slot is the one Anthropic's own guidance points at for tone: a short
// reminder near the end of a long system prompt is their measured remedy for
// Opus 5's length, worth about a 20% reduction.
//
// So: fall back to the style's own name instead of bailing, and supply a
// default reminder for styles that do not carry a turnReminder of their own.
//
// The wording is a positive instruction with its purpose attached rather than a
// prohibition. The Opus 5 system card is specific about why: the model reads
// bare scoped prohibitions as conditional and reasons past them (pp.82-83,
// p.87), and "ignoring explicit constraints" is the second-highest behavioral
// negative in the audit, regressed against 4.8 (p.94). A rule that says what to
// do survives that; a rule that says what not to do invites the negotiation.

import { showDiff } from './index';

// The default only renders for a style that does not define its own
// turnReminder. Kept to one sentence: this text is paid for on every single
// turn, and the card's remedy is a short reminder, not another rulebook.
const FALLBACK =
  'Write this reply the way that style describes, including its rules on what to leave out.';

export const writeOutputStyleTurnReminder = (
  oldFile: string
): string | null => {
  // Anchor on the renderer's shape rather than on any minified name: the table,
  // the wrapper and the message builder all get renamed between CC builds.
  const pattern =
    /output_style:\(([$\w]+)\)=>\{let ([$\w]+)=([$\w]+)\[\1\.style\];if\(!\2\)return\[\];return ([$\w]+)\(\[([$\w]+)\(\{content:`\$\{\2\.name\} output style is active\. \$\{\1\.turnReminder\?\?"([^"]*)"\}`,isMeta:!0\}\)\]\)\}/;

  const match = oldFile.match(pattern);
  if (!match || match.index === undefined) {
    if (/\.style\}\.name\?\?|outputStyleName_tweakcc/.test(oldFile)) {
      console.log(
        'patch: outputStyleTurnReminder: already patched in this build — no-op'
      );
      return oldFile;
    }
    console.error(
      'patch: outputStyleTurnReminder: failed to find the output-style reminder renderer'
    );
    return null;
  }

  const [, ev, styleVar, table, wrap, build] = match;

  // `${styleVar}?.name ?? ev.style` keeps the built-in display name where there
  // is one and uses the configured name for a custom style. The guard is gone,
  // so the reminder now renders for both.
  const replacement =
    `output_style:(${ev})=>{let ${styleVar}=${table}[${ev}.style];` +
    `let outputStyleName_tweakcc=${styleVar}?.name??${ev}.style;` +
    `if(!outputStyleName_tweakcc)return[];` +
    `return ${wrap}([${build}({content:\`\${outputStyleName_tweakcc} output style is active. ` +
    `\${${ev}.turnReminder??"${FALLBACK}"}\`,isMeta:!0})])}`;

  const newFile =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + match[0].length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    match.index,
    match.index + replacement.length
  );
  return newFile;
};
