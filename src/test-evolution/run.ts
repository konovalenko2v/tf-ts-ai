import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { proposeTest } from './propose-test';

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
  // isolation agent-fixer applies around its own Gemini CLI call.
  try {
    proposeTest(REFERENCE_FILE, OUTPUT_FILE);
  } catch (err) {
    abandon(branch, `Gemini CLI failed: ${(err as Error).message}`, false);
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

  process.stderr.write(`[test-evolution] ${OUTPUT_FILE} passed — this run stops here (dry-run, no commit/PR yet)\n`);
}

main().catch((err) => {
  process.stderr.write(`[test-evolution] failed: ${err.message}\n`);
  process.exitCode = 1;
});
