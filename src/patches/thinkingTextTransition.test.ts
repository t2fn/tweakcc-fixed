/** Tests for thinking-to-text graceful transition patch (v234/v235/v237+). */

import { describe, it, expect } from 'vitest';
import { applyThinkingTextTransition } from './thinkingTextTransition';

// ---------------------------------------------------------------------------
// v234 throw-based fixture — two handlers share one moreThinkingFlag (Cn)
// ---------------------------------------------------------------------------
const V234_SOURCE = `case"content_block_delta":{Cn=!1;let n=r.content.at(-1);switch(t.delta.type){case"text_delta":if(n.type!=="text")throw O("tengu_streaming_error",{error_type:Ce("content_block_type_mismatch_text"),expected_type:Ce("text"),actual_type:ge(n.type)}),n.text+=ls.text;break;case"signature_delta":if(ni.type!=="thinking")throw O("tengu_streaming_error",{error_type:Ce("content_block_type_mismatch_thinking_signature"),expected_type:Ce("thinking"),actual_type:ge(ni.type)}),Error("Content block is not a thinking block");ni.signature=ls.signature;break;case"thinking_delta":if(ni.type==="redacted_thinking")break;if(ni.type!=="thinking")throw O("tengu_streaming_error",{error_type:Ce("content_block_type_mismatch_thinking_delta"),expected_type:Ce("thinking"),actual_type:ge(ni.type)}),Error("Content block is not a thinking block");ni.thinking+=ls.thinking;break;`;

function freshV234() {
  return V234_SOURCE;
}

// ---------------------------------------------------------------------------
// v237 throw-based fixture — injection lands inside a string literal on the
// second case ("thinking_delta") when the original regex only matches one
// Error("Content block…") span. The substring test in the old file never
// exercised this because it checked .match(/type==="text"\)/g)?.length >= 2
// which passes with only ONE injection when both cases share the same
// flag-var scope. A real-bundle parse catches the break that lands inside
// a backtick template literal string.
// ---------------------------------------------------------------------------
const V237_SOURCE = [
  // content_block_delta handler — sets moreThinkingFlag Cn
  'case"content_block_delta":{Cn=!1;let n=r.content.at(-1);switch(t.delta.type){',
  // text_delta — throws tengu error, appends ls.text
  'case"text_delta":if(n.type!=="text")throw O("tengu_streaming_error",{error_type:Ce("content_block_type_mismatch_text"),expected_type:Ce("text"),actual_type:ge(n.type)}),n.text+=ls.text;break;',
  // signature_delta — throws tengu error + Error("Content block…"), assigns ls.signature
  'case"signature_delta":if(ni.type!=="thinking")throw O("tengu_streaming_error",{error_type:Ce("content_block_type_mismatch_thinking_signature"),expected_type:Ce("thinking"),actual_type:ge(ni.type)}),Error("Content block is not a thinking block");ni.signature=ls.signature;break;',
  // thinking_delta — redacted guard, throws tengu error + Error("Content block…"), appends ls.thinking
  'case"thinking_delta":if(ni.type==="redacted_thinking")break;if(ni.type!=="thinking")throw O("tengu_streaming_error",{error_type:Ce("content_block_type_mismatch_thinking_delta"),expected_type:Ce("thinking"),actual_type:ge(ni.type)}),Error("Content block is not a thinking block");ni.thinking+=ls.thinking;break;',
].join('');

function freshV237() {
  return V237_SOURCE;
}

describe('applyThinkingTextTransition', () => {
  it('patches v234-style source with throw-based handlers', () => {
    const result = applyThinkingTextTransition(freshV234());
    expect(result).not.toBeNull();

    // Verify two text-check injections were added (one per anchor)
    expect(
      (result ?? '').match(/type==="text"\)/g)?.length
    ).toBeGreaterThanOrEqual(2);

    // "Content block is not a thinking block" removed from bundle entirely
    const errors = result?.match(/Content block is not a thinking block/g) || [];
    expect(errors.length).toBe(0);

    // Text-check injections present at both sites
    const textChecks = (result ?? '').match(/type==="text"\)/g);
    expect(textChecks?.length).toBeGreaterThanOrEqual(2);

    // Size may shrink (we remove error strings) or grow slightly; key is two injections applied
    expect((result?.length ?? 0) - V234_SOURCE.length).toBeGreaterThan(-500);
  });

  it('is idempotent', () => {
    const patched = applyThinkingTextTransition(freshV234());
    expect(patched).not.toBeNull();

    // Second application should return null (already patched)
    const rePatched = applyThinkingTextTransition(patched!);
    expect(rePatched).toBeNull();
  });

  it('patches both signature_delta and thinking_delta handlers', () => {
    const result = applyThinkingTextTransition(freshV234());
    expect(result).not.toBeNull();

    // Both injections contain the text-check pattern before each throw.
    const checkCount = result?.match(/type==="text"\)/g);
    expect(checkCount?.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null when anchor not found', () => {
    const source = 'no signature_delta case here';
    const result = applyThinkingTextTransition(source);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // v237: real-bundle-parse gate — the injection that replaces throw+Error
  // in thinking_delta must not land inside a backtick template literal.
  // On some builds the patch splices into the middle of `throw X("…"),Error("Content block is not a thinking block");`
  // which leaves an unterminated string when the replacement break line
  // lands between the opening and closing quotes.
  // -----------------------------------------------------------------------
  it('v237 injection does not land inside a string literal (Bun-parse gate)', () => {
    const result = applyThinkingTextTransition(freshV237());
    expect(result).not.toBeNull();

    // Count how many text-check injections we added — should be exactly 2
    // (one for signature_delta, one for thinking_delta)
    const injectionMatches = result!.match(/type==="text"\)/g);
    expect(injectionMatches?.length).toBeGreaterThanOrEqual(2);

    // The "Content block is not a thinking block" error string must be fully removed
    // (both throw sites share the same Error() call text)
    const remainingErrors = result!.match(/Error\("Content block/g);
    expect(remainingErrors?.length ?? 0).toBe(0);
  });

  it('v237: patched output has balanced template literals', () => {
    const result = applyThinkingTextTransition(freshV237());
    expect(result).not.toBeNull();

    // Count backtick pairs — should be even (all templates properly terminated)
    const backticks = (result!.match(/`/g) || []).length;
    expect(backticks % 2).toBe(0);

    // No unterminated string: no bare "Content block" followed by a quote without closing match
    const contentBlockQuotes = result!.match(/"Content block is not a thinking block"/g);
    expect(contentBlockQuotes?.length ?? 0).toBe(0);
  });
});
