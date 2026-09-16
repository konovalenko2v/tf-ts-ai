import * as fs from 'fs';
import { FailureGroup } from './classify';

// Candidate detection only — this module never writes quarantine.json (the file the CI gate
// reads). A human reviews quarantine-candidates.json and moves entries into quarantine.json by
// hand: an automated detector that can also silently widen what the merge gate ignores is the
// "gate people learn to ignore" failure mode (see CLAUDE.md rule #5), just applied to quarantine
// instead of the PR-review gate.

// MUST be committed to the repo, not gitignored: CI runners are ephemeral (unlike .observability/,
// which is a per-run artifact — see .gitignore), so "flaky in N of the last M runs" only works if
// this file persists across CI runs via git itself. Each `npm run failure-analysis` run appends to
// it and the result is meant to be committed on the run's branch/PR like any other tracked file.
export const QUARANTINE_HISTORY_FILE = 'quarantine-history.jsonl';
export const QUARANTINE_FILE = 'quarantine.json';
export const QUARANTINE_CANDIDATES_FILE = 'quarantine-candidates.json';

// How many of the most recent runs to look back over when deciding whether a signature is flaky
// often enough to propose for quarantine.
export const HISTORY_WINDOW = 10;
// Fraction of the window a signature must appear as all-flaky in before it's proposed.
export const FLAKY_THRESHOLD = 0.3;
// A confirmed quarantine entry expires after this long — see checkExpiredEntries.
export const QUARANTINE_TTL_DAYS = 14;

export interface QuarantineHistoryEntry {
  signature: string;
  category: string;
  testTitlePaths: string[];
  runFile: string;
  date: string;
}

export interface QuarantineCandidate {
  signature: string;
  category: string;
  testTitlePaths: string[];
  occurrences: number;
  windowSize: number;
  sampleRunFiles: string[];
}

export interface QuarantineEntry {
  signature: string;
  testTitlePaths: string[];
  addedAt: string;
  expiresAt: string;
  reason: string;
}

// One row per all-flaky group in this run. Called from failure-analysis/run.ts alongside the
// existing report — groupFailures() already computed allFlaky per group for this run, this just
// persists that fact across runs instead of letting it disappear when the run ends.
export function flakyHistoryEntries(groups: FailureGroup[], runFile: string, date = new Date().toISOString()): QuarantineHistoryEntry[] {
  return groups
    .filter((g) => g.allFlaky)
    .map((g) => ({
      signature: g.signature,
      category: g.category,
      testTitlePaths: g.testTitlePaths,
      runFile,
      date,
    }));
}

export function appendHistory(entries: QuarantineHistoryEntry[], file = QUARANTINE_HISTORY_FILE): void {
  if (entries.length === 0) return;
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(file, lines);
}

export function readHistory(file = QUARANTINE_HISTORY_FILE): QuarantineHistoryEntry[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as QuarantineHistoryEntry);
}

// Candidates are computed from the last `HISTORY_WINDOW` distinct runFiles recorded in history,
// not the last N lines — a signature that fails-and-recovers twice in the same run must not count
// as two occurrences of "flaky across runs".
export function computeCandidates(
  history: QuarantineHistoryEntry[],
  windowSize = HISTORY_WINDOW,
  threshold = FLAKY_THRESHOLD,
): QuarantineCandidate[] {
  const runFilesInOrder = [...new Set(history.map((h) => h.runFile))];
  const window = new Set(runFilesInOrder.slice(-windowSize));
  const inWindow = history.filter((h) => window.has(h.runFile));

  const bySignature = new Map<string, { category: string; testTitlePaths: Set<string>; runFiles: Set<string> }>();
  for (const entry of inWindow) {
    const existing = bySignature.get(entry.signature);
    if (existing) {
      entry.testTitlePaths.forEach((p) => existing.testTitlePaths.add(p));
      existing.runFiles.add(entry.runFile);
    } else {
      bySignature.set(entry.signature, {
        category: entry.category,
        testTitlePaths: new Set(entry.testTitlePaths),
        runFiles: new Set([entry.runFile]),
      });
    }
  }

  const candidates: QuarantineCandidate[] = [];
  for (const [signature, data] of bySignature) {
    const occurrences = data.runFiles.size;
    if (occurrences / window.size < threshold) continue;
    candidates.push({
      signature,
      category: data.category,
      testTitlePaths: [...data.testTitlePaths],
      occurrences,
      windowSize: window.size,
      sampleRunFiles: [...data.runFiles].slice(0, 3),
    });
  }

  return candidates.sort((a, b) => b.occurrences - a.occurrences);
}

export function writeCandidates(candidates: QuarantineCandidate[], file = QUARANTINE_CANDIDATES_FILE): void {
  fs.writeFileSync(file, JSON.stringify(candidates, null, 2) + '\n');
}

export function readQuarantineList(file = QUARANTINE_FILE): QuarantineEntry[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as QuarantineEntry[];
}

// TTL is not decoration: an entry past expiresAt is a decision someone must make (renew, or
// unquarantine), not a permanent exemption from the gate. The CI gate step calls this and fails
// loudly on any hit — see the "Gate on shard results" step in regression.yml.
export function expiredEntries(entries: QuarantineEntry[], now = new Date()): QuarantineEntry[] {
  return entries.filter((e) => new Date(e.expiresAt).getTime() < now.getTime());
}

export function isQuarantined(testTitlePath: string, entries: QuarantineEntry[]): boolean {
  return entries.some((e) => e.testTitlePaths.includes(testTitlePath));
}

// Convenience for the failure-analysis run.ts entrypoint: takes the groups run.ts already computed
// via classify.ts's groupFailures (not recomputed here) and persists+recomputes candidates from them.
export function updateCandidatesFromRun(groups: FailureGroup[], runFile: string): QuarantineCandidate[] {
  appendHistory(flakyHistoryEntries(groups, runFile));
  const candidates = computeCandidates(readHistory());
  writeCandidates(candidates);
  return candidates;
}
