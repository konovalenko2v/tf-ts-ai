import * as fs from 'fs';
import * as path from 'path';
import { ObservabilityEvent, StepEvent } from '../observability/types';

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

export function findRecoveries(runFile?: string): StepEvent[] {
  const file = runFile ?? latestRunFile();
  if (!file) return [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const events = lines.map((l) => JSON.parse(l) as ObservabilityEvent);
  return events.filter(
    (e): e is StepEvent => e.type === 'step' && e.outcome === 'passed_with_recovery',
  );
}

if (require.main === module) {
  const recoveries = findRecoveries();
  process.stdout.write(JSON.stringify(recoveries, null, 2) + '\n');
  process.stderr.write(`[agent-fixer] found ${recoveries.length} recovered step(s)\n`);
}
