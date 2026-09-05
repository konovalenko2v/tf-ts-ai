// reviewer-tests: reads a test file test-developer already wrote and that already passed a real
// run, and returns a VERDICT/REASON verdict from Claude (Sonnet, high effort) via the claude CLI.
// Paranoid-profile gate: read-only, never edits the file — Claude here is only ever asked to
// answer a question, never given write access.
//
// Deliberately a stronger/differently-configured Claude call than generation: test-developer runs
// Claude at --effort medium (cli-fallback.ts, cheap.env's AI_AGENTS_CLAUDE_EFFORT); a cheap-effort
// pass reviewing its own cheap-effort output defeats the purpose of a paranoid pass. Uses the CLI
// (same auth as generation — no separate paid API key) rather than the Gemini REST helper
// (gemini-text.ts) other verdict callers (jira-triage, qa-analyst) use, so it can run on Claude
// specifically instead of Gemini.
//
// Loads ai-agents/profiles/paranoid.env itself (rather than requiring the caller to `source` it
// first) — a review step that silently falls back to generation-tier settings when the profile
// isn't manually sourced defeats the entire point of a separate review tier, so this can't depend
// on an operator remembering an extra shell step.

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { parseClaudeJson } from './cli-fallback';
import { recordAiUsage } from './usage-log';
import { ReviewVerdict, parseReviewVerdict } from './review-verdict';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/reviewer-tests.md');
const PROFILE_FILE = path.join(__dirname, '../../ai-agents/profiles/paranoid.env');

function loadProfileVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(PROFILE_FILE)) return undefined;
  const line = fs
    .readFileSync(PROFILE_FILE, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  return line?.split('=')[1]?.trim();
}

function requireProfileVar(name: string): string {
  const value = loadProfileVar(name);
  if (!value) {
    throw new Error(
      `${name} is not set and could not be read from ${PROFILE_FILE} — refusing to silently fall back to ` +
        'generation-tier settings, since that would let the review run at the same effort as the code it reviews.',
    );
  }
  return value;
}

const REVIEW_CLAUDE_TIER = requireProfileVar('AI_REVIEW_CLAUDE_TIER');
const REVIEW_CLAUDE_EFFORT = requireProfileVar('AI_REVIEW_CLAUDE_EFFORT');

// The verdict shape, its markdown renderer, and the VERDICT/bullet parser moved to ./review-verdict
// so pr-reviewer.ts can share ONE copy of the grammar rather than carrying a second, independently
// edited regex for the same `- [ok|minor|major] Check: note` bullets both personas emit. Two
// hand-maintained copies of one string format is the exact drift this repo already got burned by
// once (see CLAUDE.local.md's branch-prefix finding). Re-exported here so existing importers of
// reviewer-tests keep working unchanged.
export { Severity, ReviewFinding, ReviewVerdict, renderVerdict, parseReviewVerdict } from './review-verdict';

export async function reviewGeneratedTest(testFilePath: string, referenceFilePath: string): Promise<ReviewVerdict> {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const generatedCode = fs.readFileSync(testFilePath, 'utf-8');
  const referenceCode = fs.readFileSync(referenceFilePath, 'utf-8');

  const prompt = [
    persona,
    '',
    '---',
    '',
    '## Task',
    '',
    `Reference spec (already-established style/architecture), ${referenceFilePath}:`,
    '```typescript',
    referenceCode,
    '```',
    '',
    `Generated test to review, ${testFilePath}:`,
    '```typescript',
    generatedCode,
    '```',
  ].join('\n');

  // Read-only tools only — reviewer-tests must never edit the file it's reviewing.
  // --output-format json (piped, not inherited) so cost/token usage can be recorded via
  // recordAiUsage — this was previously the one AI call site the cost tracker couldn't see, since
  // it went through 'inherit'-mode execFileSync with no JSON result line to parse. See
  // cli-fallback.ts's runClaude for the identical parse-then-record pattern this mirrors.
  const startedAt = Date.now();
  let stdout: string;
  try {
    stdout = execFileSync(
      'claude',
      [
        '-p',
        prompt,
        '--model',
        REVIEW_CLAUDE_TIER,
        '--effort',
        REVIEW_CLAUDE_EFFORT,
        '--permission-mode',
        'plan',
        '--allowedTools',
        'Read,Grep,Glob',
        '--output-format',
        'json',
      ],
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    recordAiUsage({
      caller: 'reviewer-tests',
      provider: 'claude',
      model: REVIEW_CLAUDE_TIER,
      tierIndex: 0,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
      failureReason: (err as Error).message?.split('\n')[0],
    });
    throw err;
  }

  const parsed = parseClaudeJson(stdout);
  recordAiUsage({
    caller: 'reviewer-tests',
    provider: 'claude',
    model: REVIEW_CLAUDE_TIER,
    tierIndex: 0,
    outcome: 'success',
    durationMs: Date.now() - startedAt,
    inputTokens: parsed?.usage?.input_tokens,
    outputTokens: parsed?.usage?.output_tokens,
    cacheCreationInputTokens: parsed?.usage?.cache_creation_input_tokens,
    cacheReadInputTokens: parsed?.usage?.cache_read_input_tokens,
    costUsd: parsed?.total_cost_usd,
  });

  // Echo the model's reply to stdout, same as before this switched to --output-format json (which
  // captures stdout via 'pipe' to get the JSON result line, so nothing reaches the terminal on its
  // own anymore) — mirrors cli-fallback.ts's runClaude doing the same for the identical reason.
  if (parsed?.result) process.stdout.write(parsed.result + '\n');

  // If parsing failed, cite the raw stdout (not the now-empty parsed text) so the error still
  // carries something to debug from — parseClaudeJson already logged its own parse-failure line.
  if (!parsed) {
    throw new Error(`Could not parse claude's --output-format json response: ${stdout}`);
  }

  return parseReviewVerdict(parsed.result ?? '');
}
