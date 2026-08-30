// Shared 4-tier agentic CLI fallback: Claude (Sonnet 5, middle effort) primary -> up to three
// Gemini tiers. Used by any module that needs an AI CLI to read/edit files directly
// (test-evolution, agent-fixer's fallback layer) — not by healwright, whose own AnthropicProvider
// goes through the official Anthropic SDK and needs a paid ANTHROPIC_API_KEY we don't have (see
// README "Not yet built" — this stays a deliberate gap, not an oversight).
//
// The Claude tier authenticates via the existing Claude Code CLI subscription session, no
// separate API key (confirmed working with no ANTHROPIC_API_KEY set in this project's env). Each
// Gemini tier is intended to be its own per-model quota — the account's Google AI Studio project
// this repo was configured against lists 1500 requests/day · 15/minute per model (per the
// project owner, not independently re-derived from a full day of API traffic here).
//
// That separation only holds if the `gemini` CLI actually authenticates with a real, keyed
// request. It does NOT read AI_API_KEY on its own — it reads GEMINI_API_KEY. Before this fix,
// runGemini() never set that variable explicitly and relied on child-process env inheritance,
// which never included it under that name — so the CLI silently fell back to a different,
// unkeyed auth path with a much lower limit (confirmed live: repeated 429s at a small, short-
// window limit, unrelated to which model was requested — the 429 body's `model:` field names the
// quota metric being hit, not necessarily the model actually routed to; requesting
// gemini-3.5-flash, gemini-3.6-flash, and gemini-3.5-flash-lite by name with a real key DID
// produce three distinct responses, so -m is honored — it was only the unkeyed path where the
// model choice didn't matter).
//
// Passing a distinct API key per tier (AI_AGENTS_GEMINI_API_KEY(_FALLBACK[_2]), see
// resolveGeminiApiKey() below) buys real cross-PROJECT independence: confirmed live — a call on
// tier 1's key hit that key's short-window limit while the very next call, same session, on a
// DIFFERENT key for tier 2, succeeded immediately. Whether sharing one key across all three model
// names also gives each model its own separate allowance (vs. one pool split three ways) was not
// conclusively isolated here; per-tier keys sidestep the question rather than resolve it. An
// unconfigured tier falls back to whichever key was last configured (then AI_API_KEY). If NO key
// resolves at all, it fails loudly instead of silently degrading to the unkeyed path again — same
// reasoning as reviewer-tests.ts's requireProfileVar.

import { execFileSync } from 'child_process';
import { recordAiUsage } from './usage-log';

const CLAUDE_MODEL = process.env.AI_AGENTS_CLAUDE_TIER ?? 'sonnet'; // Sonnet 5 by default
const CLAUDE_EFFORT = process.env.AI_AGENTS_CLAUDE_EFFORT ?? 'medium';

// Same 5-minute default goal-evolution/run.ts's own ATTEMPT_TIMEOUT_MS already uses for a single
// Claude generation attempt — reused here as the project's one standard "how long is one AI CLI
// call allowed to run" figure, rather than inventing a second number. Previously the Gemini tiers
// had NO timeout at all (only the caller-supplied timeoutMs applied to the Claude tier), so a
// hung `gemini` CLI process — confirmed to happen live: see CLAUDE.local.md's session notes on a
// tier that sat at 0% CPU for minutes mid-retry — blocked the entire fallback chain indefinitely.
// Configurable via AI_AGENTS_GEMINI_TIMEOUT_MS for a slower/faster environment; not tied to the
// caller's own timeoutMs param (that one is Claude-attempt-specific and optional).
const GEMINI_TIMEOUT_MS = Number(process.env.AI_AGENTS_GEMINI_TIMEOUT_MS) || 5 * 60 * 1000;

interface GeminiTier {
  model: string;
  /** This tier's own API key, if one was configured — see resolveGeminiApiKey(). */
  apiKey: string | undefined;
}

// Three free-tier Gemini models, intended to each carry their own quota (see header comment for
// what that claim rests on) — tried in order, only advancing to the next on an actual failure. Deliberately
// its own env var prefix (AI_AGENTS_*), not AI_MODEL/AI_MODEL_FALLBACK: those are healwright's own
// model settings, and sharing them here would mean an agentic-edit run competes with every
// healwright heal call for the same daily allowance.
const GEMINI_TIERS: GeminiTier[] = dedupeByModel([
  { model: process.env.AI_AGENTS_MODEL ?? 'gemini-3.5-flash', apiKey: process.env.AI_AGENTS_GEMINI_API_KEY },
  {
    model: process.env.AI_AGENTS_MODEL_FALLBACK ?? process.env.AI_MODEL_FALLBACK ?? 'gemini-3.6-flash',
    apiKey: process.env.AI_AGENTS_GEMINI_API_KEY_FALLBACK,
  },
  { model: process.env.AI_AGENTS_MODEL_FALLBACK_2 ?? 'gemini-3.5-flash-lite', apiKey: process.env.AI_AGENTS_GEMINI_API_KEY_FALLBACK_2 },
]);

function dedupeByModel(tiers: GeminiTier[]): GeminiTier[] {
  const seen = new Set<string>();
  return tiers.filter((t) => (seen.has(t.model) ? false : (seen.add(t.model), true)));
}

// Resolves the key for a given tier index: that tier's own configured key, else the nearest
// EARLIER tier's key that was configured (so an unconfigured later tier reuses the previous tier's
// project rather than going unkeyed), else AI_API_KEY as the last resort (this project's own
// generic var name, kept for backward compatibility with a single-key setup).
function resolveGeminiApiKey(tierIndex: number): string {
  for (let i = tierIndex; i >= 0; i--) {
    const key = GEMINI_TIERS[i]?.apiKey;
    if (key) return key;
  }
  const fallback = process.env.GEMINI_API_KEY ?? process.env.AI_API_KEY;
  if (!fallback) {
    throw new Error(
      'No API key resolves for this Gemini tier (checked AI_AGENTS_GEMINI_API_KEY[_FALLBACK[_2]], ' +
        'GEMINI_API_KEY, AI_API_KEY) — refusing to invoke the gemini CLI unkeyed, since without a key ' +
        'it silently falls back to an unkeyed auth path with a much lower request limit, defeating ' +
        'the whole point of per-tier quotas.',
    );
  }
  return fallback;
}

export interface AgenticProfile {
  /** Tools/commands the CLI agent may use, in each CLI's own flag syntax. */
  geminiAllowedTools: string;
  claudeAllowedTools: string;
  /** gemini: '--approval-mode auto_edit' style trust; claude: '--permission-mode acceptEdits' style. */
  claudePermissionMode: string;
}

export const DEFAULT_PROFILE: AgenticProfile = {
  geminiAllowedTools: 'read_file,write_file,edit,glob,grep',
  claudeAllowedTools: 'Read,Write,Edit,Glob,Grep',
  claudePermissionMode: process.env.AI_AGENTS_PERMISSION_MODE ?? 'acceptEdits',
};

// Thrown when a CLI call is killed by its own wall-clock budget (timeoutMs), never by the CLI's
// own exit code. Kept distinct from a plain Error so callers (and the fallback logic below) can
// tell "this tier ran out of time" apart from "this tier failed" — a timeout is a budget decision
// the caller made, not evidence the model/provider is broken, so it must never silently burn the
// remaining fallback tiers the way an auth/quota/outage failure correctly does.
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
function isTimeoutError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { killed?: boolean };
  return e.killed === true || e.code === 'ETIMEDOUT';
}

// Claude CLI's --output-format json result line carries usage/total_cost_usd directly (no
// separate metrics call, no estimation from a public price list) — see usage-log.ts's header for
// why this exists. Only the fields this module actually reads are typed; the CLI's json result has
// many more (see README/CLAUDE.local.md notes on other fields like subagent_stats, service_tier).
interface ClaudeJsonResult {
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
      throw new CliTimeoutError(`claude (${CLAUDE_MODEL}, effort ${CLAUDE_EFFORT})`, timeoutMs as number);
    }
    throw err;
  }
}

// execFileSync throws on a nonzero exit before this ever runs, and a killed-by-timeout process
// produces no captured stdout at all — so a parse failure here only happens if the CLI's JSON
// shape itself changes. Usage logging is diagnostic, not correctness-critical, so a malformed
// result degrades to "no usage recorded for this call" rather than failing the whole operation.
function parseClaudeJson(stdout: string): ClaudeJsonResult | undefined {
  try {
    return JSON.parse(stdout) as ClaudeJsonResult;
  } catch {
    process.stderr.write('[cli-fallback] could not parse Claude CLI JSON output — usage not recorded for this call\n');
    return undefined;
  }
}

interface GeminiJsonResult {
  response?: string;
  stats?: {
    models?: Record<string, { tokens?: { input?: number; candidates?: number; total?: number } }>;
  };
}

function runGemini(prompt: string, tierIndex: number, profile: AgenticProfile, caller: string): void {
  const { model } = GEMINI_TIERS[tierIndex];
  const apiKey = resolveGeminiApiKey(tierIndex);
  const startedAt = Date.now();
  let stdout = '';
  try {
    stdout = execFileSync(
      'gemini',
      ['-p', prompt, '-m', model, '--approval-mode', 'auto_edit', '--skip-trust', '--allowed-tools', profile.geminiAllowedTools, '-o', 'json'],
      // execFileSync's `env` REPLACES the child's environment rather than merging — spread
      // process.env first or the child loses PATH/HOME and fails in ways that look nothing like an
      // auth problem. GEMINI_API_KEY is set explicitly (not just relied on via inheritance) because
      // this project's own var name is AI_API_KEY, which the gemini CLI does not recognize on its
      // own — see the header comment for what silently broke before this was added.
      {
        stdio: ['inherit', 'pipe', 'inherit'],
        env: { ...process.env, GEMINI_API_KEY: apiKey },
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: GEMINI_TIMEOUT_MS,
      },
    );
    const parsed = parseGeminiJson(stdout);
    if (parsed?.response) process.stdout.write(parsed.response + '\n');
    const tokens = parsed?.stats?.models?.[model]?.tokens;
    recordAiUsage({
      caller,
      provider: 'gemini',
      model,
      tierIndex: tierIndex + 1, // tier 0 is always the Claude call in the usage log — see recordAiUsage callers
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      inputTokens: tokens?.input,
      outputTokens: tokens?.candidates,
      // Gemini's json output reports token counts only, no dollar figure (unlike Claude's
      // total_cost_usd) — costUsd is deliberately left undefined rather than estimated from an
      // unverified public price list, per usage-log.ts's field comment.
    });
  } catch (err) {
    // Same isTimeoutError() check the Claude tier's own timeout uses (see runClaude and that
    // function's doc comment for why both `killed` and `code: 'ETIMEDOUT'` must be checked) — a
    // hung gemini process gets SIGTERM'd here instead of blocking the fallback chain forever.
    // Deliberately logged as plain 'timeout' outcome, NOT thrown as CliTimeoutError: that class's
    // whole contract (see its doc comment) is "re-thrown immediately, never falls through to the
    // Gemini tiers" — which only makes sense for the Claude tier deciding whether to fall through
    // TO Gemini. A Gemini tier timing out should behave exactly like any other Gemini tier
    // failure: move on to the next tier, or exhaust the chain — not propagate a Claude-specific
    // signal type past this function.
    const isTimeout = isTimeoutError(err);
    recordAiUsage({
      caller,
      provider: 'gemini',
      model,
      tierIndex: tierIndex + 1,
      outcome: isTimeout ? 'timeout' : 'failure',
      durationMs: Date.now() - startedAt,
      failureReason: isTimeout ? `did not finish within ${GEMINI_TIMEOUT_MS}ms` : (err as Error).message?.split('\n')[0],
    });
    throw err;
  }
}

function parseGeminiJson(stdout: string): GeminiJsonResult | undefined {
  try {
    return JSON.parse(stdout) as GeminiJsonResult;
  } catch {
    process.stderr.write('[cli-fallback] could not parse Gemini CLI JSON output — usage not recorded for this call\n');
    return undefined;
  }
}

// Tries Claude (Sonnet 5, middle effort) first, then each Gemini tier in GEMINI_TIERS order —
// each tier only reached when the previous one throws. Output is captured (not streamed live)
// so usage/cost can be parsed from each CLI's --output-format json result — see runClaude/
// runGemini — with the model's final text reply re-printed to stdout so a live run still shows
// output on the terminal.
//
// timeoutMs (caller-supplied, optional) bounds the Claude tier only; Gemini tiers are bounded
// separately by GEMINI_TIMEOUT_MS (see that constant — a fixed 5-minute default, independent of
// whatever timeoutMs the caller passed for Claude). Every tier is timeout-bounded now; previously
// only Claude was, and a hung Gemini CLI blocked the whole chain indefinitely (see GEMINI_TIMEOUT_MS's
// comment). A Claude-tier timeout is re-thrown immediately as CliTimeoutError rather than falling
// through to Gemini — see that class's doc comment. A Gemini-tier timeout is NOT a
// CliTimeoutError — it's treated like any other Gemini failure and simply advances to the next
// tier (see runGemini's catch block for why the two cases are handled differently).
// `caller` identifies which module made the call (e.g. 'test-evolution', 'agent-fixer',
// 'goal-evolution') purely for cost attribution in .observability/ai-usage.jsonl — see
// usage-log.ts. Defaults to 'unknown' rather than being required, so this stays backward-
// compatible with any call site that predates cost tracking.
export function runAgenticEdit(prompt: string, profile: AgenticProfile = DEFAULT_PROFILE, timeoutMs?: number, caller = 'unknown'): void {
  try {
    runClaude(prompt, profile, caller, timeoutMs);
    return;
  } catch (err) {
    if (err instanceof CliTimeoutError) throw err;
    process.stderr.write(`[cli-fallback] claude (${CLAUDE_MODEL}, effort ${CLAUDE_EFFORT}) failed (${(err as Error).message.split('\n')[0]}) — retrying with Gemini\n`);
  }

  const failures: string[] = [];
  for (let i = 0; i < GEMINI_TIERS.length; i++) {
    const { model } = GEMINI_TIERS[i];
    try {
      runGemini(prompt, i, profile, caller);
      return;
    } catch (err) {
      const reason = (err as Error).message.split('\n')[0];
      process.stderr.write(`[cli-fallback] ${model} failed (${reason})\n`);
      failures.push(`${model}: ${reason}`);
    }
  }

  throw new Error(`claude and all ${GEMINI_TIERS.length} Gemini tiers failed:\n- ${failures.join('\n- ')}`);
}
