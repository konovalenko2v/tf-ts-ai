// pr-reviewer: reads one pull request's full diff and returns a structured verdict under the
// pr-reviewer persona. Read-only — never edits, pushes to, merges or closes the PR it reviews.
//
// Provider: the Gemini REST helper (gemini-text.ts), NOT the `claude` CLI that reviewer-tests.ts
// uses. That is a CI constraint, not a preference: the GitHub runner has no `claude` binary (the
// agent-fixer job has to `npm install -g @google/gemini-cli` for the same reason) and the repo's
// secrets carry no Anthropic credential — only AI_API_KEY, which is exactly what callGemini reads.
// A blocking gate built on a CLI that cannot authenticate in CI would be red on arrival on every
// PR, which is the failure mode regression.yml's own --max-warnings comment already warns about.
// runAgenticEdit() in cli-fallback.ts was the other candidate and does not fit either: it returns
// void (it exists for agentic FILE EDITS) and this call must return text, from a persona whose
// entire contract is that it never edits a file.
//
// Model pair is passed explicitly rather than defaulting to AI_MODEL/AI_MODEL_FALLBACK: those are
// healwright's own runtime healing allowance (see cli-fallback.ts's header), and a review call
// silently competing with self-healing for the same quota is how one feature starts breaking the
// other. The workflow sets them in the job's env block, same as the jira-triage job does.
//
// ## Exit-code contract (the load-bearing decision here)
//
// This runs as a BLOCKING CI check, so what it does on failure matters more than what it does on
// success. Two conditions are deliberately not the same thing:
//
//   - The review ran and found a `major` problem  -> exit 1. The PR is blocked. That is the point.
//   - The review could not run at all             -> exit 0, loudly. Missing AI_API_KEY, an
//     exhausted quota (documented live in this repo more than once), or output the persona's own
//     grammar can't parse are all facts about the INFRASTRUCTURE, not about the PR. Failing the
//     check on those would turn every PR red for reasons its author cannot fix or act on, and a
//     gate that is red for unrelated reasons is a gate people learn to ignore.
//
// The unavailable path still says so as loudly as it can — stderr line plus a PR comment — so
// "nobody reviewed this" is never silently indistinguishable from "reviewed and clean".

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { callGemini, ModelPair } from './gemini-text';
import { ReviewVerdict, renderVerdict, parseReviewVerdict } from './review-verdict';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/pr-reviewer.md');

// A PR diff has no natural size bound, and this repo already contains a single 53KB file
// (README.md) — one docs-heavy PR could otherwise push a multi-megabyte prompt at the model and
// fail on request size rather than on anything about the code. Truncated rather than sampled, and
// the truncation is ANNOUNCED in the prompt (see buildPrompt) so the persona knows it is judging a
// partial diff instead of confidently reviewing a file whose second half it never saw.
const MAX_DIFF_BYTES = Number(process.env.PR_REVIEW_MAX_DIFF_BYTES) || 200_000;

const MODELS: ModelPair = {
  primary: process.env.AI_MODEL ?? 'gemini-3.6-flash',
  fallback: process.env.AI_MODEL_FALLBACK,
  // callerFrom() derives cost attribution in .observability/ai-usage.jsonl from this tag — see
  // gemini-text.ts. No new field needed for the usage log to break this out per caller.
  logTag: '[pr-reviewer]',
};

/** Why a review could not be produced. Distinct from "the review found problems". */
export class ReviewUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ReviewUnavailableError';
  }
}

export function fetchPrDiff(prNumber: string): string {
  try {
    return execFileSync('gh', ['pr', 'diff', prNumber], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // gh not installed, not authenticated, or the PR doesn't exist — all infrastructure, none of
    // it evidence about the PR's contents.
    throw new ReviewUnavailableError(`could not run \`gh pr diff ${prNumber}\`: ${(err as Error).message.split('\n')[0]}`);
  }
}

export interface TruncatedDiff {
  diff: string;
  truncated: boolean;
  originalBytes: number;
}

export function truncateDiff(diff: string, maxBytes = MAX_DIFF_BYTES): TruncatedDiff {
  const originalBytes = Buffer.byteLength(diff, 'utf-8');
  if (originalBytes <= maxBytes) return { diff, truncated: false, originalBytes };
  return { diff: Buffer.from(diff, 'utf-8').subarray(0, maxBytes).toString('utf-8'), truncated: true, originalBytes };
}

export function buildPrompt(persona: string, prNumber: string, title: string, body: string, diff: TruncatedDiff): string {
  const lines = [
    persona,
    '',
    '---',
    '',
    '## Task',
    '',
    `Review pull request #${prNumber} of this repository.`,
    '',
    `Title: ${title}`,
    '',
    'Description:',
    body.trim() || '(no description given)',
    '',
  ];

  if (diff.truncated) {
    // Stated in the prompt, not just logged locally: a persona that believes it saw the whole diff
    // will happily report `[ok] Scope` on a change whose remaining hunks it never read.
    lines.push(
      `> NOTE: this diff was truncated at ${MAX_DIFF_BYTES} bytes (full diff is ${diff.originalBytes} bytes).`,
      '> Judge only the hunks shown below, and say in your Scope bullet that the diff was truncated.',
      '',
    );
  }

  lines.push('Full diff:', '```diff', diff.diff, '```');
  return lines.join('\n');
}

export async function reviewPullRequest(prNumber: string, title: string, body: string): Promise<ReviewVerdict> {
  if (!process.env.AI_API_KEY) {
    throw new ReviewUnavailableError('AI_API_KEY is not set');
  }

  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const diff = truncateDiff(fetchPrDiff(prNumber));

  if (!diff.diff.trim()) {
    throw new ReviewUnavailableError(`\`gh pr diff ${prNumber}\` returned an empty diff`);
  }

  let text: string;
  try {
    text = await callGemini(buildPrompt(persona, prNumber, title, body, diff), MODELS);
  } catch (err) {
    // callGemini already retried its fallback model on a 429 before throwing, so reaching here
    // means both tiers are unavailable — an infrastructure fact, per the exit-code contract above.
    throw new ReviewUnavailableError(`model call failed: ${(err as Error).message.split('\n')[0]}`);
  }

  try {
    return parseReviewVerdict(text);
  } catch (err) {
    // A formatting slip by the model is not evidence the PR is bad — surfaced as unavailable, not
    // as a blocking finding. See review-verdict.ts's parseReviewVerdict doc comment.
    throw new ReviewUnavailableError(`${(err as Error).message.split('\n')[0]}`);
  }
}

// Best-effort PR comment. Never throws: a missing/insufficient GH_TOKEN must not turn a clean
// review into a failed job, and the verdict is already on stdout and in the step summary.
function comment(prNumber: string, body: string): void {
  try {
    execFileSync('gh', ['pr', 'comment', prNumber, '--body', body], { encoding: 'utf-8' });
  } catch (err) {
    process.stderr.write(`[pr-reviewer] could not post PR comment: ${(err as Error).message.split('\n')[0]}\n`);
  }
}

// Appends to the GitHub Actions job summary when running in CI, so the verdict is visible on the
// run page itself and not only in the raw log. No-op locally.
function writeStepSummary(body: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, body + '\n');
  } catch (err) {
    process.stderr.write(`[pr-reviewer] could not write step summary: ${(err as Error).message.split('\n')[0]}\n`);
  }
}

async function main(): Promise<void> {
  const prNumber = process.argv[2] ?? process.env.PR_NUMBER;
  if (!prNumber) {
    // A genuine usage error (nobody told it what to review), unlike the unavailable cases — this
    // one exits nonzero, since silently reviewing nothing and reporting success would be worse.
    process.stderr.write('Usage: npm run pr-review -- <pr-number>   (or set PR_NUMBER)\n');
    process.exit(1);
  }

  const title = process.env.PR_TITLE ?? '';
  const body = process.env.PR_BODY ?? '';

  let verdict: ReviewVerdict;
  try {
    verdict = await reviewPullRequest(prNumber, title, body);
  } catch (err) {
    if (err instanceof ReviewUnavailableError) {
      const note = `⚠️ **pr-reviewer: review unavailable** — ${err.message}. This is an infrastructure problem, not a finding about this PR; the merge gate does not block on it.`;
      process.stderr.write(`[pr-reviewer] review unavailable: ${err.message}\n`);
      writeStepSummary(`## pr-reviewer\n\n${note}`);
      comment(prNumber, note);
      return; // exit 0 — see the exit-code contract in this file's header.
    }
    throw err;
  }

  const rendered = renderVerdict(verdict);
  process.stdout.write(rendered + '\n');
  writeStepSummary(`## pr-reviewer\n\n${rendered}`);
  comment(prNumber, `🤖 **pr-reviewer** (\`ai-agents/personas/pr-reviewer.md\`)\n\n${rendered}`);

  const majors = verdict.findings.filter((f) => f.severity === 'major');
  if (majors.length > 0) {
    process.stderr.write(`[pr-reviewer] blocking: ${majors.length} major finding(s)\n`);
    process.exit(1);
  }
}

// Guarded so importing this module from a unit test never triggers a real `gh` call or model
// request — same pattern verify-stability.ts uses for the identical reason.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[pr-reviewer] ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  });
}
