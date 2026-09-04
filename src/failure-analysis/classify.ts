import { StepEvent, TestSummaryEvent } from '../observability/types';
import { HealEvent, healEventsInWindow, renderStrategy } from './heal-events';

export type FailureCategory = 'config' | 'ai-quota' | 'ai-healing' | 'assertion' | 'other';

export interface FailureGroup {
  category: FailureCategory;
  signature: string;
  count: number;
  testTitlePaths: string[];
  sampleMessage: string;
  /** true if every test in this group eventually passed on a later retry — a real bug still failed at least once. */
  allFlaky: boolean;
}

// Groups failed tests by a normalized error signature — the first line of the error message,
// with dynamic values (numbers, quoted strings, env var names) stripped so that the same failure
// on different tests collapses into one group instead of one row per test.
function normalizeSignature(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  return firstLine
    .replace(/`[^`]*`/g, '`…`')
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\b\d+\b/g, 'N')
    .trim();
}

function categorize(message: string, stackTop: string[] | undefined): FailureCategory {
  if (message.includes('Test Run Error! Please check env variable')) return 'config';
  // Distinguished from a genuine healing failure: RESOURCE_EXHAUSTED means the AI provider's
  // daily quota ran out before it could even attempt a strategy, not that it tried and failed.
  if (message.includes('HealError')) {
    return message.includes('RESOURCE_EXHAUSTED') || message.includes('"code":429') ? 'ai-quota' : 'ai-healing';
  }
  if ((stackTop ?? []).some((f) => f.includes('healwright'))) return 'ai-healing';
  if (/^Error: expect/.test(message) || message.includes('toBe') || message.includes('toEqual')) {
    return 'assertion';
  }
  return 'other';
}

// Playwright retries a failing test up to 3x, each producing its own TestSummaryEvent with the
// same testId — dedupe to one row per unique test before grouping, otherwise a single flaky test
// inflates a group's count by its retry count.
function latestAttemptPerTest(tests: TestSummaryEvent[]): TestSummaryEvent[] {
  const byTestId = new Map<string, TestSummaryEvent>();
  for (const t of tests) {
    const existing = byTestId.get(t.testId);
    if (!existing || t.retry > existing.retry) byTestId.set(t.testId, t);
  }
  return [...byTestId.values()];
}

// Playwright's `outcome` describes the whole test case, not one attempt: a test that failed at
// retry 0 and passed at retry 1 is tagged 'flaky' on every attempt record, including the final
// passing one (which carries no `error`). Use the last *failing* attempt to report what broke.
function lastFailingAttempt(tests: TestSummaryEvent[], testId: string): TestSummaryEvent | undefined {
  return tests.filter((t) => t.testId === testId && t.error).sort((a, b) => b.retry - a.retry)[0];
}

export function groupFailures(tests: TestSummaryEvent[]): FailureGroup[] {
  const latest = latestAttemptPerTest(tests);
  const unexpected = latest.filter((t) => t.outcome === 'unexpected' && t.error).map((t) => ({ t, flaky: false }));
  const flakyWithError = latest
    .filter((t) => t.outcome === 'flaky')
    .map((t) => lastFailingAttempt(tests, t.testId))
    .filter((t): t is TestSummaryEvent => !!t)
    .map((t) => ({ t, flaky: true }));

  const groups = new Map<string, FailureGroup>();

  for (const { t, flaky } of [...unexpected, ...flakyWithError]) {
    const message = t.error!.message;
    const signature = normalizeSignature(message);
    const category = categorize(message, t.error!.stackTop);
    const key = `${category}::${signature}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.testTitlePaths.push(t.testTitlePath);
      existing.allFlaky = existing.allFlaky && flaky;
    } else {
      groups.set(key, {
        category,
        signature,
        count: 1,
        testTitlePaths: [t.testTitlePath],
        sampleMessage: message,
        allFlaky: flaky,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export interface HealedLocator {
  contextName: string;
  newLocator: string;
  confidence?: number;
  why?: string;
  used: 'healed' | 'cache';
}

export interface RecoverySummary {
  testTitlePath: string;
  stepTitle: string;
  recoveredSelectors: string[];
  healedLocators: HealedLocator[];
}

// Same latent-brittleness signal agent-fixer consumes, surfaced here for a human-readable report
// instead of an automated code fix. heal_events.jsonl carries the replacement locator and the
// AI's own confidence/rationale — neither is in the observability step event, which only records
// the selector(s) that *failed* — so this joins the two by matching each heal event's timestamp
// against the step's [startedAt, startedAt+durationMs) window (the file has no run id to key on).
export function summarizeRecoveries(steps: StepEvent[], healEvents: HealEvent[] = []): RecoverySummary[] {
  return steps
    .filter((s) => s.outcome === 'passed_with_recovery')
    .map((s) => {
      // readHealEvents already filters to success && strategy present, but TS can't see that
      // across the module boundary — narrow again here rather than widening HealEvent's type.
      const inWindow = healEventsInWindow(healEvents, s.startedAt, s.durationMs).filter((e) => e.strategy);
      return {
        testTitlePath: s.testTitlePath,
        stepTitle: s.stepTitle,
        recoveredSelectors: [...new Set((s.recoveredErrors ?? []).map((e) => e.selector).filter((s): s is string => !!s))],
        healedLocators: inWindow.map((e) => ({
          contextName: e.contextName,
          newLocator: renderStrategy(e.strategy!),
          confidence: e.confidence,
          why: e.why,
          used: e.used,
        })),
      };
    });
}
