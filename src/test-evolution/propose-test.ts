// Proposes one new edge-case test for an existing spec, in the same style, backed by an AI CLI
// agent — the same pattern agent-fixer already validates (branch, AI edits files, PR), applied to
// authoring instead of repair.
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

import { execFileSync } from 'child_process';

const MODEL = 'gemini-3.5-flash'; // distinct from healwright's gemini-3.6-flash primary — own daily quota

function buildPrompt(referenceFile: string, outputFile: string): string {
  return [
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
    'Reuse the same imports, `config`, and data builders the reference file uses where they fit.',
    'If your new test creates a booking via POST, you are on your own for cleanup — do not import',
    "the reference file's createdBookingIds/afterEach, write a self-contained test.",
    '',
    'Do not modify the reference file. Do not run the test yourself — another step does that.',
    'Do not search the web or fetch any URL.',
  ].join('\n');
}

function proposeTestWithGemini(prompt: string): void {
  execFileSync(
    'gemini',
    [
      '-p',
      prompt,
      '-m',
      MODEL,
      '--approval-mode',
      'auto_edit',
      '--skip-trust',
      '--allowed-tools',
      'read_file,write_file,edit,glob,grep',
    ],
    { stdio: 'inherit' },
  );
}

// Fallback path — reached whenever the Gemini CLI call fails for any reason (quota exhaustion is
// what's actually been hit in practice, but stdio: 'inherit' means the live output goes straight
// to the terminal rather than a buffer this process can pattern-match, so any nonzero exit is
// treated the same way rather than trying to distinguish quota from a transient CLI error).
// Authenticates via the user's existing Claude Code subscription session, not an API key — no
// ANTHROPIC_API_KEY needed (confirmed: `claude -p` works with none set in this project's env).
function proposeTestWithClaude(prompt: string): void {
  execFileSync(
    'claude',
    ['-p', prompt, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Edit,Glob,Grep'],
    { stdio: 'inherit' },
  );
}

export function proposeTest(referenceFile: string, outputFile: string): void {
  const prompt = buildPrompt(referenceFile, outputFile);

  try {
    proposeTestWithGemini(prompt);
  } catch (err) {
    process.stderr.write(
      `[test-evolution] gemini CLI failed (${(err as Error).message.split('\n')[0]}) — retrying with claude CLI\n`,
    );
    proposeTestWithClaude(prompt);
  }
}
