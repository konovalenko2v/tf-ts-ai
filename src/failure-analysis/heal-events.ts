// healwright writes .self-heal/heal_events.jsonl on every heal attempt, append-only across every
// run on this machine — it carries contextName, the winning strategy, confidence, and the AI's
// own rationale ("why"), none of which the observability layer captures (StepEvent only knows the
// selector that *failed*, never the one healwright resolved to). This module joins the two: a
// passed_with_recovery step's [startedAt, startedAt+durationMs) window is matched against heal
// events whose timestamp falls inside it — the file has no run id, so the time window is the only
// correlation key available, and it's exact since both come from the same process/run.

import * as fs from 'fs';

// A failed heal attempt writes `error` instead of `strategy`/`confidence`/`why` — those three are
// only present when `success: true`. Only successful events are useful for "old → new" reporting.
export interface HealEvent {
  ts: string;
  url: string;
  contextName: string;
  used: 'healed' | 'cache';
  success: boolean;
  error?: string;
  confidence?: number;
  why?: string;
  strategy?: {
    type: string;
    role?: string | null;
    name?: string | null;
    selector?: string | null;
    text?: string | null;
    value?: string | null;
    exact?: boolean | null;
  };
}

export function readHealEvents(file: string): HealEvent[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as HealEvent)
    .filter((e) => e.success && e.strategy);
}

export function healEventsInWindow(events: HealEvent[], startedAt: string, durationMs: number): HealEvent[] {
  const start = new Date(startedAt).getTime();
  const end = start + durationMs;
  return events.filter((e) => {
    const t = new Date(e.ts).getTime();
    return t >= start && t <= end;
  });
}

export function renderStrategy(strategy: NonNullable<HealEvent['strategy']>): string {
  switch (strategy.type) {
    case 'role':
      return strategy.exact
        ? `getByRole('${strategy.role}', { name: '${strategy.name}', exact: true })`
        : `getByRole('${strategy.role}', { name: '${strategy.name}' })`;
    case 'testid':
      return `getByTestId('${strategy.value}')`;
    case 'label':
      return `getByLabel('${strategy.text}')`;
    case 'placeholder':
      return `getByPlaceholder('${strategy.text}')`;
    case 'text':
      return `getByText('${strategy.text}')`;
    case 'altText':
      return `getByAltText('${strategy.text}')`;
    case 'title':
      return `getByTitle('${strategy.text}')`;
    case 'css':
      return `locator('${strategy.selector}')`;
    default:
      return `<unknown strategy: ${strategy.type}>`;
  }
}
