import * as fs from 'fs';
import * as path from 'path';
import { ObservabilityEvent } from './types';

const OBSERVABILITY_DIR = '.observability';

export function latestRunFile(): string | undefined {
  if (!fs.existsSync(OBSERVABILITY_DIR)) return undefined;
  const files = fs
    .readdirSync(OBSERVABILITY_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(OBSERVABILITY_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

export function readEvents(file: string): ObservabilityEvent[] {
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l) as ObservabilityEvent);
}
