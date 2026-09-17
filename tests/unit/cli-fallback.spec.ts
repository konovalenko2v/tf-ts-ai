// Unit coverage for the pure logic inside src/ai-agents/cli-fallback.ts — the AI layer's own
// timeout-classification and CLI-output-parsing code had NO automated coverage at all before this
// (see CLAUDE.local.md's session notes: the CliTimeoutError path was previously checked only with
// a one-off, unsaved mock script). No CLI is invoked here — these are the pure functions
// (isTimeoutError, parseClaudeJson) that cli-fallback.ts exports specifically so this file doesn't
// need to mock child_process to exercise error classification.
import { test, expect } from '@playwright/test';
import { isTimeoutError, parseClaudeJson } from '../../src/ai-agents/cli-fallback';

test.describe('isTimeoutError', () => {
  test("recognizes killed:true (the signal Node sets when a running child is SIGTERM'd by its own timeout)", () => {
    expect(isTimeoutError({ killed: true })).toBe(true);
  });

  test('recognizes code:"ETIMEDOUT" (the signal Node sets when the timeout fires before the child fully starts)', () => {
    // Regression test for a real bug found in this session: the original implementation checked
    // ONLY `killed`, so a fast timeout that fires before the child is far enough along to be
    // "killed" was silently mis-recorded as a plain failure instead of a timeout in
    // .observability/ai-usage.jsonl — confirmed live with an artificially tiny timeoutMs.
    expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  test('does not misclassify an ordinary CLI failure (nonzero exit, no timeout signal) as a timeout', () => {
    expect(isTimeoutError(new Error('Command failed: claude -p ... (exit code 1)'))).toBe(false);
  });

  test('does not throw on a non-Error, non-object value', () => {
    expect(isTimeoutError('a plain string')).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});

test.describe('parseClaudeJson', () => {
  test('extracts usage/cost fields from a well-formed --output-format json result', () => {
    const stdout = JSON.stringify({
      total_cost_usd: 0.1563,
      usage: { input_tokens: 2, output_tokens: 9, cache_creation_input_tokens: 39054, cache_read_input_tokens: 0 },
      result: 'hi there',
    });
    expect(parseClaudeJson(stdout)).toEqual({
      total_cost_usd: 0.1563,
      usage: { input_tokens: 2, output_tokens: 9, cache_creation_input_tokens: 39054, cache_read_input_tokens: 0 },
      result: 'hi there',
    });
  });

  test('degrades to undefined (not a throw) on malformed JSON, so usage logging never breaks the actual CLI call', () => {
    expect(parseClaudeJson('not json at all')).toBeUndefined();
    expect(parseClaudeJson('')).toBeUndefined();
  });
});
