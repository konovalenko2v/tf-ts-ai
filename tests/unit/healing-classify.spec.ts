// Unit coverage for healing-classify.ts's shape validation — the deterministic half of the module
// (no live AI call, which costs real quota and isn't run here). A wrong-shape model reply must be
// rejected rather than silently treated as a valid verdict.
// The ```json-fence unwrapping this module relies on lives in ai-agents/json-response.ts and is
// covered by json-response.spec.ts — not re-tested here.
import { test, expect } from '@playwright/test';
import { isHealingClassification, HealingClassification } from '../../src/failure-analysis/healing-classify';

test.describe('isHealingClassification', () => {
  const valid: HealingClassification = { verdict: 'DYNAMIC_ID', reason: 'id contains a session hash', action: 'PROPOSE_FIX' };

  test('accepts a well-formed classification', () => {
    expect(isHealingClassification(valid)).toBe(true);
  });

  test('rejects an unknown verdict value', () => {
    expect(isHealingClassification({ ...valid, verdict: 'FLAKY' })).toBe(false);
  });

  test('rejects an unknown action value', () => {
    expect(isHealingClassification({ ...valid, action: 'RETRY' })).toBe(false);
  });

  test('rejects a missing reason field', () => {
    const { reason, ...rest } = valid;
    expect(isHealingClassification(rest)).toBe(false);
  });

  test('rejects a non-object value', () => {
    expect(isHealingClassification('STRUCTURAL')).toBe(false);
    expect(isHealingClassification(null)).toBe(false);
  });
});
