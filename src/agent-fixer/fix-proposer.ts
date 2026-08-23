// AI fallback: only reached when the deterministic cache lookup (cache-lookup.ts) has no exact
// contextName match for a broken selector. That happens when healwright's cache doesn't have an
// answer to give — most commonly because SELF_HEAL wasn't enabled on the run that produced this
// recovery, or healing itself failed to find a replacement.
//
// Unlike the cache layer, this is a real agentic call: the Gemini CLI (`gemini`, same AI_API_KEY
// healwright already needs — no extra paid credential) reads the target file itself, edits the
// broken locator's line directly with its own tools, and re-runs `tsc --noEmit` to confirm the
// result compiles — the same agentic edit/verify loop a `claude -p` invocation would run, just
// on a provider that doesn't need a paid key. run.ts only needs to check `git status --porcelain`
// afterwards to see whether anything changed, exactly as it would for a claude-driven fallback.

import { execFileSync } from 'child_process';

export function proposeFixWithGemini(
  selector: string,
  contextName: string,
  targetFile: string,
  screenshotPath: string | undefined,
): void {
  const prompt = [
    `In ${targetFile}, find the line calling \`heal.click(this.page.locator('${selector}'), '${contextName}')\`.`,
    `The selector '${selector}' no longer matches anything on the page it drives`,
    '(https://demoqa.com/automation-practice-form).',
    '',
    screenshotPath
      ? `Read the screenshot at ${screenshotPath} — it's a capture of the page from the run where`
      : "No screenshot is available for this run, so you can't see the current page state.",
    screenshotPath
      ? `this locator failed. Find the element described by "${contextName}" in that screenshot,`
      : `Use only the description "${contextName}" and your knowledge of this specific DemoQA form`,
    screenshotPath
      ? 'and infer a Playwright locator that would match it — prefer getByRole/getByLabel/getByText'
      : '(react-select-based dropdowns rendering options with a generated id) to infer a locator —',
    screenshotPath ? 'over a css selector where possible.' : 'prefer getByRole/getByLabel/getByText over guessing a css id.',
    '',
    'Replace only the broken Locator argument (not the contextName, not the heal.click wrapper).',
    'If you cannot confidently identify the right element, leave the file unchanged and say so —',
    'do not guess a css selector you are not confident about.',
    '',
    'After editing, run `npx tsc --noEmit` to confirm the change compiles, and fix any type error',
    'your edit introduced before finishing.',
    '',
    'Do not search the web or fetch any URL — everything you need is either the description above',
    'or the screenshot file, both already provided.',
  ].join('\n');

  execFileSync(
    'gemini',
    [
      '-p',
      prompt,
      '--approval-mode',
      'auto_edit',
      '--skip-trust',
      // Explicitly excludes web_search/web_fetch — this fallback should only ever read/edit local
      // files and run tsc, never leave the machine to "research" the page. --allowed-tools is
      // deprecated in favor of the Policy Engine, but still enforced; a policy file is overkill
      // for this one restriction.
      '--allowed-tools',
      'read_file,write_file,edit,glob,grep,run_shell_command',
    ],
    { stdio: 'inherit' },
  );
}

// --- Alternative implementation (needs a paid ANTHROPIC_API_KEY) ---
//
// import { execFileSync } from 'child_process';
//
// export function proposeFixWithClaudeCode(selector: string, contextName: string, targetFile: string): void {
//   const prompt = [...]; // same broken-selector + contextName + live-page instructions
//   execFileSync('claude', [
//     '-p', prompt,
//     '--permission-mode', 'acceptEdits',
//     '--allowedTools', 'Read,Edit,Grep,Glob,Bash(npx tsc --noEmit)',
//   ], { stdio: 'inherit' });
// }
