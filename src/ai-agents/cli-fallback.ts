// Shared 3-tier agentic CLI fallback: Gemini primary -> Gemini fallback model -> Claude CLI.
// Used by any module that needs an AI CLI to read/edit files directly (test-evolution,
// agent-fixer's fallback layer) — not by healwright, whose own AnthropicProvider goes through
// the official Anthropic SDK and needs a paid ANTHROPIC_API_KEY we don't have (see README
// "Not yet built" — this stays a deliberate gap, not an oversight).
//
// Both Gemini tiers are free-tier CLI calls (share AI_API_KEY, separate daily quotas per model —
// same reasoning as fixtures.ts's withModelFallback). The Claude tier authenticates via the
// existing Claude Code CLI subscription session, no separate API key (confirmed working with no
// ANTHROPIC_API_KEY set in this project's env).

import { execFileSync } from 'child_process';

// Deliberately its own env var, not AI_MODEL: AI_MODEL is healwright's primary model
// (gemini-3.6-flash in CI/most .env setups) and free-tier quotas are tracked per model — sharing
// AI_MODEL here would mean an agentic-edit run competes with every healwright heal call for the
// same daily allowance. AI_AGENTS_MODEL keeps this pipeline's quota separate.
const GEMINI_MODEL = process.env.AI_AGENTS_MODEL ?? 'gemini-3.5-flash';
const GEMINI_MODEL_FALLBACK = process.env.AI_AGENTS_MODEL_FALLBACK ?? process.env.AI_MODEL_FALLBACK;
const CLAUDE_TIER = process.env.AI_AGENTS_CLAUDE_TIER; // e.g. 'sonnet', 'opus' — set by a profile .env

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

function runGemini(prompt: string, model: string, profile: AgenticProfile): void {
  execFileSync(
    'gemini',
    ['-p', prompt, '-m', model, '--approval-mode', 'auto_edit', '--skip-trust', '--allowed-tools', profile.geminiAllowedTools],
    { stdio: 'inherit' },
  );
}

function runClaude(prompt: string, profile: AgenticProfile): void {
  const args = ['-p', prompt, '--permission-mode', profile.claudePermissionMode, '--allowedTools', profile.claudeAllowedTools];
  if (CLAUDE_TIER) args.push('--model', CLAUDE_TIER);
  execFileSync('claude', args, { stdio: 'inherit' });
}

// Tries Gemini primary, then Gemini fallback model (only if configured), then Claude CLI — each
// tier only reached when the previous one throws. stdio: 'inherit' keeps live CLI output on the
// terminal, which means failures are detected by exit code alone, not parsed for a specific error
// (e.g. 429) — any nonzero exit moves to the next tier.
export function runAgenticEdit(prompt: string, profile: AgenticProfile = DEFAULT_PROFILE): void {
  try {
    runGemini(prompt, GEMINI_MODEL, profile);
    return;
  } catch (err) {
    process.stderr.write(`[cli-fallback] ${GEMINI_MODEL} failed (${(err as Error).message.split('\n')[0]})\n`);
  }

  if (GEMINI_MODEL_FALLBACK) {
    try {
      process.stderr.write(`[cli-fallback] retrying with fallback model ${GEMINI_MODEL_FALLBACK}\n`);
      runGemini(prompt, GEMINI_MODEL_FALLBACK, profile);
      return;
    } catch (err) {
      process.stderr.write(`[cli-fallback] ${GEMINI_MODEL_FALLBACK} failed (${(err as Error).message.split('\n')[0]})\n`);
    }
  }

  process.stderr.write('[cli-fallback] both Gemini tiers failed — retrying with claude CLI\n');
  runClaude(prompt, profile);
}
