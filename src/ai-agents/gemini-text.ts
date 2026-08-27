// Shared Gemini-text-call helper: any module that needs a plain string/verdict back (not an
// agentic file edit — that's cli-fallback.ts) uses this instead of calling the REST API directly.
// This calls the Generative Language API directly, the same API healwright itself calls under the
// hood, reusing the same AI_API_KEY/AI_MODEL_FALLBACK pair fixtures.ts already establishes for
// exactly this quota-exhaustion scenario (free-tier quotas are tracked per model, so a second
// model has its own untouched daily allowance).
//
// Model resolution is per-call, not module-level: jira-triage and qa-analyst want AI_MODEL (the
// same tier that does everything else); reviewer-tests explicitly needs a DIFFERENT tier from
// whatever generated the code it's reviewing — a cheap model reviewing its own output defeats the
// point of a paranoid profile. Callers pass their own primary/fallback pair; askYesNo/
// askYesNoWithReason default to AI_MODEL/AI_MODEL_FALLBACK when the caller doesn't care.

const DEFAULT_MODEL = process.env.AI_MODEL ?? 'gemini-3.6-flash';
const DEFAULT_FALLBACK_MODEL = process.env.AI_MODEL_FALLBACK;

function isQuotaExhausted(message: string): boolean {
  return message.includes('RESOURCE_EXHAUSTED') || message.includes('"code":429') || message.includes(' 429');
}

async function callGeminiOnce(model: string, prompt: string): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY is not set');
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

export interface ModelPair {
  primary: string;
  fallback?: string;
  /** Prefixes stderr fallback/failure logs, e.g. '[jira-triage]'. */
  logTag?: string;
}

const DEFAULT_PAIR: ModelPair = { primary: DEFAULT_MODEL, fallback: DEFAULT_FALLBACK_MODEL, logTag: '[ai-agents]' };

export async function callGemini(prompt: string, models: ModelPair = DEFAULT_PAIR): Promise<string> {
  try {
    return await callGeminiOnce(models.primary, prompt);
  } catch (err) {
    const message = (err as Error).message;
    if (!models.fallback || !isQuotaExhausted(message)) throw err;
    process.stderr.write(`${models.logTag ?? '[ai-agents]'} ${models.primary} quota exhausted — retrying with fallback model ${models.fallback}\n`);
    return callGeminiOnce(models.fallback, prompt);
  }
}

export async function askYesNo(prompt: string, models: ModelPair = DEFAULT_PAIR): Promise<boolean> {
  const text = await callGemini(`${prompt}\n\nAnswer with exactly one word: YES or NO.`, models);
  return /\byes\b/i.test(text);
}

export interface YesNoWithReason {
  verdict: boolean;
  reason: string;
}

// Same call shape as askYesNo, but for a verdict that needs a stated reason attached (surfaced in
// a CI job summary / PR description), not just a boolean nobody can audit.
export async function askYesNoWithReason(prompt: string, models: ModelPair = DEFAULT_PAIR): Promise<YesNoWithReason> {
  const instructed = [
    prompt,
    '',
    'Respond with exactly two lines, nothing else:',
    'VERDICT: YES or NO',
    'REASON: one sentence explaining why',
  ].join('\n');

  const text = await callGemini(instructed, models);

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
