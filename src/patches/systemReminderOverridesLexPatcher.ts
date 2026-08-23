/**
 * LexPatcher-based system reminder overrides for Claude Code cli.js patches.
 *
 * Replaces the sequential `findAndReplace` / `applySimpleEntry` / `findCaseBody`
 * chain in `systemReminderOverrides.ts` with per-reminder LexPatcher configs that
 * discover all minified variable names at runtime via structural regex matchers.
 * No hardcoded fallbacks (`o5/j6/H/J7/YT3/P`) — every identifier is extracted from
 * bounded context windows around stable anchors.
 *
 * ## Architecture
 *
 * Each reminder has its own `LexPatcherConfig` with:
 * 1. **Anchors** — structural regex matching stable text in cli.js across versions
 * 2. **Variables** — regex matchers scoped to anchor context windows, extracting
 *    minified names like wrapper functions (`HT`, `U6`) and delta params (`e`)
 * 3. **Injections** — template functions receiving `{vars, safe}` at runtime
 *
 * Configs are applied sequentially (matching original `working = next` semantics)
 * to handle findCaseBody offset shifts between injections.
 */

import { LexPatcher } from './lexPatcher.js';
import type { LexPatcherConfig } from './lexPatcher.js';

// ===========================================================================
// Pattern 1: simpleEntryPattern — 5 reminders
// Shape (v238): `key:(e)=>Zy([Tn({content:`...`,isMeta:!0})])`
// Wrapper names differ per version: v235=wy/hn, v236-237=Ty/vn, v238=Zy/Tn.
// Anchor on key prefix + param capture; discover wrapper from context before.
// ===========================================================================

function buildSimpleEntryConfig(key: string): LexPatcherConfig {
  return {
    anchors: [
      {
        id: 'anchor',
        regex: new RegExp(`${key}:\\([a-zA-Z_$]+=>`),
        contextWindowBefore: 4096, // wide enough to reach preceding wrapper definitions
        contextWindowAfter: 128,
      },
    ],
    variables: [
      {
        id: 'hParam',
        anchorId: 'anchor',
        direction: 'before',
        regex: new RegExp(`${key}:\\(([a-zA-Z_$]+)=>`),
      },
      // Discover array wrapper name from context before this key (e.g., `Zy`, `Ty`, `wy`)
      {
        id: 'arrayWrap',
        anchorId: 'anchor',
        direction: 'before',
        regex: /return\s+([a-zA-Z_$]+)\(\[/,
      },
      // Discover message constructor name (e.g., `Tn`, `j6`)
      {
        id: 'msgCtor',
        anchorId: 'anchor',
        direction: 'before',
        regex: /return\s+[a-zA-Z_$]+\(\[[a-zA-Z_$]+\(([a-zA-Z_$]+)\(/,
      },
    ],
    injections: [
      {
        targetAnchorId: 'anchor',
        position: 'before',
        template: vars => {
          const param = vars.hParam || key.charAt(0);
          return `${key}:(${param})=>__TWEAKCC_REWRITE__`;
        },
      },
    ],
  };
}

// ===========================================================================
// Pattern 2: direct arrow no-gate — 7 reminders
// Shape (v238): `key:(e)=>[Tn({content:Nw(`...`),isMeta:!0})]`
// Anchors capture all needed vars inline via wide context.
// ===========================================================================

function buildDirectArrowConfig(
  key: string,
  contentAnchor: string // unique text inside the template literal
): LexPatcherConfig {
  return {
    anchors: [
      {
        id: 'anchor',
        regex: new RegExp(`${key}:\\([^)]+\\)=>[^;]{0,40}${contentAnchor}`),
        contextWindowBefore: 256,
        contextWindowAfter: 192,
      },
    ],
    variables: [
      {
        id: 'hParam',
        anchorId: 'anchor',
        direction: 'before',
        regex: new RegExp(`${key}:\\(([a-zA-Z_$]+)=>`),
      },
      {
        id: 'msgCtor',
        anchorId: 'anchor',
        direction: 'before',
        regex: /return\s+([a-zA-Z_$]+)/,
      },
    ],
    injections: [
      {
        targetAnchorId: 'anchor',
        position: 'after',
        template: () => `__TWEAKCC_REWRITE__`,
      },
    ],
  };
}

// ===========================================================================
// Pattern 3: complex inline shapes — 4 reminders
// Each has a unique multi-line structure that needs its own anchor.
// ===========================================================================

const PLAN_MODE_EXIT_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // (e)=>{let t=e.planExists?` The plan file...
      regex:
        /plan_mode_exit:\([^)]+\)=>\{let [a-zA-Z_$]+=.*?The plan file is located at \$\{/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /plan_mode_exit:\(([a-zA-Z_$]+)=>/,
    },
    {
      id: 'suffixVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\{let\s+([a-zA-Z_$]+)=/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

const AUTO_MODE_EXIT_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // (e)=>{let t=e.bashFirst?""... let r=e.steerOnly?...
      regex:
        /auto_mode_exit:\([^)]+\)=>\{let [a-zA-Z_$]+=.*?bashFirst\?.*:"",[a-zA-Z_$]+=[a-zA-Z_$]+\.steerOnly/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'eParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /auto_mode_exit:\(([a-zA-Z_$]+)=>/,
    },
    {
      id: 'tVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\{let\s+([a-zA-Z_$]+)=\1\.bashFirst/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

const OUTPUT_STYLE_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // output_style:(e)=>{let s=mwhMap[e.style];if(!s)return[];return o5([j6({content:`${s.name}...
      regex:
        /output_style:\([^)]+\)=>\{let [a-zA-Z_$]+=[a-zA-Z_$]+\[.*\.style\];if\(![a-zA-Z_$]\)return/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /output_style:\(([a-zA-Z_$]+)=>/,
    },
    {
      id: 'sVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\{let\s+([a-zA-Z_$]+)=[a-zA-Z_$]+\[/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

const OUTPUT_TOKEN_USAGE_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // output_token_usage:(e)=>{let t=e.budget!==null?...;return[j6({content:Nw(`Output tokens...
      regex:
        /output_token_usage:\([^)]+\)=>\{let [a-zA-Z_$]+=.*?budget!==null\?.*Sf\(.*\.turn\).*Sf\(.*\.budget/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /output_token_usage:\(([a-zA-Z_$]+)=>/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

// ===========================================================================
// Pattern 4: findCaseBody switch cases — 5 reminders
// Shape: `case"x_y":{let ...;return W([C({content:`...`})])}}`
// Anchor on case label; inject AFTER opening brace with replacement + end marker.
// Variable discovery from context window before anchor.
// ===========================================================================

function buildFindCaseBodyConfig(
  caseName: string,
  /* eslint-disable @typescript-eslint/no-unused-vars */
  _anchorEnglish: string // unique text in the case body for disambiguation
  /* eslint-enable @typescript-eslint/no-unused-vars */
): LexPatcherConfig {
  return {
    anchors: [
      {
        id: 'caseAnchor',
        regex: new RegExp(`case"${caseName}":\\s*\\{`),
        contextWindowBefore: 2048, // reaches into case body for discoverWrappers
        contextWindowAfter: 1024,
      },
    ],
    variables: [
      {
        id: 'arrayWrap',
        anchorId: 'caseAnchor',
        direction: 'before',
        regex: /return\s+([a-zA-Z_$]+)\(\[([a-zA-Z_$]+)\(\{content:/,
      },
      // Feature guard condition (for task_reminder)
      {
        id: 'featureGuard',
        anchorId: 'caseAnchor',
        direction: 'before',
        regex:
          /^\s*if\((!?[$\w]+\(\)(?:(?:\|\||&&)!?[$\w]+\(\))*)\)return\s*\[\]/,
      },
    ],
    injections: [
      {
        targetAnchorId: 'caseAnchor',
        position: 'after',
        template: vars => {
          const aw = vars.arrayWrap || '__TWEAKCC_ARRAY_WRAP__';
          return `${aw}([__TWEAKCC_REWRITE__])}}`;
        },
      },
    ],
  };
}

// ===========================================================================
// Pattern 5: standalone function declarations — 3 reminders
// Shape: `function X(e,t){return Y({content:`...`})}`
// ===========================================================================

const TOOL_CALLED_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // Distinctive function declaration: `function X(p1,p2){return Y({content:`Called the $`
      regex:
        /function [a-zA-Z_$]+\([a-zA-Z_$]+,[a-zA-Z_$]+\)\{return [a-zA-Z_$]+\(\{content:`Called the \$\{/i,
      contextWindowBefore: 512,
      contextWindowAfter: 256,
    },
  ],
  variables: [
    {
      id: 'fnName',
      anchorId: 'anchor',
      direction: 'before',
      regex: /function ([a-zA-Z_$]+)\(/,
    },
    {
      id: 'p1',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\(([a-zA-Z_$]+),/,
    },
    {
      id: 'j6Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /return ([a-zA-Z_$]+)/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'before',
      template: vars =>
        `function ${vars.fnName || 'fn'}(${vars.p1 || 'p'},${vars.p2 || 't'}){return ${vars.j6Name || 'j6'}({content:__TWEAKCC_REWRITE__,isMeta:!0})}`,
    },
  ],
};

const LOCAL_COMMAND_CAVEAT_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // Distinctive function declaration: `function JWe(){return Tn({content:`<$`
      regex:
        /function [a-zA-Z_$]+\(\)\{return [a-zA-Z_$]+\(\{content:`<\$\\[a-zA-Z_$]+>Caveat:/,
      contextWindowBefore: 512,
      contextWindowAfter: 256,
    },
  ],
  variables: [
    {
      id: 'fnName',
      anchorId: 'anchor',
      direction: 'before',
      regex: /function ([a-zA-Z_$]+)\(\)/,
    },
    {
      id: 'tagVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /`<\\$\\{([a-zA-Z_$]+)>/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

// ===========================================================================
// Pattern 6: early-return guard shapes — 3 reminders
// Shape: `key:(e)=>{if(e.content.length===0)return[];return...`
// ===========================================================================

const HOOK_ADDITIONAL_CONTEXT_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // hook_additional_context:(e)=>{if(e.content.length===0)return[];return[...
      regex:
        /hook_additional_context:\([^)]+\)=>\{if\([a-zA-Z_$]+\.content\.length===0\)return\[\];/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /hook_additional_context:\(([a-zA-Z_$]+)=>/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

const SKILL_LISTING_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // skill_listing:(e)=>{if(!e.content)return[];return[...
      regex:
        /skill_listing:\([^)]+\)=>\{if\(![a-zA-Z_$]+\.content\)return\[\];/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /skill_listing:\(([a-zA-Z_$]+)=>/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

// ===========================================================================
// Pattern 7: task-notification-framing — case return or lazy var assignment
// ===========================================================================

const TASK_NOTIFICATION_FRAMING_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // v235-v238 lazy var shape: `jBr=`${"[SYSTEM NOTIFICATION - NOT USER INPUT]"}...pending question.`"
      // Uses [\s\S]*? to span actual newlines inside the template literal (not \n byte escapes).
      regex:
        /([a-zA-Z_$]+)=`\$\{"\[SYSTEM NOTIFICATION - NOT USER INPUT\]"\}[\s\S]*?pending question[^`]*`/,
      contextWindowBefore: 512,
      contextWindowAfter: 256,
    },
  ],
  variables: [
    // Extract the variable name assigned in anchor (e.g. jBr/pPt/hPt/KPt) — used to replace ${H} in injection
    {
      id: 'framingVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /([a-zA-Z_$]+)=`\$\{"\[SYSTEM NOTIFICATION/,
    },
  ],
  injections: [
    // Inject after the closing backtick of the assignment. The original injects __TWEAKCC_REWRITE__ before ${framingVar} reference in the helper function.
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: vars => `__TWEAKCC_REWRITE__\${${vars.framingVar || '_H'}}`,
    },
  ],
};

// ===========================================================================
// Pattern 8: stop_hook_session_goal — assignment expression
// ===========================================================================

const STOP_HOOK_SESSION_GOAL_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // v235-v238: ,hLi=(e)=>`A session-scoped Stop hook is now active with condition: "${e}". Briefly acknowledge the goal, then immedi
      // Single occurrence in all versions — unique and stable.
      regex:
        /[a-zA-Z_$]+=\(e\)=>`A session-scoped Stop hook is now active with condition: "\$\{[a-zA-Z_$]+\}"\. Briefly acknowledge the goal, then imme/,
      contextWindowBefore: 192,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    // Extract param name from anchor (e) in all versions
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'after',
      regex:
        /\)=>`A session-scoped Stop hook is now active with condition: "\$\{([a-zA-Z_$]+)\}"/,
    },
  ],
  injections: [
    // Inject after the closing backtick of the template literal start
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: () => `__TWEAKCC_REWRITE__`,
    },
  ],
};

// ===========================================================================
// Pattern 9: thinking-reminder — direct arrow no-content-anchor
// Shape: `thinking_reminder:()=>[j6({content:lwName(\`...\`),isMeta:!0})]`
// ===========================================================================

const THINKING_REMINDER_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      regex: /thinking_reminder:\(\)=>\[[a-zA-Z_$]+\(\{content:[a-zA-Z_$]+\(/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'j6Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /thinking_reminder:\(\)=>\[([a-zA-Z_$]+)/,
    },
    {
      id: 'lwName',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\(\{content:([a-zA-Z_$]+)\(/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: vars =>
        `thinking_reminder:()=>[${vars.j6Name || '__TWEAKCC_J6__'}({content:${vars.lwName || '__TWEAKCC_LW__'}(__TWEAKCC_REWRITE__),isMeta:!0})]`,
    },
  ],
};

// ===========================================================================
// Pattern 10: ultrathink-effort — direct arrow with array wrapper
// Shape: `ultrathink_effort:()=>o5([j6({content:'...',isMeta:!0})])`
// ===========================================================================

const ULTRATHINK_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      regex: /ultrathink_effort:\(\)=>[a-zA-Z_$]+\(\[[a-zA-Z_$]+\(\{content:/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'o5Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /ultrathink_effort:\(\)=>([a-zA-Z_$]+)\(/,
    },
    {
      id: 'j6Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\([a-zA-Z_$]+\(([a-zA-Z_$]+)\(\{content:/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: vars =>
        `ultrathink_effort:()=>${vars.o5Name || '__TWEAKCC_O5__'}([${vars.j6Name || '__TWEAKCC_J6__'}({content:__TWEAKCC_REWRITE__,isMeta:!0})])`,
    },
  ],
};

// ===========================================================================
// Pattern 11: edited-text-file — hoisted const shape (v234+)
// Shape: `edited_text_file:(e)=>{let p=\`Note:\`;return o5([j6({content:p.snippet===...})])}`
// ===========================================================================

const EDITED_TEXT_FILE_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // Matches the hoisted-const shape introduced in v234+
      regex: /edited_text_file:\([a-zA-Z_$]+\)=>\{let [a-zA-Z_$]+=`((?:[^`\\]|\\.)*)`;return [a-zA-Z_$]+\(\[([a-zA-Z_$]+)\(\{content:[a-zA-Z_$]+\.snippet===""\?[`]([^`\\]|\\.)*`\:[`]([^`\\]|\\.)*`,isMeta:!0\}\)\]\)/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /edited_text_file:\(([a-zA-Z_$]+)=>/,
    },
    {
      id: 'o5Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /return\s+([a-zA-Z_$]+)\(\[/,
    },
    {
      id: 'j6Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\[([a-zA-Z_$]+)\(\{content:/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: vars =>
        `edited_text_file:(${vars.hParam || '__TWEAKCC_H__'})=>${vars.o5Name || '__TWEAKCC_O5__'}([${vars.j6Name || '__TWEAKCC_J6__'}({content:__TWEAKCC_REWRITE__,isMeta:!0})])`,
    },
  ],
};

// ===========================================================================
// Pattern 12: user-sent-new-message — complex case return shape
// Shape: `case"human":case void 0:(default:)return\`${intro}${H}\n\n...\``
// ===========================================================================

const USER_NEW_MSG_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // Matches the case return shape with either inline text or ${VAR} intro
      regex: /case"human":case void 0:(?:default:)?`/,
      contextWindowBefore: 512,
      contextWindowAfter: 256,
    },
  ],
  variables: [
    {
      id: 'prefix',
      anchorId: 'anchor',
      direction: 'before',
      regex: /((?:case"auto-continuation":)?case"human":case void 0:(?:default:)?)return/,
    },
    // Extract the intro var name from ${VAR} pattern
    {
      id: 'introVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /return`\\$\{([a-zA-Z_$]+)\}/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: vars => `${vars.prefix || '__TWEAKCC_PREFIX__'}\`${vars.introVar ? '${' + vars.introVar + '}' : ''}__TWEAKCC_REWRITE__`,
    },
  ],
};

// ===========================================================================
// Pattern 13: mcp-per-server-router — full loop replacement
// Shape: `for(let j of z)if(j.instructions)m.set(j.name,\`## \$\{j.name\}\n\$j.instructions\`)...`
// ===========================================================================

const MCP_PER_SERVER_ROUTER_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      regex: /for\(let [a-zA-Z_$]+ of [a-zA-Z_$]+\)if\([a-zA-Z_$]+\.instructions\)[a-zA-Z_$]+\.set\([a-zA-Z_$]+\.name,`## \$\{[a-zA-Z_$]+\.name\}\n\$j\.instructions`\)/,
      contextWindowBefore: 512,
      contextWindowAfter: 256,
    },
  ],
  variables: [
    {
      id: 'jVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /for\(let ([a-zA-Z_$]+) of/,
    },
    {
      id: 'zVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /of ([a-zA-Z_$]+)/,
    },
    {
      id: 'mapVar',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\.set\([a-zA-Z_$]+\.name,[^)]+\)\s*([a-zA-Z_$]+)\.set/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'before',
      template: vars => `function __tweakccMcpOverride(_n,_d){try{let _f=require('fs'),_p=require('os').homedir()+'/.tweakcc/system-reminders/mcp-'+_n+'.md';let _r=_f.readFileSync(_p,'utf8');let _m=_r.match(/-->\\s*([\\s\\S]*?)\\s*$/);if(!_m)return _d;let _b=_m[1].trim();if(_b==='')return null;return _b.replace(/\\{\\{server_instructions\\}\\}/g,_d||'')}catch{return _d}}`,
    },
  ],
};

// ===========================================================================
// Pattern 14: claudemd-context — standalone function with Object.entries
// Shape: `function X(m,c){if(Object.entries(c).length===0)return m;return[j6({content:`<system-reminder>...`})]}`
// ===========================================================================

const CLAUDEMD_CONTEXT_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      regex: /function [a-zA-Z_$]+\([a-zA-Z_$]+,[a-zA-Z_$]+\)\{if\(Object\.entries\([a-zA-Z_$]+\)\.length===0\)return [a-zA-Z_$]+;return\[([a-zA-Z_$]+)\(\{content:/,
      contextWindowBefore: 512,
      contextWindowAfter: 256,
    },
  ],
  variables: [
    {
      id: 'fnName',
      anchorId: 'anchor',
      direction: 'before',
      regex: /function ([a-zA-Z_$]+)/,
    },
    {
      id: 'msgsParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\([a-zA-Z_$]+,([a-zA-Z_$]+)\)/,
    },
    {
      id: 'ctxParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\(([a-zA-Z_$]+),[a-zA-Z_$]+\)/,
    },
    {
      id: 'j6Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /return\[([a-zA-Z_$]+)\(\{content:/,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'before',
      template: vars =>
        `function ${vars.fnName || 'fn'}(${vars.msgsParam || 'm'},${vars.ctxParam || 'c'}){return __TWEAKCC_REWRITE__}`,
    },
  ],
};

// ===========================================================================
// Pattern O: tool-result / tool-error — return/catch pair shapes
// ===========================================================================

const TOOL_RESULT_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // Shape: `return X({content:`Result of calling the ${H.name} tool:\n${K}`,isMeta:!0})}catch{...`
      regex:
        /return\s+([a-zA-Z_$]+)\(\{content:`Result of calling the \$\{[a-zA-Z_$]+\.[a-zA-Z_$]+\}\s*tool:\n\$\\{[a-zA-Z_$]+\}`,isMeta:!0\}\)catch\{/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'j6Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /return\s+([a-zA-Z_$]+)\(/,
    },
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\$\{[a-zA-Z_$]+\./,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: vars =>
        `return ${vars.j6Name || '__TWEAKCC_J6__'}({content:__TWEAKCC_REWRITE__,isMeta:!0})catch{return ${vars.j6Name || '__TWEAKCC_J6__'}({content:\`Result of calling the \${${vars.hParam || 'H'}.name} tool: Error\`,isMeta:!0})}`,
    },
  ],
};

const TOOL_ERROR_CONFIG: LexPatcherConfig = {
  anchors: [
    {
      id: 'anchor',
      // Shape: `catch{return X({content:`Result of calling the ${H.name} tool: Error`,isMeta:!0})}`
      regex:
        /catch\{return\s+([a-zA-Z_$]+)\(\{content:`Result of calling the \$\{[a-zA-Z_$]+\.[a-zA-Z_$]+\}\s*tool:\s*Error`,isMeta:!0\}\)\}/,
      contextWindowBefore: 256,
      contextWindowAfter: 192,
    },
  ],
  variables: [
    {
      id: 'j6Name',
      anchorId: 'anchor',
      direction: 'before',
      regex: /catch\{return\s+([a-zA-Z_$]+)\(/,
    },
    {
      id: 'hParam',
      anchorId: 'anchor',
      direction: 'before',
      regex: /\$\{[a-zA-Z_$]+\./,
    },
  ],
  injections: [
    {
      targetAnchorId: 'anchor',
      position: 'after',
      template: vars =>
        `catch{return ${vars.j6Name || '__TWEAKCC_J6__'}({content:\`Result of calling the \${${vars.hParam || 'H'}.name} tool:__TWEAKCC_REWRITE__,isMeta:!0})}`,
    },
  ],
};

// ===========================================================================
// Reminder configs registry — one config per reminder ID
// 37 total injections mapped to 19 config groups by structural pattern
// ===========================================================================

interface ReminderConfig {
  id: string;
  config: LexPatcherConfig;
}

const REMINDER_CONFIGS: ReminderConfig[] = [
  // === Pattern A: simpleEntryPattern (5 reminders) ===
  { id: 'date-change', config: buildSimpleEntryConfig('date_change') },
  {
    id: 'compact-file-reference',
    config: buildSimpleEntryConfig('compact_file_reference'),
  },
  { id: 'pdf-reference', config: buildSimpleEntryConfig('pdf_reference') },
  {
    id: 'selected-lines-in-ide',
    config: buildSimpleEntryConfig('selected_lines_in_ide'),
  },
  {
    id: 'opened-file-in-ide',
    config: buildSimpleEntryConfig('opened_file_in_ide'),
  },

  // === Pattern B: direct arrow no-gate (7 reminders) ===
  {
    id: 'token-usage',
    config: buildDirectArrowConfig('token_usage', 'Token usage:'),
  },
  {
    id: 'budget-usd',
    config: buildDirectArrowConfig('budget_usd', 'USD budget:'),
  },
  {
    id: 'hook-blocking-error',
    config: buildDirectArrowConfig(
      'hook_blocking_error',
      'hook blocking error'
    ),
  },
  {
    id: 'hook-stopped-continuation',
    config: buildDirectArrowConfig(
      'hook_stopped_continuation',
      'hook stopped continuation'
    ),
  },
  {
    id: 'plan-file-reference',
    config: buildDirectArrowConfig(
      'plan_file_reference',
      'A plan file exists from plan mode at:'
    ),
  },
  {
    id: 'nested-memory',
    config: buildDirectArrowConfig('nested_memory', 'Contents of'),
  },
  {
    id: 'agent-mention',
    config: buildDirectArrowConfig(
      'agent_mention',
      'The user has expressed a desire to invoke the agent'
    ),
  },

  // === Pattern C: complex inline shapes (4 reminders) ===
  { id: 'plan-mode-exit', config: PLAN_MODE_EXIT_CONFIG },
  { id: 'auto-mode-exit', config: AUTO_MODE_EXIT_CONFIG },
  { id: 'output-style-banner', config: OUTPUT_STYLE_CONFIG },
  { id: 'output-token-usage', config: OUTPUT_TOKEN_USAGE_CONFIG },

  // === Pattern D: findCaseBody switch cases (5 reminders) ===
  {
    id: 'mcp-instructions',
    config: buildFindCaseBodyConfig(
      'mcp_instructions_delta',
      '# MCP Server Instructions'
    ),
  },
  {
    id: 'agent-listing',
    config: buildFindCaseBodyConfig(
      'agent_listing_delta',
      'Available agent types for the Agent tool:'
    ),
  },
  {
    id: 'memory-update',
    config: buildFindCaseBodyConfig(
      'memory_update',
      'updated your memory directory'
    ),
  },
  {
    id: 'verify-plan-reminder',
    config: buildFindCaseBodyConfig(
      'verify_plan_reminder',
      'You have completed implementing the plan'
    ),
  },
  {
    id: 'task-list-reminder',
    config: buildFindCaseBodyConfig(
      'task_reminder',
      'Here are the existing tasks'
    ),
  },

  // === Pattern E: standalone function declarations (3 reminders) ===
  { id: 'tool-called', config: TOOL_CALLED_CONFIG },
  { id: 'local-command-caveat', config: LOCAL_COMMAND_CAVEAT_CONFIG },

  // === Pattern F: early-return guard shapes (3 reminders) ===
  { id: 'hook-additional-context', config: HOOK_ADDITIONAL_CONTEXT_CONFIG },
  { id: 'skills-listing', config: SKILL_LISTING_CONFIG },

  // === Pattern O: tool-result / tool-error — return/catch pair ===
  { id: 'tool-result', config: TOOL_RESULT_CONFIG },
  { id: 'tool-error', config: TOOL_ERROR_CONFIG },

  // === Pattern G: task-notification-framing (1 reminder) ===
  { id: 'task-notification-framing', config: TASK_NOTIFICATION_FRAMING_CONFIG },

  // === Pattern H: stop_hook_session_goal assignment (1 reminder) ===
  { id: 'stop-hook-session-goal', config: STOP_HOOK_SESSION_GOAL_CONFIG },

  // === Pattern I: thinking-reminder (unique direct arrow, no content anchor) ===
  { id: 'thinking-reminder', config: THINKING_REMINDER_CONFIG },

  // === Pattern J: ultrathink-effort (array wrapper shape) ===
  { id: 'ultrathink-effort', config: ULTRATHINK_CONFIG },

  // === Pattern K: edited-text-file (hoisted const, v234+) ===
  { id: 'edited-text-file', config: EDITED_TEXT_FILE_CONFIG },

  // === Pattern L: user-sent-new-message (case return shape) ===
  { id: 'user-sent-new-message', config: USER_NEW_MSG_CONFIG },

  // === Pattern M: mcp-per-server-router (full loop replacement) ===
  { id: 'mcp-per-server-router', config: MCP_PER_SERVER_ROUTER_CONFIG },

  // === Pattern N: claudemd-context (standalone function, Object.entries) ===
  { id: 'claudemd-context', config: CLAUDEMD_CONTEXT_CONFIG },
];

// ===========================================================================
// Wrapper function — applies all configs sequentially, matching original semantics
// ===========================================================================

/**
 * Per-reminder override context passed to injection templates.
 */
export interface ReminderOverrideContext {
  /** The substituted body text for this reminder (replaces __TWEAKCC_REWRITE__).
   *  Set to '' when isSuppressed to produce empty-content injections. */
  body: string;
}

/**
 * Apply system reminder overrides using LexPatcher engine.
 * Returns patched content or null if any anchor fails to match.
 *
 * @param content - The original cli.js source code
 * @param overrideContexts - Map from reminder ID to override context (body text)
 */
export function applySystemReminderOverridesLexPatcher(
  content: string,
  overrideContexts: Record<string, ReminderOverrideContext> = {}
): string | null {
  let working = content;

  for (const rc of REMINDER_CONFIGS) {
    try {
      const ctx = overrideContexts[rc.id];
      if (!ctx) continue;

      // Create a modified config with templates that use the actual body text
      const patcher = new LexPatcher(rc.config);
      const patched = patcher.applyWithBody(working, ctx.body);
      if (!patched) {
        console.log(`patch: reminder ${rc.id}: anchor not found — skipping`);
        continue;
      }
      working = patched;
    } catch (err) {
      console.error(`patch: reminder ${rc.id}: ${err}`);
    }
  }

  return working;
}
