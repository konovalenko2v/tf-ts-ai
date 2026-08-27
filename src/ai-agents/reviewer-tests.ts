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

export type Severity = 'ok' | 'minor' | 'major';

export interface ReviewFinding {
  check: string;
  severity: Severity;
  note: string;
}

export interface ReviewVerdict {
  verdict: boolean;
  findings: ReviewFinding[];
}

// Renders the structured verdict as short markdown bullets for a human skimming a PR body —
// one line per check, severity tag up front, no run-on prose. See ai-agents/personas/reviewer-tests.md
// "Output contract" for why: a single "one sentence" reason field made a 4-part review
// (architecture/style/assertion-honesty/cleanup) unreadable once more than one check had a finding.
export function renderVerdict(v: ReviewVerdict): string {
  const icon: Record<Severity, string> = { ok: '✅', minor: '⚠️', major: '❌' };
  const lines = v.findings.map((f) => `- ${icon[f.severity]} **${f.check}**: ${f.note}`);
  return [`**Overall: ${v.verdict ? '✅ YES — safe to propose as-is' : '❌ NO — needs a look before merging'}**`, '', ...lines].join('\n');
}

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
  const text = execFileSync(
    'claude',
    ['-p', prompt, '--model', REVIEW_CLAUDE_TIER, '--effort', REVIEW_CLAUDE_EFFORT, '--permission-mode', 'plan', '--allowedTools', 'Read,Grep,Glob'],
    { encoding: 'utf-8' },
  );

  const verdictMatch = text.match(/VERDICT:\s*(YES|NO)/i);
  if (!verdictMatch) {
    throw new Error(`Could not parse a VERDICT line from claude's response: ${text}`);
  }

  const findingLines = [...text.matchAll(/^-\s*\[(ok|minor|major)\]\s*([^:]+):\s*(.+)$/gim)];
  const findings: ReviewFinding[] = findingLines.map((m) => ({
    severity: m[1].toLowerCase() as Severity,
    check: m[2].trim(),
    note: m[3].trim(),
  }));

  if (findings.length === 0) {
    throw new Error(`VERDICT line found but no [ok|minor|major] bullets parsed from claude's response: ${text}`);
  }

  return {
    verdict: verdictMatch[1].toUpperCase() === 'YES',
    findings,
  };
}
