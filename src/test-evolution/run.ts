import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { proposeTest } from './propose-test';
import { reviewGeneratedTest } from '../ai-agents/reviewer-tests';
import { latestRunFile, readEvents } from '../observability/run-file';
import { TestSummaryEvent } from '../observability/types';

const REFERENCE_FILE = 'tests/api/negative.spec.ts';
const OUTPUT_FILE = `tests/api/negative-generated-${Date.now()}.spec.ts`;
const BRANCH_PREFIX = 'test-evolution/';

function currentBranch(): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
}

function runGeneratedSpec(file: string): boolean {
  try {
    execFileSync('npx', ['playwright', 'test', file, '--project=api', '--retries=0'], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

// The reviewer explicitly asked to never have to take "it passed" on faith — this reads the
// observability reporter's own record of the run that just happened (not a re-derived claim)
// so the PR body carries the actual status/duration per test.
//
// OUTPUT_FILE is repo-relative (tests/api/negative-generated-...), but the reporter's
// testTitlePath is relative to the project's testDir (api/negative-generated-...) — Playwright's
// own TestCase.titlePath() never includes the tests/<project> prefix the config's testDir strips.
// Match on the basename instead of the full path.
function readTestResults(): TestSummaryEvent[] {
  const runFile = latestRunFile();
  if (!runFile) return [];
  const basename = OUTPUT_FILE.split('/').pop()!;
  return readEvents(runFile).filter((e): e is TestSummaryEvent => e.type === 'test' && e.testTitlePath.includes(basename));
}

// A file path alone doesn't tell a reviewer what's being tested — pull the human-written
// describe/test titles straight out of the generated source instead of re-summarizing them.
function extractTestTitles(file: string): { describe?: string; tests: string[] } {
  const source = fs.readFileSync(file, 'utf-8');
  const describeMatch = source.match(/test\.describe\(\s*['"`](.+?)['"`]/);
  const testMatches = [...source.matchAll(/(?<!\.)\btest\(\s*['"`](.+?)['"`]/g)];
  return { describe: describeMatch?.[1], tests: testMatches.map((m) => m[1]) };
}

function renderResultsTable(results: TestSummaryEvent[]): string {
  if (results.length === 0) {
    return '_No observability record found for this run — results below are unverified._';
  }
  const rows = results.map((r) => `| ${r.status === 'passed' ? '✅' : '❌'} ${r.status} | ${r.durationMs}ms | ${r.testTitlePath.split('>').pop()!.trim()} |`);
  return ['| Result | Duration | Test |', '|---|---|---|', ...rows].join('\n');
}

function abandon(branch: string, reason: string, removeOutputFile: boolean): void {
  process.stderr.write(`[test-evolution] ${reason}\n`);
  if (removeOutputFile && fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);
  execFileSync('git', ['checkout', 'master'], { stdio: 'inherit' });
  execFileSync('git', ['branch', '-D', branch], { stdio: 'inherit' });
}

async function main(): Promise<void> {
  if (currentBranch().startsWith(BRANCH_PREFIX)) {
    process.stderr.write('[test-evolution] running on a test-evolution branch — skipping to avoid a loop\n');
    return;
  }

  const branch = `${BRANCH_PREFIX}${Date.now()}`;
  execFileSync('git', ['checkout', '-b', branch], { stdio: 'inherit' });

  // CLI failures (quota, rate limit, network) must not leave an orphaned branch behind — same
  // isolation agent-fixer applies around its own AI calls. proposeTest() already runs the shared
  // 3-tier fallback (gemini primary -> gemini fallback -> claude, cli-fallback.ts) internally, so
  // reaching this catch means all three tiers failed.
  try {
    proposeTest(REFERENCE_FILE, OUTPUT_FILE);
  } catch (err) {
    abandon(branch, `AI CLI failed (all 3 tiers: gemini primary, gemini fallback, claude): ${(err as Error).message}`, false);
    return;
  }

  if (!fs.existsSync(OUTPUT_FILE)) {
    abandon(branch, 'no file was generated — nothing to propose', false);
    return;
  }

  process.stderr.write(`[test-evolution] generated ${OUTPUT_FILE} — running it to verify it actually passes\n`);
  const passed = runGeneratedSpec(OUTPUT_FILE);

  if (!passed) {
    abandon(branch, 'generated test did not pass — discarding, not proposing a PR for a test that fails', true);
    return;
  }

  // Second gate, after "it passed": reviewer-tests (paranoid profile) checks architecture/style
  // conformance and assertion honesty — a passing test can still reach past an existing Page
  // Object/client or assert something that looks like a guess. Failure here (a CLI error, not a
  // NO verdict) doesn't block the PR — the review is advisory, and a broken review CLI shouldn't
  // discard an otherwise-verified-passing test.
  let review: { verdict: boolean; reason: string } | undefined;
  try {
    review = await reviewGeneratedTest(OUTPUT_FILE, REFERENCE_FILE);
    if (!review.verdict) {
      process.stderr.write(`[test-evolution] reviewer-tests flagged this test: ${review.reason}\n`);
    }
  } catch (err) {
    process.stderr.write(`[test-evolution] reviewer-tests call failed, proceeding without a review verdict: ${(err as Error).message}\n`);
  }

  process.stderr.write(`[test-evolution] ${OUTPUT_FILE} passed — committing and opening a PR\n`);

  const { describe, tests } = extractTestTitles(OUTPUT_FILE);
  const results = readTestResults();

  execFileSync('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });

  execFileSync('git', ['add', OUTPUT_FILE], { stdio: 'inherit' });
  execFileSync(
    'git',
    [
      'commit',
      '-m',
      `test-evolution: propose a new edge-case test\n\nGenerated from ${REFERENCE_FILE}, verified to pass before being committed.`,
    ],
    { stdio: 'inherit' },
  );
  execFileSync('git', ['push', 'origin', branch], { stdio: 'inherit' });
  execFileSync(
    'gh',
    [
      'pr',
      'create',
      '--draft',
      '--title',
      'test-evolution: propose a new edge-case test',
      '--body',
      [
        `Auto-generated by test-evolution from \`${REFERENCE_FILE}\`.`,
        '',
        '## What this tests',
        '',
        describe ? `**${describe}**` : `New file: \`${OUTPUT_FILE}\``,
        ...tests.map((t) => `- ${t}`),
        '',
        '## Result',
        '',
        renderResultsTable(results),
        '',
        `Run command: \`npx playwright test ${OUTPUT_FILE} --project=api --retries=0\``,
        '',
        '## reviewer-tests verdict',
        '',
        review
          ? `${review.verdict ? '✅ YES' : '⚠️ NO'} — ${review.reason}`
          : '_reviewer-tests call failed — no automated review verdict for this PR, review manually._',
        '',
        'Review the assertion itself for correctness (a passing test can still assert the wrong',
        'thing — see the file header comment in `src/test-evolution/propose-test.ts` for why this',
        'only proposes tests it can demonstrate hold, not tests it can prove are *right*).',
      ].join('\n'),
    ],
    { stdio: 'inherit' },
  );
}

main().catch((err) => {
  process.stderr.write(`[test-evolution] failed: ${err.message}\n`);
  process.exitCode = 1;
});
