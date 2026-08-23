import { describe, it, expect } from 'vitest';
import { writeConversationTitle } from './conversationTitle';

// Also need to clear the global caches in index.ts helpers
import { clearCaches } from './helpers';

const MODULE_BLOCK =
  'var $m0={};AO($m0,{performsetColor:()=>qSet,call:()=>qCall});' +
  'async function qCall(rv,ctx,args){return rv(await qFmt(args,ctx),{display:"system"}),null}';
const AFTER_MODULE = 'var $nextThing=1;';
const COMMAND_LIST =
  'xK=L8(()=>[{type:"local",name:"clear",description:"Clear conversation history"},lastCmd])';
const MODERN_FIXTURE = 'prefix;' + MODULE_BLOCK + AFTER_MODULE + COMMAND_LIST;

describe('debug writeConversationTitle', () => {
  it('should not return null on modern fixture', () => {
    clearCaches();
    const result = writeConversationTitle(MODERN_FIXTURE);
    console.log('Result:', result ? `not null (${result.length} chars)` : 'null');
    if (result) {
      expect(result).toContain('tweakccTitleModule');
      // Check that AO (the real export helper name from the fixture) is used
      expect(result).toContain('AO(tweakccTitleModule');
      console.log('PASS: AO correctly used for injection');
    } else {
      const mp = new RegExp('var ([\\\\w$]+)=\\\\{\\\\};([\\\\w$]+)\\\\(\\\\1,\\\\{performsetColor:\\\\(\\\\)=>[\\\\w$]+,call:\\\\(\\\\)=>[\\\\w$]+\\\\}\\\\);async function [\\\\w$]+\\\\(');
      const mm = MODERN_FIXTURE.match(mp);
      console.log('modulePattern match:', mm ? 'yes' : 'no');
      if (mm) {
        console.log('match[0] length:', mm[0].length, 'index:', mm.index);
        console.log('Group 2 (export helper):', mm[2]);
        const me = MODERN_FIXTURE.indexOf('var ', mm.index + mm[0].length);
        console.log('moduleEnd at:', me);
      } else {
        // Show what's at the expected position
        const m1 = /var ([\w$]+)=\{\};/.exec(MODERN_FIXTURE);
        console.log('First var match:', m1?.[0], 'at', m1?.index);
        if (m1) {
          const after = MODERN_FIXTURE.slice(m1.index + m1[0].length, m1.index + m1[0].length + 80);
          console.log('After var block:', JSON.stringify(after));
        }
      }
    }
    expect(result).not.toBeNull();
  });
});
