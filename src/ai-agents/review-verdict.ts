// Shared verdict shape + parser for every read-only AI review persona in this repo
// (`reviewer-tests`, `pr-reviewer`). Both personas emit the same output contract — a `VERDICT:
// YES|NO` line followed by one `- [ok|minor|major] Check: note` bullet per check — so the grammar
// that parses it lives in exactly one place.
//
// Extracted from reviewer-tests.ts (where it was module-private) rather than copied into
// pr-reviewer.ts: two independently maintained copies of one string format is the drift pattern
// this repo already paid for once — the agent-fixer branch prefix was a string literal duplicated
// between run.ts and regression.yml, and the fix was a single exported constant plus a test that
// fails when the two diverge (see safety-gates.ts / safety-gates.spec.ts). Same reasoning here.
//
// Deliberately provider-agnostic: reviewer-tests reaches the model through the `claude` CLI, while
// pr-reviewer goes through the Gemini REST helper (gemini-text.ts) because CI has no Claude
// credential. Nothing below knows or cares which — it parses text.

export type Severity = 'ok' | 'minor' | 'major';

export interface ReviewFinding {
  check: string;
  severity: Severity;
  note: string;
}

export interface ReviewVerdict {
  verdict: boolean;
  findings: ReviewFinding[];
}

// Renders the structured verdict as short markdown bullets for a human skimming a PR body —
// one line per check, severity tag up front, no run-on prose. See ai-agents/personas/reviewer-tests.md
// "Output contract" for why: a single "one sentence" reason field made a 4-part review
// (architecture/style/assertion-honesty/cleanup) unreadable once more than one check had a finding.
export function renderVerdict(v: ReviewVerdict): string {
  const icon: Record<Severity, string> = { ok: '✅', minor: '⚠️', major: '❌' };
  const lines = v.findings.map((f) => `- ${icon[f.severity]} **${f.check}**: ${f.note}`);
  return [`**Overall: ${v.verdict ? '✅ YES — safe to propose as-is' : '❌ NO — needs a look before merging'}**`, '', ...lines].join('\n');
}

// Parses a persona's raw reply into the structured verdict.
//
// Throws rather than returning a default on unparseable output: a review that silently degrades to
// "no findings, verdict YES" is worse than no review at all, since it looks identical to a genuine
// clean pass. Callers decide what an unparseable reply means for their exit code — pr-reviewer.ts
// treats it as "review unavailable" (exit 0, loudly), NOT as "found problems", because a model
// formatting slip is not evidence about the PR.
//
// `major` overrides the model's own VERDICT line rather than trusting it: the persona is told
// "VERDICT is NO if any bullet is major", but that's an instruction it can fail to follow, and the
// bullets are the part a human actually reads. Where the two disagree, the specific findings win
// over the summary line — the same "don't trust the agent's own claim of success" principle
// goal-evolution's agent/oracle split rests on (see CLAUDE.md rule 3).
export function parseReviewVerdict(text: string): ReviewVerdict {
  const verdictMatch = text.match(/VERDICT:\s*(YES|NO)/i);
  if (!verdictMatch) {
    throw new Error(`Could not parse a VERDICT line from the model response: ${text}`);
  }

  const findingLines = [...text.matchAll(/^-\s*\[(ok|minor|major)\]\s*([^:]+):\s*(.+)$/gim)];
  const findings: ReviewFinding[] = findingLines.map((m) => ({
    severity: m[1].toLowerCase() as Severity,
    check: m[2].trim(),
    note: m[3].trim(),
  }));

  if (findings.length === 0) {
    throw new Error(`VERDICT line found but no [ok|minor|major] bullets parsed from the model response: ${text}`);
  }

  const saidYes = verdictMatch[1].toUpperCase() === 'YES';
  const hasMajor = findings.some((f) => f.severity === 'major');

  return { verdict: saidYes && !hasMajor, findings };
}
