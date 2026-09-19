// Writes the AI-authored half of onboarding a new API: steps + a spec file exercising the
// already-generated (deterministic, not AI-written) client and types. Same pattern as
// src/test-evolution/propose-test.ts — persona file concatenated with a task description, run
// through the shared 3-tier CLI fallback (see src/ai-agents/cli-fallback.ts).

import * as fs from 'fs';
import * as path from 'path';
import { runAgenticEdit } from '../ai-agents/cli-fallback';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/api-onboarder.md');

export interface OnboardingTarget {
  apiName: string;
  clientFile: string;
  typesFile: string;
  stepsOutputFile: string;
  specOutputFile: string;
  baseUrl: string;
}

function buildPrompt(target: OnboardingTarget): string {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const task = [
    `A new REST API, "${target.apiName}" (base URL: ${target.baseUrl}), has just been onboarded`,
    'into this suite. Its client and types were generated deterministically from its OpenAPI/Swagger',
    `document and already exist — read them first: ${target.clientFile} and ${target.typesFile}.`,
    'Do not modify either file.',
    '',
    `Write a steps file at ${target.stepsOutputFile}, following the existing`,
    '`test.step()`-wrapping pattern used by sibling files in src/api/steps/*.steps.ts — one method',
    'per user-facing action, each calling a method on the generated client.',
    '',
    `Write a spec file at ${target.specOutputFile} with 2-4 tests: at least one happy-path`,
    'CRUD-style flow through the steps file, and at least one edge case (invalid input, a',
    'not-found id, a missing required field).',
    '',
    'Remember this is a shared public demo API — every test must create its own uniquely-named',
    'data, assert only on what it created, and delete it before finishing. Never assert on a',
    'global list count or on data the test did not create itself.',
    '',
    'Do not run the tests yourself — another step does that.',
  ].join('\n');

  return `${persona}\n\n---\n\n## Task\n\n${task}`;
}

export function proposeOnboarding(target: OnboardingTarget): void {
  runAgenticEdit(buildPrompt(target), undefined, undefined, 'api-onboarder');
}
