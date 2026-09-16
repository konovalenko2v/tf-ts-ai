import RPClient from '@reportportal/client-javascript';

// CI-only helper for merging sharded test-shard runs into one ReportPortal launch — see the
// agent's own guidance (node_modules/@reportportal/agent-js-playwright/README.md, "Merging
// launches based on the build ID" / "Using the launchId config option"). Started once, before the
// shard matrix; playwright.config.ts picks up the resulting ID via RP_LAUNCH_ID and attaches every
// shard's results to it instead of starting its own. finish-launch.ts closes it out afterwards.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`start-launch: missing required env var ${name}`);
  return value;
}

async function main(): Promise<void> {
  const project = requireEnv('RP_PROJECT');
  const client = new RPClient({
    apiKey: requireEnv('RP_API_KEY'),
    endpoint: requireEnv('RP_ENDPOINT'),
    project,
  });

  const { tempId, promise } = client.startLaunch({
    name: process.env.RP_LAUNCH ?? 'tf-ts-ai',
    description: 'tf-ts-ai regression run',
    attributes: [{ key: 'project', value: project }],
  });
  const { id } = await promise;

  // GITHUB_OUTPUT, not stdout — this runs as a job step whose output another job's `needs`
  // context reads; printing to stdout would require the caller to scrape logs instead.
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `launch_id=${id}\n`);
  }
  // tempId is what finishLaunch's underlying queue tracks internally, but a *separate* CI job
  // has none of this process's in-memory state — only the real ReportPortal id survives across
  // jobs, so that's what's exported here (and what RP_LAUNCH_ID expects, per the agent's docs).
  console.log(`ReportPortal launch started: ${id} (tempId ${tempId})`);
}

main().catch((err) => {
  console.error('start-launch failed:', err);
  process.exit(1);
});
