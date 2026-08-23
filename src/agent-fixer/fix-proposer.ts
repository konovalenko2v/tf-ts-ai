// AI fallback: only reached when the deterministic cache lookup (cache-lookup.ts) has no exact
// contextName match for a broken selector. That happens when healwright's cache doesn't have an
// answer to give — most commonly because SELF_HEAL wasn't enabled on the run that produced this
// recovery, healing itself failed to find a replacement, or the cache wasn't carried over to
// this job. In all of those cases there's no DOM snapshot or live browser available here (only a
// screenshot path and a sanitized error message in .observability/) to ground a real locator
// proposal — guessing from text alone would be fabrication, not analysis. For v1 this layer's
// only job is to report a proposal it can't confidently make; a screenshot-driven multimodal
// pass is the natural next step once agent-fixer needs it.

export interface FixProposal {
  selector: string;
  contextName: string;
  found: false;
  reason: string;
}

export async function proposeFallbackFix(selector: string, contextName: string): Promise<FixProposal> {
  return {
    selector,
    contextName,
    found: false,
    reason:
      'No exact healwright cache entry for this contextName, and no DOM/screenshot analysis is wired up yet — needs a human to find the right locator.',
  };
}
