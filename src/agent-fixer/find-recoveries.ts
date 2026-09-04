import { StepEvent, TestSummaryEvent } from '../observability/types';
import { latestRunFile, readEvents } from '../observability/run-file';

export function findRecoveries(runFile?: string): StepEvent[] {
  const file = runFile ?? latestRunFile();
  if (!file) return [];
  return readEvents(file).filter((e): e is StepEvent => e.type === 'step' && e.outcome === 'passed_with_recovery');
}

// A recovered step's testId identifies the test attempt it belongs to; the screenshot Playwright
// captured for that same attempt lives in the test-level summary record, not the step record.
export function findScreenshotForTest(testId: string, runFile?: string): string | undefined {
  const file = runFile ?? latestRunFile();
  if (!file) return undefined;
  const testEvent = readEvents(file).find((e): e is TestSummaryEvent => e.type === 'test' && e.testId === testId);
  return testEvent?.artifacts.find((a) => a.name === 'screenshot')?.path;
}

if (require.main === module) {
  const recoveries = findRecoveries();
  process.stdout.write(JSON.stringify(recoveries, null, 2) + '\n');
  process.stderr.write(`[agent-fixer] found ${recoveries.length} recovered step(s)\n`);
}
