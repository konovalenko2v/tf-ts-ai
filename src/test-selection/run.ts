import { execFileSync } from 'child_process';
import { getAffectedSpecs } from './affected-tests';

function main(): void {
  // Forwarded verbatim to `playwright test` below — this is what lets a caller pass --shard=N/M
  // or --project=X through `npm run test:affected -- <flags>` instead of test:affected always
  // running the whole affected set unsharded regardless of what the caller asked for.
  const extraArgs = process.argv.slice(2);
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'master';
  const { specs, runAll, changedFiles } = getAffectedSpecs(baseRef);

  process.stderr.write(`[test-selection] diffing against ${baseRef}\n`);
  process.stderr.write(`[test-selection] changed files:\n${changedFiles.map((f) => `  - ${f}`).join('\n') || '  (none)'}\n`);

  if (runAll) {
    process.stderr.write('[test-selection] change touches build/CI config outside the import graph — running the full suite\n');
    execFileSync('npx', ['playwright', 'test', ...extraArgs], { stdio: 'inherit' });
    return;
  }

  if (specs.length === 0) {
    process.stderr.write('[test-selection] no spec depends on the changed files — nothing to run\n');
    return;
  }

  process.stderr.write(`[test-selection] running ${specs.length} affected spec(s):\n${specs.map((f) => `  - ${f}`).join('\n')}\n`);
  // --pass-with-no-tests: with extraArgs carrying a --project filter (e.g. --shard split combined
  // with a project restriction), the affected spec list can resolve to zero tests for THIS
  // invocation specifically (every affected spec belongs to a different project) without that
  // being the "nothing affected at all" case handled above — that must stay a pass, not a failure.
  execFileSync('npx', ['playwright', 'test', ...specs, ...extraArgs, '--pass-with-no-tests'], { stdio: 'inherit' });
}

main();
