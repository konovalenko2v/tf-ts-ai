// AI fallback: only reached when the deterministic cache lookup (cache-lookup.ts) has no exact
// contextName match for a broken selector. That happens when healwright's cache doesn't have an
// answer to give — most commonly because SELF_HEAL wasn't enabled on the run that produced this
// recovery, or healing itself failed to find a replacement.
//
// Unlike the cache layer, this is a real agentic call, run under the locator-medic persona
// (ai-agents/personas/locator-medic.md) through the same shared 3-tier CLI fallback
// (src/ai-agents/cli-fallback.ts) test-developer uses — Gemini primary -> Gemini fallback model
// -> Claude CLI, no separate paid credential for any tier.

import * as fs from 'fs';
import * as path from 'path';
import { runAgenticEdit } from '../ai-agents/cli-fallback';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/locator-medic.md');

export function proposeFixWithAI(
  selector: string,
  contextName: string,
  targetFile: string,
  screenshotPath: string | undefined,
): void {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const task = [
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
      ? 'and infer a Playwright locator that would match it.'
      : '(react-select-based dropdowns rendering options with a generated id) to infer a locator.',
    '',
    'After editing, run `npx tsc --noEmit` to confirm the change compiles, and fix any type error',
    'your edit introduced before finishing.',
  ].join('\n');

  const prompt = `${persona}\n\n---\n\n## Task\n\n${task}`;

  // agent-fixer's fallback needs shell access for `npx tsc --noEmit`, beyond cli-fallback's
  // DEFAULT_PROFILE — pass an explicit profile that adds it for the Gemini tiers only (the
  // Claude tier already includes Bash implicitly via its own allowedTools).
  runAgenticEdit(prompt, {
    geminiAllowedTools: 'read_file,write_file,edit,glob,grep,run_shell_command',
    claudeAllowedTools: 'Read,Write,Edit,Glob,Grep,Bash(npx tsc --noEmit)',
    claudePermissionMode: 'acceptEdits',
  });
}
