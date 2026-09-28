// Writes the AI-authored half of onboarding a new API: steps + a spec file exercising the
// already-generated (deterministic, not AI-written) client and types. Same pattern as
// src/test-evolution/propose-test.ts — persona file concatenated with a task description, run
// through the shared 3-tier CLI fallback (see src/ai-agents/cli-fallback.ts).

import * as fs from 'fs';
import * as path from 'path';
import { runAgenticEdit } from '../ai-agents/cli-fallback';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/api-onboarder.md');

export interface LoginHint {
  methodName: string;
  usernameEnvVar: string;
  passwordEnvVar: string;
}

export interface OnboardingTarget {
  apiName: string;
  clientFile: string;
  typesFile: string;
  stepsOutputFile: string;
  specOutputFile: string;
  baseUrl: string;
  // Set when the spec's paths contain a POST operation that looks like a login endpoint (see
  // openapi-types.ts's findLoginOperation) — the spec's own `security` field is not trustworthy
  // for this: a session-cookie API commonly leaves every operation's security undeclared, since
  // the spec author never has to state "you need the cookie the login call gave you" for it to be
  // true in practice. Undefined means no login-shaped operation was found, not that auth is known
  // to be unnecessary — the persona is told either way, see buildPrompt below.
  loginHint?: LoginHint;
}

function buildPrompt(target: OnboardingTarget): string {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const authNote = target.loginHint
    ? [
        '',
        `This API has a login-shaped operation: ${target.loginHint.methodName}(). Its other endpoints may`,
        'require the session it establishes even though the spec does not declare a `security`',
        'requirement on them — a spec author frequently leaves this undeclared for a session-cookie API,',
        "since the requirement is only ever visible in the live server's behavior, not the document.",
        `Call it once per test, before any other client method, with credentials read from`,
        `process.env.${target.loginHint.usernameEnvVar} and process.env.${target.loginHint.passwordEnvVar}`,
        '(read them directly with process.env — do not invent a config helper). If either is unset,',
        'throw a clear error naming both variables rather than sending empty-string credentials.',
        'Because every other test depends on a successful login, do NOT write a "wrong credentials"',
        'negative test for the login endpoint itself — a real 401 there would be indistinguishable',
        'from a misconfigured env var and would misreport as a product bug.',
      ].join('\n')
    : [
        '',
        'No login-shaped operation was found in this spec. If a non-login endpoint unexpectedly',
        'returns 401/403 when you reason through the flow, say so in a comment instead of guessing at',
        'undocumented auth — do not invent a login call the spec never described.',
      ].join('\n');

  const task = [
    `A new REST API, "${target.apiName}" (base URL: ${target.baseUrl}), has just been onboarded`,
    'into this suite. Its client and types were generated deterministically from its OpenAPI/Swagger',
    `document and already exist — read them first: ${target.clientFile} and ${target.typesFile}.`,
    'Do not modify either file.',
    authNote,
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
