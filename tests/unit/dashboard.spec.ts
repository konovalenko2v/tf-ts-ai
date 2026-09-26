// Unit coverage for src/failure-analysis/dashboard.ts — buildDashboardData (pure aggregation) and
// renderDashboard (pure HTML string). No file I/O in the tests themselves: main()'s
// readAllRunEvents/writeFileSync are intentionally left uncovered, same split as
// verify-stability.spec.ts uses for its thin main(). renderDashboard's own readAllureSuites() read
// is exercised as-is — this test file's CWD has no allure-report/data/suites.json, so it exercises
// exactly the "no Allure report generated yet" path; findAllureUids (the pure matcher) is tested
// directly below with an in-memory tree instead.
import { test, expect } from '@playwright/test';
import { buildDashboardData, renderDashboard, namespaceTestIds, findAllureUids } from '../../src/failure-analysis/dashboard';
import { ObservabilityEvent, TestSummaryEvent } from '../../src/observability/types';
import { QuarantineCandidate, QuarantineEntry } from '../../src/failure-analysis/quarantine';

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

  test("proposed-for-quarantine comes from the persistent candidates list, not this run's own flaky groups", () => {
    // A test can be flaky in THIS run's events without being a candidate (one-off blip), and a
    // candidate from cross-run history can be absent from this run's events entirely (not
    // re-run, or genuinely stable this time) — the two are independent inputs on purpose.
    const events: ObservabilityEvent[] = [makeTest({ testId: 't1', outcome: 'expected' })];
    const candidates: QuarantineCandidate[] = [
      {
        signature: 'HealError: …',
        category: 'ai-healing',
        testTitlePaths: ['> ui > suite > flaky test'],
        occurrences: 4,
        windowSize: 10,
        sampleRunFiles: ['run-1.jsonl'],
      },
    ];

    const data = buildDashboardData(events, [], new Date(), null, null, null, candidates);

    expect(data.proposedForQuarantineCount).toBe(1);
    expect(data.proposedForQuarantine[0].category).toBe('ai-healing');
    expect(data.proposedForQuarantine[0].testTitlePaths).toEqual(['> ui > suite > flaky test']);
    expect(data.proposedForQuarantine[0].occurrences).toBe(4);
    expect(data.proposedForQuarantine[0].windowSize).toBe(10);
  });

  test('a candidate already promoted into quarantine.json is excluded from proposed-for-quarantine', () => {
    const candidates: QuarantineCandidate[] = [
      {
        signature: 'HealError: …',
        category: 'ai-healing',
        testTitlePaths: ['> ui > suite > already quarantined'],
        occurrences: 6,
        windowSize: 10,
        sampleRunFiles: ['run-1.jsonl'],
      },
    ];
    const quarantine: QuarantineEntry[] = [
      {
        signature: 'HealError: …',
        testTitlePaths: ['> ui > suite > already quarantined'],
        addedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-12-31T00:00:00Z',
        reason: 'flaky',
      },
    ];

    const data = buildDashboardData([], quarantine, new Date(), null, null, null, candidates);

    expect(data.proposedForQuarantineCount).toBe(0);
    expect(data.quarantinedCount).toBe(1);
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

  test('byProject counts passed/failed/flaky per Playwright project, ordered unit/contract/api/graphql/ui', () => {
    const events: ObservabilityEvent[] = [
      makeTest({ testId: 'u1', project: 'unit', outcome: 'expected' }),
      makeTest({ testId: 'a1', project: 'api', outcome: 'unexpected', error: { message: 'Error: expect(1).toBe(2)' } }),
      makeTest({ testId: 'g1', project: 'graphql', outcome: 'expected' }),
      makeTest({ testId: 'w1', project: 'ui', outcome: 'flaky', retry: 0, error: { message: 'Error: x' } }),
      makeTest({ testId: 'w1', project: 'ui', outcome: 'flaky', retry: 1 }),
    ];

    const data = buildDashboardData(events, []);

    expect(data.byProject).toEqual([
      { project: 'unit', passed: 1, failed: 0, flaky: 0, quarantined: 0 },
      { project: 'api', passed: 0, failed: 1, flaky: 0, quarantined: 0 },
      { project: 'graphql', passed: 1, failed: 0, flaky: 0, quarantined: 0 },
      { project: 'ui', passed: 0, failed: 0, flaky: 1, quarantined: 0 },
    ]);
  });

  test('byProject marks a test as quarantined without changing its passed/failed/flaky bucket', () => {
    const events: ObservabilityEvent[] = [
      makeTest({ testId: 't1', project: 'ui', testTitlePath: '> ui > flaky one', outcome: 'unexpected', error: { message: 'x' } }),
    ];
    const quarantine: QuarantineEntry[] = [
      {
        signature: 'x',
        testTitlePaths: ['> ui > flaky one'],
        addedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
        reason: 'flaky',
      },
    ];

    const data = buildDashboardData(events, quarantine);

    expect(data.byProject).toEqual([{ project: 'ui', passed: 0, failed: 1, flaky: 0, quarantined: 1 }]);
  });

  test('byProject omits a project with no events this run instead of showing an all-zero card', () => {
    const events: ObservabilityEvent[] = [makeTest({ testId: 't1', project: 'api', outcome: 'expected' })];

    const data = buildDashboardData(events, []);

    expect(data.byProject).toEqual([{ project: 'api', passed: 1, failed: 0, flaky: 0, quarantined: 0 }]);
  });

  test('an empty event list produces an empty-state dashboard, not a crash', () => {
    const data = buildDashboardData([], []);

    expect(data.totalTests).toBe(0);
    expect(data.groups).toHaveLength(0);
    expect(data.proposedForQuarantineCount).toBe(0);
  });

  test('coveragePct/mutationScoreBaselinePct/mutationScoreCurrentPct default to null when not passed', () => {
    const data = buildDashboardData([], []);

    expect(data.coveragePct).toBeNull();
    expect(data.mutationScoreBaselinePct).toBeNull();
    expect(data.mutationScoreCurrentPct).toBeNull();
  });

  test('carries through explicit coveragePct/mutationScore values', () => {
    const data = buildDashboardData([], [], new Date(), 70.84, 85.0, 91.72);

    expect(data.coveragePct).toBe(70.84);
    expect(data.mutationScoreBaselinePct).toBe(85.0);
    expect(data.mutationScoreCurrentPct).toBe(91.72);
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

  test('omits the "Failures by cause" section entirely when there are no failures', () => {
    const html = renderDashboard(baseData());

    expect(html).not.toContain('Failures by cause');
    expect(html).not.toContain('No failing tests in this run.');
  });

  test('shows the "Failures by cause" heading when there is at least one failure group', () => {
    const events: ObservabilityEvent[] = [
      makeTest({ testId: 't1', outcome: 'unexpected', error: { message: 'Error: expect(1).toBe(2)' } }),
    ];
    const data = buildDashboardData(events, []);

    const html = renderDashboard(data);

    expect(html).toContain('Failures by cause');
  });

  test('omits the "Proposed for quarantine" section entirely when nothing was proposed', () => {
    const html = renderDashboard(baseData());

    expect(html).not.toContain('Proposed for quarantine (this run)');
  });

  test('project cards always show Passed but hide Failed/Flaky/Quarantined labels when their count is zero', () => {
    const data = buildDashboardData([makeTest({ testId: 't1', project: 'api', outcome: 'expected' })], []);

    const html = renderDashboard(data);

    expect(html).toContain('<dt>Passed</dt><dd>1</dd>');
    expect(html).not.toContain('<dt>Failed</dt>');
    expect(html).not.toContain('<dt>Flaky</dt>');
    expect(html).not.toContain('<dt>Quarantined</dt>');
  });

  test('project card shows a nonzero label alongside Passed, still hiding the still-zero ones', () => {
    const events: ObservabilityEvent[] = [
      makeTest({ testId: 't1', project: 'ui', outcome: 'expected' }),
      makeTest({ testId: 't2', project: 'ui', outcome: 'unexpected', error: { message: 'x' } }),
    ];

    const data = buildDashboardData(events, []);

    const html = renderDashboard(data);

    expect(html).toContain('<dt>Passed</dt><dd>1</dd>');
    expect(html).toContain('<dt>Failed</dt><dd>1</dd>');
    expect(html).not.toContain('<dt>Flaky</dt>');
    expect(html).not.toContain('<dt>Quarantined</dt>');
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

  test('renders "n/a" for coverage/mutation score when neither was supplied', () => {
    const html = renderDashboard(baseData());

    expect(html).toContain('Unit test coverage');
    expect(html).toContain('Mutation score');
    expect(html).toContain('<div class="num">n/a</div>');
    expect(html).toContain('<div class="num flat">n/a</div>');
  });

  test('renders a bare percentage (no arrow) when the mutation score has not moved from baseline', () => {
    const data = buildDashboardData([], [], new Date(), 70.84, 91.72, 91.72);

    const html = renderDashboard(data);

    expect(html).toContain('<div class="num">70.84%</div>');
    expect(html).toContain('<div class="num flat">91.72%</div>');
    expect(html).not.toContain('→');
  });

  test('renders a green "up" class when the mutation score rose (survived mutant fixed)', () => {
    const data = buildDashboardData([], [], new Date(), 70.84, 91.72, 96.55);

    const html = renderDashboard(data);

    expect(html).toContain('<div class="num up">91.72% → 96.55%</div>');
  });

  test('renders a red "down" class when the mutation score dropped', () => {
    const data = buildDashboardData([], [], new Date(), 70.84, 91.72, 87.59);

    const html = renderDashboard(data);

    expect(html).toContain('<div class="num down">91.72% → 87.59%</div>');
  });

  test('"Proposed for quarantine" no longer says "(this run)" — the card reads from cross-run history, not this run\'s events', () => {
    const candidates: QuarantineCandidate[] = [
      {
        signature: 'HealError: …',
        category: 'ai-healing',
        testTitlePaths: ['> ui > suite > flaky test'],
        occurrences: 4,
        windowSize: 10,
        sampleRunFiles: ['run-1.jsonl'],
      },
    ];
    const data = buildDashboardData([], [], new Date(), null, null, null, candidates);

    const html = renderDashboard(data);

    expect(html).toContain('Proposed for quarantine');
    expect(html).not.toContain('Proposed for quarantine (this run)');
  });

  test('a proposed candidate shows the test name and how often it was flaky, not just a count', () => {
    const candidates: QuarantineCandidate[] = [
      {
        signature: 'HealError: …',
        category: 'ai-healing',
        testTitlePaths: ['> ui > suite > flaky test'],
        occurrences: 4,
        windowSize: 10,
        sampleRunFiles: ['run-1.jsonl'],
      },
    ];
    const data = buildDashboardData([], [], new Date(), null, null, null, candidates);

    const html = renderDashboard(data);

    expect(html).toContain('flaky test');
    expect(html).toContain('flaky in 4/10 recent runs');
  });

  test('a proposed candidate with no matching Allure report renders the test name as plain text, not a dead link', () => {
    const candidates: QuarantineCandidate[] = [
      {
        signature: 'HealError: …',
        category: 'ai-healing',
        testTitlePaths: ['> ui > suite > flaky test'],
        occurrences: 4,
        windowSize: 10,
        sampleRunFiles: [],
      },
    ];
    const data = buildDashboardData([], [], new Date(), null, null, null, candidates);

    const html = renderDashboard(data);

    expect(html).toContain('<li>suite &gt; flaky test</li>');
  });
});

test.describe('findAllureUids', () => {
  const tree = {
    name: 'suites',
    uid: 'root',
    children: [
      {
        name: 'ui',
        uid: 'suite-ui',
        children: [
          {
            name: 'ui/links.spec.ts',
            uid: 'suite-links-file',
            children: [
              {
                name: 'DemoQA UI @ Links',
                uid: 'suite-links-describe',
                children: [{ name: 'Clicking "Moved" reports a 301', uid: 'test-links-301' }],
              },
            ],
          },
          {
            name: 'ui/web-tables.spec.ts',
            uid: 'suite-tables-file',
            children: [
              {
                name: 'DemoQA UI @ Web Tables',
                uid: 'suite-tables-describe',
                // Same leaf title as another file, on purpose — the matcher must walk the whole
                // chain, not just match on the leaf, or it would return the wrong test's uid.
                children: [{ name: 'Clicking "Moved" reports a 301', uid: 'test-tables-301' }],
              },
            ],
          },
        ],
      },
    ],
  };

  test('resolves the suite and test uid for a matching testTitlePath', () => {
    const result = findAllureUids(tree, ' > ui > ui/links.spec.ts > DemoQA UI @ Links > Clicking "Moved" reports a 301');

    expect(result).toEqual({ suiteUid: 'suite-links-describe', testUid: 'test-links-301' });
  });

  test('matches the full chain, not just the leaf title — same leaf title under a different file resolves to a different uid', () => {
    const result = findAllureUids(tree, ' > ui > ui/web-tables.spec.ts > DemoQA UI @ Web Tables > Clicking "Moved" reports a 301');

    expect(result).toEqual({ suiteUid: 'suite-tables-describe', testUid: 'test-tables-301' });
  });

  test('returns null when a segment has no matching node', () => {
    const result = findAllureUids(tree, ' > ui > ui/links.spec.ts > DemoQA UI @ Links > A title that does not exist');

    expect(result).toBeNull();
  });

  test('returns null for an empty testTitlePath', () => {
    expect(findAllureUids(tree, '')).toBeNull();
  });
});
