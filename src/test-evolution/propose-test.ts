// Proposes one new edge-case test for an existing spec, in the same style, backed by an AI CLI
// agent — the same pattern agent-fixer already validates (branch, AI edits files, PR), applied to
// authoring instead of repair. Runs the shared 3-tier CLI fallback (Claude -> Gemini -> Gemini,
// see src/ai-agents/cli-fallback.ts) under the test-developer persona (ai-agents/personas/).
//
// The gate here can't be "compiles" the way agent-fixer's locator fix can: a generated assertion
// can compile and still be *wrong* — e.g. asserting a 400 where this API documents a 200 for the
// same shape of malformed input (see tests/api/negative.spec.ts). So this only proposes a test
// after actually running it and watching it pass; a generated test that fails is discarded, not
// proposed, because a framework that ships tests it can't demonstrate hold isn't trustworthy.
//
// Output goes to a NEW file, never into the reference spec: the diff stays purely additive (the
// CLI can't touch 100+ lines of working tests), and it sidesteps that file's shared
// `createdBookingIds` + `afterEach` cleanup contract, which a generated test would have to know
// about to avoid leaking a booking.

import * as fs from 'fs';
import * as path from 'path';
import { runAgenticEdit } from '../ai-agents/cli-fallback';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/test-developer.md');

function buildPrompt(referenceFile: string, outputFile: string): string {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const task = [
    `Read ${referenceFile} — it's a Playwright API test spec with several edge-case tests`,
    'documenting how this REST API actually behaves for malformed/unusual input (some assert a',
    '200 where you might expect a 400 — that is the real, observed behavior, not a bug to fix).',
    '',
    `Write ONE new test in the same style into a new file: ${outputFile}.`,
    'It must exercise an edge case NOT already covered by the reference file — pick something',
    'genuinely different (a different field, a boundary value, a different malformed shape),',
    "not a minor variation of an existing test. State only what the API actually returns; don't",
    'assume validation exists unless you have reason to.',
    '',
    'Do not run the test yourself — another step does that.',
  ].join('\n');

  return `${persona}\n\n---\n\n## Task\n\n${task}`;
}

export function proposeTest(referenceFile: string, outputFile: string): void {
  runAgenticEdit(buildPrompt(referenceFile, outputFile), undefined, undefined, 'test-evolution');
}
