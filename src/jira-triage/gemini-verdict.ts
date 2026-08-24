// The two model calls collect-context.ts needs (is-there-enough-context, is-this-sibling-relevant)
// only need a one-word answer — agent-fixer's/test-evolution's Gemini CLI pattern is for agentic
// file edits and is the wrong tool here (no way to get a plain string back into a variable without
// parsing CLI stdout). This calls the Generative Language API directly instead, the same API
// healwright itself calls under the hood, reusing the same AI_API_KEY.

const MODEL = process.env.AI_MODEL ?? 'gemini-3.6-flash';

export async function askYesNo(prompt: string): Promise<boolean> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY is not set — required for jira-triage yes/no verdicts');
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}\n\nAnswer with exactly one word: YES or NO.` }] }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY is not set — required for jira-triage verdicts');
  }

  const instructed = [
    prompt,
    '',
    'Respond with exactly two lines, nothing else:',
    'VERDICT: YES or NO',
    'REASON: one sentence explaining why',
  ].join('\n');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: instructed }] }] }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

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
