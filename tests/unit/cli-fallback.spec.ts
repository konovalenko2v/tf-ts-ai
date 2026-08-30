// Unit coverage for the pure logic inside src/ai-agents/cli-fallback.ts — the AI layer's own
// retry/fallback/env-resolution code had NO automated coverage at all before this (see
// CLAUDE.local.md's session notes: the CliTimeoutError path was previously checked only with a
// one-off, unsaved mock script). No CLI is invoked here — these are the pure functions
// (dedupeByModel, resolveGeminiApiKeyFrom, isTimeoutError, parseClaudeJson/parseGeminiJson) that
// cli-fallback.ts exports specifically so this file doesn't need to reset Node's module cache to
// exercise different env-var configurations, or mock child_process to exercise error classification.
import { test, expect } from '@playwright/test';
import {
  dedupeByModel,
  resolveGeminiApiKeyFrom,
  isTimeoutError,
  parseClaudeJson,
  parseGeminiJson,
  GeminiTier,
} from '../../src/ai-agents/cli-fallback';

test.describe('dedupeByModel', () => {
  test('keeps the first occurrence when two tiers share the same model name', () => {
    const tiers: GeminiTier[] = [
      { model: 'gemini-3.5-flash', apiKey: 'key-a' },
      { model: 'gemini-3.5-flash', apiKey: 'key-b' }, // e.g. AI_MODEL_FALLBACK left unset, defaults collide with tier 0
      { model: 'gemini-3.5-flash-lite', apiKey: 'key-c' },
    ];
    const result = dedupeByModel(tiers);
    expect(result).toEqual([
      { model: 'gemini-3.5-flash', apiKey: 'key-a' },
      { model: 'gemini-3.5-flash-lite', apiKey: 'key-c' },
    ]);
  });

  test('preserves order and all tiers when every model name is distinct', () => {
    const tiers: GeminiTier[] = [
      { model: 'a', apiKey: undefined },
      { model: 'b', apiKey: undefined },
      { model: 'c', apiKey: undefined },
    ];
    expect(dedupeByModel(tiers)).toEqual(tiers);
  });
});

test.describe('resolveGeminiApiKeyFrom', () => {
  const tiers: GeminiTier[] = [
    { model: 'tier-0', apiKey: 'key-0' },
    { model: 'tier-1', apiKey: undefined },
    { model: 'tier-2', apiKey: 'key-2' },
  ];

  test('uses the tier\'s own key when configured', () => {
    expect(resolveGeminiApiKeyFrom(tiers, 0, { geminiApiKey: undefined, aiApiKey: undefined })).toBe('key-0');
    expect(resolveGeminiApiKeyFrom(tiers, 2, { geminiApiKey: undefined, aiApiKey: undefined })).toBe('key-2');
  });

  test('falls back to the nearest EARLIER configured tier when this tier has no key of its own', () => {
    // tier-1 has no key — must reuse tier-0's, never look ahead to tier-2's.
    expect(resolveGeminiApiKeyFrom(tiers, 1, { geminiApiKey: undefined, aiApiKey: undefined })).toBe('key-0');
  });

  test('falls back to GEMINI_API_KEY, then AI_API_KEY, when no tier up to and including this index has a key', () => {
    const noTierKeys: GeminiTier[] = [{ model: 'tier-0', apiKey: undefined }];
    expect(resolveGeminiApiKeyFrom(noTierKeys, 0, { geminiApiKey: 'generic-gemini-key', aiApiKey: 'generic-ai-key' })).toBe(
      'generic-gemini-key',
    );
    expect(resolveGeminiApiKeyFrom(noTierKeys, 0, { geminiApiKey: undefined, aiApiKey: 'generic-ai-key' })).toBe('generic-ai-key');
  });

  test('throws loudly rather than resolving to an unkeyed call when nothing resolves at all', () => {
    // This is the specific bug this module's header comment documents fixing: silently running
    // gemini unkeyed instead of failing loud meant a much lower, unkeyed request quota kicked in
    // without anyone noticing which model/tier was actually being throttled.
    const noTierKeys: GeminiTier[] = [{ model: 'tier-0', apiKey: undefined }];
    expect(() => resolveGeminiApiKeyFrom(noTierKeys, 0, { geminiApiKey: undefined, aiApiKey: undefined })).toThrow(
      /refusing to invoke the gemini CLI unkeyed/,
    );
  });
});

test.describe('isTimeoutError', () => {
  test('recognizes killed:true (the signal Node sets when a running child is SIGTERM\'d by its own timeout)', () => {
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

test.describe('parseGeminiJson', () => {
  test('extracts response text and per-model token stats from a well-formed -o json result', () => {
    const stdout = JSON.stringify({
      response: 'Hi!',
      stats: { models: { 'gemini-3.5-flash-lite': { tokens: { input: 10896, candidates: 2, total: 10898 } } } },
    });
    const parsed = parseGeminiJson(stdout);
    expect(parsed?.response).toBe('Hi!');
    expect(parsed?.stats?.models?.['gemini-3.5-flash-lite']?.tokens?.input).toBe(10896);
  });

  test('degrades to undefined (not a throw) on malformed JSON', () => {
    expect(parseGeminiJson('{not valid json')).toBeUndefined();
  });
});
