import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { findRecoveries, findScreenshotForTest } from './find-recoveries';
import { findByContext, loadHealedCache, renderLocatorExpression } from './cache-lookup';
import { proposeFixWithAI } from './fix-proposer';

const SELF_HEAL_CACHE = '.self-heal/healed_locators.json';
const TARGET_FILE = 'src/ui/pages/practice-form.page.ts';
const BRANCH_PREFIX = 'agent-fixer/';
const SKIP_MARKER = 'agent-fixer: skip';

interface BrokenLocator {
  selector: string;
  contextName: string;
  lineIndex: number;
  testId: string;
}

function currentBranch(): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
}

// A selector is skipped if the nearest non-blank line above it is a comment carrying the marker
// — walking up stops at the first real code line, so it can't leak across an unrelated line.
function isSkipped(fileLines: string[], matchLineIndex: number): boolean {
  for (let i = matchLineIndex - 1; i >= 0; i--) {
    const trimmed = fileLines[i].trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('//')) return false;
    if (trimmed.includes(SKIP_MARKER)) return true;
  }
  return false;
}

// Finds each broken selector's line in source and extracts the contextName paired with it in
// `heal.click(locator('<selector>'), '<contextName>')` — that contextName is the exact join key
// into healwright's cache (cache entry `context` field), so this is done once here rather than
// re-derived downstream.
function locateInSource(brokenSelectors: Map<string, string>): BrokenLocator[] {
  const lines = fs.readFileSync(TARGET_FILE, 'utf-8').split('\n');
  const found: BrokenLocator[] = [];
  for (const [selector, testId] of brokenSelectors) {
    const lineIndex = lines.findIndex((l) => l.includes(`this.page.locator('${selector}')`));
    if (lineIndex === -1) {
      process.stderr.write(`[agent-fixer] selector ${selector} not found in ${TARGET_FILE} — skipping\n`);
      continue;
    }
    if (isSkipped(lines, lineIndex)) {
      process.stderr.write(`[agent-fixer] ${selector} is marked "${SKIP_MARKER}" — leaving it untouched\n`);
      continue;
    }
    const contextMatch = lines[lineIndex].match(/,\s*'([^']+)'\s*\)/);
    if (!contextMatch) {
      process.stderr.write(`[agent-fixer] could not extract contextName for ${selector} — skipping\n`);
      continue;
    }
    found.push({ selector, contextName: contextMatch[1], lineIndex, testId });
  }
  return found;
}

function applyReplacement(lineIndex: number, selector: string, replacementCode: string): void {
  const source = fs.readFileSync(TARGET_FILE, 'utf-8');
  const lines = source.split('\n');
  const needle = `this.page.locator('${selector}')`;
  const replacementWithThis = replacementCode.startsWith('page.') ? `this.${replacementCode}` : replacementCode;
  lines[lineIndex] = lines[lineIndex].replace(needle, replacementWithThis);
  fs.writeFileSync(TARGET_FILE, lines.join('\n'));
}

async function main(): Promise<void> {
  if (currentBranch().startsWith(BRANCH_PREFIX)) {
    process.stderr.write('[agent-fixer] running on an agent-fixer branch — skipping to avoid a loop\n');
    return;
  }

  const recoveries = findRecoveries();
  const brokenSelectors = new Map<string, string>(); // selector -> testId
  for (const step of recoveries) {
    for (const err of step.recoveredErrors ?? []) {
      if (err.selector) brokenSelectors.set(err.selector, step.testId);
    }
  }

  if (brokenSelectors.size === 0) {
    process.stderr.write('[agent-fixer] no passed_with_recovery steps found — nothing to fix\n');
    return;
  }

  const candidates = locateInSource(brokenSelectors);
  if (candidates.length === 0) {
    process.stderr.write('[agent-fixer] nothing left to fix after applying skip markers\n');
    return;
  }

  const cache = fs.existsSync(SELF_HEAL_CACHE) ? loadHealedCache(fs.readFileSync(SELF_HEAL_CACHE, 'utf-8')) : {};

  const branch = `${BRANCH_PREFIX}${Date.now()}`;
  execFileSync('git', ['checkout', '-b', branch], { stdio: 'inherit' });

  const applied: { selector: string; replacementCode: string; source: 'cache' | 'ai-fallback' }[] = [];
  const unresolved: string[] = [];

  for (const candidate of candidates) {
    // Layer 1: deterministic cache lookup — no AI call, healwright already did the work.
    const strategy = findByContext(cache, candidate.contextName);
    const cachedExpr = strategy ? renderLocatorExpression(strategy) : undefined;
    if (cachedExpr) {
      applyReplacement(candidate.lineIndex, candidate.selector, cachedExpr);
      applied.push({ selector: candidate.selector, replacementCode: cachedExpr, source: 'cache' });
      continue;
    }

    // Layer 2: AI fallback (locator-medic persona) — only reached when the cache has no exact
    // answer. Runs the shared 3-tier CLI fallback (Gemini -> Gemini -> Claude), which edits
    // TARGET_FILE itself; detect whether it actually changed the broken selector's line.
    // A CLI failure (rate limit, quota, network) must not abort the whole run — cache-layer
    // fixes already applied for other selectors are still worth committing and opening a PR for.
    const before = fs.readFileSync(TARGET_FILE, 'utf-8').split('\n')[candidate.lineIndex];
    const screenshotPath = findScreenshotForTest(candidate.testId);
    try {
      proposeFixWithAI(candidate.selector, candidate.contextName, TARGET_FILE, screenshotPath);
    } catch (err) {
      process.stderr.write(`[agent-fixer] AI fallback failed for ${candidate.selector}: ${(err as Error).message}\n`);
      unresolved.push(candidate.selector);
      continue;
    }
    const afterLines = fs.readFileSync(TARGET_FILE, 'utf-8').split('\n');
    const after = afterLines[candidate.lineIndex];
    if (after !== before && !after.includes(candidate.selector)) {
      applied.push({ selector: candidate.selector, replacementCode: after.trim(), source: 'ai-fallback' });
    } else {
      unresolved.push(candidate.selector);
    }
  }

  if (unresolved.length > 0) {
    process.stderr.write(`[agent-fixer] ${unresolved.length} selector(s) still need a human: ${unresolved.join(', ')}\n`);
  }

  if (applied.length === 0) {
    process.stderr.write('[agent-fixer] no fixes applied — nothing to commit\n');
    execFileSync('git', ['checkout', 'master'], { stdio: 'inherit' });
    execFileSync('git', ['branch', '-D', branch], { stdio: 'inherit' });
    return;
  }

  execFileSync('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });

  execFileSync('git', ['add', TARGET_FILE], { stdio: 'inherit' });
  execFileSync(
    'git',
    [
      'commit',
      '-m',
      'agent-fixer: replace healwright-recovered locators\n\nAuto-generated from .observability/ passed_with_recovery records.',
    ],
    { stdio: 'inherit' },
  );
  execFileSync('git', ['push', 'origin', branch], { stdio: 'inherit' });
  execFileSync(
    'gh',
    [
      'pr',
      'create',
      '--title',
      'agent-fixer: replace healwright-recovered locators',
      '--body',
      [
        'Auto-generated by agent-fixer from `.observability/` `passed_with_recovery` records.',
        '',
        'Fixes applied:',
        ...applied.map(
          (f) => `- \`${f.selector}\` -> \`${f.replacementCode}\` (${f.source === 'cache' ? 'from healwright cache, no AI call' : 'locator-medic AI fallback, no cache match'})`,
        ),
        ...(unresolved.length > 0
          ? ['', 'Selectors that still need a human:', ...unresolved.map((s) => `- \`${s}\``)]
          : []),
        '',
        `See \`${SELF_HEAL_CACHE}\` in this branch for the exact strategy/confidence healwright used to recover the cache-layer fixes at runtime — review the confidence before merging, a low-confidence match may be overfit to one page state. locator-medic (AI fallback) fixes have no such record and deserve closer review.`,
      ].join('\n'),
    ],
    { stdio: 'inherit' },
  );
}

main().catch((err) => {
  process.stderr.write(`[agent-fixer] failed: ${err.message}\n`);
  process.exitCode = 1;
});
