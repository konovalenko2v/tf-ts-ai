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
services) — enough to receive and browse Playwright launches.

### Optional: Auto-Analyzer

Add `--profile analyzer` (alongside `core`, not instead of it) to also start ReportPortal's
ML-based failure-similarity service:

```bash
docker compose -p reportportal --profile core --profile analyzer up -d
```

It compares each new failure's error message/stack trace against ones already triaged in the
project and auto-suggests a defect type (`Product Bug` / `Auto Bug` / `System Issue` / `Ignored`)
instead of leaving every failure as `To Investigate` for a human to classify from scratch. It needs
a few triaged launches in the project before it has anything to compare against, and it's a
separate, heavier service (its own container) — left off by default since this project's
integration doesn't require it to function.

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

## CI wiring (opt-in, unset today)

`regression.yml` has the plumbing for a shared ReportPortal instance CI can reach, but no such
instance is deployed yet — `vars.RP_ENDPOINT` is unset, so `rp-launch-start`/`rp-launch-finish`
and the `RP_*` env vars on `test-shard` are all no-ops (the jobs skip; the reporter never engages).
To actually wire it up: deploy a reachable ReportPortal instance (this local Docker stack is a
_local_ instance — a GitHub-hosted runner can't reach `localhost` on your machine), then set the
repo variables `RP_ENDPOINT` and `RP_PROJECT` and the repo secret `RP_API_KEY`.

Sharded runs (`test-shard`'s matrix) are handled: `rp-launch-start` starts one ReportPortal launch
before the matrix and hands every shard the same ID via `RP_LAUNCH_ID`
(`playwright.config.ts` → `launchId`), so all shards attach to it instead of each starting their
own. `rp-launch-finish` closes it out after the `test` aggregate job, `always()`-gated so a red run
still gets its launch finished rather than left `IN_PROGRESS` forever. This is the mechanism the
agent's own docs recommend for sharded runs — see
`node_modules/@reportportal/agent-js-playwright/README.md`, "Using the launchId config option".
Not verified live (no CI-reachable instance to test against) — typecheck/lint/format clean, and
`src/reportportal/start-launch.ts` + `finish-launch.ts` were each verified live against the local
Docker stack individually (start → real launch created, finish → real launch closed via the API).
