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
