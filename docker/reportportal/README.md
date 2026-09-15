# ReportPortal (local, Docker)

Self-hosted ReportPortal instance for this project's Playwright reports, in addition to the
existing Allure/HTML reports (see `../../playwright.config.ts`). `docker-compose.yml` here is the
official EPAM stack, pinned to release
[26.0.5](https://github.com/reportportal/reportportal/releases/tag/26.0.5) — fetched, not authored.

## Start

```bash
# optional: set your own admin password (default is the project's public demo value "erebus")
export RP_INITIAL_ADMIN_PASSWORD=your-strong-password

docker compose -p reportportal --profile core up -d
```

`--profile core` starts the minimal stack (UI, API, Postgres, RabbitMQ, OpenSearch, MinIO, index
services) — enough to receive and browse Playwright launches. Add `--profile analyzer` if you also
want ReportPortal's ML-based failure-similarity analyzer; it's a separate, heavier service this
project's integration doesn't require.

UI: http://localhost:8080 — default login `superadmin` / `RP_INITIAL_ADMIN_PASSWORD` (or `erebus`
if unset). Change the default password and create a real project before pointing real runs at it.

If port 8080 is already taken on your machine (common — many local dev setups bind it), add a
`docker-compose.override.yml` next to this file remapping the `gateway` service's port. Compose
_concatenates_ override port lists onto the base file's rather than replacing them, so the base
`8080:8080` entry has to be explicitly replaced with the `!override` YAML tag, not just added to:

```yaml
services:
  gateway:
    ports: !override
      - '8090:8080' # or whatever's free
      - '8081:8081'
      - '443:443'
```

`docker-compose.override.yml` is gitignored-by-convention here (machine-specific) — not committed.

## Stop

```bash
docker compose -p reportportal down          # keep data (named volumes)
docker compose -p reportportal down -v       # also wipe data
```

## Wire it into the test run

1. In ReportPortal's UI, create a project and generate an API key (Profile page → API keys).
2. Set in this repo's `.env` (see `.env.example` for the full list): `RP_ENDPOINT` (note the path is
   `/api/v2`, not `/v1` — the agent's own docs use v2), `RP_API_KEY`, `RP_PROJECT`, optionally
   `RP_LAUNCH`.
3. Run tests as usual (`npm test`, `npm run test:ui`, ...). `playwright.config.ts` only adds the
   ReportPortal reporter when `RP_ENDPOINT` is set — with it unset (the default, and always true in
   CI unless someone deploys a shared instance and wires the same vars as CI secrets), nothing
   changes and no connection is attempted. On success the run prints a `ReportPortal Launch Link:`
   with a direct URL to the launch.

Verified end-to-end locally: `npm run test:unit` against a freshly started stack produced a
`PASSED` launch in ReportPortal with all 18 executions recorded. One gotcha hit along the way:
passing `--reporter=...` on the CLI **replaces** the config's whole reporter array (standard
Playwright behavior) — don't add it when you want the ReportPortal (or any config-declared)
reporter to actually run.

## Not done here

- No CI wiring. `regression.yml` does not set `RP_ENDPOINT`, so ReportPortal stays local/opt-in —
  wiring it into CI would mean running this stack somewhere CI can reach it (not the GitHub-hosted
  runner itself), which is a separate infrastructure decision.
- Sharded runs (`test-shard` in `regression.yml`) each start Playwright separately; without extra
  launch-merge configuration in `rpConfig`, a sharded run would create one ReportPortal launch per
  shard rather than one merged launch. Not addressed since CI doesn't send to ReportPortal yet.
