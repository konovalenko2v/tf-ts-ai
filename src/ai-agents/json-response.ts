// Shared parser for AI replies that are supposed to be a single JSON object.
//
// Every JSON-STRICT persona (ai-agents/personas/healing-classifier.md, retry-dispatcher.md) tells
// the model "no text before or after the JSON" — and models still routinely wrap it in a ```json
// fence, or add a lead-in sentence, regardless. Each caller re-implementing that unwrapping is how
// two call sites end up with two subtly different tolerances for the same model quirk, so it lives
// here once instead.
//
// Deliberately NOT merged into gemini-text.ts's askYesNo/askYesNoWithReason: those parse a fixed
// VERDICT/REASON line format out of prose, this parses a JSON object — same provider, different
// response contract.

/**
 * Extracts a JSON value from a model reply, tolerating a ```json fence and any prose around it.
 * Throws (via JSON.parse) if what's found isn't valid JSON — callers validate the shape separately,
 * since "parsed but wrong shape" needs a different error message than "not JSON at all".
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}
