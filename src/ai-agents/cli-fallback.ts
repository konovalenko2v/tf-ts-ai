// Claude-only agentic CLI call: authenticates via the existing Claude Code CLI subscription
// session, no separate API key (confirmed working with no ANTHROPIC_API_KEY set in this project's
// env). Used by any module that needs an AI CLI to read/edit files directly (test-evolution,
// agent-fixer) — not by healwright, whose provider config is set separately (see src/ui/fixtures.ts).
//
// This is the claude-only-edition of the framework: no Gemini fallback tiers, no paid Anthropic
// API key. If the `claude` CLI call fails, it fails loud — there is nothing left to fall back to.

import { execFileSync } from 'child_process';
import { recordAiUsage } from './usage-log';

const CLAUDE_MODEL = process.env.AI_AGENTS_CLAUDE_TIER ?? 'sonnet'; // Sonnet 5 by default
const CLAUDE_EFFORT = process.env.AI_AGENTS_CLAUDE_EFFORT ?? 'medium';

export interface AgenticProfile {
  /** Tools/commands the CLI agent may use, in the CLI's own flag syntax. */
  claudeAllowedTools: string;
  /** claude: '--permission-mode acceptEdits' style trust. */
  claudePermissionMode: string;
}

export const DEFAULT_PROFILE: AgenticProfile = {
  claudeAllowedTools: 'Read,Write,Edit,Glob,Grep',
  claudePermissionMode: process.env.AI_AGENTS_PERMISSION_MODE ?? 'acceptEdits',
};

// Thrown when a CLI call is killed by its own wall-clock budget (timeoutMs), never by the CLI's
// own exit code. Kept distinct from a plain Error so callers can tell "this call ran out of time"
// apart from "this call failed".
export class CliTimeoutError extends Error {
  constructor(tier: string, timeoutMs: number) {
    super(`${tier} did not finish within ${timeoutMs}ms`);
    this.name = 'CliTimeoutError';
  }
}

// execFileSync's `timeout` option surfaces a killed child TWO different ways depending on how
// close the process got to actually starting before the deadline hit — confirmed by live testing
// (not just reading Node's docs): a short-enough timeout throws an error with `code: 'ETIMEDOUT'`
// and no `killed` flag at all (the child never got far enough to be meaningfully "killed"), while
// a timeout that fires after the child is genuinely running sets `killed: true` (with SIGTERM).
// Checking only `killed` — the original implementation here — silently mis-recorded the
// ETIMEDOUT case as a plain 'failure' rather than 'timeout' in the usage log, which would make a
// real timeout invisible in .observability/ai-usage.jsonl's outcome breakdown. Both signals are
// checked so either shape of "the process didn't finish in time" is classified the same way.
export function isTimeoutError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as NodeJS.ErrnoException & { killed?: boolean };
  return e.killed === true || e.code === 'ETIMEDOUT';
}

// Claude CLI's --output-format json result line carries usage/total_cost_usd directly (no
// separate metrics call, no estimation from a public price list) — see usage-log.ts's header for
// why this exists. Only the fields this module actually reads are typed; the CLI's json result has
// many more (see README/CLAUDE.local.md notes on other fields like subagent_stats, service_tier).
export interface ClaudeJsonResult {
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  result?: string;
}

function runClaude(prompt: string, profile: AgenticProfile, caller: string, timeoutMs?: number): void {
  const startedAt = Date.now();
  let stdout = '';
  try {
    // Captured via 'pipe' (not 'inherit') specifically so the --output-format json result line can
    // be parsed for usage/cost — see the ClaudeJsonResult comment. The result's own `result` field
    // (the model's final text reply) is echoed to stdout below so a live run still shows output on
    // the terminal, same as 'inherit' did before this change.
    stdout = execFileSync(
      'claude',
      [
        '-p',
        prompt,
        '--model',
        CLAUDE_MODEL,
        '--effort',
        CLAUDE_EFFORT,
        '--permission-mode',
        profile.claudePermissionMode,
        '--allowedTools',
        profile.claudeAllowedTools,
        '--output-format',
        'json',
      ],
      { stdio: ['inherit', 'pipe', 'inherit'], timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    const parsed = parseClaudeJson(stdout);
    if (parsed?.result) process.stdout.write(parsed.result + '\n');
    recordAiUsage({
      caller,
      provider: 'claude',
      model: CLAUDE_MODEL,
      tierIndex: 0,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      inputTokens: parsed?.usage?.input_tokens,
      outputTokens: parsed?.usage?.output_tokens,
      cacheCreationInputTokens: parsed?.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: parsed?.usage?.cache_read_input_tokens,
      costUsd: parsed?.total_cost_usd,
    });
  } catch (err) {
    const isTimeout = !!timeoutMs && isTimeoutError(err);
    recordAiUsage({
      caller,
      provider: 'claude',
      model: CLAUDE_MODEL,
      tierIndex: 0,
      outcome: isTimeout ? 'timeout' : 'failure',
      durationMs: Date.now() - startedAt,
      failureReason: (err as Error).message?.split('\n')[0],
    });
    if (isTimeout) {
      throw new CliTimeoutError(`claude (${CLAUDE_MODEL}, effort ${CLAUDE_EFFORT})`, timeoutMs);
    }
    throw err;
  }
}

// execFileSync throws on a nonzero exit before this ever runs, and a killed-by-timeout process
// produces no captured stdout at all — so a parse failure here only happens if the CLI's JSON
// shape itself changes. Usage logging is diagnostic, not correctness-critical, so a malformed
// result degrades to "no usage recorded for this call" rather than failing the whole operation.
export function parseClaudeJson(stdout: string): ClaudeJsonResult | undefined {
  try {
    return JSON.parse(stdout) as ClaudeJsonResult;
  } catch {
    process.stderr.write('[cli-fallback] could not parse Claude CLI JSON output — usage not recorded for this call\n');
    return undefined;
  }
}

// `caller` identifies which module made the call (e.g. 'test-evolution', 'agent-fixer',
// 'goal-evolution') purely for cost attribution in .observability/ai-usage.jsonl — see
// usage-log.ts. Defaults to 'unknown' rather than being required, so this stays backward-
// compatible with any call site that predates cost tracking.
export function runAgenticEdit(prompt: string, profile: AgenticProfile = DEFAULT_PROFILE, timeoutMs?: number, caller = 'unknown'): void {
  runClaude(prompt, profile, caller, timeoutMs);
}
