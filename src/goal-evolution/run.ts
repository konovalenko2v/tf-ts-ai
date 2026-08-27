// Orchestrates one goal-based test end to end: agent resolves a Goal into a driver file, then this
// script verifies the agent stayed inside its contract (no assertions, plus whatever goal-specific
// check applies — see each goal's contractChecks) BEFORE running the fixed human-owned spec that
// actually judges the goal. A driver that violates its contract is rejected here regardless of
// whether the spec happens to pass — an agent that wrote its own expect() and always passes it
// proves nothing.
//
// A goal can fail to resolve for three DIFFERENT reasons, and they call for different budgets and
// different final reports — conflating them into one generic "it failed" is exactly the kind of
// non-finding a paranoid review would flag:
//   1. Generation itself never returns — an infra/model problem (hung CLI, auth, outage). Bounded
//      by ATTEMPT_TIMEOUT_MS per attempt (via cli-fallback's CliTimeoutError — a timeout is
//      re-thrown immediately, never silently falls through to the Gemini tiers, so it isn't
//      mistaken for "the model failed").
//   2. The driver comes back but violates its contract (writes its own expect(...), hardcodes an
//      identity, etc.) — the agent broke the rules it was given. No budget needed: this is
//      detected by reading the file, not by running anything.
//   3. The driver is clean but the ORACLE fails — the goal genuinely wasn't reached (or the
//      page-knowledge file the agent was given is wrong/stale). This is the one case retrying can
//      plausibly fix (a different generation run may pick a different, correct approach), so it's
//      the only one bounded by MAX_ATTEMPTS rather than stopping on the first failure.
//
// Usage: npm run goal-evolution -- <goal-id>  (defaults to buttons-dynamic-click)

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { proposeDriver } from './propose-driver';
import { CliTimeoutError } from '../ai-agents/cli-fallback';
import { Goal } from './goal';
import { buttonsDynamicClickGoal } from './goals/buttons-dynamic-click';
import { bookStoreRegisterUserGoal } from './goals/book-store-register-user';

const MAX_ATTEMPTS = 2; // see book-store-register-user.ts: each attempt can register a real user
// on a third-party server, so this is an orphan-account multiplier, not just a token budget —
// kept at the minimum that still lets one bad generation retry once.
const ATTEMPT_TIMEOUT_MS = 5 * 60 * 1000; // generation-only; the oracle spec run isn't bounded by
// this (Playwright's own test timeout already governs that).

type StopReason = 'generation-timeout' | 'contract-violation' | 'oracle-failed' | 'achieved';

interface RunEntry {
  // Goal<any>: run.ts only ever reads id/description/driverFile/contractChecks, never the
  // context-typed succeedsWhen — the registry deliberately erases TCtx rather than making run.ts
  // itself generic over it, since it never calls succeedsWhen (the spec files do).
  goal: Goal<any>;
  specFile: string;
  project: string;
}

const REGISTRY: Record<string, RunEntry> = {
  'buttons-dynamic-click': {
    goal: buttonsDynamicClickGoal,
    specFile: 'tests/ui/buttons-goal.spec.ts',
    project: 'ui',
  },
  'book-store-register-user': {
    goal: bookStoreRegisterUserGoal,
    specFile: 'tests/api/book-store-goal.spec.ts',
    project: 'api',
  },
};

const goalId = process.argv[2] ?? 'buttons-dynamic-click';
const entry = REGISTRY[goalId];

function verifyDriverContract(entry: RunEntry, source: string): string[] {
  const violations: string[] = [];

  if (/\bexpect\s*\(/.test(source)) {
    violations.push('driver file contains an expect(...) call — the agent must never author the success check');
  }

  if (entry.goal.contractChecks) {
    violations.push(...entry.goal.contractChecks(source));
  }

  return violations;
}

function report(entry: RunEntry, attempt: number, reason: StopReason, detail: string): void {
  const lines = [
    '',
    `[goal-evolution] === STOPPED: "${entry.goal.id}" after attempt ${attempt}/${MAX_ATTEMPTS} ===`,
    `Reason: ${reason}`,
    detail,
  ];

  if (reason === 'oracle-failed') {
    lines.push(
      '',
      'A contract-clean driver whose oracle fails repeatedly is usually NOT an agent mistake — it is',
      `evidence that ${entry.goal.pageKnowledgeFile} is wrong or stale (see README "Page Knowledge`,
      'Cache": staleness is only ever caught by a failure like this one, never proactively). Re-verify',
      'that file against the live site before re-running this goal.',
    );
  }
  if (reason === 'generation-timeout') {
    lines.push('', `Each attempt was capped at ${ATTEMPT_TIMEOUT_MS}ms of Claude CLI time — raise ATTEMPT_TIMEOUT_MS in run.ts if this goal is legitimately harder, not just retry blindly.`);
  }

  process.stderr.write(lines.join('\n') + '\n');
}

async function main(): Promise<void> {
  if (!entry) {
    throw new Error(`unknown goal id "${goalId}" — known goals: ${Object.keys(REGISTRY).join(', ')}`);
  }

  const driverPath = path.join(__dirname, '../..', entry.goal.driverFile);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Unlike test-evolution/run.ts (branch + abandon()), this demo runs directly against the
    // working tree, no branch — see README "Goal-Based Tests" for the scope note. Attempt 1 keeps
    // the original skip-on-exists guard (an already-present driver — hand-edited or from a prior
    // successful run — is trusted as-is, never silently deleted); only a RETRY (attempt > 1)
    // deletes the previous attempt's driver first, so a bad driver doesn't survive into the next
    // attempt while a good one a human is actively editing is never touched on a fresh run.
    if (attempt > 1 && fs.existsSync(driverPath)) fs.unlinkSync(driverPath);

    if (fs.existsSync(driverPath)) {
      process.stderr.write(`[goal-evolution] ${entry.goal.driverFile} already exists — skipping generation, running the oracle against it as-is\n`);
    } else {
      process.stderr.write(`[goal-evolution] attempt ${attempt}/${MAX_ATTEMPTS}: resolving goal "${entry.goal.id}": ${entry.goal.description}\n`);
      try {
        proposeDriver(entry.goal, ATTEMPT_TIMEOUT_MS);
      } catch (err) {
        if (err instanceof CliTimeoutError) {
          if (attempt === MAX_ATTEMPTS) {
            report(entry, attempt, 'generation-timeout', err.message);
            process.exitCode = 1;
            return;
          }
          process.stderr.write(`[goal-evolution] attempt ${attempt} timed out — retrying\n`);
          continue;
        }
        throw err; // an actual CLI failure (auth/quota/outage) — not this loop's concern to retry
      }
    }

    if (!fs.existsSync(driverPath)) {
      throw new Error(`agent did not produce the expected driver file at ${entry.goal.driverFile}`);
    }

    const source = fs.readFileSync(driverPath, 'utf-8');
    if (!/export\s+(async\s+)?function\s+achieve/.test(source) && !/export\s+const\s+achieve/.test(source)) {
      report(entry, attempt, 'contract-violation', `${entry.goal.driverFile} does not export an achieve(...) function as required by the goal-solver contract`);
      process.exitCode = 1;
      return; // not retried — a missing export isn't something a second attempt is likely to fix differently, and it's cheap to just look
    }

    const violations = verifyDriverContract(entry, source);
    if (violations.length > 0) {
      report(entry, attempt, 'contract-violation', `- ${violations.join('\n- ')}`);
      process.exitCode = 1;
      return;
    }

    process.stderr.write('[goal-evolution] driver contract OK — compiling\n');
    execFileSync('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });

    process.stderr.write(`[goal-evolution] running the fixed oracle spec (${entry.specFile})\n`);
    try {
      execFileSync('npx', ['playwright', 'test', entry.specFile, `--project=${entry.project}`, '--retries=0'], { stdio: 'inherit' });
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        report(entry, attempt, 'oracle-failed', (err as Error).message);
        process.exitCode = 1;
        return;
      }
      process.stderr.write(`[goal-evolution] attempt ${attempt}'s oracle failed — retrying with a fresh driver\n`);
      continue;
    }

    process.stderr.write(`[goal-evolution] goal achieved — oracle passed against agent-written driver (attempt ${attempt}/${MAX_ATTEMPTS})\n`);
    return;
  }
}

main().catch((err) => {
  process.stderr.write(`[goal-evolution] failed: ${err.message}\n`);
  process.exitCode = 1;
});
