// Maps a git diff to the spec files it actually touches, via a real TypeScript import graph
// (not a coarse project/folder guess) — so a change to src/ui/pages/text-box.page.ts selects only
// tests/ui/text-box.spec.ts, not the whole ui project. Anything outside the import graph's reach
// (build/CI config) falls back to "run everything" rather than trying to be clever about its
// blast radius.

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const TSCONFIG_PATH = path.join(REPO_ROOT, 'tsconfig.json');

// A change to any of these can affect behavior in ways the import graph can't see (compiler
// options, CI steps, dependency versions) — never try to scope these, just run everything.
const FALLBACK_TRIGGERS = [
  'playwright.config.ts',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
];

export interface AffectedResult {
  specs: string[];
  runAll: boolean;
  changedFiles: string[];
}

function changedFiles(baseRef: string): string[] {
  const output = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  return output.split('\n').filter(Boolean);
}

function triggersFallback(files: string[]): boolean {
  return files.some((f) => FALLBACK_TRIGGERS.includes(f) || f.startsWith('.github/workflows/'));
}

function findSpecFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSpecFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      results.push(full);
    }
  }
  return results;
}

function loadCompilerOptions(): ts.CompilerOptions {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, REPO_ROOT);
  return parsed.options;
}

// Recursively resolves every local (repo-internal) import reachable from `entryFile`, memoizing
// per-file so a shared dependency like src/core/config.ts is only walked once even though many
// specs import it. Anything that resolves outside REPO_ROOT (node_modules, @playwright/test) is
// a dead end — its own imports are never followed.
function collectLocalDependencies(entryFile: string, compilerOptions: ts.CompilerOptions, memo: Map<string, Set<string>>): Set<string> {
  const cached = memo.get(entryFile);
  if (cached) return cached;

  const deps = new Set<string>([entryFile]);
  memo.set(entryFile, deps); // set before recursing to guard against import cycles

  const sourceText = fs.readFileSync(entryFile, 'utf-8');
  const sourceFile = ts.createSourceFile(entryFile, sourceText, ts.ScriptTarget.ES2022, true);

  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const specifier of specifiers) {
    const resolved = ts.resolveModuleName(specifier, entryFile, compilerOptions, ts.sys);
    const resolvedPath = resolved.resolvedModule?.resolvedFileName;
    if (!resolvedPath) continue; // untyped/ambient module — nothing to walk further

    const normalized = path.normalize(resolvedPath);
    if (!normalized.startsWith(REPO_ROOT) || normalized.includes(`${path.sep}node_modules${path.sep}`)) {
      continue; // external package — its transitive deps don't matter for impact analysis
    }

    for (const dep of collectLocalDependencies(normalized, compilerOptions, memo)) {
      deps.add(dep);
    }
  }

  return deps;
}

export function getAffectedSpecs(baseRef: string): AffectedResult {
  const changed = changedFiles(baseRef);

  if (triggersFallback(changed)) {
    return { specs: [], runAll: true, changedFiles: changed };
  }

  const compilerOptions = loadCompilerOptions();
  const specFiles = findSpecFiles(TESTS_DIR);
  const memo = new Map<string, Set<string>>();

  const changedAbsolute = new Set(changed.map((f) => path.normalize(path.join(REPO_ROOT, f))));

  const affected = specFiles.filter((spec) => {
    const deps = collectLocalDependencies(spec, compilerOptions, memo);
    for (const dep of deps) {
      if (changedAbsolute.has(dep)) return true;
    }
    return false;
  });

  return {
    specs: affected.map((f) => path.relative(REPO_ROOT, f)),
    runAll: false,
    changedFiles: changed,
  };
}
