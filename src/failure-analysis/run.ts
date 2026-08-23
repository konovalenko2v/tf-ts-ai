import * as fs from 'fs';
import * as path from 'path';
import { StepEvent, TestSummaryEvent } from '../observability/types';
import { latestRunFile, readEvents } from '../observability/run-file';
import { groupFailures, summarizeRecoveries, FailureCategory } from './classify';

const CATEGORY_LABELS: Record<FailureCategory, string> = {
  config: 'Configuration (missing/invalid env var)',
  'ai-quota': 'AI provider quota exhausted (not a healing capability issue)',
  'ai-healing': 'AI healing tried and failed to recover a broken locator',
  assertion: 'Assertion failure (likely a real bug)',
  other: 'Uncategorized',
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
      lines.push('Affected tests:');
      for (const p of g.testTitlePaths) lines.push(`- ${p.trim()}`);
      lines.push('', '<details><summary>Sample error message</summary>', '', '```', g.sampleMessage, '```', '</details>', '');
    }
  }

  if (recoveries.length > 0) {
    lines.push('## Passed only via AI healing', '');
    lines.push('These tests passed, but only because a broken locator was healed at runtime — see agent-fixer for automated fixes.', '');
    for (const r of recoveries) {
      lines.push(`- ${r.testTitlePath.trim()} — ${r.stepTitle} (${r.recoveredSelectors.join(', ')})`);
    }
  }

  return lines.join('\n') + '\n';
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

  const groups = groupFailures(tests);
  const recoveries = summarizeRecoveries(steps);
  const report = renderReport(runFile, groups, recoveries);

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
