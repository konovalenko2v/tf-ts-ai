// Unit coverage for retry-dispatch.ts's shape validation — same rationale as
// healing-classify.spec.ts: the deterministic half only, no live AI call. Fence unwrapping is
// covered once in json-response.spec.ts.
import { test, expect } from '@playwright/test';
import { isRetryVerdict, RetryVerdict } from '../../src/failure-analysis/retry-dispatch';

test.describe('isRetryVerdict', () => {
  const valid: RetryVerdict = { category: 'INFRA_FLAKE', shouldRetry: true, retryBudget: 2, explanation: 'transient ECONNRESET' };

  test('accepts a well-formed verdict', () => {
    expect(isRetryVerdict(valid)).toBe(true);
  });

  test('accepts every documented category', () => {
    for (const category of ['CONFIG_ERROR', 'INFRA_FLAKE', 'ASSERTION_FAILURE', 'AI_QUOTA_EXHAUSTED'] as const) {
      expect(isRetryVerdict({ ...valid, category })).toBe(true);
    }
  });

  test('rejects an unknown category', () => {
    expect(isRetryVerdict({ ...valid, category: 'UNKNOWN' })).toBe(false);
  });

  test('rejects a retryBudget outside 0|1|2', () => {
    expect(isRetryVerdict({ ...valid, retryBudget: 3 })).toBe(false);
  });

  test('rejects a non-boolean shouldRetry', () => {
    expect(isRetryVerdict({ ...valid, shouldRetry: 'true' })).toBe(false);
  });

  test('rejects a missing explanation field', () => {
    const { explanation, ...rest } = valid;
    expect(isRetryVerdict(rest)).toBe(false);
  });
});
