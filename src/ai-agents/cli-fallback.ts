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

const CLAUDE_MODEL = process.env.AI_AGENTS_CLAUDE_TIER ?? 'sonnet'; // Sonnet 5 by default
const CLAUDE_EFFORT = process.env.AI_AGENTS_CLAUDE_EFFORT ?? 'medium';

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

function runClaude(prompt: string, profile: AgenticProfile, timeoutMs?: number): void {
  try {
    execFileSync(
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
      ],
      { stdio: 'inherit', timeout: timeoutMs },
    );
  } catch (err) {
    // Node sets `killed: true` (and signal SIGTERM) when `timeout` fired, as opposed to the
    // child exiting nonzero on its own — see the CliTimeoutError doc comment for why this
    // distinction has to survive past this function.
    if (timeoutMs && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
      throw new CliTimeoutError(`claude (${CLAUDE_MODEL}, effort ${CLAUDE_EFFORT})`, timeoutMs);
    }
    throw err;
  }
}

function runGemini(prompt: string, tierIndex: number, profile: AgenticProfile): void {
  const { model } = GEMINI_TIERS[tierIndex];
  const apiKey = resolveGeminiApiKey(tierIndex);
  execFileSync(
    'gemini',
    ['-p', prompt, '-m', model, '--approval-mode', 'auto_edit', '--skip-trust', '--allowed-tools', profile.geminiAllowedTools],
    // execFileSync's `env` REPLACES the child's environment rather than merging — spread
    // process.env first or the child loses PATH/HOME and fails in ways that look nothing like an
    // auth problem. GEMINI_API_KEY is set explicitly (not just relied on via inheritance) because
    // this project's own var name is AI_API_KEY, which the gemini CLI does not recognize on its
    // own — see the header comment for what silently broke before this was added.
    { stdio: 'inherit', env: { ...process.env, GEMINI_API_KEY: apiKey } },
  );
}

// Tries Claude (Sonnet 5, middle effort) first, then each Gemini tier in GEMINI_TIERS order —
// each tier only reached when the previous one throws. stdio: 'inherit' keeps live CLI output on
// the terminal, which means failures are detected by exit code alone, not parsed for a specific
// error (e.g. 429) — any nonzero exit moves to the next tier.
//
// timeoutMs is optional and Claude-tier only (deliberately not applied to the Gemini tiers —
// those already only run after Claude already spent up to timeoutMs, and this fallback chain
// exists for auth/quota/outage, not for bounding total wall-clock across all tiers). A timeout is
// re-thrown immediately as CliTimeoutError rather than falling through to Gemini — see that
// class's doc comment.
export function runAgenticEdit(prompt: string, profile: AgenticProfile = DEFAULT_PROFILE, timeoutMs?: number): void {
  try {
    runClaude(prompt, profile, timeoutMs);
    return;
  } catch (err) {
    if (err instanceof CliTimeoutError) throw err;
    process.stderr.write(`[cli-fallback] claude (${CLAUDE_MODEL}, effort ${CLAUDE_EFFORT}) failed (${(err as Error).message.split('\n')[0]}) — retrying with Gemini\n`);
  }

  const failures: string[] = [];
  for (let i = 0; i < GEMINI_TIERS.length; i++) {
    const { model } = GEMINI_TIERS[i];
    try {
      runGemini(prompt, i, profile);
      return;
    } catch (err) {
      const reason = (err as Error).message.split('\n')[0];
      process.stderr.write(`[cli-fallback] ${model} failed (${reason})\n`);
      failures.push(`${model}: ${reason}`);
    }
  }

  throw new Error(`claude and all ${GEMINI_TIERS.length} Gemini tiers failed:\n- ${failures.join('\n- ')}`);
}
