import { requireEnv } from './config';

// globalSetup receives FullConfig.projects unfiltered — it always lists every project regardless
// of a --project CLI flag (verified against the installed Playwright version) — so the CLI's own
// argv is the only reliable way to know which projects this invocation will actually run.
function requestedProjects(): string[] | undefined {
  const flag = process.argv.find((a) => a.startsWith('--project='));
  if (!flag) return undefined; // no filter — every project runs
  return [flag.slice('--project='.length)];
}

// Retry cannot fix a missing credential: without this, a missing env var means 10 api tests each
// burn their full retry budget (30 attempts) before failing with the identical cause. Failing
// once here, before any worker starts, turns that into a single 2-second error.
export default async function globalSetup(): Promise<void> {
  const projects = requestedProjects();
  const apiInScope = !projects || projects.includes('api');
  if (!apiInScope) return;

  requireEnv('BOOKER_USERNAME');
  requireEnv('USER_PASSWORD');
}
