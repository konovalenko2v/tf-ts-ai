import * as fs from 'fs';
import * as path from 'path';
import { ObservabilityEvent, StepEvent, TestSummaryEvent } from '../observability/types';

const OBSERVABILITY_DIR = '.observability';

function latestRunFile(): string | undefined {
  if (!fs.existsSync(OBSERVABILITY_DIR)) return undefined;
  const files = fs
    .readdirSync(OBSERVABILITY_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(OBSERVABILITY_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

function readEvents(file: string): ObservabilityEvent[] {
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l) as ObservabilityEvent);
}

export function findRecoveries(runFile?: string): StepEvent[] {
  const file = runFile ?? latestRunFile();
  if (!file) return [];
  return readEvents(file).filter(
    (e): e is StepEvent => e.type === 'step' && e.outcome === 'passed_with_recovery',
  );
}

// A recovered step's testId identifies the test attempt it belongs to; the screenshot Playwright
// captured for that same attempt lives in the test-level summary record, not the step record.
export function findScreenshotForTest(testId: string, runFile?: string): string | undefined {
  const file = runFile ?? latestRunFile();
  if (!file) return undefined;
  const testEvent = readEvents(file).find(
    (e): e is TestSummaryEvent => e.type === 'test' && e.testId === testId,
  );
  return testEvent?.artifacts.find((a) => a.name === 'screenshot')?.path;
}

if (require.main === module) {
  const recoveries = findRecoveries();
  process.stdout.write(JSON.stringify(recoveries, null, 2) + '\n');
  process.stderr.write(`[agent-fixer] found ${recoveries.length} recovered step(s)\n`);
}
