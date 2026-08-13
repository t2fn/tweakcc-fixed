// Additional Directories Patch - Inject CLAUDE_CODE_ADDITIONAL_DIRS env var support
//
// Appends colon-separated paths from the CLAUDE_CODE_ADDITIONAL_DIRS environment variable
// to additionalDirectoriesForClaudeMd before Claude Code processes them.
//
// These directories are shared across:
//   1. Skills  — <dir>/.claude/skills (loaded via getAdditionalDirectoriesForClaudeMd)
//   2. Rules   — <dir>/CLAUDE.md, <dir>/.claude/CLAUDE.md, <dir>/.claude/rules/*.md
//                (gated by CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD env var)
//   3. Templates — <dir>/.claude/templates (via markdownConfigLoader CLAUDE_CONFIG_DIRECTORIES)
//
// Patch strategy: find the call that stores additional dirs to state, inject env-var parsing
// before it consumes the addDir array so new paths get appended.

import { showDiff } from './index';

/**
 * Build injection code that appends colon-separated CLAUDE_CODE_ADDITIONAL_DIRS entries
 * to the given variable name (the minified addDir identifier).
 */
const buildInjection = (varName: string): string => {
  return `\n(function(){try{var d=process.env.CLAUDE_CODE_ADDITIONAL_DIRS;if(d){var ds=d.split(":");for(var i=0;i<ds.length;i++){if(ds[i]&&${varName}.indexOf(ds[i])<0)${varName}.push(ds[i]);}}}catch(e){}})();`;
};

// ============================================================================
// Version: NPM bundled cli.js (text search for named function call)
// Pattern: setAdditionalDirectoriesForClaudeMd(addDir) or similar
// ============================================================================
const patchNpmCli = (file: string): string | null => {
  const anchor = 'setAdditionalDirectoriesForClaudeMd(';
  const idx = file.indexOf(anchor);
  if (idx === -1) return null;

  // Find the variable name inside parens
  const afterAnchor = file.slice(idx + anchor.length);
  const m = afterAnchor.match(/^([$\w]+)/);
  if (!m) return null;

  const injection = buildInjection(m[1]);
  const result = file.slice(0, idx) + injection + file.slice(idx);

  showDiff(
    file,
    result,
    `Injected CLAUDE_CODE_ADDITIONAL_DIRS (NPM cli.js)`,
    idx,
    idx
  );
  return result;
};

// ============================================================================
// Version: Native binary minified bundle (uses function context anchor)
// Pattern in bundled code: ...ue(yn)`)}hFe(b);let... right after [Computer Use MCP] Setup failed
// Raw sequence: `)}<fn>(<var>) — backtick+close-paren close template+catch, brace closes try
// ============================================================================
const patchNativeBinary = (file: string): string | null => {
  // Find the exact call site pattern right after "Setup failed:"
  const anchor = 'Setup failed:';
  const idx = file.indexOf(anchor);
  if (idx === -1) return null;

  // Pattern in raw text after Setup failed:: ...ue(XN)`)}<fnName>(<varName>);...
  // We match the `)}<fn>(<var>) sequence using a regex that handles:
  //   ` = closing backtick of template literal
  //   ) = closing paren of catch parameter
  // } = closing brace of try/catch body
  // <fnName> = minified function name (hFe, etc.)
  // ( = opening paren of the call
  // <varName> = variable holding addDir array
  const searchArea = file.slice(idx, idx + 600);
  // Use character class [`] for backtick to avoid TS template literal parsing issues
  // Match the full call: `)}<fnName>(<varName>) including closing paren
  const callPattern = /[`]\)\}([$\w]+)\(([ $\t]*)([$\w]+)/;
  const m = callPattern.exec(searchArea);
  if (!m) return null;

  // m[3] = variable name (e.g. b) — the addDir array identifier
  const varName = m[3];
  if (!varName) return null;

  // Calculate absolute position in file
  // We need to inject after the closing ) of the function call
  // The match ends at the last char of the variable name, so find the next ) in searchArea
  const matchStart = idx + (m.index ?? 0);
  let scanPos = matchStart + m[0].length;
  while (scanPos < file.length && file[scanPos] !== ')') scanPos++;
  if (scanPos >= file.length) return null; // Shouldn't happen but be safe
  const injectionPoint = scanPos + 1; // After the closing )

  const injection = buildInjection(varName);
  const result =
    file.slice(0, injectionPoint) +
    '\n' +
    injection +
    file.slice(injectionPoint);

  showDiff(
    file,
    result,
    `Injected CLAUDE_CODE_ADDITIONAL_DIRS (Native: ${varName})`,
    injectionPoint,
    injectionPoint
  );
  return result;
};

/**
 * Try NPM cli.js pattern first, then fall back to native binary pattern.
 */
export const writeAdditionalDirs = (file: string): string | null => {
  // Check if already patched
  if (file.includes('CLAUDE_CODE_ADDITIONAL_DIRS')) return file;

  const npmResult = patchNpmCli(file);
  if (npmResult) return npmResult;

  const nativeResult = patchNativeBinary(file);
  if (nativeResult) return nativeResult;

  return null;
};
