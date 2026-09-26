import { requireEnv } from './config';

// globalSetup receives FullConfig.projects unfiltered — it always lists every project regardless
// of a --project CLI flag (verified against the installed Playwright version) — so the CLI's own
// argv is the only reliable way to know which projects this invocation will actually run. Collects
// every --project= flag, not just the first — regression.yml now passes several at once
// (--project=api --project=graphql --project=ui), and reading only the first would have made this
// scope check order-dependent on which project happened to be listed first on the command line.
export function requestedProjects(argv: string[] = process.argv): string[] | undefined {
  const flags = argv.filter((a) => a.startsWith('--project='));
  if (flags.length === 0) return undefined; // no filter — every project runs
  return flags.map((f) => f.slice('--project='.length));
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
