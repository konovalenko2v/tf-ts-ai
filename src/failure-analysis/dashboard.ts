// Standalone HTML dashboard — a second, separate page from the Allure report, published to the
// same Pages site at /dashboard/. Gives a quick top-line view (pass/fail counts, failures grouped
// by cause, quarantine state) without opening Allure's per-suite tree. Never mutates any file:
// quarantine.json/quarantine-candidates.json/quarantine-history.jsonl are read-only inputs here,
// unlike failure-analysis/run.ts's main() which is the one place allowed to write them.
import * as fs from 'fs';
import * as path from 'path';
import { ObservabilityEvent, TestSummaryEvent } from '../observability/types';
import { FailureGroup, groupFailures, latestAttemptPerTest } from './classify';
import { CATEGORY_LABELS } from './run';
import { QuarantineEntry, expiredEntries, flakyHistoryEntries, readQuarantineList } from './quarantine';

export interface DashboardData {
  generatedAt: string;
  totalTests: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  groups: FailureGroup[];
  quarantinedCount: number;
  quarantinedExpiredCount: number;
  proposedForQuarantineCount: number;
  proposedForQuarantine: { signature: string; category: FailureGroup['category']; testTitlePaths: string[] }[];
  // null, not a missing field: c8 coverage/coverage-summary.json (unit+contract's line coverage,
  // "did any test execute this code") and Stryker's reports/mutation-summary.json (the 3 CI
  // gate modules' mutation score, "would any test have NOTICED this code breaking") are both
  // optional inputs this dashboard doesn't generate itself — a run/branch that hasn't produced
  // one yet, or a local `npm run dashboard` with neither file present, must render "n/a" rather
  // than crash or silently show 0%.
  coveragePct: number | null;
  // baseline/current, not a single number: shows "was X%, now Y%" for the gate modules' mutation
  // score, so fixing a survived mutant ("zombie test" — one that keeps passing after the code it's
  // meant to check was changed) has a visible before/after, not just the latest point-in-time
  // number. baseline is whatever mutation-summary.ts first recorded; current is its most recent
  // run — see that file's mergeWithExisting for how the two diverge over time.
  mutationScoreBaselinePct: number | null;
  mutationScoreCurrentPct: number | null;
}

// Counts outcomes, not attempts — a test that fails on attempt 0 and passes on retry 1 is one
// flaky test, not one failure plus one pass. latestAttemptPerTest is the same dedupe classify.ts's
// groupFailures() already relies on for its own counts, reused rather than re-implemented so the
// two never drift apart on what "one test" means.
export function buildDashboardData(
  events: ObservabilityEvent[],
  quarantine: QuarantineEntry[],
  now = new Date(),
  coveragePct: number | null = null,
  mutationScoreBaselinePct: number | null = null,
  mutationScoreCurrentPct: number | null = null,
): DashboardData {
  const allTests = events.filter((e): e is TestSummaryEvent => e.type === 'test');
  const latest = latestAttemptPerTest(allTests);

  const passed = latest.filter((t) => t.outcome === 'expected').length;
  const failed = latest.filter((t) => t.outcome === 'unexpected').length;
  const flaky = latest.filter((t) => t.outcome === 'flaky').length;
  const skipped = latest.filter((t) => t.outcome === 'skipped').length;

  const groups = groupFailures(allTests);
  const proposed = flakyHistoryEntries(groups, 'this-run', now.toISOString());

  return {
    generatedAt: now.toISOString(),
    totalTests: latest.length,
    passed,
    failed,
    flaky,
    skipped,
    groups,
    quarantinedCount: quarantine.length,
    quarantinedExpiredCount: expiredEntries(quarantine, now).length,
    proposedForQuarantineCount: proposed.length,
    proposedForQuarantine: proposed.map((p) => ({
      signature: p.signature,
      category: p.category as FailureGroup['category'],
      testTitlePaths: p.testTitlePaths,
    })),
    coveragePct,
    mutationScoreBaselinePct,
    mutationScoreCurrentPct,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// "n/a" when neither is known; a bare "X%" once baseline and current are equal (no drift yet, or
// the first run — see mergeWithExisting) rather than the redundant "X% → X%"; otherwise the arrow
// form the user asked to see: the score before fixing survived mutants, then after.
function renderMutationScore(baselinePct: number | null, currentPct: number | null): string {
  if (currentPct === null) return 'n/a';
  if (baselinePct === null || baselinePct === currentPct) return `${currentPct}%`;
  return `${baselinePct}% → ${currentPct}%`;
}

function renderGroup(g: FailureGroup): string {
  const flakyBadge = g.allFlaky ? '<span class="badge badge-flaky">flaky — passed on retry</span>' : '';
  const tests = g.testTitlePaths.map((p) => `<li>${escapeHtml(p.trim())}</li>`).join('');
  return `
    <article class="group">
      <header>
        <span class="badge badge-${g.category}">${escapeHtml(CATEGORY_LABELS[g.category])}</span>
        <span class="count">${g.count} test${g.count === 1 ? '' : 's'}</span>
        ${flakyBadge}
      </header>
      <p class="signature">${escapeHtml(g.signature)}</p>
      <ul class="test-list">${tests}</ul>
      <details>
        <summary>Sample error</summary>
        <pre>${escapeHtml(g.sampleMessage)}</pre>
      </details>
    </article>`;
}

function renderProposed(data: DashboardData): string {
  if (data.proposedForQuarantine.length === 0) return '';
  const rows = data.proposedForQuarantine
    .map(
      (p) => `
      <li>
        <span class="badge badge-${p.category}">${escapeHtml(CATEGORY_LABELS[p.category])}</span>
        <span class="signature">${escapeHtml(p.signature)}</span>
        <span class="muted">${p.testTitlePaths.length} test${p.testTitlePaths.length === 1 ? '' : 's'}</span>
      </li>`,
    )
    .join('');
  return `
    <section>
      <h2>Proposed for quarantine (this run)</h2>
      <p class="muted">Failed at least once, then passed on retry — a human still has to promote these into quarantine.json.</p>
      <ul class="proposed-list">${rows}</ul>
    </section>`;
}

export function renderDashboard(data: DashboardData): string {
  const groupsHtml = data.groups.length > 0 ? data.groups.map(renderGroup).join('') : '<p class="muted">No failing tests in this run.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>tf-ts-ai — Test Health Dashboard</title>
<style>
  :root {
    --bg: #f7f8fa; --card: #ffffff; --text: #1a1d24; --muted: #6b7280; --border: #e5e7eb;
    --green: #16a34a; --red: #dc2626; --amber: #d97706; --blue: #2563eb; --purple: #7c3aed;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1115; --card: #171a21; --text: #e5e7eb; --muted: #9099a8; --border: #2a2e37; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .wrap { max-width: 920px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.25rem; }
  .subtitle { color: var(--muted); font-size: 0.875rem; margin: 0 0 2rem; }
  .subtitle a { color: var(--blue); text-decoration: none; }
  .subtitle a:hover { text-decoration: underline; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 2.5rem; }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 1.25rem; text-align: center;
  }
  .card .num { font-size: 2rem; font-weight: 700; line-height: 1.1; }
  .card .label { color: var(--muted); font-size: 0.8125rem; margin-top: 0.25rem; }
  .card.passed .num { color: var(--green); }
  .card.failed .num { color: var(--red); }
  .card.proposed .num { color: var(--amber); }
  .card.quarantined .num { color: var(--purple); }
  .card.coverage .num { color: var(--blue); }
  .card.mutation .num { color: var(--blue); }
  h2 { font-size: 1.125rem; font-weight: 600; margin: 2rem 0 0.75rem; }
  .muted { color: var(--muted); font-size: 0.875rem; }
  .group {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 1rem 1.25rem; margin-bottom: 0.875rem;
  }
  .group header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .badge {
    display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.6rem;
    border-radius: 999px; background: var(--border); color: var(--text);
  }
  .badge-config { background: #fef3c7; color: #92400e; }
  .badge-ai-quota { background: #dbeafe; color: #1e40af; }
  .badge-ai-healing { background: #fee2e2; color: #991b1b; }
  .badge-contract { background: #ede9fe; color: #5b21b6; }
  .badge-assertion { background: #fecaca; color: #7f1d1d; }
  .badge-other { background: #e5e7eb; color: #374151; }
  .badge-flaky { background: #fef9c3; color: #854d0e; }
  @media (prefers-color-scheme: dark) {
    .badge-config { background: #451a03; color: #fcd34d; }
    .badge-ai-quota { background: #1e3a5f; color: #93c5fd; }
    .badge-ai-healing { background: #450a0a; color: #fca5a5; }
    .badge-contract { background: #2e1065; color: #c4b5fd; }
    .badge-assertion { background: #450a0a; color: #fca5a5; }
    .badge-other { background: #2a2e37; color: #d1d5db; }
    .badge-flaky { background: #422006; color: #fde047; }
  }
  .count { font-size: 0.875rem; color: var(--muted); font-weight: 500; }
  .signature { font-family: ui-monospace, monospace; font-size: 0.8125rem; color: var(--muted); margin: 0.25rem 0 0.75rem; word-break: break-word; }
  .test-list { margin: 0 0 0.5rem; padding-left: 1.25rem; font-size: 0.875rem; }
  .test-list li { margin-bottom: 0.2rem; }
  details { font-size: 0.8125rem; }
  summary { cursor: pointer; color: var(--blue); }
  pre {
    background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
    padding: 0.75rem; overflow-x: auto; font-size: 0.75rem; margin-top: 0.5rem; white-space: pre-wrap;
  }
  .proposed-list { list-style: none; margin: 0; padding: 0; }
  .proposed-list li {
    display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
    background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    padding: 0.6rem 0.9rem; margin-bottom: 0.5rem; font-size: 0.8125rem;
  }
  footer { margin-top: 3rem; color: var(--muted); font-size: 0.75rem; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Test Health Dashboard</h1>
  <p class="subtitle">tf-ts-ai — generated ${escapeHtml(data.generatedAt)} · <a href="../">↩ Allure report</a></p>

  <div class="cards">
    <div class="card passed"><div class="num">${data.passed}</div><div class="label">Passed</div></div>
    <div class="card failed"><div class="num">${data.failed}</div><div class="label">Failed</div></div>
    <div class="card proposed"><div class="num">${data.proposedForQuarantineCount}</div><div class="label">Proposed for quarantine</div></div>
    <div class="card quarantined"><div class="num">${data.quarantinedCount}</div><div class="label">Currently quarantined</div></div>
    <div class="card coverage"><div class="num">${data.coveragePct !== null ? data.coveragePct + '%' : 'n/a'}</div><div class="label">Unit test coverage</div></div>
    <div class="card mutation"><div class="num">${renderMutationScore(data.mutationScoreBaselinePct, data.mutationScoreCurrentPct)}</div><div class="label">Mutation score (gate modules)</div></div>
  </div>

  <h2>Failures by cause</h2>
  ${groupsHtml}

  ${renderProposed(data)}

  <footer>
    ${data.totalTests} test(s) total · ${data.flaky} flaky · ${data.skipped} skipped
    ${data.quarantinedExpiredCount > 0 ? `· <strong>${data.quarantinedExpiredCount} quarantine entr${data.quarantinedExpiredCount === 1 ? 'y' : 'ies'} past TTL</strong>` : ''}
  </footer>
</div>
</body>
</html>
`;
}

const OBSERVABILITY_DIR = '.observability';

// Playwright's testId is a stable hash of (file, title) — deliberately IDENTICAL across shards
// and machines for the same test, since that's what lets Playwright itself correlate retries.
// That's exactly wrong for merging multiple shards' run files here: classify.ts's
// latestAttemptPerTest/groupFailures dedupe by bare testId, so two shards' events would collide
// and one shard's tests would silently vanish from every count and group. Namespacing testId by
// runId (unique per shard's run-*.jsonl) before anything downstream sees the events keeps each
// shard's tests distinct without having to change classify.ts's dedupe contract, which is correct
// for its only other caller (failure-analysis/run.ts, always a single run file).
export function namespaceTestIds(events: ObservabilityEvent[]): ObservabilityEvent[] {
  return events.map((e) => ('testId' in e ? { ...e, testId: `${e.runId}::${e.testId}` } : e));
}

function readAllRunEvents(dir: string): ObservabilityEvent[] {
  if (!fs.existsSync(dir)) return [];
  const events = fs
    .readdirSync(dir)
    .filter((f) => /^run-.*\.jsonl$/.test(f))
    .flatMap((f) =>
      fs
        .readFileSync(path.join(dir, f), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ObservabilityEvent),
    );
  return namespaceTestIds(events);
}

const COVERAGE_SUMMARY_PATH = path.join('coverage', 'coverage-summary.json');
const MUTATION_SUMMARY_PATH = path.join('reports', 'mutation-summary.json');

// Both optional: a local `npm run dashboard` run, or a CI run whose coverage/mutation-summary
// artifact download step was skipped (both use continue-on-error, same policy as this whole
// dashboard step in regression.yml — a report-only page must never crash the pipeline), leaves
// these files absent. buildDashboardData's coveragePct/mutationScorePct default to null for
// exactly this reason.
function readCoveragePct(): number | null {
  if (!fs.existsSync(COVERAGE_SUMMARY_PATH)) return null;
  try {
    const summary = JSON.parse(fs.readFileSync(COVERAGE_SUMMARY_PATH, 'utf-8')) as { total?: { lines?: { pct?: number } } };
    return summary.total?.lines?.pct ?? null;
  } catch {
    return null;
  }
}

function readMutationScores(): { baseline: number | null; current: number | null } {
  if (!fs.existsSync(MUTATION_SUMMARY_PATH)) return { baseline: null, current: null };
  try {
    const summary = JSON.parse(fs.readFileSync(MUTATION_SUMMARY_PATH, 'utf-8')) as {
      baseline?: { scorePct?: number | null };
      current?: { scorePct?: number | null };
    };
    return { baseline: summary.baseline?.scorePct ?? null, current: summary.current?.scorePct ?? null };
  } catch {
    return { baseline: null, current: null };
  }
}

function main(): void {
  const events = readAllRunEvents(OBSERVABILITY_DIR);
  const quarantine = readQuarantineList();
  const mutationScores = readMutationScores();
  const data = buildDashboardData(events, quarantine, new Date(), readCoveragePct(), mutationScores.baseline, mutationScores.current);
  const html = renderDashboard(data);

  const outDir = process.argv[2] ?? path.join('allure-report', 'dashboard');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  process.stdout.write(
    `[dashboard] wrote ${path.join(outDir, 'index.html')} (${data.totalTests} test(s), ${data.groups.length} failure group(s))\n`,
  );
}

if (require.main === module) {
  main();
}
