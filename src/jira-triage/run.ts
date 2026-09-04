// Entry point for the jira-triage CI job: reads the latest observability run, finds every
// 'assertion'-category failure (the class classify.ts already distinguishes from a broken locator
// or config/quota issue — see src/failure-analysis/classify.ts), collects Jira context for the
// current branch, and asks for a bug-vs-feature-change verdict per failing step.
//
// Deliberately does not act on a YES verdict yet — no fix generation, no PR. That's the
// Intent-Based Testing piece, still unbuilt. This only produces and reports the verdict.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { StepEvent, TestSummaryEvent } from '../observability/types';
import { latestRunFile, readEvents } from '../observability/run-file';
import { groupFailures } from '../failure-analysis/classify';
import { collectJiraContext } from './collect-context';
import { judgeFailure, TriageVerdict } from './verdict';

function currentBranch(): string {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF; // PR branch name in CI
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
}

// classify.ts groups by test, but the verdict prompt needs the specific step that failed (its
// title doubles as the "old step" description) — find the first failed StepEvent belonging to
// each affected testId, from the same run file.
function findFailingStep(steps: StepEvent[], testId: string): StepEvent | undefined {
  return steps.find((s) => s.testId === testId && s.outcome === 'failed');
}

async function main(): Promise<void> {
  const runFile = process.argv[2] ?? latestRunFile();
  if (!runFile) {
    process.stderr.write('[jira-triage] no observability run file found — nothing to triage\n');
    return;
  }

  const events = readEvents(runFile);
  const tests = events.filter((e): e is TestSummaryEvent => e.type === 'test');
  const steps = events.filter((e): e is StepEvent => e.type === 'step');

  const groups = groupFailures(tests).filter((g) => g.category === 'assertion');
  if (groups.length === 0) {
    process.stderr.write('[jira-triage] no assertion failures in this run — nothing to triage\n');
    return;
  }

  const branch = currentBranch();
  process.stderr.write(`[jira-triage] branch: ${branch}\n`);

  const verdicts: (TriageVerdict & { testTitlePath: string })[] = [];

  for (const group of groups) {
    for (const testTitlePath of group.testTitlePaths) {
      const test = tests.find((t) => t.testTitlePath === testTitlePath && t.error);
      const step = test ? findFailingStep(steps, test.testId) : undefined;

      const failureArea = step?.stepTitle ?? testTitlePath;
      const context = await collectJiraContext(branch, failureArea);

      if (!context) {
        process.stderr.write(`[jira-triage] "${testTitlePath}" — no Jira ticket found for branch "${branch}", staying red\n`);
        continue;
      }

      const verdict = await judgeFailure(
        { testTitlePath, stepTitle: step?.stepTitle ?? '(step unknown)', errorMessage: group.sampleMessage },
        context,
      );

      verdicts.push({ ...verdict, testTitlePath });
      process.stderr.write(
        `[jira-triage] "${testTitlePath}" — ${verdict.verdict ? 'YES (feature change)' : 'NO (likely bug)'} — ${verdict.reason} (${verdict.ticketKey})\n`,
      );
    }
  }

  const lines = [
    '## Jira Triage',
    '',
    verdicts.length === 0
      ? 'No assertion failures had a matching Jira ticket — nothing to triage.'
      : verdicts
          .map(
            (v) => `- **${v.testTitlePath}** — ${v.verdict ? 'YES (feature change)' : 'NO (likely bug)'} via ${v.ticketKey}\n  ${v.reason}`,
          )
          .join('\n'),
    '',
  ].join('\n');

  process.stdout.write(lines);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines);
  }
}

main().catch((err) => {
  process.stderr.write(`[jira-triage] failed: ${err.message}\n`);
  process.exitCode = 1;
});
