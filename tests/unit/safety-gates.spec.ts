// Unit coverage for src/agent-fixer/safety-gates.ts — written BEFORE these gates ever run live in
// CI, unlike verify-stability.ts (still zero coverage, flagged as the repo's biggest AI-layer risk).
import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import {
  isWithinAllowedScope,
  checkCircuitBreaker,
  riskTierFor,
  branchFor,
  CACHE_TIER_BRANCH_PREFIX,
  AI_TIER_BRANCH_PREFIX,
} from '../../src/agent-fixer/safety-gates';

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

test.describe('branchFor', () => {
  test('auto-merge tier gets the cache-tier prefix', () => {
    expect(branchFor('auto-merge', '12345')).toBe(`${CACHE_TIER_BRANCH_PREFIX}12345`);
  });

  test('human-review tier gets the ai-tier prefix', () => {
    expect(branchFor('human-review', '12345')).toBe(`${AI_TIER_BRANCH_PREFIX}12345`);
  });
});

// End-to-end guard for the split described in safety-gates.ts's branchFor() comment: run.ts's
// branchFor() output and regression.yml's own startsWith(...) trigger are two independently
// edited files agreeing on one literal by convention only. This test reads the actual workflow
// file and fails if CACHE_TIER_BRANCH_PREFIX and that file's match string ever diverge — the
// specific failure mode this closes is "someone renames the branch prefix in one file, auto-merge
// either silently stops firing (safe but broken) or, worse, an unrelated future refactor makes an
// ai-fallback-sourced branch match the merge job's trigger (unsafe)."
test.describe('branch-prefix agreement with regression.yml', () => {
  const workflowPath = path.join(__dirname, '../../.github/workflows/regression.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf-8');

  // matchAll + exact-count assertion rather than taking the first match: a future job adding its
  // own unrelated startsWith(github.head_ref, ...) check must fail this test loudly instead of
  // having this test silently start validating the wrong occurrence while still passing.
  function findHeadRefMatch(): string {
    const matches = [...workflow.matchAll(/startsWith\(github\.head_ref,\s*'([^']+)'\)/g)];
    expect(matches.length, 'expected exactly one startsWith(github.head_ref, \'...\') trigger in regression.yml').toBe(1);
    return matches[0][1];
  }

  test('agent-fixer-verify-and-merge triggers on exactly CACHE_TIER_BRANCH_PREFIX', () => {
    expect(findHeadRefMatch()).toBe(CACHE_TIER_BRANCH_PREFIX);
  });

  test('a branchFor() auto-merge-tier branch name actually matches the workflow trigger', () => {
    const workflowPrefix = findHeadRefMatch();
    const producedBranch = branchFor('auto-merge', String(Date.now()));
    expect(producedBranch.startsWith(workflowPrefix)).toBe(true);
  });

  test('a branchFor() human-review-tier branch name never matches the workflow trigger', () => {
    const workflowPrefix = findHeadRefMatch();
    const producedBranch = branchFor('human-review', String(Date.now()));
    expect(producedBranch.startsWith(workflowPrefix)).toBe(false);
  });
});
