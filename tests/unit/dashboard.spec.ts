// Unit coverage for src/failure-analysis/dashboard.ts — buildDashboardData (pure aggregation) and
// renderDashboard (pure HTML string). No file I/O: main()'s readAllRunEvents/writeFileSync are
// intentionally left uncovered here, same split as verify-stability.spec.ts uses for its thin main().
import { test, expect } from '@playwright/test';
import { buildDashboardData, renderDashboard, namespaceTestIds } from '../../src/failure-analysis/dashboard';
import { ObservabilityEvent, TestSummaryEvent } from '../../src/observability/types';
import { QuarantineEntry } from '../../src/failure-analysis/quarantine';

function makeTest(overrides: Partial<TestSummaryEvent>): TestSummaryEvent {
  return {
    type: 'test',
    runId: 'run-a',
    testId: 't1',
    testTitlePath: '> ui > suite > test',
    project: 'ui',
    status: 'passed',
    outcome: 'expected',
    retry: 0,
    durationMs: 100,
    stepCount: 1,
    recoveredStepCount: 0,
    artifacts: [],
    ...overrides,
  };
}

test.describe('buildDashboardData', () => {
  test('counts passed/failed/flaky/skipped by outcome, deduped to the latest attempt per test', () => {
    const events: ObservabilityEvent[] = [
      makeTest({ testId: 't1', outcome: 'expected' }),
      makeTest({ testId: 't2', outcome: 'unexpected', retry: 0, error: { message: 'Error: expect(1).toBe(2)' } }),
      makeTest({ testId: 't2', outcome: 'unexpected', retry: 1, error: { message: 'Error: expect(1).toBe(2)' } }),
      makeTest({ testId: 't3', outcome: 'flaky', retry: 0, error: { message: 'HealError: ' } }),
      makeTest({ testId: 't3', outcome: 'flaky', retry: 1 }),
      makeTest({ testId: 't4', outcome: 'skipped' }),
    ];

    const data = buildDashboardData(events, []);

    expect(data.totalTests).toBe(4);
    expect(data.passed).toBe(1);
    expect(data.failed).toBe(1);
    expect(data.flaky).toBe(1);
    expect(data.skipped).toBe(1);
  });

  test('groups failures by cause via classify.ts, unchanged from failure-analysis/run.ts', () => {
    const events: ObservabilityEvent[] = [
      makeTest({ testId: 't1', outcome: 'unexpected', error: { message: 'Test Run Error! Please check env variable BOOKER_USERNAME' } }),
      makeTest({ testId: 't2', outcome: 'unexpected', error: { message: 'Test Run Error! Please check env variable BOOKER_USERNAME' } }),
    ];

    const data = buildDashboardData(events, []);

    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].category).toBe('config');
    expect(data.groups[0].count).toBe(2);
  });

  test('an all-flaky group is proposed for quarantine; a genuinely-failed one is not', () => {
    const events: ObservabilityEvent[] = [
      makeTest({ testId: 't1', outcome: 'flaky', retry: 0, error: { message: 'HealError: ' } }),
      makeTest({ testId: 't1', outcome: 'flaky', retry: 1 }),
      makeTest({ testId: 't2', outcome: 'unexpected', error: { message: 'Error: expect(1).toBe(2)' } }),
    ];

    const data = buildDashboardData(events, []);

    expect(data.proposedForQuarantineCount).toBe(1);
    expect(data.proposedForQuarantine[0].category).toBe('ai-healing');
  });

  test('reflects the currently-quarantined and expired-TTL counts from the entries it is given', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const quarantine: QuarantineEntry[] = [
      { signature: 'sig-a', testTitlePaths: ['a'], addedAt: '2026-06-01T00:00:00Z', expiresAt: '2026-06-20T00:00:00Z', reason: 'flaky' },
      { signature: 'sig-b', testTitlePaths: ['b'], addedAt: '2026-05-01T00:00:00Z', expiresAt: '2026-05-10T00:00:00Z', reason: 'flaky' },
    ];

    const data = buildDashboardData([], quarantine, now);

    expect(data.quarantinedCount).toBe(2);
    expect(data.quarantinedExpiredCount).toBe(1);
  });

  test('an empty event list produces an empty-state dashboard, not a crash', () => {
    const data = buildDashboardData([], []);

    expect(data.totalTests).toBe(0);
    expect(data.groups).toHaveLength(0);
    expect(data.proposedForQuarantineCount).toBe(0);
  });
});

test.describe('namespaceTestIds', () => {
  test("keeps two shards' identically-hashed testId (same file+title) from colliding when merged", () => {
    const shard1 = makeTest({ runId: 'shard-a', testId: 'same-hash', outcome: 'expected' });
    const shard2 = makeTest({ runId: 'shard-b', testId: 'same-hash', outcome: 'expected' });

    const namespaced = namespaceTestIds([shard1, shard2]) as TestSummaryEvent[];

    expect(new Set(namespaced.map((e) => e.testId)).size).toBe(2);
    // buildDashboardData's dedupe (via classify.ts's latestAttemptPerTest) must see both as
    // distinct tests, not one test overwriting the other.
    const data = buildDashboardData(namespaced, []);
    expect(data.totalTests).toBe(2);
  });

  test('leaves non-test events (no testId field) untouched', () => {
    const runEvent: ObservabilityEvent = { type: 'run', phase: 'end', runId: 'run-a', ci: true };

    const namespaced = namespaceTestIds([runEvent]);

    expect(namespaced[0]).toEqual(runEvent);
  });
});

test.describe('renderDashboard', () => {
  function baseData() {
    return buildDashboardData([], []);
  }

  test('escapes HTML-significant characters in error messages and test titles', () => {
    const data = buildDashboardData(
      [
        makeTest({
          testId: 't1',
          outcome: 'unexpected',
          testTitlePath: '> ui > suite > test with <script>alert("x")</script> & \'quotes\'',
          error: { message: 'Error: expected `<div>` but got "<span>" & \'other\'' },
        }),
      ],
      [],
    );

    const html = renderDashboard(data);

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  test('renders an explicit empty state when there are no failures', () => {
    const html = renderDashboard(baseData());

    expect(html).toContain('No failing tests in this run.');
  });

  test('omits the "Proposed for quarantine" section entirely when nothing was proposed', () => {
    const html = renderDashboard(baseData());

    expect(html).not.toContain('Proposed for quarantine (this run)');
  });

  test('includes the top-line counts and a link back to the Allure report', () => {
    const data = buildDashboardData(
      [
        makeTest({ testId: 't1', outcome: 'expected' }),
        makeTest({ testId: 't2', outcome: 'unexpected', error: { message: 'Error: expect(1).toBe(2)' } }),
      ],
      [],
    );

    const html = renderDashboard(data);

    expect(html).toContain('<div class="num">1</div>');
    expect(html).toContain('href="../"');
    expect(html).toContain('Allure report');
  });
});
