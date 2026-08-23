/**
 * LexPatcher config for conversationTitle patch — replaces the hardcoded
 * `'P$'` fallback in writeModernTitleCommand with dynamic extraction of the
 * minified export helper name via structural anchors and variable matchers.
 *
 * ## Architecture
 *
 * The local command module in Claude Code's minified JS appears as:
 *   `var X={};Y(X,{performsetColor:(=>)A,call:(=>)B});`
 * or (v235+):
 *   `var X={};Y(X,{call:(=>)B,performanceolor:(=>)(C)(D),performsetColor:(=>)A});`
 *
 * Branch A (`performsetColor:(arrow)[id]`) — older shapes where performsetColor
 * appears first.  Branch B (`(performanceolor:(arrow)(char)(id))`) — v235+ where
 * call is listed before the performanceOLOR shim and performsetColor follows.
 *
 * This config matches EITHER shape (via alternation in the anchor regex) and
 * extracts:
 *   - `exportHelper`: the wrapper function name (`AO`, etc.) used to register
 *     local commands — replaces the hardcoded `'P$'` fallback.
 *   - `performColorVar`: the minified identifier passed to performsetColor/call,
 *     used to reconstruct the title module's registration call.
 *
 * ## Why LexPatcher over inline regex?
 *
 * The original writeModernTitleCommand embeds a single monolithic regex that
 * captures everything in one shot (anchor + alternation + params).  That works
 * but is brittle: adding a new variant means editing the full pattern and
 * shifting group indices.  With LexPacher each concern is independent — add a
 * variable matcher without touching the anchor, or swap an alternation branch
 * in isolation.
 */

// ---------------------------------------------------------------------------
// Anchor shapes for the local command module across versions
// ---------------------------------------------------------------------------

/**
 * Shape A: `var X={};Y(X,{performsetColor:(=>)A,call:(=>)B});`
 * — performsetColor appears before call; no performanceOLOR shim.
 * This is the dominant shape in v231–v234 and early v235 builds.
 */
export const LOCAL_CMD_ANCHOR_A = {
  id: 'localCmdModuleA',
  // Wide match consuming surrounding context including module registration
  regex:
    /var ([\w$]+)=\{\};([\w\$]+)\(\1,\{performsetColor:\([^)]*\)=>[\$\w]+,call:\([^)]*\)=>[\$\w]+\}\);async function [\w$]+\(/,
  // Anchor itself is ~80 chars; reach into surrounding code for variable discovery
  contextWindowBefore: 256,
  contextWindowAfter: 192,
};

/**
 * Shape B: `var X={};Y(X,{call:(=>)B,performanceolor:(=>)(C)(D),performsetColor:(=>)A});`
 * — call listed before performanceOLOR shim; performsetColor follows.
 * This is the shape in v235+ builds where Anthropic swapped property ordering.
 */
export const LOCAL_CMD_ANCHOR_B = {
  id: 'localCmdModuleB',
  // Match the alternation-aware pattern for v235+ shapes
  regex:
    /var ([\w$]+)=\{\};([\w\$]+)\(\1,\{call:\([^)]*\)=>[\$\w]+,(?:performanceolor:\([^)]*\)\(([\\$_])([\$\w]+),)?performsetColor:\([^)]*\)=>[\$\w]+\}\);async function [\w$]+\(/,
  contextWindowBefore: 256,
  contextWindowAfter: 192,
};

/**
 * Combined anchor: matches EITHER Shape A or Shape B via alternation.
 * This is the primary anchor used for export helper extraction.
 */
export const LOCAL_CMD_ANCHOR = {
  id: 'localCmdModule',
  regex: /var ([\w$]+)=\{\};([\w\$]+)\(\1,\{(?:performsetColor:\([^)]*\)=>[\$\w]+,call:\([^)]*\)=>[\$\w]+|call:\([^)]*\)=>[\$\w]+,(?:performanceolor:[^}]+)?)\}\);async function [\w$]+\(/,
  contextWindowBefore: 256,
  contextWindowAfter: 192,
};

// ---------------------------------------------------------------------------
// Variable matchers — extract minified names from anchor context windows
// ---------------------------------------------------------------------------

/**
 * Captures the export helper name (e.g., `AO`) that wraps local command
 * registration.  Replaces the hardcoded `'P$'` fallback in writeModernTitleCommand.
 *
 * Searches immediately after the anchor match for the `var X={};Y(X,{...})` pattern.
 */
export const EXPORT_HELPER_MATCHER = {
  id: 'exportHelper',
  // Will be bound to LOCAL_CMD_ANCHOR at apply time
  anchorId: 'localCmdModule' as const,
  direction: 'before' as const,
  regex: /([\w\$]+)\(\1,\{/,
};

/**
 * Captures the wrapper function name used for the export helper call.
 * Searches after the anchor match to find patterns like `AO(tweakccTitleModule,{...})`.
 */
export const EXPORT_CALL_MATCHER = {
  id: 'exportCall',
  anchorId: 'localCmdModule' as const,
  direction: 'after' as const,
  regex: /([\w\$]+)\(tweakccTitleModule,\{/,
};

/**
 * Captures the minified identifier used in performsetColor/call callbacks.
 * Used to reconstruct the registration call with correct parameter names.
 */
export const PERFORM_COLOR_VAR_MATCHER = {
  id: 'performColorVar',
  anchorId: 'localCmdModule' as const,
  direction: 'before' as const,
  regex: /performsetColor:\([^)]*\)=>([\$\w]+)/,
};

/**
 * Captures the call callback identifier (the variable name passed to `call`).
 */
export const CALL_VAR_MATCHER = {
  id: 'callVar',
  anchorId: 'localCmdModule' as const,
  direction: 'before' as const,
  regex: /call:\([^)]*\)=>([\$\w]+)/,
};

// ---------------------------------------------------------------------------
// Injection templates — produce code using extracted variables
// ---------------------------------------------------------------------------

/**
 * Template for registering the tweakcc title module.
 * Uses `vars.exportHelper` instead of hardcoded `'P$'`.
 */
export const TITLE_MODULE_REGISTRATION_TEMPLATE = (
  vars: Record<string, string>,
  safe: string[]
) => {
  const helper = vars.exportHelper || safe[0] || 'AO';
  return `var tweakccTitleModule={};${helper}(tweakccTitleModule,{call:()=>tweakccTitleCall})`;
};

/**
 * Template for the /title command definition.
 * Uses discovered variable names to avoid hardcoded minified identifiers.
 */
export const TITLE_COMMAND_TEMPLATE = (_vars: Record<string, string>) => {
  return `tweakccTitleCommand={type:"local",name:"title",description:"Set the conversation title",argumentHint:"<title>",supportsNonInteractive:!0,userFacingName(){return"title"},load:()=>Promise.resolve(tweakccTitleModule)},`;
};

// ---------------------------------------------------------------------------
// Config object — assembled from anchors, variables, and injections
// ---------------------------------------------------------------------------

/**
 * LexPatcher config for the local command module anchor.
 * Used by writeModernTitleCommand to dynamically extract variable names
 * instead of relying on hardcoded fallbacks like `'P$'`.
 */
export const CONVERSATION_TITLE_CONFIG = {
  anchors: [LOCAL_CMD_ANCHOR],
  variables: [
    EXPORT_HELPER_MATCHER,
    EXPORT_CALL_MATCHER,
    PERFORM_COLOR_VAR_MATCHER,
    CALL_VAR_MATCHER,
  ],
  injections: [
    {
      targetAnchorId: 'localCmdModule',
      position: 'after' as const,
      template: (vars) => TITLE_MODULE_REGISTRATION_TEMPLATE(vars, []),
    },
  ],
};

/**
 * Build a combined anchor pattern that handles both version shapes.
 * Returns the raw regex string for use in writeModernTitleCommand's modulePattern.
 * This matches the local command module registration: var X={};Y(X,{...});
 */
export function buildModulePattern(): RegExp | null {
  // Use non-capturing alternation to match both Shape A and B consistently
  // Group 1: variable name, Group 2: export helper wrapper (AO etc.)
  const altA = 'performsetColor:\\([^)]*\\)=>[\\$\\w]+,call:\\([^)]*\\)=>[\\$\\w]+';
  const altB =
    'call:\\([^)]*\\)=>[\\$\\w]+,(?:performanceolor:[^}]+)?,performsetColor:\\([^)]*\\)=>[\\$\\w]+';

  // Single-escaped backslashes since these strings become regex source via new RegExp()
  const fullPattern = [
    'var ([\\$\\w]+)=\\{\\};([\\$\\w]+)\\(\\1,\\{(?:',
    altA,
    '|',
    altB,
    ')\\}\\);async function [\\w$]+\\(',
  ].join('');

  try {
    return new RegExp(fullPattern);
  } catch (err) {
    console.error('[lexPatcher] conversationTitle: failed to build module pattern', err.message);
    return null;
  }
}
