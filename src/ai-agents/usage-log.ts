// Cost/token observability for AI CLI calls — a real gap the framework had (see README "Enterprise
// applicability" notes): every runAgenticEdit() call went through `stdio: 'inherit'`, meaning
// neither the prompt, the tier that served it, nor its token/cost usage was ever recorded anywhere.
// On a team scale that makes AI spend impossible to attribute or budget — this module closes that
// specific gap without touching runAgenticEdit's call sites (see cli-fallback.ts).
//
// Written as its own JSONL stream (.observability/ai-usage.jsonl), sibling to the existing
// per-test-run observability (reporter.ts's run-*.jsonl) but deliberately not merged into it: test
// runs and AI-agent invocations have different lifecycles (a single goal-evolution/test-evolution
// run may make 1-4 AI calls across an entire process, not per Playwright test), so a shared runId
// scheme would be forced and not actually meaningful.

import * as fs from 'fs';
import * as path from 'path';

const OBSERVABILITY_DIR = '.observability';
const USAGE_FILE = path.join(OBSERVABILITY_DIR, 'ai-usage.jsonl');

export interface AiUsageEvent {
  type: 'ai-call';
  timestamp: string;
  /** Which module invoked runAgenticEdit — passed by the caller for attribution (e.g. 'test-evolution', 'agent-fixer', 'goal-evolution'). */
  caller: string;
  provider: 'claude' | 'gemini';
  model: string;
  /** Tier index within the fallback chain (0 = primary Claude call, 1+ = Gemini tiers). Lets a report show "how often do we fall past tier N". */
  tierIndex: number;
  outcome: 'success' | 'failure' | 'timeout';
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /** USD, only ever populated for the Claude tier — Claude CLI's --output-format json reports total_cost_usd directly; Gemini's json output does not report a dollar figure, so cost for Gemini calls is left undefined rather than estimated from an unverified public price list. */
  costUsd?: number;
  /** First line only of the failure/timeout reason, if any — enough to classify without logging a full stack trace into a cost-tracking stream. */
  failureReason?: string;
}

export function recordAiUsage(event: Omit<AiUsageEvent, 'type' | 'timestamp'>): void {
  fs.mkdirSync(OBSERVABILITY_DIR, { recursive: true });
  const full: AiUsageEvent = { type: 'ai-call', timestamp: new Date().toISOString(), ...event };
  fs.appendFileSync(USAGE_FILE, JSON.stringify(full) + '\n');
}

export function readAiUsage(): AiUsageEvent[] {
  if (!fs.existsSync(USAGE_FILE)) return [];
  return fs
    .readFileSync(USAGE_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AiUsageEvent);
}
