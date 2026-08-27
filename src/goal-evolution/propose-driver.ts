// Resolves a Goal into a driver file — a client/Page Object plus one exported achieve(...)
// function — via the goal-solver persona (extends test-developer, see
// ai-agents/personas/goal-solver.md). Mirrors test-evolution/propose-test.ts's pattern (shared
// 3-tier CLI fallback, persona file prepended to a task block) but the task is a goal description,
// never a step-by-step script — the agent decides the sequence AND the layer (UI vs. API) itself
// from docs/page-knowledge/<page>.md. The GOAL description never tells the agent which layer to
// use — see book-store-register-user.ts: it only says "figure out from the page-knowledge notes".
// The page-knowledge file itself, though, states its conclusion outright ("Why this is API-only,
// not UI"), so what's actually being exercised here is the agent reading and correctly acting on
// a documented conclusion, not deriving one from raw evidence — see README's calibration note on
// this goal for the exact claim this demo supports.
//
// Deliberately does NOT let the agent touch the spec file or write any assertion: see goal.ts's
// header comment for why. This module's output scope is the driver file only.

import * as fs from 'fs';
import * as path from 'path';
import { runAgenticEdit } from '../ai-agents/cli-fallback';
import { Goal } from './goal';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/goal-solver.md');

function buildPrompt<TCtx>(goal: Goal<TCtx>): string {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const pageKnowledge = fs.readFileSync(path.join(__dirname, '../..', goal.pageKnowledgeFile), 'utf-8');

  const task = [
    `## Goal`,
    '',
    goal.description,
    '',
    `Page-knowledge file (${goal.pageKnowledgeFile}) — this is your ground truth for locators,`,
    'endpoints, and behavior; you have no browser or network access of your own to explore with:',
    '```markdown',
    pageKnowledge,
    '```',
    '',
    `Write to ${goal.driverFile}. Follow the existing three-layer shape for whichever layer the`,
    'page-knowledge notes tell you is actually achievable for this goal: a UI Page Object (see',
    'src/ui/pages/text-box.page.ts for the pattern) if it has to be the browser, or a thin API',
    'client (see src/api/clients/booking.client.ts for the pattern) if the goal is only reachable',
    'through a REST endpoint. Do not create a steps file or a spec file — this run covers only the',
    'client/Page Object file.',
    '',
    'In that same file, also export a standalone async function `achieve(...)` that performs',
    'whatever sequence of interactions accomplishes the goal above. It MUST have exactly this',
    `signature — the calling spec is already written against it and will fail to compile otherwise:`,
    '```typescript',
    goal.achieveSignature,
    '```',
    'The parameters (if any beyond the ones shown) are generated fresh by the calling spec each',
    'run — accept them as parameters rather than inventing your own values. Do not write any',
    'assertion/expect call anywhere, and do not decide on your own what counts as success — your',
    'job ends the moment the interaction is performed; a separate, fixed check that you do not',
    'write and will not see decides afterward whether the goal was actually reached.',
  ].join('\n');

  return `${persona}\n\n---\n\n## Task\n\n${task}`;
}

export function proposeDriver<TCtx>(goal: Goal<TCtx>, timeoutMs?: number): void {
  runAgenticEdit(buildPrompt(goal), undefined, timeoutMs);
}
