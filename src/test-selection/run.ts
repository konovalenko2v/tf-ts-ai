import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { getAffectedSpecs, AffectedSpec } from './affected-tests';

const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// A bordered table, not a plain "- file\n    because: ..." list — the whole point of this output
// is to be the thing a human's eye catches while scrolling past hundreds of Playwright result
// lines, not something they have to go looking for. Colors are dropped automatically in a
// non-TTY (piped to a file, CI log viewer without ANSI support) via process.stderr.isTTY, so this
// never writes escape codes into a saved log.
function renderAffectedTable(affected: AffectedSpec[]): string {
  const specHeader = 'Spec';
  const reasonHeader = 'Because it depends on';
  const specWidth = Math.max(specHeader.length, ...affected.map((a) => a.spec.length));
  const reasonWidth = Math.max(reasonHeader.length, ...affected.map((a) => a.reasons.join(', ').length));

  const useColor = process.stderr.isTTY === true;
  const bold = (s: string) => (useColor ? `${BOLD}${s}${RESET}` : s);
  const cyan = (s: string) => (useColor ? `${CYAN}${s}${RESET}` : s);

  const pad = (s: string, width: number) => s + ' '.repeat(width - s.length);
  const border = (l: string, m: string, r: string) => `${l}${'─'.repeat(specWidth + 2)}${m}${'─'.repeat(reasonWidth + 2)}${r}`;

  const rows = affected.map((a) => `│ ${cyan(pad(a.spec, specWidth))} │ ${pad(a.reasons.join(', '), reasonWidth)} │`);

  return [
    bold(`RUNNING ${affected.length} AFFECTED SPEC(S)`),
    border('┌', '┬', '┐'),
    `│ ${bold(pad(specHeader, specWidth))} │ ${bold(pad(reasonHeader, reasonWidth))} │`,
    border('├', '┼', '┤'),
    ...rows,
    border('└', '┴', '┘'),
  ].join('\n');
}

// Written alongside the stderr log (never instead of it) so a PR reviewer sees WHY each spec ran
// without downloading CI logs — GITHUB_STEP_SUMMARY is Actions' per-step markdown panel, appended
// to (not overwritten), so this coexists with whatever other steps write to the same run's summary.
function writeGithubStepSummary(baseRef: string, changedFiles: string[], affected: AffectedSpec[], runAll: boolean): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return; // local run, or CI step without this env var set — nothing to append to

  const lines = ['### Affected-test selection', `Diffed against \`${baseRef}\`.`, ''];
  if (runAll) {
    lines.push('Change touches build/CI config outside the import graph — ran the full suite.');
  } else if (affected.length === 0) {
    lines.push('No spec depends on the changed files — nothing ran.');
  } else {
    lines.push('| Spec | Because it depends on |', '| --- | --- |');
    for (const a of affected) {
      lines.push(`| \`${a.spec}\` | ${a.reasons.map((r) => `\`${r}\``).join(', ')} |`);
    }
  }
  lines.push('', '<details><summary>Changed files</summary>', '', ...changedFiles.map((f) => `- \`${f}\``), '', '</details>', '');
  fs.appendFileSync(summaryFile, lines.join('\n'));
}

function main(): void {
  // Forwarded verbatim to `playwright test` below — this is what lets a caller pass --shard=N/M
  // or --project=X through `npm run test:affected -- <flags>` instead of test:affected always
  // running the whole affected set unsharded regardless of what the caller asked for.
  const extraArgs = process.argv.slice(2);
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'master';
  const { specs, runAll, changedFiles, affected } = getAffectedSpecs(baseRef);

  process.stderr.write(`[test-selection] diffing against ${baseRef}\n`);
  process.stderr.write(`[test-selection] changed files:\n${changedFiles.map((f) => `  - ${f}`).join('\n') || '  (none)'}\n`);

  writeGithubStepSummary(baseRef, changedFiles, affected, runAll);

  if (runAll) {
    process.stderr.write('[test-selection] change touches build/CI config outside the import graph — running the full suite\n');
    execFileSync('npx', ['playwright', 'test', ...extraArgs], { stdio: 'inherit' });
    return;
  }

  if (specs.length === 0) {
    process.stderr.write('[test-selection] no spec depends on the changed files — nothing to run\n');
    return;
  }

  process.stderr.write(`\n${renderAffectedTable(affected)}\n\n`);
  // --pass-with-no-tests: with extraArgs carrying a --project filter (e.g. --shard split combined
  // with a project restriction), the affected spec list can resolve to zero tests for THIS
  // invocation specifically (every affected spec belongs to a different project) without that
  // being the "nothing affected at all" case handled above — that must stay a pass, not a failure.
  execFileSync('npx', ['playwright', 'test', ...specs, ...extraArgs, '--pass-with-no-tests'], { stdio: 'inherit' });
}

main();
