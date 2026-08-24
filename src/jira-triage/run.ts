import { collectJiraContext } from './collect-context';

async function main(): Promise<void> {
  const branch = process.argv[2];
  const failureArea = process.argv[3];

  if (!branch || !failureArea) {
    process.stderr.write('Usage: tsx src/jira-triage/run.ts <branch-name> <failure-area>\n');
    process.exitCode = 1;
    return;
  }

  const context = await collectJiraContext(branch, failureArea);

  if (!context) {
    process.stderr.write(`[jira-triage] no Jira key found in branch "${branch}" — no context to collect\n`);
    return;
  }

  process.stdout.write(JSON.stringify(context, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`[jira-triage] failed: ${err.message}\n`);
  process.exitCode = 1;
});
