// Unit coverage for the aggregated-failure-message logic in src/ui/fixtures.ts's
// withModelFallback(). Before this, when BOTH the primary and fallback AI tiers failed on an
// availability signal (quota/transient outage), the thrown error carried only the fallback
// tier's own message — the primary tier's failure reason was silently dropped (visible only in a
// stderr log line, never in the exception that becomes the Playwright test's failure message /
// Allure report). extractFailureReason() and buildFallbackExhaustedError() are exported
// specifically so this can be covered without constructing a real Playwright Page or healwright
// HealPage — see cli-fallback.spec.ts and gemini-text.spec.ts for the same "extract the pure
// logic, test it directly" convention this file follows.
//
// Important boundary covered below: buildFallbackExhaustedError only SKIPS combining when the
// fallback's HealError is recognizably a genuine "AI answered" verdict — "Could not find a
// matching element" / "Best match scored …" (pickValid rejected every candidate) or the (dead in
// this project, but defensively handled) warn-mode no-op message — OR a generic HealError whose
// context proves askAI() actually returned (context.candidatesAnalyzed > 0 or
// context.strategiesTried non-empty; see isAiAvailabilityFailure's doc comment in fixtures.ts for
// the full healwright-source citation on why neither field alone is sufficient — pickValid()
// never records the candidate it ultimately CHOSE, only ones it rejected, so a post-pick action
// timeout also has strategiesTried: []; candidatesAnalyzed is what actually distinguishes it,
// since askAI() only sets it from its own return value).
//
// "AI returned no suggestions" (empty/unparseable provider reply) is deliberately NOT on the
// allowlist even though it's also a HealError with strategiesTried: [] and candidatesAnalyzed
// possibly > 0 — per the brief, a malformed response IS an availability failure and must combine.
//
// Everything else — a HealError wrapping a network/timeout/missing-key failure where askAI()
// itself never returned, or a non-HealError value (the `!enabled` no-API-key rethrow) — is treated
// as an availability failure and combined, per this fix's brief ("для любой причины" / "for any
// reason"). A fallback that ran and genuinely found no matching element is a real ai-healing
// failure, not "every tier unavailable" — combining it anyway would misclassify a real
// locator/app regression as ai-quota in src/failure-analysis/classify.ts (its own header comment
// defines ai-quota as "the AI never got to attempt a strategy"). That boundary, and the
// candidatesAnalyzed-vs-strategiesTried refinement, were both caught and fixed during review
// before this shipped — see the "feeds classify.ts correctly" describe block below.
import { test, expect } from '@playwright/test';
import { HealError } from 'healwright';
import { extractFailureReason, buildFallbackExhaustedError } from '../../src/ui/fixtures';
import { groupFailures } from '../../src/failure-analysis/classify';
import { TestSummaryEvent } from '../../src/observability/types';

// Matches the real shape healwright's askAI()-threw catch-all (dist/index.js:1403) produces:
// candidatesAnalyzed/strategiesTried are only ever non-zero/non-empty if askAI() actually
// returned, which by definition it did not on this path — see isAiAvailabilityFailure's doc
// comment in fixtures.ts.
function makeContext(overrides: Partial<HealError['context']> = {}): HealError['context'] {
  return {
    action: 'click',
    contextName: 'Submit button',
    url: 'https://example.com',
    candidatesAnalyzed: 0,
    strategiesTried: [],
    ...overrides,
  };
}

// A HealError shaped like the ones healwright's askAI() failure path throws (see
// node_modules/healwright/dist/index.js:1403) — message carries the raw provider error text
// (e.g. a 429 payload), which is what isRetryableAiError() and extractFailureReason() both key on.
function quotaError(reason: string, overrides: Partial<HealError['context']> = {}): HealError {
  return new HealError(reason, makeContext(overrides));
}

// Matches pickValid()'s real shape when every candidate is rejected: it PUSHES a reason for each
// one, so strategiesTried is non-empty (dist/index.js:~1156-1176), and candidatesAnalyzed reflects
// the DOM-candidate count askAI() actually returned.
function noMatchError(overrides: Partial<HealError['context']> = {}): HealError {
  return new HealError('Could not find a matching element', {
    ...makeContext(overrides),
    candidatesAnalyzed: overrides.candidatesAnalyzed ?? 4,
    strategiesTried: overrides.strategiesTried ?? [{ type: 'role', reason: 'element not found' }],
  });
}

test.describe('extractFailureReason', () => {
  test('pulls the ❌-marked line out of a HealError box-drawn message', () => {
    const err = quotaError('quota exceeded: RESOURCE_EXHAUSTED');
    expect(extractFailureReason(err)).toBe('quota exceeded: RESOURCE_EXHAUSTED');
  });

  test('falls back to the first non-empty line for a plain Error with no ❌ marker', () => {
    const err = new Error('ECONNRESET: socket hang up\nat someInternalFn (file.js:1:1)');
    expect(extractFailureReason(err)).toBe('ECONNRESET: socket hang up');
  });

  test('handles a non-Error thrown value without throwing itself', () => {
    expect(extractFailureReason('plain string failure')).toBe('plain string failure');
  });

  test('falls back to "unknown error" for an empty message', () => {
    expect(extractFailureReason(new Error(''))).toBe('unknown error');
  });

  test('is idempotent on an already-extracted plain-string reason (the already-switched call path passes one through)', () => {
    expect(extractFailureReason('already extracted reason')).toBe('already extracted reason');
  });
});

test.describe('buildFallbackExhaustedError — both tiers genuinely unavailable', () => {
  test('names both tiers and both failure reasons, not just the last one', () => {
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = quotaError('"code":503 UNAVAILABLE');
    const err = buildFallbackExhaustedError('gemini-3.5-flash', primaryErr, 'gemini-3.6-flash', fallbackErr);
    expect(err.message).toContain('gemini-3.5-flash');
    expect(err.message).toContain('RESOURCE_EXHAUSTED (429)');
    expect(err.message).toContain('gemini-3.6-flash');
    expect(err.message).toContain('"code":503 UNAVAILABLE');
  });

  test('falls back to descriptive placeholders when a model name is undefined', () => {
    const err = buildFallbackExhaustedError(
      undefined,
      quotaError('primary reason RESOURCE_EXHAUSTED'),
      undefined,
      quotaError('fallback reason "code":429'),
    );
    expect(err.message).toContain('default model');
    expect(err.message).toContain('fallback model');
    expect(err.message).toContain('primary reason RESOURCE_EXHAUSTED');
    expect(err.message).toContain('fallback reason "code":429');
  });

  test('is a real HealError so it stays inside the same classification pipeline every other healing failure goes through', () => {
    const err = buildFallbackExhaustedError('model-a', quotaError('RESOURCE_EXHAUSTED'), 'model-b', quotaError('RESOURCE_EXHAUSTED'));
    expect(err).toBeInstanceOf(HealError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('model-a');
    expect(err.message).toContain('model-b');
  });

  test('preserves the fallback tier context when available, so Allure still names the element/URL being healed', () => {
    const primaryErr = quotaError('RESOURCE_EXHAUSTED', { contextName: 'Login form' });
    const fallbackErr = quotaError('RESOURCE_EXHAUSTED', { contextName: 'Login form (retry)', url: 'https://example.com/login' });
    const err = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr) as HealError;
    expect(err.context.contextName).toBe('Login form (retry)');
    expect(err.context.url).toBe('https://example.com/login');
  });

  test('sets cause to the fallback error so the full original failure is still inspectable', () => {
    const fallbackErr = quotaError('RESOURCE_EXHAUSTED');
    const err = buildFallbackExhaustedError('model-a', quotaError('RESOURCE_EXHAUSTED'), 'model-b', fallbackErr);
    expect((err as Error & { cause?: unknown }).cause).toBe(fallbackErr);
  });

  test('accepts an already-extracted string reason for the primary tier (the already-switched call path)', () => {
    const err = buildFallbackExhaustedError(
      'model-a',
      'primary failed earlier this test (RESOURCE_EXHAUSTED)',
      'model-b',
      quotaError('RESOURCE_EXHAUSTED again'),
    );
    expect(err.message).toContain('primary failed earlier this test (RESOURCE_EXHAUSTED)');
    expect(err.message).toContain('RESOURCE_EXHAUSTED again');
  });

  test('combines a fallback HealError wrapping a network/timeout failure, not just quota/429/503 shapes', () => {
    // Shaped like healwright's askAI()-failed catch-all (dist/index.js:1403): the message is
    // whatever the underlying network/timeout error said, with no RESOURCE_EXHAUSTED/429/503
    // marker at all — this is one of the "for any reason" causes the brief calls out by name.
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = new HealError('fetch failed: ECONNRESET', makeContext());
    const err = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr);
    expect(err.message).toContain('model-a');
    expect(err.message).toContain('RESOURCE_EXHAUSTED (429)');
    expect(err.message).toContain('model-b');
    expect(err.message).toContain('fetch failed: ECONNRESET');
  });

  test('combines a fallback failure that is not even a HealError (e.g. the `!enabled` no-API-key rethrow)', () => {
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = new Error('missing GEMINI_API_KEY for this tier');
    const err = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr);
    expect(err.message).toContain('model-b');
    expect(err.message).toContain('missing GEMINI_API_KEY for this tier');
  });

  test('combines "AI returned no suggestions" (malformed/empty provider reply) even though it is a HealError with strategiesTried: []', () => {
    // Shaped like dist/index.js:~1260: askAI() returned but the plan was falsy — the brief's
    // "malformed response" case. candidatesAnalyzed can be > 0 here (DOM candidates were still
    // collected before the provider reply failed to parse), which is exactly why this can't be
    // told apart from a genuine no-match verdict by field emptiness alone — it's matched by
    // message instead, deliberately left OFF the "AI answered" allowlist.
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = new HealError('AI returned no suggestions', makeContext({ candidatesAnalyzed: 4 }));
    const err = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr);
    expect(err.message).toContain('model-b');
    expect(err.message).toContain('AI returned no suggestions');
  });

  test('combines "Healing disabled or API key not set" (the brief\'s missing-key case, thrown by askAI itself)', () => {
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = new HealError('Healing disabled or API key not set', makeContext());
    const err = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr);
    expect(err.message).toContain('model-b');
    expect(err.message).toContain('Healing disabled or API key not set');
  });
});

test.describe('buildFallbackExhaustedError — fallback tier answered but genuinely found nothing', () => {
  test('rethrows the fallback error completely unchanged, not combined with the primary', () => {
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = noMatchError();
    const result = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr);
    expect(result).toBe(fallbackErr);
    expect(result.message).not.toContain('model-a');
    expect(result.message).not.toContain('RESOURCE_EXHAUSTED');
  });

  test('also leaves a low-confidence match and a warn-mode no-op HealError uncombined', () => {
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const lowConfidenceErr = new HealError(
      'Best match scored 0.42, below the configured minConfidence of 0.7',
      makeContext({ candidatesAnalyzed: 3, strategiesTried: [{ type: 'role', reason: 'confidence 0.42 below minConfidence 0.7' }] }),
    );
    expect(buildFallbackExhaustedError('model-a', primaryErr, 'model-b', lowConfidenceErr)).toBe(lowConfidenceErr);
    const warnModeErr = new HealError(
      "Healing is in report-only mode (mode: 'warn'), so no action was taken",
      makeContext({ candidatesAnalyzed: 3, strategiesTried: [] }),
    );
    expect(buildFallbackExhaustedError('model-a', primaryErr, 'model-b', warnModeErr)).toBe(warnModeErr);
  });

  test('the ai-healing allowlist wins even when candidatesAnalyzed/strategiesTried are both 0/[] (empty-candidates plan)', () => {
    // The AI returned a valid plan with an empty candidates array — pickValid()'s loop never
    // runs, so both fields stay at the "askAI never returned" shape even though it DID return.
    // This is why the allowlist check must run BEFORE the candidatesAnalyzed/strategiesTried
    // check, not be replaced by it.
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = noMatchError({ candidatesAnalyzed: 0, strategiesTried: [] });
    const result = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr);
    expect(result).toBe(fallbackErr);
  });

  test('a fallback action timeout AFTER a successful AI pick is not combined (strategiesTried: [] but candidatesAnalyzed > 0)', () => {
    // Shaped like dist/index.js:~1403 reached via the post-pick waitForReady/performAction path:
    // askAI() DID return (candidatesAnalyzed > 0, from real DOM candidates), pickValid() picked a
    // candidate on the first try (so strategiesTried stays [] — pickValid never records the one it
    // CHOSE, only ones it rejected), and then the actual click/fill timed out. This is the case
    // that a strategiesTried-only rule would misclassify as ai-quota — candidatesAnalyzed is what
    // correctly keeps it out.
    const primaryErr = quotaError('RESOURCE_EXHAUSTED (429)');
    const fallbackErr = new HealError(
      'locator.click: Timeout 30000ms exceeded',
      makeContext({ candidatesAnalyzed: 5, strategiesTried: [] }),
    );
    const result = buildFallbackExhaustedError('model-a', primaryErr, 'model-b', fallbackErr);
    expect(result).toBe(fallbackErr);
  });
});

// Confirms the aggregated error lands in the SAME failure-analysis category a lone HealError
// would have, and — the regression caught in review — that a genuine no-match fallback failure
// is NOT misfiled as ai-quota just because the primary tier hit a quota error earlier.
test.describe('buildFallbackExhaustedError output feeds classify.ts correctly', () => {
  let nextTestId = 0;
  function asFailedTest(message: string): TestSummaryEvent {
    nextTestId += 1;
    return {
      type: 'test',
      runId: 'run-1',
      testId: `t${nextTestId}`,
      testTitlePath: 'suite > test',
      project: 'ui',
      status: 'failed',
      outcome: 'unexpected',
      retry: 0,
      durationMs: 100,
      stepCount: 1,
      recoveredStepCount: 0,
      artifacts: [],
      // Mirrors what Playwright's own TestError.message actually looks like for a thrown, named
      // error — confirmed empirically (a live minimal Playwright run) to be `${name}: ${message}`.
      error: { message: `${message}` },
    };
  }

  test('categorizes as ai-quota when both tiers genuinely exhausted on a quota signal', () => {
    const err = buildFallbackExhaustedError(
      'gemini-3.5-flash',
      quotaError('RESOURCE_EXHAUSTED (429)'),
      'gemini-3.6-flash',
      quotaError('also RESOURCE_EXHAUSTED (429)'),
    );
    const groups = groupFailures([asFailedTest(`${err.name}: ${err.message}`)]);
    expect(groups[0].category).toBe('ai-quota');
  });

  test('categorizes as ai-healing, NOT ai-quota, when the fallback genuinely found no match — even though the primary hit a quota error', () => {
    const err = buildFallbackExhaustedError('gemini-3.5-flash', quotaError('RESOURCE_EXHAUSTED (429)'), 'gemini-3.6-flash', noMatchError());
    const groups = groupFailures([asFailedTest(`${err.name}: ${err.message}`)]);
    expect(groups[0].category).toBe('ai-healing');
  });

  test('categorizes as ai-healing, NOT ai-quota, when the fallback times out AFTER a successful AI pick', () => {
    const fallbackErr = new HealError(
      'locator.click: Timeout 30000ms exceeded',
      makeContext({ candidatesAnalyzed: 5, strategiesTried: [] }),
    );
    const err = buildFallbackExhaustedError('gemini-3.5-flash', quotaError('RESOURCE_EXHAUSTED (429)'), 'gemini-3.6-flash', fallbackErr);
    const groups = groupFailures([asFailedTest(`${err.name}: ${err.message}`)]);
    expect(groups[0].category).toBe('ai-healing');
  });

  test('categorizes as ai-quota when the fallback is a malformed/empty provider reply ("AI returned no suggestions")', () => {
    const fallbackErr = new HealError('AI returned no suggestions', makeContext({ candidatesAnalyzed: 4 }));
    const err = buildFallbackExhaustedError('gemini-3.5-flash', quotaError('RESOURCE_EXHAUSTED (429)'), 'gemini-3.6-flash', fallbackErr);
    const groups = groupFailures([asFailedTest(`${err.name}: ${err.message}`)]);
    expect(groups[0].category).toBe('ai-quota');
  });
});
