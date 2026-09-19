// Entry point: point this at any OpenAPI/Swagger document URL and it onboards that API into the
// suite — generates a client + types deterministically (no AI in that half, see generate-client.ts
// / generate-schema.ts), then has an AI agent write steps + a spec exercising them.
//
// Deliberately NOT modeled on src/test-evolution/run.ts's branch/PR pipeline: that script runs
// unattended in CI and needs somewhere to deliver its output, so it owns its own git branch and
// opens its own PR. This script is run by a human who already has a target repo/branch in hand —
// delivering the result in a PR is the caller's job, not this tool's. Porting the branch-per-run
// + `git checkout master` abandon-path from that script here would be actively dangerous: it would
// check the invoking session out of whatever branch it's currently working on.

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fetchSpec } from './fetch-spec';
import { generateSchemaFile, generateTypesBarrel, emittableSchemaNames, supportsSchemaGeneration } from './generate-schema';
import { generateClientFile } from './generate-client';
import { resolveBaseUrl } from './openapi-types';
import { proposeOnboarding } from './propose-onboarding';

const OUTPUT_ROOT = 'src/api-onboarder/generated';
// Playwright's `api` project only collects spec files under tests/api/ (testDir + testMatch in
// playwright.config.ts) — a spec generated anywhere under src/ is invisible to the runner no
// matter how it's named, so the spec file (and only the spec file) has to live here.
const SPEC_ROOT = 'tests/api';
const STABILITY_RUNS = 3;

function toClassName(apiName: string): string {
  return apiName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

function toDirName(apiName: string): string {
  return apiName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// A red generated test must not survive to be committed, and no partial output should linger for
// a re-run to trip over — this removes exactly what this run created, and nothing else.
function cleanUp(paths: string[]): void {
  for (const p of paths) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
}

function runSpecOnce(file: string): boolean {
  try {
    execFileSync('npx', ['playwright', 'test', file, '--project=api', '--retries=0'], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

// Petstore (and any other shared public demo API) is mutable by anyone at any time — a test that
// passes once on shared, concurrently-modified state is not evidence it's stable. Require the
// SAME generated file to pass 3 consecutive times before treating it as onboarded, not just once.
function runSpecRepeatedly(file: string, times: number): boolean {
  for (let i = 1; i <= times; i++) {
    process.stderr.write(`[api-onboarder] stability run ${i}/${times}...\n`);
    if (!runSpecOnce(file)) {
      process.stderr.write(`[api-onboarder] failed on run ${i}/${times}\n`);
      return false;
    }
  }
  return true;
}

async function main(): Promise<void> {
  const specUrl = process.argv[2];
  if (!specUrl) {
    process.stderr.write('Usage: npm run api-onboarder -- <openapi-spec-url> [api-name]\n');
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`[api-onboarder] fetching spec from ${specUrl}...\n`);
  const doc = await fetchSpec(specUrl);
  const apiName = process.argv[3] ?? doc.info?.title ?? 'api';
  const className = `${toClassName(apiName)}Client`;
  const dirName = toDirName(apiName);
  const baseUrl = resolveBaseUrl(doc, new URL(specUrl).host);

  const outDir = path.join(OUTPUT_ROOT, dirName);
  const schemaFile = path.join(outDir, 'schema.ts');
  const typesFile = path.join(outDir, 'types.ts');
  const clientFile = path.join(outDir, `${dirName}.client.ts`);
  const stepsFile = path.join(outDir, `${dirName}.steps.ts`);
  const specFile = path.join(SPEC_ROOT, `${dirName}-onboarded.spec.ts`);

  if (fs.existsSync(outDir) || fs.existsSync(specFile)) {
    process.stderr.write(`[api-onboarder] ${outDir} or ${specFile} already exists — remove them first to re-onboard\n`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  // openapi-typescript (a maintained library, not this repo's own parser) only understands
  // OpenAPI 3.x — a Swagger 2.0 doc still gets a working client (see generate-client.ts's
  // Swagger-2.0/OpenAPI-3 dual-path handling), just without named types: every $ref falls back to
  // `unknown` there. That's a coverage gap to say out loud, not a silent downgrade.
  const generatedFiles = [clientFile];
  let availableTypeNames = new Set<string>();
  if (supportsSchemaGeneration(doc)) {
    fs.writeFileSync(schemaFile, await generateSchemaFile(doc));
    fs.writeFileSync(typesFile, generateTypesBarrel(doc));
    availableTypeNames = new Set(emittableSchemaNames(doc));
    generatedFiles.unshift(typesFile, schemaFile);
  } else {
    process.stderr.write(
      '[api-onboarder] this is a Swagger 2.0 document — openapi-typescript needs OpenAPI 3.x, so no schema.ts/types.ts is generated; the client will use `unknown` for every $ref type instead of a named one\n',
    );
  }

  fs.writeFileSync(clientFile, generateClientFile(doc, className, baseUrl, availableTypeNames));
  execFileSync('npx', ['prettier', '--write', ...generatedFiles], { stdio: 'inherit' });
  process.stderr.write(`[api-onboarder] generated ${generatedFiles.join(', ')} (${Object.keys(doc.paths).length} paths)\n`);

  const statusBefore = execFileSync('git', ['status', '--short']).toString();

  try {
    proposeOnboarding({
      apiName,
      clientFile,
      typesFile,
      stepsOutputFile: stepsFile,
      specOutputFile: specFile,
      baseUrl,
    });
  } catch (err) {
    process.stderr.write(`[api-onboarder] AI CLI failed (all tiers): ${(err as Error).message}\n`);
    cleanUp([outDir, specFile]);
    process.exitCode = 1;
    return;
  }

  // runAgenticEdit has broad file-write access (Read/Write/Edit, acceptEdits) — this is a
  // deliberate check on what it actually touched, not decoration. The prompt asks for exactly two
  // new files; anything else (especially an edit to an existing src/api/clients/*.client.ts) is a
  // finding to surface, not silently accept.
  //
  // git status --short collapses an untracked directory to a single "?? src/api-onboarder/" line,
  // so it can't enumerate new files inside one — the two new files this step is allowed to create
  // are exactly that case and would show as nothing new either way. What it CAN see reliably is a
  // tracked file flipping to modified (" M path"), which is the actual danger (an AI edit landing
  // in an existing hand-written client/type file) — so only tracked-modification lines count here.
  const statusAfter = execFileSync('git', ['status', '--short']).toString();
  const newlyChanged = statusAfter.split('\n').filter((line) => line.trim() && !line.startsWith('??') && !statusBefore.includes(line));
  if (newlyChanged.length > 0) {
    process.stderr.write(
      `[api-onboarder] AI CLI touched files outside the requested output paths — aborting:\n${newlyChanged.join('\n')}\n`,
    );
    cleanUp([outDir, specFile]);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(stepsFile) || !fs.existsSync(specFile)) {
    process.stderr.write('[api-onboarder] AI CLI did not produce both the steps file and the spec file — discarding\n');
    cleanUp([outDir, specFile]);
    process.exitCode = 1;
    return;
  }

  execFileSync('npx', ['prettier', '--write', stepsFile, specFile], { stdio: 'inherit' });

  // Mechanically-fixable lint noise (a redundant `as Type` assertion, an unused import) is a style
  // problem, not a content problem — fix it the same way prettier's already fixing formatting,
  // rather than discarding a test whose actual logic is fine. `--fix` exits non-zero on anything it
  // couldn't fix; the lintOk check right below is still the real gate.
  try {
    execFileSync('npx', ['eslint', '--fix', stepsFile, specFile], { stdio: 'inherit' });
  } catch {
    // fall through to the lintOk check, which re-lints and decides whether to discard
  }

  const lintOk = (() => {
    try {
      execFileSync('npx', ['eslint', stepsFile, specFile], { stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  })();
  if (!lintOk) {
    process.stderr.write('[api-onboarder] generated steps/spec has lint errors — discarding\n');
    cleanUp([outDir, specFile]);
    process.exitCode = 1;
    return;
  }

  try {
    execFileSync('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });
  } catch {
    process.stderr.write('[api-onboarder] generated code does not typecheck — discarding\n');
    cleanUp([outDir, specFile]);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`[api-onboarder] running ${specFile} ${STABILITY_RUNS}x to confirm it's stable against live shared state...\n`);
  const stable = runSpecRepeatedly(specFile, STABILITY_RUNS);
  if (!stable) {
    process.stderr.write(
      '[api-onboarder] generated spec did not pass 3/3 runs (broken assertion or unstable shared state — either way, not proposing it) — discarding\n',
    );
    cleanUp([outDir, specFile]);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(
    `[api-onboarder] done — ${apiName} onboarded at ${outDir}/ (${[...generatedFiles, stepsFile, specFile].join(', ')})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[api-onboarder] failed: ${err.message}\n`);
  process.exitCode = 1;
});
