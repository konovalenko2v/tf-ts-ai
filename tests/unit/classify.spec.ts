// Unit coverage for src/failure-analysis/classify.ts's pure grouping/categorization logic — the
// second AI-adjacent module flagged as having zero automated coverage (this module's output
// directly drives retry verdicts and the human-facing failure report, so a silent regression here
// would misclassify real bugs as flaky noise, or vice versa).
import { test, expect } from '@playwright/test';
import { groupFailures, summarizeRecoveries } from '../../src/failure-analysis/classify';
import { TestSummaryEvent, StepEvent } from '../../src/observability/types';
import { HealEvent } from '../../src/failure-analysis/heal-events';

function makeTest(overrides: Partial<TestSummaryEvent>): TestSummaryEvent {
  return {
    type: 'test',
    runId: 'run-1',
    testId: 'test-1',
    testTitlePath: 'suite > test',
    project: 'api',
    status: 'failed',
    outcome: 'unexpected',
    retry: 0,
    durationMs: 100,
    stepCount: 1,
    recoveredStepCount: 0,
    artifacts: [],
    ...overrides,
  };
}

test.describe('groupFailures — categorization', () => {
  test('categorizes a missing env var as "config"', () => {
    const groups = groupFailures([
      makeTest({ error: { message: 'Test Run Error! Please check env variable BOOKER_USERNAME in test run: undefined' } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('config');
  });

  test('categorizes a HealError with RESOURCE_EXHAUSTED as "ai-quota", not "ai-healing"', () => {
    const groups = groupFailures([makeTest({ error: { message: 'HealError: RESOURCE_EXHAUSTED — daily quota exceeded' } })]);
    expect(groups[0].category).toBe('ai-quota');
  });

  test('categorizes a HealError with a 429 status as "ai-quota"', () => {
    const groups = groupFailures([makeTest({ error: { message: 'HealError: request failed with "code":429' } })]);
    expect(groups[0].category).toBe('ai-quota');
  });

  test('categorizes a genuine HealError (no quota signal) as "ai-healing"', () => {
    const groups = groupFailures([makeTest({ error: { message: 'HealError: no matching element found for this context' } })]);
    expect(groups[0].category).toBe('ai-healing');
  });

  test('categorizes a failure whose stack trace passes through healwright as "ai-healing" even without HealError in the message', () => {
    const groups = groupFailures([
      makeTest({ error: { message: 'TypeError: cannot read property of undefined', stackTop: ['at heal.click (healwright/dist/index.js:42:1)'] } }),
    ]);
    expect(groups[0].category).toBe('ai-healing');
  });

  test('categorizes a Playwright expect() failure as "assertion"', () => {
    const groups = groupFailures([makeTest({ error: { message: 'Error: expect(received).toBe(expected)' } })]);
    expect(groups[0].category).toBe('assertion');
  });

  test('falls back to "other" for anything unrecognized', () => {
    const groups = groupFailures([makeTest({ error: { message: 'Error: something completely unexpected happened' } })]);
    expect(groups[0].category).toBe('other');
  });
});

test.describe('groupFailures — signature normalization and grouping', () => {
  test('groups two failures with the same shape but different dynamic values into one signature', () => {
    const groups = groupFailures([
      makeTest({ testId: 'a', testTitlePath: 'suite > test a', error: { message: `Error: expect(42).toBe(99)` } }),
      makeTest({ testId: 'b', testTitlePath: 'suite > test b', error: { message: `Error: expect(7).toBe(3)` } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].testTitlePaths).toEqual(['suite > test a', 'suite > test b']);
  });

  test('keeps genuinely different error messages in separate groups', () => {
    const groups = groupFailures([
      makeTest({ testId: 'a', error: { message: 'Error: expect(1).toBe(2)' } }),
      makeTest({ testId: 'b', error: { message: 'TimeoutError: locator.click timed out' } }),
    ]);
    expect(groups).toHaveLength(2);
  });

  test('sorts groups by count descending', () => {
    const groups = groupFailures([
      makeTest({ testId: 'a', error: { message: 'Error: expect(1).toBe(2)' } }),
      makeTest({ testId: 'b', error: { message: 'Error: expect(3).toBe(4)' } }),
      makeTest({ testId: 'c', error: { message: 'TimeoutError: locator.click timed out' } }),
    ]);
    expect(groups[0].count).toBe(2); // the two assertion failures, grouped
    expect(groups[1].count).toBe(1);
  });
});

test.describe('groupFailures — retry/flaky handling', () => {
  test('dedupes multiple attempts of the same test to its latest attempt only', () => {
    const groups = groupFailures([
      makeTest({ testId: 'a', retry: 0, outcome: 'unexpected', error: { message: 'Error: expect(1).toBe(2)' } }),
      makeTest({ testId: 'a', retry: 1, outcome: 'unexpected', error: { message: 'Error: expect(1).toBe(2)' } }),
    ]);
    // Without dedup this would count as 2 — a single flaky-looking test must not inflate a group.
    expect(groups[0].count).toBe(1);
  });

  test('a test that failed then passed on retry ("flaky") is still reported using its last FAILING attempt error', () => {
    const groups = groupFailures([
      makeTest({ testId: 'a', retry: 0, outcome: 'flaky', error: { message: 'Error: expect(1).toBe(2)' } }),
      // Final passing attempt carries outcome:'flaky' too (Playwright's own quirk) but no error.
      makeTest({ testId: 'a', retry: 1, outcome: 'flaky', error: undefined, status: 'passed' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].allFlaky).toBe(true);
    expect(groups[0].sampleMessage).toContain('expect(1).toBe(2)');
  });

  test('allFlaky is false when at least one test in the group never passed on any retry', () => {
    const groups = groupFailures([
      makeTest({ testId: 'a', retry: 0, outcome: 'flaky', error: { message: 'Error: expect(1).toBe(2)' } }),
      makeTest({ testId: 'a', retry: 1, outcome: 'flaky', error: undefined, status: 'passed' }),
      makeTest({ testId: 'b', retry: 0, outcome: 'unexpected', error: { message: 'Error: expect(3).toBe(4)' } }),
    ]);
    expect(groups).toHaveLength(1); // same normalized signature
    expect(groups[0].count).toBe(2);
    expect(groups[0].allFlaky).toBe(false); // test 'b' never passed
  });

  test('ignores tests with no error (passed outcomes) entirely', () => {
    const groups = groupFailures([makeTest({ outcome: 'expected', status: 'passed', error: undefined })]);
    expect(groups).toHaveLength(0);
  });
});

test.describe('summarizeRecoveries', () => {
  function makeStep(overrides: Partial<StepEvent>): StepEvent {
    return {
      type: 'step',
      runId: 'run-1',
      testId: 'test-1',
      testTitlePath: 'suite > test',
      project: 'ui',
      retry: 0,
      stepTitle: 'click button',
      stepIndex: 0,
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 1000,
      outcome: 'passed_with_recovery',
      ...overrides,
    };
  }

  test('joins a passed_with_recovery step to a heal event whose timestamp falls in its time window', () => {
    const steps = [makeStep({ recoveredErrors: [{ action: 'click', selector: '#old-id', durationMs: 500, message: 'not found' }] })];
    const healEvents: HealEvent[] = [
      {
        ts: '2026-01-01T00:00:00.500Z', // inside [00:00:00.000, 00:00:01.000]
        url: 'https://example.com',
        contextName: 'Click Me button',
        used: 'healed',
        success: true,
        confidence: 0.9,
        why: 'role-based match',
        strategy: { type: 'role', role: 'button', name: 'Click Me' },
      },
    ];
    const result = summarizeRecoveries(steps, healEvents);
    expect(result).toHaveLength(1);
    expect(result[0].recoveredSelectors).toEqual(['#old-id']);
    expect(result[0].healedLocators).toHaveLength(1);
    expect(result[0].healedLocators[0].newLocator).toBe("getByRole('button', { name: 'Click Me' })");
    expect(result[0].healedLocators[0].confidence).toBe(0.9);
  });

  test('excludes a heal event whose timestamp falls outside the step\'s time window', () => {
    const steps = [makeStep({})];
    const healEvents: HealEvent[] = [
      {
        ts: '2026-01-01T00:05:00.000Z', // well outside [00:00:00.000, 00:00:01.000]
        url: 'https://example.com',
        contextName: 'unrelated',
        used: 'healed',
        success: true,
        strategy: { type: 'testid', value: 'submit-btn' },
      },
    ];
    expect(summarizeRecoveries(steps, healEvents)[0].healedLocators).toHaveLength(0);
  });

  test('only considers steps with outcome "passed_with_recovery" — plain passed/failed steps are excluded', () => {
    const steps = [makeStep({ outcome: 'passed' }), makeStep({ outcome: 'failed' })];
    expect(summarizeRecoveries(steps, [])).toHaveLength(0);
  });

  test('defaults to no heal events and still returns the recovered-selector info from the step itself', () => {
    const steps = [makeStep({ recoveredErrors: [{ action: 'click', selector: '#x', durationMs: 100, message: 'gone' }] })];
    const result = summarizeRecoveries(steps);
    expect(result[0].recoveredSelectors).toEqual(['#x']);
    expect(result[0].healedLocators).toEqual([]);
  });
});
