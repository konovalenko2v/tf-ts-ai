// CLI wrapper around safety-gates.ts's checkCircuitBreaker for the agent-fixer-verify-and-merge
// CI job. A tripped breaker must NOT exit nonzero — that would be indistinguishable from a
// stability failure to the calling job, but this isn't "the fix is unstable," it's "autonomy is
// suspended pending a human" — a different condition that needs its own signal (a GITHUB_OUTPUT
// var) so the workflow can hold the PR open with an explanatory comment instead of quietly
// behaving like every other failed gate.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { checkCircuitBreaker } from './safety-gates';

const MAX_MERGES_IN_WINDOW = Number(process.env.AGENT_FIXER_MAX_MERGES_PER_WINDOW) || 3;
const WINDOW = process.env.AGENT_FIXER_BREAKER_WINDOW || '24 hours ago';

function recentCommitSubjects(): string[] {
  const output = execFileSync('git', ['log', 'origin/master', `--since=${WINDOW}`, '--pretty=%s'], {
    encoding: 'utf-8',
  });
  return output.split('\n').filter(Boolean);
}

function main(): void {
  const subjects = recentCommitSubjects();
  const result = checkCircuitBreaker(subjects, { maxMergesInWindow: MAX_MERGES_IN_WINDOW });

  if (result.tripped) {
    process.stderr.write(`[circuit-breaker] TRIPPED — ${result.reason}\n`);
  } else {
    process.stderr.write('[circuit-breaker] clear — autonomy not suspended\n');
  }

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `tripped=${result.tripped}\nreason=${result.reason ?? ''}\n`);
  }
}

main();
