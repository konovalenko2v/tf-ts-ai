import * as fs from 'fs';
import * as path from 'path';
import { StepEvent, TestSummaryEvent } from '../observability/types';
import { latestRunFile, readEvents } from '../observability/run-file';
import { groupFailures, summarizeRecoveries, FailureCategory } from './classify';
import { readHealEvents } from './heal-events';

const HEAL_EVENTS_FILE = '.self-heal/heal_events.jsonl';
const ALLURE_RESULTS_DIR = 'allure-results';

const CATEGORY_LABELS: Record<FailureCategory, string> = {
  config: 'Configuration (missing/invalid env var)',
  'ai-quota': 'AI provider quota exhausted (not a healing capability issue)',
  'ai-healing': 'AI healing tried and failed to recover a broken locator',
  assertion: 'Assertion failure (likely a real bug)',
  other: 'Uncategorized',
};

// Playwright's retries setting is static per-project, decided before the run starts — there's no
// hook to grant or deny a retry per-attempt based on why the previous attempt failed. So the
// "smart" part of retry policy is this verdict: whether the retries this category already spent
// (or would spend) were worth spending, made visible instead of left implicit in a retry count.
const RETRY_VERDICTS: Record<FailureCategory, string> = {
  config: 'Retrying cannot fix this — same missing value every attempt, budget should be 0. A globalSetup precheck (src/core/global-setup.ts) already guards BOOKER_USERNAME/USER_PASSWORD before any retries are spent; other config failures still burn the full retry budget until they get the same guard.',
  'ai-quota': 'Retrying is correct — the provider itself returns a retry-after delay, and the model fallback (AI_MODEL_FALLBACK) has turned this into a pass on a later attempt before.',
  'ai-healing': 'Retrying rarely helps — the AI looked and found nothing; a second identical attempt is unlikely to differ. Worth a human look at the locator/description, not more retries.',
  assertion: 'Retrying is the right way to tell flake from a real bug — if it fails on every attempt, treat it as a real bug.',
  other: 'No established policy yet — falls back to the project default retry count.',
};

function renderReport(runFile: string, groups: ReturnType<typeof groupFailures>, recoveries: ReturnType<typeof summarizeRecoveries>): string {
  const lines: string[] = [];
  lines.push(`# Failure analysis — ${path.basename(runFile)}`, '');

  if (groups.length === 0) {
    lines.push('No failing tests in this run.');
  } else {
    const totalFailedTests = groups.reduce((sum, g) => sum + g.count, 0);
    lines.push(`${totalFailedTests} test(s) failed, grouped into ${groups.length} distinct cause(s):`, '');
    for (const g of groups) {
      const flakyNote = g.allFlaky ? ' — passed on retry (flaky)' : '';
      lines.push(`## ${CATEGORY_LABELS[g.category]} — ${g.count} test(s)${flakyNote}`, '');
      lines.push(`Signature: \`${g.signature}\``, '');
      lines.push(`Retry verdict: ${RETRY_VERDICTS[g.category]}`, '');
      lines.push('Affected tests:');
      for (const p of g.testTitlePaths) lines.push(`- ${p.trim()}`);
      lines.push('', '<details><summary>Sample error message</summary>', '', '```', g.sampleMessage, '```', '</details>', '');
    }
  }

  if (recoveries.length > 0) {
    lines.push('## Passed only via AI healing', '');
    lines.push('These tests passed, but only because a broken locator was healed at runtime — see agent-fixer for automated fixes.', '');
    for (const r of recoveries) {
      lines.push(`- ${r.testTitlePath.trim()} — ${r.stepTitle}`);
      if (r.healedLocators.length > 0) {
        for (const h of r.healedLocators) {
          const confidenceNote = h.confidence !== undefined ? ` — confidence ${h.confidence}` : '';
          const sourceNote = h.used === 'cache' ? ' (from healwright cache, no AI call this run)' : '';
          lines.push(`  - "${h.contextName}" → \`${h.newLocator}\`${confidenceNote}${sourceNote}`);
          if (h.why) lines.push(`    ${h.why}`);
        }
      } else if (r.recoveredSelectors.length > 0) {
        // No matching heal_events.jsonl entry (e.g. the file wasn't available) — fall back to
        // reporting only what broke, not what it was replaced with.
        lines.push(`  - broken selector(s): ${r.recoveredSelectors.join(', ')}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

// allure-results/environment.properties renders on the report's Overview page — the one thing
// everyone opening the report sees before choosing to drill into any suite. This is the landing-
// page-visible half of the healing-visibility gap; the tag on individual tests (src/ui/fixtures.ts)
// is the filterable half. Must be written before `allure generate` (the Generate Allure Report
// step runs right after this one). `allure generate --clean` only wipes allure-report/, not
// allure-results/, so writing here doesn't race that step — but if npm test failed early enough
// that allure-results/ was never created, mkdirSync guards against this step throwing on top of it.
function writeAllureEnvironment(recoveries: ReturnType<typeof summarizeRecoveries>): void {
  const healedCount = recoveries.reduce((sum, r) => sum + r.healedLocators.length, 0);
  if (healedCount === 0) return;

  fs.mkdirSync(ALLURE_RESULTS_DIR, { recursive: true });
  const contexts = recoveries.flatMap((r) => r.healedLocators.map((h) => h.contextName)).join('; ');
  const lines = [`Self-healed-locators=${healedCount} (${contexts})`];
  fs.writeFileSync(path.join(ALLURE_RESULTS_DIR, 'environment.properties'), lines.join('\n') + '\n');
}

function main(): void {
  const runFile = process.argv[2] ?? latestRunFile();
  if (!runFile) {
    process.stderr.write('[failure-analysis] no observability run file found — nothing to analyze\n');
    return;
  }

  const events = readEvents(runFile);
  const tests = events.filter((e): e is TestSummaryEvent => e.type === 'test');
  const steps = events.filter((e): e is StepEvent => e.type === 'step');

  const healEvents = readHealEvents(HEAL_EVENTS_FILE);
  const groups = groupFailures(tests);
  const recoveries = summarizeRecoveries(steps, healEvents);
  const report = renderReport(runFile, groups, recoveries);
  writeAllureEnvironment(recoveries);

  const outPath = path.join(path.dirname(runFile), `failure-analysis-${path.basename(runFile, '.jsonl')}.md`);
  fs.writeFileSync(outPath, report);
  process.stdout.write(report);
  process.stderr.write(`[failure-analysis] wrote report to ${outPath}\n`);

  // Renders the report directly on the CI run page — otherwise it only surfaces if someone
  // downloads the observability artifact and opens the file by hand.
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
}

if (require.main === module) {
  main();
}
