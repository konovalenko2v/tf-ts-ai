// Stability gate for agent-fixer's auto-merge path (see run.ts's PR-open step and
// .github/workflows/regression.yml's agent-fixer-verify-and-merge job). A locator fix passing
// ONCE proves nothing about a healed selector — the whole point of self-healing is that it papers
// over flakiness at runtime, so the replacement locator itself needs repeated-run evidence before
// it's trusted enough to merge without a human ever looking at it. Two levels, per the
// project owner's explicit requirement:
//   - individual test: must pass 5 consecutive times (--repeat-each 5)
//   - the whole affected spec file (its "suite"/class): must pass 2 consecutive full runs
// Both must hold; failing either fails this script (nonzero exit), which the calling CI job
// treats as "do not merge."
//
// Uses the same import-graph affected-spec selection as npm run test:affected (getAffectedSpecs)
// rather than a hardcoded path, so this stays correct if agent-fixer ever targets more than
// practice-form.page.ts.

import { execFileSync } from 'child_process';
import { getAffectedSpecs, AffectedResult } from '../test-selection/affected-tests';
import { isWithinAllowedScope, ALLOWED_TARGET_FILES } from './safety-gates';

export const REPEAT_EACH_TEST = 5;
export const REPEAT_WHOLE_SUITE = 2;

function runPlaywright(specs: string[], args: string[]): boolean {
  try {
    execFileSync('npx', ['playwright', 'test', ...specs, ...args], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

export interface StabilityVerdict {
  passed: boolean;
  reason: string;
}

// The gate's decision logic, isolated from the actual subprocess calls: takes an already-resolved
// AffectedResult plus an injected `runner` (real signature matches runPlaywright above) so a test
// can assert on the exact argv sequence a real run would produce — order and flags included —
// without spawning Playwright. main() below is the only caller that wires in the real
// getAffectedSpecs/runPlaywright pair.
export function evaluateStability(
  { specs, runAll, changedFiles }: AffectedResult,
  runner: (specs: string[], args: string[]) => boolean,
): StabilityVerdict {
  if (runAll || specs.length === 0) {
    // agent-fixer only ever touches ALLOWED_TARGET_FILES (see run.ts's TARGET_FILE), so this
    // branch is a defensive fallback, not an expected path — but if it's ever reached, "no
    // affected specs found" means there's nothing to stability-check, and "run everything" means
    // the whole suite already stands in for both individual-test and suite-level repeats via the
    // existing full-suite CI run — neither case is a stability gate this script should silently
    // pass, so both fail loud rather than merging on no evidence.
    return {
      passed: false,
      reason: `expected a scoped set of affected specs for an agent-fixer branch, got runAll=${runAll} specs=${specs.length} — refusing to auto-merge on unclear affected-test scope`,
    };
  }

  // Scope limit (point 4 of the autonomy/safety plan): agent-fixer must only ever touch its
  // declared target file(s). Checked before any Playwright process runs — a tampered/out-of-scope
  // branch must never get as far as having its tests run, let alone pass.
  if (!isWithinAllowedScope(changedFiles, ALLOWED_TARGET_FILES)) {
    return {
      passed: false,
      reason: `FAILED — branch touches file(s) outside the allowed auto-merge scope (${ALLOWED_TARGET_FILES.join(', ')}): ${changedFiles.join(', ')}`,
    };
  }

  // --retries=0 on every invocation is load-bearing: Playwright's own config-level retries would
  // let a flaky healed locator pass on a later attempt, making this repeat-based gate decorative.
  if (!runner(specs, ['--repeat-each', String(REPEAT_EACH_TEST), '--retries=0'])) {
    return { passed: false, reason: `FAILED — at least one test did not pass all ${REPEAT_EACH_TEST} repeats` };
  }

  for (let run = 1; run <= REPEAT_WHOLE_SUITE; run++) {
    if (!runner(specs, ['--retries=0'])) {
      return { passed: false, reason: `FAILED — suite run ${run}/${REPEAT_WHOLE_SUITE} did not pass` };
    }
  }

  return { passed: true, reason: 'PASSED — stable across all repeats, safe to auto-merge' };
}

function main(): void {
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'master';
  const result = getAffectedSpecs(baseRef);
  process.stderr.write(`[verify-stability] affected spec(s): ${result.specs.join(', ')}\n`);
  process.stderr.write(`[verify-stability] step 1/2: each test must pass ${REPEAT_EACH_TEST} consecutive times (--repeat-each)\n`);

  const verdict = evaluateStability(result, runPlaywright);

  process.stderr.write(`[verify-stability] ${verdict.reason}\n`);
  if (!verdict.passed) process.exitCode = 1;
}

// Guards against running real subprocesses / touching process.exitCode when this module is
// imported from a test rather than run directly via `npm run agent-fixer:verify-stability`.
if (require.main === module) {
  main();
}
