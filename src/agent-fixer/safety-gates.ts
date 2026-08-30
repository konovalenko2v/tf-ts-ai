// Pure-function safety checks for agent-fixer's auto-merge path. Kept separate from
// verify-stability.ts (and free of child_process/fs at the call sites below) specifically so they
// have unit coverage before ever running live in CI — verify-stability.ts itself still has none,
// which the framework's own enterprise-readiness assessment flagged as its biggest risk.

// --- Scope limit (point 4): agent-fixer must only ever touch its declared target file(s). If the
// PR branch's diff against base touches anything else — a config file, a workflow, a dependency —
// that's either a bug in agent-fixer or a tampered branch, and auto-merge must refuse either way.
export function isWithinAllowedScope(changedFiles: string[], allowedFiles: string[]): boolean {
  return changedFiles.length > 0 && changedFiles.every((f) => allowedFiles.includes(f));
}

// --- Circuit breaker (point 5): a count alone doesn't catch "fixing the same thing over and over"
// — a revert is a much stronger signal that autonomy should pause, so it trips the breaker on its
// own regardless of count. `git revert --no-edit` produces "Revert \"agent-fixer: ...\"", which
// does NOT start with the 'agent-fixer:' prefix — so reverts are counted via a separate check, not
// double-counted as merges.
export interface CircuitBreakerResult {
  tripped: boolean;
  reason?: string;
}

export function checkCircuitBreaker(
  commitSubjects: string[],
  opts: { maxMergesInWindow: number },
): CircuitBreakerResult {
  const reverted = commitSubjects.some((s) => s.startsWith('Revert "agent-fixer:'));
  if (reverted) {
    return { tripped: true, reason: 'a previous agent-fixer auto-merge was reverted in this window — autonomy suspended pending human review' };
  }

  const mergeCount = commitSubjects.filter((s) => s.startsWith('agent-fixer:')).length;
  if (mergeCount >= opts.maxMergesInWindow) {
    return {
      tripped: true,
      reason: `${mergeCount} agent-fixer auto-merges already landed in this window (limit ${opts.maxMergesInWindow}) — autonomy suspended pending human review`,
    };
  }

  return { tripped: false };
}

// --- Risk tier (point 8): a fix sourced from the healwright cache is a locator the running system
// already exercised and recorded a strategy/confidence for; a fix sourced from the AI fallback is
// freshly generated code with no such runtime evidence. Only the former is eligible for the fully
// autonomous path — the latter always needs a human, however well it did on verify-stability's
// repeated runs, because repeated runs prove the replacement is *stable*, not that it's *correct*.
export type FixSource = 'cache' | 'ai-fallback';

export function riskTierFor(sources: FixSource[]): 'auto-merge' | 'human-review' {
  return sources.every((s) => s === 'cache') ? 'auto-merge' : 'human-review';
}
