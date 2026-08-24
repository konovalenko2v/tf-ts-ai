// The model calls collect-context.ts/verdict.ts need only need a plain string back — agent-fixer's/
// test-evolution's Gemini CLI pattern is for agentic file edits and is the wrong tool here (no way
// to get a string back into a variable without parsing CLI stdout). This calls the Generative
// Language API directly instead, the same API healwright itself calls under the hood, reusing the
// same AI_API_KEY/AI_MODEL_FALLBACK pair fixtures.ts already establishes for exactly this
// quota-exhaustion scenario (free-tier quotas are tracked per model, so a second model has its own
// untouched daily allowance).

const PRIMARY_MODEL = process.env.AI_MODEL ?? 'gemini-3.6-flash';
const FALLBACK_MODEL = process.env.AI_MODEL_FALLBACK;

function isQuotaExhausted(message: string): boolean {
  return message.includes('RESOURCE_EXHAUSTED') || message.includes('"code":429') || message.includes(' 429');
}

async function callGeminiOnce(model: string, prompt: string): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY is not set — required for jira-triage verdicts');
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API (${model}) returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callGemini(prompt: string): Promise<string> {
  try {
    return await callGeminiOnce(PRIMARY_MODEL, prompt);
  } catch (err) {
    const message = (err as Error).message;
    if (!FALLBACK_MODEL || !isQuotaExhausted(message)) throw err;
    process.stderr.write(`[jira-triage] ${PRIMARY_MODEL} quota exhausted — retrying with fallback model ${FALLBACK_MODEL}\n`);
    return callGeminiOnce(FALLBACK_MODEL, prompt);
  }
}

export async function askYesNo(prompt: string): Promise<boolean> {
  const text = await callGemini(`${prompt}\n\nAnswer with exactly one word: YES or NO.`);
  return /\byes\b/i.test(text);
}

export interface YesNoWithReason {
  verdict: boolean;
  reason: string;
}

// Same call shape as askYesNo, but for the final bug-vs-feature-change verdict — that decision
// needs a stated reason attached (surfaced in the CI job summary / eventual PR description), not
// just a boolean nobody can audit.
export async function askYesNoWithReason(prompt: string): Promise<YesNoWithReason> {
  const instructed = [
    prompt,
    '',
    'Respond with exactly two lines, nothing else:',
    'VERDICT: YES or NO',
    'REASON: one sentence explaining why',
  ].join('\n');

  const text = await callGemini(instructed);

  const verdictMatch = text.match(/VERDICT:\s*(YES|NO)/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);

  if (!verdictMatch) {
    throw new Error(`Could not parse a VERDICT line from the model response: ${text}`);
  }

  return {
    verdict: verdictMatch[1].toUpperCase() === 'YES',
    reason: reasonMatch?.[1]?.trim() ?? '(no reason given)',
  };
}
