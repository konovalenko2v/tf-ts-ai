// Turns a broken-selector + healwright-cache prompt into a proposed source edit.
//
// Two implementations exist:
// - proposeFixesWithGemini (active): a direct @google/genai call asking for a small structured
//   JSON diff. Reuses the same AI_API_KEY healwright already needs, so no extra paid credential
//   is required to run agent-fixer.
// - proposeFixesWithClaudeCode (commented out below): drives the `claude` CLI as an agent — it
//   reads the file itself, applies the edit with the Edit tool, and re-runs `tsc --noEmit`,
//   which generalizes better to fixes more complex than "replace one argument" and needs no
//   apply/verify loop of our own. Left in place as the natural upgrade path once a paid
//   ANTHROPIC_API_KEY is available — swap the import in run.ts to switch.

import { GoogleGenAI, Type } from '@google/genai';

export interface FixProposal {
  selector: string;
  found: boolean;
  replacementCode?: string; // e.g. `page.getByRole('option', { name: 'NCR' })`
  reason?: string;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fixes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          selector: { type: Type.STRING },
          found: { type: Type.BOOLEAN },
          replacementCode: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ['selector', 'found'],
      },
    },
  },
  required: ['fixes'],
};

export async function proposeFixesWithGemini(
  brokenSelectors: string[],
  healedCacheJson: string,
): Promise<FixProposal[]> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error('AI_API_KEY is not set — agent-fixer reuses the healwright key');

  const ai = new GoogleGenAI({ apiKey });
  const prompt = [
    'Each of these Playwright locator selectors is broken in source, but healwright (a runtime',
    'self-healing wrapper) already found and cached a working replacement for it. Your job is only',
    'to produce that replacement as a Playwright locator expression — you are not editing any file.',
    '',
    'Broken selectors:',
    ...brokenSelectors.map((s) => `- ${s}`),
    '',
    "healwright's cache (from .self-heal/healed_locators.json):",
    '```json',
    healedCacheJson,
    '```',
    '',
    'Each cache entry\'s "context" field is the contextName that was paired with one of the broken',
    'selectors above in source (e.g. `heal.click(locator(\'<broken selector>\'), \'<context>\')`).',
    'Match broken selectors to cache entries by finding the entry whose recovered strategy is for',
    'the same UI element (the strategy itself does not repeat the broken selector, so match by',
    'process of elimination when there is exactly one broken selector and one cache entry left).',
    '',
    'For each broken selector, if you can confidently identify its cache entry, output',
    '`replacementCode` as a single Playwright locator expression built from that entry\'s strategy —',
    "e.g. `page.getByRole('option', { name: 'NCR' })` for a role strategy, `page.locator('#foo')`",
    'for a css strategy, `page.getByText(\'...\')` for a text strategy — and set `found: true`. If you',
    'cannot confidently match it, set `found: false` and leave replacementCode empty.',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: process.env.AI_MODEL ?? 'gemini-3.6-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty response');
  const parsed = JSON.parse(text) as { fixes: FixProposal[] };
  return parsed.fixes;
}

// --- Alternative implementation (commented out — needs a paid ANTHROPIC_API_KEY) ---
//
// import { execFileSync } from 'child_process';
//
// export function proposeFixesWithClaudeCode(brokenSelectors: string[], healedCacheJson: string): void {
//   const prompt = [...]; // same broken-selector + cache prompt, plus explicit file-edit instructions
//   execFileSync('claude', [
//     '-p', prompt,
//     '--permission-mode', 'acceptEdits',
//     '--allowedTools', 'Read,Edit,Grep,Glob,Bash(npx tsc --noEmit)',
//   ], { stdio: 'inherit' });
//   // claude edits src/ui/pages/practice-form.page.ts directly; run.ts only needs to check
//   // `git status --porcelain` afterwards instead of applying a diff itself.
// }
