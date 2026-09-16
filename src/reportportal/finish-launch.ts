// Counterpart to start-launch.ts. finishLaunch() on @reportportal/client-javascript only works
// against a launch the SAME client instance started (it tracks state in an in-memory map keyed by
// tempId) — no use across a separate CI job, which is exactly the case here (start-launch runs
// before the shard matrix, this runs after `test`). The REST call is what the agent's own README
// falls back to for this reason ("the same actions can be performed by sending requests to the
// ReportPortal API directly") — this is that direct call.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`finish-launch: missing required env var ${name}`);
  return value;
}

async function main(): Promise<void> {
  const endpoint = requireEnv('RP_ENDPOINT').replace(/\/+$/, '');
  const apiKey = requireEnv('RP_API_KEY');
  const project = requireEnv('RP_PROJECT');
  const launchId = requireEnv('RP_LAUNCH_ID');

  const response = await fetch(`${endpoint}/${project}/launch/${launchId}/finish`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ endTime: Date.now() }),
  });

  if (!response.ok) {
    throw new Error(`finish-launch: ReportPortal returned ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as { link?: string };
  console.log(`ReportPortal launch finished: ${body.link ?? launchId}`);
}

main().catch((err) => {
  console.error('finish-launch failed:', err);
  process.exit(1);
});
