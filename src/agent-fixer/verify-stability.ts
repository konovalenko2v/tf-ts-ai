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
import { getAffectedSpecs } from '../test-selection/affected-tests';

const REPEAT_EACH_TEST = 5;
const REPEAT_WHOLE_SUITE = 2;

function runPlaywright(specs: string[], args: string[]): boolean {
  try {
    execFileSync('npx', ['playwright', 'test', ...specs, ...args], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'master';
  const { specs, runAll } = getAffectedSpecs(baseRef);

  if (runAll || specs.length === 0) {
    // agent-fixer only ever touches src/ui/pages/practice-form.page.ts (see run.ts's TARGET_FILE),
    // so this branch is a defensive fallback, not an expected path — but if it's ever reached,
    // "no affected specs found" means there's nothing to stability-check, and "run everything"
    // means the whole suite already stands in for both individual-test and suite-level repeats
    // via the existing full-suite CI run — neither case is a stability gate this script should
    // silently pass, so both fail loud rather than merging on no evidence.
    process.stderr.write(`[verify-stability] expected a scoped set of affected specs for an agent-fixer branch, got runAll=${runAll} specs=${specs.length} — refusing to auto-merge on unclear affected-test scope\n`);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`[verify-stability] affected spec(s): ${specs.join(', ')}\n`);

  process.stderr.write(`[verify-stability] step 1/2: each test must pass ${REPEAT_EACH_TEST} consecutive times (--repeat-each)\n`);
  if (!runPlaywright(specs, ['--repeat-each', String(REPEAT_EACH_TEST), '--retries=0'])) {
    process.stderr.write(`[verify-stability] FAILED — at least one test did not pass all ${REPEAT_EACH_TEST} repeats\n`);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`[verify-stability] step 2/2: the whole affected spec file must pass ${REPEAT_WHOLE_SUITE} consecutive full runs\n`);
  for (let run = 1; run <= REPEAT_WHOLE_SUITE; run++) {
    process.stderr.write(`[verify-stability]   suite run ${run}/${REPEAT_WHOLE_SUITE}\n`);
    if (!runPlaywright(specs, ['--retries=0'])) {
      process.stderr.write(`[verify-stability] FAILED — suite run ${run}/${REPEAT_WHOLE_SUITE} did not pass\n`);
      process.exitCode = 1;
      return;
    }
  }

  process.stderr.write('[verify-stability] PASSED — stable across all repeats, safe to auto-merge\n');
}

main();
