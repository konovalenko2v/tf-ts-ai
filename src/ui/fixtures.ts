import * as fs from 'fs';
import { test as base, Page } from '@playwright/test';
import { withHealing, HealError, HealPage, HealMethods } from 'healwright';
import { tag } from 'allure-js-commons';
import { readHealEventsRaw, renderStrategy } from '../failure-analysis/heal-events';

const HEAL_EVENTS_FILE = '.self-heal/heal_events.jsonl';

// withHealing() mutates and returns the same `page` object (it attaches `.heal` and marks it
// with a global symbol) rather than creating a fresh wrapper, so healPage === page here.
const HEAL_SYMBOL = Symbol.for('healwright');

const PRIMARY_MODEL = process.env.AI_MODEL;
const FALLBACK_MODEL = process.env.AI_MODEL_FALLBACK;

// Covers two distinct failure shapes, only one of which the model-switch below is a real fix for:
// a 429/RESOURCE_EXHAUSTED quota error is genuinely per-model (Free-tier Gemini quotas are tracked
// per model — confirmed by the 429 payload's quotaId "GenerateRequestsPerDayPerProjectPerModel-
// FreeTier" — so a second model has its own untouched daily allowance). A 503/UNAVAILABLE
// ("experiencing high demand") is transient shared-capacity trouble, not a quota — a sibling model
// may sit behind the same overloaded backend, so switching models here is a best-effort attempt,
// not the guarantee the 429 path is. Also note the switch is per-test, not per-run: `page` fixture
// below rebuilds this wrapper (and resets switchedToFallback) on every Playwright retry, so a 503
// that recurs across retries hits the primary model again each time rather than staying on fallback.
function isRetryableAiError(err: unknown): boolean {
  if (!(err instanceof HealError)) return false;
  const message = String((err as Error).message ?? '');
  return message.includes('RESOURCE_EXHAUSTED') || message.includes('"code":503') || message.includes('"code":429');
}

// healwright's own source (node_modules/healwright/dist/index.js, the getLocator/performHealing
// action path — read in full, not just grepped, to get this right) throws a HealError from
// several distinct places, and they do NOT collapse into a clean "message shape" split:
//
// - "Could not find a matching element" / "Best match scored … below … minConfidence" (~1298):
//   the AI returned a plan, but pickValid() rejected every candidate (not found, not visible,
//   duplicate match, below confidence). pickValid() PUSHES a reason for every candidate it
//   rejects, so `context.strategiesTried` is non-empty here — UNLESS the AI's plan came back with
//   an empty `candidates` array, in which case pickValid()'s loop never runs and strategiesTried
//   stays `[]` too. Either way this is a genuine "AI answered, nothing qualified" verdict — must
//   NOT combine — so it's matched by an explicit message-prefix allowlist, not by field emptiness.
// - "AI returned no suggestions" (~1260): askAI() returned but `aiResult.plan` was falsy — an
//   empty/unparseable provider reply (confirmed via GoogleProvider.generateHealPlan: a JSON parse
//   failure is caught locally and turned into `{plan: null}`, never re-thrown). This IS the
//   brief's "malformed response" case and must combine, even though it's a HealError with
//   `strategiesTried: []` just like the case above — hence NOT on the allowlist.
// - Warn-mode no-op messages (~1336/1476): dead in this project (HEALWRIGHT_MODE is never set
//   anywhere in this repo, and withHealing() here is called with no explicit `mode` option — see
//   buildHealPage above — so this path is unreachable today; kept on the allowlist defensively in
//   case that ever changes, since it's a deliberate no-op, not a failure to heal).
// - Everything else HealError-shaped (~1403, the generic askAI()-threw / post-heal-action-threw
//   catch-all): re-wraps whatever the underlying failure was — network error, timeout, missing
//   API key ("Healing disabled or API key not set"), quota/429/503 — AS WELL AS a Playwright
//   action timeout on a locator the AI *did* successfully pick (waitForReady/performAction sit
//   inside the same try as askAI/pickValid). The two are told apart by
//   `context.candidatesAnalyzed`: askAI() only sets it (to the DOM-candidate count, from its own
//   return value) if the provider call actually returned — so it stays at its initial `0` if and
//   only if askAI() itself never completed. `strategiesTried` alone can't do this job (see above:
//   pickValid() never records the candidate it ultimately CHOSE, only ones it rejected, so a
//   post-pick action timeout also has `strategiesTried: []`).
// - A thrown value that isn't a HealError at all: in this codebase, reachable only via the
//   `!enabled` (no API key / healing disabled) branch rethrowing the raw error — genuinely an
//   availability failure, so combine.
//
// A known, accepted false positive: a page with literally zero DOM candidates where the AI still
// received a plan, picked its first candidate, and the subsequent click/fill timed out —
// `candidatesAnalyzed` counts DOM candidates offered to the AI, not whether the AI answered, so
// this reads as "askAI never returned" and gets combined even though the AI did participate. Not
// worth a further signal for: healwright's own context type carries nothing that disambiguates it
// more cheaply, and it's a narrow edge case (an empty-candidate page succeeding at all requires a
// candidate come from somewhere pickValid can act on).
const AI_ANSWERED_MESSAGE_PREFIXES = [
  'Could not find a matching element',
  'Best match scored',
  "Healing is in report-only mode (mode: 'warn')",
];

function isAiAvailabilityFailure(err: unknown): boolean {
  if (!(err instanceof HealError)) return true;
  const reason = extractFailureReason(err);
  if (AI_ANSWERED_MESSAGE_PREFIXES.some((prefix) => reason.startsWith(prefix))) return false;
  if (reason.startsWith('AI returned no suggestions')) return true;
  return err.context.candidatesAnalyzed === 0 && err.context.strategiesTried.length === 0;
}

// HealError's own .message is a multi-line box-drawn report (see healwright's formatMessage —
// the ❌-prefixed line is the one actual reason, everything else is a fixed box + context dump
// that would only make an aggregated multi-tier message below noisier, not clearer). A
// non-HealError (e.g. a plain network/timeout Error from a Gemini/Claude call further down the
// AI stack) has no such box, so the first non-empty line is used instead. Exported so
// tests/unit/fixtures.spec.ts can cover both shapes without constructing a real HealError.
export function extractFailureReason(err: unknown): string {
  const message = String((err as Error)?.message ?? err ?? 'unknown error');
  const lines = message.split('\n');
  const marked = lines.find((l) => l.includes('❌'));
  if (marked) return marked.replace('❌', '').trim();
  return lines.find((l) => l.trim().length > 0)?.trim() ?? 'unknown error';
}

// Both AI tiers exhausted: the thrown error must name what was tried and why EACH one failed, not
// just the last tier's reason. Before this, the fallback tier's own catch had no try/catch at
// all — its raw error propagated alone, silently dropping the primary tier's failure (only ever
// visible in the stderr line above, never in the exception that becomes the Playwright test's
// failure message / Allure report). Mirrors the same "accumulate a reason per tier, throw one
// combined message" shape already used by src/ai-agents/cli-fallback.ts's runAgenticEdit() for
// the analogous multi-tier-exhausted case — same convention, not a new abstraction.
//
// Deliberately still a HealError (not a plain Error) when it DOES combine: src/failure-analysis/
// classify.ts's categorize() gates ai-quota/ai-healing purely on `message.includes('HealError')`
// (confirmed via a live Playwright run — TestError.message is `${err.name}: ${err.message}`, so a
// plain Error's recorded message would read "Error: ...", never matching that check, and this
// failure would silently fall into the 'other' bucket instead of 'ai-quota'/'ai-healing'). Reusing
// HealError keeps this failure inside the same classification/retry-dispatch pipeline every other
// healing failure already goes through, per this repo's "reuse existing abstractions" rule.
//
// Only combines when the fallback ALSO failed to get an AI answer at all (isAiAvailabilityFailure
// — deliberately broader than isRetryableAiError above: that one gates the primary→fallback
// SWITCH decision and only recognizes the 429/503/RESOURCE_EXHAUSTED shapes worth burning the
// fallback tier on; this one decides what counts as "the fallback tier was unavailable" for the
// error MESSAGE, which per this fix's brief must cover missing key, timeout, network error and
// malformed response too, not just quota/outage). A fallback that answered but genuinely found no
// matching element is not "every tier unavailable" — it's a real ai-healing failure in its own
// right, and classify.ts's own header comment defines ai-quota as "the AI never got to attempt a
// strategy". Folding a genuine no-match result into "all tiers exhausted" would misfile it as
// ai-quota, hiding a real locator/app regression behind an infrastructure label. So a
// non-availability fallback failure is rethrown completely unchanged — own message, own class, own
// classification — with the primary's earlier reason left out of it (still visible via the
// stderr log line at the switch site).
export function buildFallbackExhaustedError(
  primaryModel: string | undefined,
  primaryErr: unknown,
  fallbackModel: string | undefined,
  fallbackErr: unknown,
): Error {
  if (!isAiAvailabilityFailure(fallbackErr)) {
    return fallbackErr as Error;
  }
  const primaryReason = extractFailureReason(primaryErr);
  const fallbackReason = extractFailureReason(fallbackErr);
  const context = (fallbackErr instanceof HealError && fallbackErr.context) ||
    (primaryErr instanceof HealError && primaryErr.context) || {
      action: 'heal',
      contextName: 'unknown (no HealError context available from either tier)',
      url: 'unknown',
      candidatesAnalyzed: 0,
      strategiesTried: [],
    };
  const message =
    `primary AI tier failed, fallback tier also failed — no AI tier could complete healing:\n` +
    `- ${primaryModel ?? 'default model'}: ${primaryReason}\n` +
    `- ${fallbackModel ?? 'fallback model'}: ${fallbackReason}`;
  const err = new HealError(message, context);
  // Preserves the full original HealError (box-drawn message, stack, context) for anyone
  // inspecting err.cause — the aggregated message above is a summary, not a replacement.
  (err as Error & { cause?: unknown }).cause = fallbackErr ?? primaryErr;
  return err;
}

function buildHealPage(page: Page, model: string | undefined): HealPage {
  delete (page as unknown as Record<symbol, unknown>)[HEAL_SYMBOL];
  return withHealing(page, model ? { model } : undefined);
}

// The call that failed is retried once against AI_MODEL_FALLBACK; every later heal.* call in the
// same test also goes straight to the fallback, since withHealing mutates the shared page object
// rather than returning a copy.
type HealFn = (...args: unknown[]) => unknown;

function withModelFallback(page: Page, healPage: HealPage): HealPage {
  if (!FALLBACK_MODEL) return healPage;

  const original = { ...healPage.heal } as unknown as Record<string, HealFn>;
  const methodNames = Object.keys(original);
  if (methodNames.length === 0) {
    throw new Error('[healwright] heal methods were not enumerable — fallback wiring is broken');
  }

  let switchedToFallback = false;
  // Set once, at the moment of the first switch, and reused by every later call that hits this
  // wrapper post-switch. Needed for the "already switched" case below: a later heal.* call in the
  // same test never retries the primary tier again (see the module comment on switchedToFallback),
  // so if THAT call also fails on the fallback, the primary's original failure reason has to come
  // from here rather than from a fresh primary attempt that never happens.
  let primaryFailureReason: string | undefined;
  const wrapped: Record<string, HealFn> = {};
  for (const key of methodNames) {
    const fn = original[key];
    if (typeof fn !== 'function') continue;
    wrapped[key] = async (...args: unknown[]) => {
      const currentHeal = healPage.heal as unknown as Record<string, HealFn>;
      // Once switched, every call goes straight through the current page.heal[key] — never the
      // `fn` closed over above, which is permanently bound to the primary model's provider.
      if (switchedToFallback) {
        try {
          return await currentHeal[key].apply(healPage.heal, args);
        } catch (fallbackErr) {
          // Same "both tiers exhausted" gap as the fresh-switch path below, reached via the
          // already-switched shortcut instead: the primary tier isn't retried here (by design —
          // see the comment above), so its reason has to come from the closure captured at switch
          // time rather than from a fresh catch on it. Worded to make clear the primary wasn't
          // retried for THIS call — it failed earlier in the same test, before the switch.
          throw buildFallbackExhaustedError(
            PRIMARY_MODEL,
            `${primaryFailureReason} (earlier heal call in this test; not retried again after switching to the fallback)`,
            FALLBACK_MODEL,
            fallbackErr,
          );
        }
      }
      try {
        return await fn.apply(healPage.heal, args);
      } catch (primaryErr) {
        if (!isRetryableAiError(primaryErr)) throw primaryErr;
        switchedToFallback = true;
        primaryFailureReason = extractFailureReason(primaryErr);
        process.stderr.write(
          `[healwright] ${PRIMARY_MODEL ?? 'default model'} failed (quota or transient unavailability) — switching to fallback model ${FALLBACK_MODEL} for the rest of this test\n`,
        );
        buildHealPage(page, FALLBACK_MODEL);
        const fallbackHeal = healPage.heal as unknown as Record<string, HealFn>;
        try {
          return await fallbackHeal[key].apply(healPage.heal, args);
        } catch (fallbackErr) {
          // Both tiers exhausted: previously the fallback's own error propagated alone here,
          // silently dropping the primary tier's failure reason (visible only in the stderr line
          // above, never in the exception that becomes the Playwright test's failure message /
          // Allure report). Now the thrown error names every tier tried and why each one failed.
          throw buildFallbackExhaustedError(PRIMARY_MODEL, primaryErr, FALLBACK_MODEL, fallbackErr);
        }
      }
    };
  }
  healPage.heal = wrapped as unknown as HealMethods;
  return healPage;
}

function countLines(file: string): number {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).length;
}

// Standard Allure/HTML reports show a green test with no sign AI intervened at runtime — the
// exact "healing hides regressions" gap this project's observability layer exists to close.
// Attaching a per-test note makes that visible directly on the report someone actually browses,
// not only in the JSONL/step-summary someone has to know to look at.
export const test = base.extend<{ page: HealPage }>({
  page: async ({ page }, use, testInfo) => {
    const healPage = buildHealPage(page, PRIMARY_MODEL);
    const linesBefore = countLines(HEAL_EVENTS_FILE);

    await use(withModelFallback(page, healPage));

    const newEvents = readHealEventsRaw(HEAL_EVENTS_FILE)
      .slice(linesBefore)
      .filter((e) => e.success && e.strategy);

    // Filterable and visible in the suite list without opening the test — the attachment alone
    // is buried 4 levels deep in the step tree and nobody browsing a green report finds it.
    if (newEvents.length > 0) await tag('self-healed');

    for (const e of newEvents) {
      if (!e.strategy) continue;
      const sourceNote = e.used === 'cache' ? ' (from cache, no AI call)' : '';
      await testInfo.attach(`self-healed: ${e.contextName}`, {
        body: [
          `Context: ${e.contextName}`,
          `Healed locator: ${renderStrategy(e.strategy)}${sourceNote}`,
          e.confidence !== undefined ? `Confidence: ${e.confidence}` : undefined,
          e.why ? `Rationale: ${e.why}` : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
        contentType: 'text/plain',
      });
    }
  },
});
export { expect } from '@playwright/test';
