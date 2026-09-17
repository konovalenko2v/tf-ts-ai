// Unit coverage for src/failure-analysis/quarantine.ts — candidate detection only. The module
// deliberately never writes quarantine.json (the file the CI gate reads); these tests cover the
// pure history -> candidate computation and the TTL check the gate calls, all against a scratch
// dir so no test touches this repo's real quarantine-history.jsonl.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import {
  appendHistory,
  computeCandidates,
  expiredEntries,
  isQuarantined,
  readHistory,
  readQuarantineList,
  writeCandidates,
  QuarantineHistoryEntry,
  QuarantineEntry,
} from '../../src/failure-analysis/quarantine';
import { FailureGroup } from '../../src/failure-analysis/classify';
import { flakyHistoryEntries } from '../../src/failure-analysis/quarantine';

function makeGroup(overrides: Partial<FailureGroup>): FailureGroup {
  return {
    category: 'assertion',
    signature: 'Error: expect(received).toBe(expected)',
    count: 1,
    testTitlePaths: ['suite > test'],
    sampleMessage: 'Error: expect(received).toBe(expected)',
    allFlaky: true,
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<QuarantineHistoryEntry>): QuarantineHistoryEntry {
  return {
    signature: 'sig-a',
    category: 'assertion',
    testTitlePaths: ['suite > test'],
    runFile: 'run-1.jsonl',
    date: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

test.describe('flakyHistoryEntries', () => {
  test('emits one entry per all-flaky group, skips non-flaky groups', () => {
    const groups = [makeGroup({ signature: 'flaky-one', allFlaky: true }), makeGroup({ signature: 'real-bug', allFlaky: false })];
    const entries = flakyHistoryEntries(groups, 'run-42.jsonl', '2026-09-16T00:00:00.000Z');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ signature: 'flaky-one', runFile: 'run-42.jsonl', date: '2026-09-16T00:00:00.000Z' });
  });

  test('returns nothing when no group is all-flaky', () => {
    expect(flakyHistoryEntries([makeGroup({ allFlaky: false })], 'run.jsonl')).toEqual([]);
  });
});

test.describe('computeCandidates', () => {
  test('proposes a signature that is flaky in >= threshold fraction of the window', () => {
    // 3 of 5 runs = 60%, above the 30% default threshold.
    const history = ['run-1', 'run-2', 'run-3'].map((runFile) => makeHistoryEntry({ signature: 'sig-a', runFile }));
    const otherRuns = ['run-4', 'run-5'].map((runFile) => makeHistoryEntry({ signature: 'sig-b', runFile }));
    const candidates = computeCandidates([...history, ...otherRuns], 5, 0.3);
    const sigA = candidates.find((c) => c.signature === 'sig-a');
    expect(sigA).toBeDefined();
    expect(sigA!.occurrences).toBe(3);
    expect(sigA!.windowSize).toBe(5);
  });

  test('excludes a signature below threshold', () => {
    // 1 of 10 runs = 10%, below the 30% default threshold.
    const runFiles = Array.from({ length: 10 }, (_, i) => `run-${i}`);
    const history = runFiles.map((runFile, i) => makeHistoryEntry({ signature: i === 0 ? 'sig-rare' : 'sig-common', runFile }));
    const candidates = computeCandidates(history, 10, 0.3);
    expect(candidates.find((c) => c.signature === 'sig-rare')).toBeUndefined();
  });

  test('only considers the most recent windowSize distinct run files', () => {
    // sig-old only ever appears in the oldest run, which falls outside a window of 2.
    const history = [
      makeHistoryEntry({ signature: 'sig-old', runFile: 'run-1' }),
      makeHistoryEntry({ signature: 'sig-new', runFile: 'run-2' }),
      makeHistoryEntry({ signature: 'sig-new', runFile: 'run-3' }),
    ];
    const candidates = computeCandidates(history, 2, 0.3);
    expect(candidates.find((c) => c.signature === 'sig-old')).toBeUndefined();
    expect(candidates.find((c) => c.signature === 'sig-new')).toBeDefined();
  });

  test('a signature failing twice in the SAME run counts as one occurrence, not two', () => {
    const history = [
      makeHistoryEntry({ signature: 'sig-a', runFile: 'run-1', testTitlePaths: ['suite > a'] }),
      makeHistoryEntry({ signature: 'sig-a', runFile: 'run-1', testTitlePaths: ['suite > b'] }),
    ];
    const candidates = computeCandidates(history, 1, 0.3);
    const sigA = candidates.find((c) => c.signature === 'sig-a');
    expect(sigA!.occurrences).toBe(1);
    expect(sigA!.testTitlePaths.sort()).toEqual(['suite > a', 'suite > b']);
  });

  test('sorts candidates by occurrence count, most frequent first', () => {
    const history = [
      ...['r1', 'r2'].map((runFile) => makeHistoryEntry({ signature: 'sig-low', runFile })),
      ...['r3', 'r4', 'r5'].map((runFile) => makeHistoryEntry({ signature: 'sig-high', runFile })),
    ];
    const candidates = computeCandidates(history, 5, 0.3);
    expect(candidates.map((c) => c.signature)).toEqual(['sig-high', 'sig-low']);
  });
});

test.describe('history file round-trip', () => {
  let dir: string;

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarantine-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('appendHistory + readHistory round-trips entries across multiple calls', () => {
    const file = path.join(dir, 'history.jsonl');
    appendHistory([makeHistoryEntry({ signature: 'sig-a' })], file);
    appendHistory([makeHistoryEntry({ signature: 'sig-b' })], file);
    const entries = readHistory(file);
    expect(entries.map((e) => e.signature)).toEqual(['sig-a', 'sig-b']);
  });

  test('readHistory returns empty array when file does not exist', () => {
    expect(readHistory(path.join(dir, 'missing.jsonl'))).toEqual([]);
  });

  test('appendHistory is a no-op for an empty entry list (does not create the file)', () => {
    const file = path.join(dir, 'never-created.jsonl');
    appendHistory([], file);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('writeCandidates writes valid JSON readable back', () => {
    const file = path.join(dir, 'candidates.json');
    const candidates = computeCandidates([makeHistoryEntry({ signature: 'sig-a', runFile: 'r1' })], 1, 0.3);
    writeCandidates(candidates, file);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(parsed[0].signature).toBe('sig-a');
  });
});

test.describe('quarantine.json — TTL and lookup', () => {
  function makeEntry(overrides: Partial<QuarantineEntry>): QuarantineEntry {
    return {
      signature: 'sig-a',
      testTitlePaths: ['suite > test'],
      addedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-15T00:00:00.000Z',
      reason: 'flaky 3/10 runs, see quarantine-candidates.json',
      ...overrides,
    };
  }

  test('expiredEntries flags an entry whose expiresAt is in the past', () => {
    const now = new Date('2026-09-16T00:00:00.000Z');
    const entries = [makeEntry({ expiresAt: '2026-09-15T00:00:00.000Z' })];
    expect(expiredEntries(entries, now)).toHaveLength(1);
  });

  test('expiredEntries does not flag an entry still within TTL', () => {
    const now = new Date('2026-09-10T00:00:00.000Z');
    const entries = [makeEntry({ expiresAt: '2026-09-15T00:00:00.000Z' })];
    expect(expiredEntries(entries, now)).toHaveLength(0);
  });

  test('isQuarantined matches by testTitlePath membership', () => {
    const entries = [makeEntry({ testTitlePaths: ['suite > quarantined test'] })];
    expect(isQuarantined('suite > quarantined test', entries)).toBe(true);
    expect(isQuarantined('suite > other test', entries)).toBe(false);
  });

  test('readQuarantineList returns empty array when quarantine.json does not exist', () => {
    expect(readQuarantineList('/nonexistent/quarantine.json')).toEqual([]);
  });
});
