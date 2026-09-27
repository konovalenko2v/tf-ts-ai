// Automates the recon + registration half of adding a new goal — the boilerplate that took 5
// hand-edited files for alerts-confirm (config.ts, page-knowledge, goal file, run.ts registry,
// spec file). Deliberately does NOT write succeedsWhen: goal.ts's header comment explains why an
// agent-written oracle is a self-report, and the same argument applies to a scaffolder-written one
// — a human deciding the goal was actually reached is the one piece this tool must never automate.
// See README §8 and CLAUDE.local.md's 2026-09-26 session note for the full argument.
//
// Usage: npm run goal-evolution:new -- <id> <path> "<description>"
//   id: kebab-case, becomes the goal id, the config key suffix, and every generated file's name.
//   path: repo-relative to the configured UI host, e.g. "/alerts" — never a full URL (rule 4:
//     nothing hardcoded outside config.ts; a scaffolded goal must resolve through the same
//     uiBaseHost every other goal does, not point at an arbitrary domain the CLI caller typed).
//   description: plain English, no steps/locators — same rule as every hand-written goal.

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { recon, renderPageKnowledgeMarkdown } from './recon';

export const ORACLE_NOT_WRITTEN_MARKER = 'ORACLE_NOT_WRITTEN';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface ScaffoldPaths {
  configFile: string;
  pageKnowledgeFile: string;
  goalFile: string;
  driverFile: string;
  specFile: string;
}

function pathsFor(id: string): ScaffoldPaths {
  return {
    configFile: path.join(REPO_ROOT, 'src/core/config.ts'),
    pageKnowledgeFile: path.join(REPO_ROOT, `docs/page-knowledge/${id}.md`),
    goalFile: path.join(REPO_ROOT, `src/goal-evolution/goals/${id}.ts`),
    driverFile: path.join(REPO_ROOT, `src/ui/pages/${id}.page.ts`),
    specFile: path.join(REPO_ROOT, `tests/ui/goalBasedTests/${id}-goal.spec.ts`),
  };
}

// camelCase config key from a kebab-case id, e.g. "alerts-confirm" -> "alertsConfirmHost" — matches
// the existing buttonsHost/textBoxHost/checkBoxHost naming convention in config.ts exactly.
export function configKeyFor(id: string): string {
  const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return `${camel}Host`;
}

function assertDoesNotExist(filePath: string, whatFor: string): void {
  if (fs.existsSync(filePath)) {
    throw new Error(
      `refusing to scaffold: ${whatFor} already exists at ${path.relative(REPO_ROOT, filePath)} — pick a different id or remove it first`,
    );
  }
}

function insertConfigHost(id: string, urlPath: string): void {
  const configFile = path.join(REPO_ROOT, 'src/core/config.ts');
  const source = fs.readFileSync(configFile, 'utf-8');
  const key = configKeyFor(id);

  if (source.includes(`${key}:`)) {
    throw new Error(`refusing to scaffold: config.ts already has a "${key}" entry`);
  }

  // Anchored insertion (not a rewrite of config.ts) — every existing *Host entry follows this
  // exact `key: \`${uiBaseHost}/path\`,` shape, so this appends one more line in the same style
  // right before the closing brace of the exported config object, never touching existing entries.
  const closingBraceIndex = source.lastIndexOf('};');
  if (closingBraceIndex === -1) {
    throw new Error('could not find the closing "};" of the config object in config.ts — scaffold anchor assumption broke');
  }
  const insertion = `  ${key}: \`\${uiBaseHost}${urlPath}\`,\n`;
  const updated = source.slice(0, closingBraceIndex) + insertion + source.slice(closingBraceIndex);
  fs.writeFileSync(configFile, updated);
}

function insertRegistryEntry(id: string, specFileRel: string): void {
  const runFile = path.join(REPO_ROOT, 'src/goal-evolution/run.ts');
  const source = fs.readFileSync(runFile, 'utf-8');
  const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const importName = `${camel}Goal`;

  if (source.includes(importName)) {
    throw new Error(`refusing to scaffold: run.ts already imports "${importName}"`);
  }

  // Two anchored insertions: the import line (after the last existing goal import) and the
  // registry entry (before REGISTRY's closing brace). Both are textual, not an AST rewrite — the
  // registry is a static literal by design (see goal.ts), so scaffold.ts respects that shape
  // rather than replacing it with a directory scan, which would change run.ts's own contract.
  const importAnchor = "import { alertsConfirmGoal } from './goals/alerts-confirm';";
  const lastKnownImport = source.includes(importAnchor) ? importAnchor : "import { Goal } from './goal';";
  const importInsertion = `\nimport { ${importName} } from './goals/${id}';`;
  let updated = source.replace(lastKnownImport, `${lastKnownImport}${importInsertion}`);

  const registryClosingBrace = updated.indexOf('\n};', updated.indexOf('const REGISTRY'));
  if (registryClosingBrace === -1) {
    throw new Error('could not find REGISTRY\'s closing "};" in run.ts — scaffold anchor assumption broke');
  }
  const entryInsertion = `  '${id}': {\n    goal: ${importName},\n    specFile: '${specFileRel}',\n    project: 'ui',\n  },\n`;
  updated = updated.slice(0, registryClosingBrace + 1) + entryInsertion + updated.slice(registryClosingBrace + 1);

  fs.writeFileSync(runFile, updated);
}

export function renderGoalFileTemplate(
  id: string,
  configKey: string,
  description: string,
  pageKnowledgeRel: string,
  driverRel: string,
): string {
  const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const exportName = `${camel}Goal`;
  return `import { Page } from '@playwright/test';
import { Goal } from '../goal';
import { config } from '../../core/config';

// Scaffolded by \`npm run goal-evolution:new\` — recon and registration are automated, but the
// oracle below is NOT. See src/goal-evolution/scaffold.ts's header and goal.ts's header comment
// for why: an agent- or scaffolder-written success check is a self-report, not evidence. A human
// must read docs/${pageKnowledgeRel} and write succeedsWhen by hand before this goal can run.
export const ${exportName}: Goal<Page> = {
  id: '${id}',
  description: \`On \${config.${configKey}}, ${description}\`,
  pageKnowledgeFile: 'docs/${pageKnowledgeRel}',
  driverFile: '${driverRel}',
  achieveSignature: 'export async function achieve(page: HealPage): Promise<void>',
  succeedsWhen: async () => {
    throw new Error(
      '${ORACLE_NOT_WRITTEN_MARKER}: ${exportName}.succeedsWhen was scaffolded, not written. ' +
        'Read docs/${pageKnowledgeRel}, decide what observable state proves the goal was reached, ' +
        'and replace this function body before running goal-evolution against this goal.',
    );
  },
};
`;
}

export function renderSpecFileTemplate(id: string, configKey: string, exportName: string): string {
  const driverModule = `../../../src/ui/pages/${id}.page`;
  return `// Human-owned. The agent (goal-solver persona, src/goal-evolution/propose-driver.ts) never edits
// this file and never sees it — its output scope is src/ui/pages/${id}.page.ts only. This file is
// the only place the goal's oracle (${exportName}.succeedsWhen) actually runs, in the same page
// context right after the agent-written achieve(page) returns. See src/goal-evolution/goal.ts for
// why this split is what makes the goal-based result trustworthy instead of self-reported.

import { test } from '../../../src/ui/fixtures';
import { achieve } from '${driverModule}';
import { ${exportName} } from '../../../src/goal-evolution/goals/${id}';

test.describe('DemoQA UI @ ${id} (goal-based)', () => {
  test(${exportName}.id, async ({ page }) => {
    // achieve() owns navigation itself (the agent's driver called page.goto internally) — this
    // spec only checks the oracle after.
    await achieve(page);

    await ${exportName}.succeedsWhen(page);
  });
});
`;
}

export interface ScaffoldOptions {
  id: string;
  urlPath: string;
  description: string;
}

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const { id, urlPath, description } = opts;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`goal id "${id}" must be kebab-case (lowercase letters, digits, hyphens)`);
  }
  if (!urlPath.startsWith('/')) {
    throw new Error(`path "${urlPath}" must start with "/" — it's appended to the configured UI host, never a full URL`);
  }

  const paths = pathsFor(id);
  assertDoesNotExist(paths.goalFile, 'goal file');
  assertDoesNotExist(paths.driverFile, 'driver file');
  assertDoesNotExist(paths.specFile, 'spec file');

  const configKey = configKeyFor(id);
  const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const exportName = `${camel}Goal`;
  const pageKnowledgeRel = `page-knowledge/${id}.md`;
  const specFileRel = path.relative(REPO_ROOT, paths.specFile);
  const driverFileRel = path.relative(REPO_ROOT, paths.driverFile);

  // Curated page-knowledge files are hand-maintained truth, never silently overwritten by a
  // re-run — recon only fills the gap when nothing exists yet.
  if (!fs.existsSync(paths.pageKnowledgeFile)) {
    process.stderr.write(`[scaffold] running headless recon against the live page (no AI)...\n`);
    const result = await recon(`https://demoqa.com${urlPath}`); // demoqa.com hardcoded ONLY as the
    // literal recon target for logging/printing — the goal file itself never hardcodes this; it
    // reads config.${configKey}, which resolves through the same configurable uiBaseHost every
    // other goal uses (UI_BASE_URL env override included).
    const markdown = renderPageKnowledgeMarkdown(id, result);
    fs.writeFileSync(paths.pageKnowledgeFile, markdown);
    process.stderr.write(
      `[scaffold] wrote docs/${pageKnowledgeRel} (${result.elements.length} elements, ${result.dialogs.length} dialogs observed)\n`,
    );
  } else {
    process.stderr.write(`[scaffold] docs/${pageKnowledgeRel} already exists — reusing it as-is, recon skipped\n`);
  }

  insertConfigHost(id, urlPath);
  process.stderr.write(`[scaffold] added config.${configKey} to src/core/config.ts\n`);

  fs.writeFileSync(paths.goalFile, renderGoalFileTemplate(id, configKey, description, pageKnowledgeRel, driverFileRel));
  process.stderr.write(
    `[scaffold] wrote src/goal-evolution/goals/${id}.ts (succeedsWhen left for a human — see ${ORACLE_NOT_WRITTEN_MARKER})\n`,
  );

  fs.writeFileSync(paths.specFile, renderSpecFileTemplate(id, configKey, exportName));
  process.stderr.write(`[scaffold] wrote ${specFileRel}\n`);

  insertRegistryEntry(id, specFileRel);
  process.stderr.write(`[scaffold] registered "${id}" in src/goal-evolution/run.ts\n`);

  execFileSync(
    'npx',
    [
      'prettier',
      '--write',
      paths.goalFile,
      paths.specFile,
      paths.pageKnowledgeFile,
      paths.configFile,
      path.join(REPO_ROOT, 'src/goal-evolution/run.ts'),
    ],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    },
  );

  process.stderr.write(
    `\n[scaffold] done. Next steps:\n` +
      `  1. Read docs/${pageKnowledgeRel} and write ${exportName}.succeedsWhen in src/goal-evolution/goals/${id}.ts by hand.\n` +
      `  2. Run: npm run goal-evolution -- ${id}\n` +
      `  (typecheck will fail until step 1 is done and the driver exists — that's expected.)\n`,
  );
}

function main(): void {
  const [id, urlPath, ...descriptionParts] = process.argv.slice(2);
  const description = descriptionParts.join(' ');
  if (!id || !urlPath || !description) {
    process.stderr.write('Usage: npm run goal-evolution:new -- <id> <path> "<description>"\n');
    process.exitCode = 1;
    return;
  }
  scaffold({ id, urlPath, description }).catch((err) => {
    process.stderr.write(`[scaffold] failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

if (require.main === module) {
  main();
}
