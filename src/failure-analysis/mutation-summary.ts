// Reads Stryker's mutation.json (src/agent-fixer/safety-gates.ts, verify-stability.ts,
// src/ai-agents/review-verdict.ts — the CI merge-gate modules, see stryker.config.json) and writes
// a small committed snapshot the dashboard can read without needing mutation.yml's own artifact —
// that workflow is path-filtered and runs separately from regression.yml (which builds the
// dashboard), so the dashboard has no direct access to its output. A "survived" mutant is exactly
// a test that keeps passing after the code it's meant to check was changed — the dashboard calls
// this "test quality", not coverage, because c8 coverage only proves a line executed, not that any
// assertion would have caught it breaking.
import * as fs from 'fs';
import * as path from 'path';

interface StrykerMutant {
  status: 'Killed' | 'Timeout' | 'Survived' | 'NoCoverage' | 'RuntimeError' | 'CompileError' | 'Ignored' | 'Pending';
}

interface StrykerReport {
  files: Record<string, { mutants: StrykerMutant[] }>;
}

export interface MutationCounts {
  generatedAt: string;
  killed: number;
  timeout: number;
  survived: number;
  noCoverage: number;
  // CompileError/RuntimeError/Ignored/Pending are excluded from the score's denominator — same
  // rule mutation-testing-metrics' calculateMetrics.js uses (totalValid = detected + undetected,
  // totalInvalid tracked separately) — a mutant that couldn't even compile says nothing about
  // whether a test would have caught a real change.
  scorePct: number | null;
}

// baseline is written once (the first time this runs with no existing snapshot) and then carried
// forward unchanged on every later run — current is what gets refreshed. This is what makes the
// dashboard able to show "was X%, now Y%" instead of only ever the most recent single number,
// which is what the user explicitly asked for: a before/after of fixing the survived mutants
// found in this same session, not just a point-in-time score.
export interface MutationSummary {
  baseline: MutationCounts;
  current: MutationCounts;
}

// mutationScore = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage) * 100 —
// Stryker's own formula (mutation-testing-metrics/dist/src/calculateMetrics.js's toMetrics),
// reimplemented here rather than imported since that package's metrics function expects the full
// mutation-testing-report-schema shape, not just the counts this needs.
export function summarize(report: StrykerReport, now = new Date()): MutationCounts {
  let killed = 0;
  let timeout = 0;
  let survived = 0;
  let noCoverage = 0;

  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === 'Killed') killed++;
      else if (mutant.status === 'Timeout') timeout++;
      else if (mutant.status === 'Survived') survived++;
      else if (mutant.status === 'NoCoverage') noCoverage++;
    }
  }

  const totalDetected = killed + timeout;
  const totalValid = totalDetected + survived + noCoverage;

  return {
    generatedAt: now.toISOString(),
    killed,
    timeout,
    survived,
    noCoverage,
    scorePct: totalValid > 0 ? Math.round((totalDetected / totalValid) * 10000) / 100 : null,
  };
}

const MUTATION_REPORT_PATH = path.join('reports', 'mutation', 'mutation.json');
// Committed (not gitignored, unlike reports/ itself — see .gitignore) since mutation.yml runs in
// its own workflow, path-filtered to only the 3 gate files, and master requires a PR + passing
// checks (branch protection), so it can't push this snapshot on its own. A human (or a PR from
// this same branch) commits the refreshed file after running `npm run test:mutation` — same
// "human promotes, tool proposes" split quarantine.json already uses.
export const SNAPSHOT_PATH = path.join('reports', 'mutation-summary.json');

function readExistingSnapshot(): MutationSummary | undefined {
  if (!fs.existsSync(SNAPSHOT_PATH)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8')) as MutationSummary;
  } catch {
    return undefined;
  }
}

// Pure merge step, split out for testing: baseline carries forward from whatever snapshot already
// exists (undefined on the very first run, so current becomes its own baseline) — current is the
// only field this ever overwrites.
export function mergeWithExisting(current: MutationCounts, existing: MutationSummary | undefined): MutationSummary {
  return { baseline: existing?.baseline ?? current, current };
}

function main(): void {
  if (!fs.existsSync(MUTATION_REPORT_PATH)) {
    process.stderr.write(`[mutation-summary] ${MUTATION_REPORT_PATH} not found — run \`npm run test:mutation\` first\n`);
    process.exitCode = 1;
    return;
  }
  const report = JSON.parse(fs.readFileSync(MUTATION_REPORT_PATH, 'utf-8')) as StrykerReport;
  const current = summarize(report);
  const summary = mergeWithExisting(current, readExistingSnapshot());
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(
    `[mutation-summary] wrote ${SNAPSHOT_PATH} — baseline ${summary.baseline.scorePct ?? 'n/a'}% -> current ${current.scorePct ?? 'n/a'}% (${current.killed} killed, ${current.timeout} timeout, ${current.survived} survived, ${current.noCoverage} no coverage)\n`,
  );
}

if (require.main === module) {
  main();
}
