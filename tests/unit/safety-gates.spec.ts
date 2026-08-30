// Unit coverage for src/agent-fixer/safety-gates.ts — written BEFORE these gates ever run live in
// CI, unlike verify-stability.ts (still zero coverage, flagged as the repo's biggest AI-layer risk).
import { test, expect } from '@playwright/test';
import { isWithinAllowedScope, checkCircuitBreaker, riskTierFor } from '../../src/agent-fixer/safety-gates';

test.describe('isWithinAllowedScope', () => {
  const allowed = ['src/ui/pages/practice-form.page.ts'];

  test('passes when the diff touches only allowed files', () => {
    expect(isWithinAllowedScope(['src/ui/pages/practice-form.page.ts'], allowed)).toBe(true);
  });

  test('fails when the diff touches anything outside the allowed set', () => {
    expect(isWithinAllowedScope(['src/ui/pages/practice-form.page.ts', '.github/workflows/regression.yml'], allowed)).toBe(false);
  });

  test('fails on an empty diff — no evidence of what changed is not evidence it is safe', () => {
    expect(isWithinAllowedScope([], allowed)).toBe(false);
  });
});

test.describe('checkCircuitBreaker', () => {
  test('does not trip on a normal history with no agent-fixer commits at all', () => {
    expect(checkCircuitBreaker(['fix: unrelated human commit'], { maxMergesInWindow: 3 })).toEqual({ tripped: false });
  });

  test('does not trip while under the merge-count limit', () => {
    const result = checkCircuitBreaker(['agent-fixer: replace healwright-recovered locators'], { maxMergesInWindow: 3 });
    expect(result.tripped).toBe(false);
  });

  test('trips once the merge count reaches the limit', () => {
    const subjects = Array(3).fill('agent-fixer: replace healwright-recovered locators');
    const result = checkCircuitBreaker(subjects, { maxMergesInWindow: 3 });
    expect(result.tripped).toBe(true);
    expect(result.reason).toContain('3 agent-fixer auto-merges');
  });

  test('trips immediately on any reverted agent-fixer commit, regardless of count', () => {
    const result = checkCircuitBreaker(['Revert "agent-fixer: replace healwright-recovered locators"'], { maxMergesInWindow: 10 });
    expect(result.tripped).toBe(true);
    expect(result.reason).toContain('reverted');
  });

  test('a revert commit is not itself counted toward the merge-count limit', () => {
    // Regression guard for the exact wording `git revert --no-edit` produces: it must not
    // start with 'agent-fixer:' or it would double-trip (both as a revert AND inflate the count).
    const result = checkCircuitBreaker(['Revert "agent-fixer: replace healwright-recovered locators"'], { maxMergesInWindow: 10 });
    expect(result.reason).toContain('reverted');
    expect(result.reason).not.toContain('10 agent-fixer');
  });
});

test.describe('riskTierFor', () => {
  test('cache-only fixes are eligible for full auto-merge', () => {
    expect(riskTierFor(['cache', 'cache'])).toBe('auto-merge');
  });

  test('any ai-fallback fix forces human review, even mixed with cache fixes', () => {
    expect(riskTierFor(['cache', 'ai-fallback'])).toBe('human-review');
  });

  test('all ai-fallback fixes force human review', () => {
    expect(riskTierFor(['ai-fallback'])).toBe('human-review');
  });
});
