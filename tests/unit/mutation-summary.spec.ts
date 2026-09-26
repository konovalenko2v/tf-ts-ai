import { test, expect } from '@playwright/test';
import { summarize, mergeWithExisting, MutationCounts } from '../../src/failure-analysis/mutation-summary';

function counts(overrides: Partial<MutationCounts> = {}): MutationCounts {
  return { generatedAt: '2026-01-01T00:00:00.000Z', killed: 1, timeout: 0, survived: 0, noCoverage: 0, scorePct: 100, ...overrides };
}

function report(statuses: string[]) {
  return { files: { 'a.ts': { mutants: statuses.map((status) => ({ status: status as never })) } } };
}

test.describe('summarize', () => {
  test("matches Stryker's own formula: (killed + timeout) / (killed + timeout + survived + noCoverage)", () => {
    const summary = summarize(report(['Killed', 'Killed', 'Timeout', 'Survived', 'NoCoverage']));

    expect(summary.killed).toBe(2);
    expect(summary.timeout).toBe(1);
    expect(summary.survived).toBe(1);
    expect(summary.noCoverage).toBe(1);
    // (2 + 1) / (2 + 1 + 1 + 1) * 100 = 60
    expect(summary.scorePct).toBe(60);
  });

  test('excludes CompileError/RuntimeError/Ignored/Pending from the denominator', () => {
    const summary = summarize(report(['Killed', 'CompileError', 'RuntimeError', 'Ignored', 'Pending']));

    // (1) / (1) * 100 = 100 — the 4 excluded statuses never enter totalValid
    expect(summary.scorePct).toBe(100);
  });

  test("reproduces this repo's actual baseline counts (115 killed, 18 timeout, 12 survived, 0 no coverage -> 91.72%)", () => {
    const statuses: string[] = [
      ...(Array(115).fill('Killed') as string[]),
      ...(Array(18).fill('Timeout') as string[]),
      ...(Array(12).fill('Survived') as string[]),
      ...(Array(36).fill('CompileError') as string[]),
    ];

    const summary = summarize(report(statuses));

    expect(summary.killed).toBe(115);
    expect(summary.timeout).toBe(18);
    expect(summary.survived).toBe(12);
    expect(summary.scorePct).toBe(91.72);
  });

  test('returns a null score, not NaN or a crash, when there are zero valid mutants', () => {
    const summary = summarize(report(['CompileError', 'Ignored']));

    expect(summary.scorePct).toBeNull();
  });

  test('an empty report also returns a null score', () => {
    const summary = summarize({ files: {} });

    expect(summary.scorePct).toBeNull();
    expect(summary.killed).toBe(0);
  });
});

test.describe('mergeWithExisting', () => {
  test('the first run (no existing snapshot) becomes its own baseline', () => {
    const current = counts({ scorePct: 91.72 });

    const merged = mergeWithExisting(current, undefined);

    expect(merged.baseline).toEqual(current);
    expect(merged.current).toEqual(current);
  });

  test('a later run keeps the original baseline and only updates current', () => {
    const original = counts({ scorePct: 91.72 });
    const improved = counts({ scorePct: 96.0, survived: 2 });

    const merged = mergeWithExisting(improved, { baseline: original, current: original });

    expect(merged.baseline).toEqual(original);
    expect(merged.current).toEqual(improved);
  });
});
