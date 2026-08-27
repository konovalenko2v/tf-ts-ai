// reviewer-tests: reads a test file test-developer already wrote and that already passed a real
// run, and returns a VERDICT/REASON verdict via the shared gemini-text helper. Paranoid-profile
// gate: read-only, never edits the file.
//
// Deliberately does NOT default to AI_MODEL — that's the same tier that generated the code under
// review (test-developer runs on cli-fallback.ts's AI_AGENTS_MODEL, which itself falls back
// through AI_MODEL/AI_MODEL_FALLBACK before reaching Claude). A cheap model reviewing its own
// output at the same capability tier defeats the purpose of a paranoid pass.
//
// Loads ai-agents/profiles/paranoid.env itself (rather than requiring the caller to `source` it
// first) — a review step that silently falls back to the generation model when the profile isn't
// manually sourced defeats the entire point of a separate review tier, so this can't depend on an
// operator remembering an extra shell step.

import * as fs from 'fs';
import * as path from 'path';
import { askYesNoWithReason, YesNoWithReason } from './gemini-text';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/reviewer-tests.md');
const PROFILE_FILE = path.join(__dirname, '../../ai-agents/profiles/paranoid.env');

function loadReviewModel(): string {
  if (process.env.AI_REVIEW_MODEL) return process.env.AI_REVIEW_MODEL;

  if (fs.existsSync(PROFILE_FILE)) {
    const match = fs
      .readFileSync(PROFILE_FILE, 'utf-8')
      .split('\n')
      .find((line) => line.startsWith('AI_REVIEW_MODEL='));
    if (match) return match.split('=')[1].trim();
  }

  throw new Error(
    `AI_REVIEW_MODEL is not set and could not be read from ${PROFILE_FILE} — refusing to silently fall back to ` +
      'the generation model, since that would let the cheap model review its own output.',
  );
}

const REVIEW_MODEL = loadReviewModel();

export type ReviewVerdict = YesNoWithReason;

export async function reviewGeneratedTest(testFilePath: string, referenceFilePath: string): Promise<ReviewVerdict> {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const generatedCode = fs.readFileSync(testFilePath, 'utf-8');
  const referenceCode = fs.readFileSync(referenceFilePath, 'utf-8');

  const prompt = [
    persona,
    '',
    '---',
    '',
    '## Task',
    '',
    `Reference spec (already-established style/architecture), ${referenceFilePath}:`,
    '```typescript',
    referenceCode,
    '```',
    '',
    `Generated test to review, ${testFilePath}:`,
    '```typescript',
    generatedCode,
    '```',
  ].join('\n');

  return askYesNoWithReason(prompt, { primary: REVIEW_MODEL, logTag: '[reviewer-tests]' });
}
