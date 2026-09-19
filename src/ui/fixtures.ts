import * as fs from 'fs';
import { test as base, Page, TestInfo } from '@playwright/test';
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

function buildHealPage(page: Page, model: string | undefined): HealPage {
  delete (page as unknown as Record<symbol, unknown>)[HEAL_SYMBOL];
  return withHealing(page, model ? { model } : undefined);
}

// The call that failed is retried once against AI_MODEL_FALLBACK; every later heal.* call in the
// same test also goes straight to the fallback, since withHealing mutates the shared page object
// rather than returning a copy.
type HealFn = (...args: unknown[]) => unknown;

// Module-scoped (shared across tests in a worker), not reset per test — attachment names only
// need to be unique and ordered within a test, and a running counter guarantees both regardless.
let healScreenshotCounter = 0;

async function attachHealScreenshot(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  try {
    const body = await page.screenshot();
    await testInfo.attach(label, { body, contentType: 'image/png' });
  } catch (err) {
    // A failed screenshot (e.g. page already navigating away) must never fail the heal call
    // itself — this is a diagnostic nicety, not part of the test's own assertions.
    process.stderr.write(`[healwright] could not attach heal screenshot: ${(err as Error).message}\n`);
  }
}

// Fallback-switching and screenshotting are combined into one wrapper (rather than two composed
// ones) because buildHealPage() below replaces `page.heal` wholesale — healPage === page, so a
// wrapper built by wrapping today's `healPage.heal` would be discarded the moment the fallback
// path swaps the model, silently losing the screenshot behavior for the rest of the test. This
// wrapper re-asserts itself onto `healPage.heal` right after that swap, so screenshots keep
// working, and keeps its own `fallbackTarget` reference to the raw post-swap methods to dispatch
// through — dispatching through `healPage.heal` after re-asserting would call back into `wrapped`
// itself and recurse forever.
function wrapHealMethods(page: Page, healPage: HealPage, testInfo: TestInfo): void {
  const original = { ...healPage.heal } as unknown as Record<string, HealFn>;
  const methodNames = Object.keys(original);
  if (methodNames.length === 0) {
    throw new Error('[healwright] heal methods were not enumerable — heal wrapping is broken');
  }

  let switchedToFallback = false;
  let fallbackTarget: Record<string, HealFn> | undefined;
  const wrapped: Record<string, HealFn> = {};
  for (const key of methodNames) {
    const primaryFn = original[key];
    if (typeof primaryFn !== 'function') continue;
    wrapped[key] = async (...args: unknown[]) => {
      // Screenshot the state BEFORE the call too — for a real (non-cached) heal this is the
      // broken-locator moment the healing is actually reacting to, and by the time the call
      // resolves the DOM has already moved past it.
      healScreenshotCounter += 1;
      const n = healScreenshotCounter;
      await attachHealScreenshot(page, testInfo, `heal-${n}-${key}-before`);

      let result: unknown;
      if (switchedToFallback) {
        // Dispatch through the raw post-swap methods, never healPage.heal — that's `wrapped`
        // again (re-asserted below), and calling it here would recurse forever.
        result = await fallbackTarget![key].apply(fallbackTarget, args);
      } else {
        try {
          result = await primaryFn.apply(healPage.heal, args);
        } catch (err) {
          if (!FALLBACK_MODEL || !isRetryableAiError(err)) throw err;
          switchedToFallback = true;
          process.stderr.write(
            `[healwright] ${PRIMARY_MODEL ?? 'default model'} failed (quota or transient unavailability) — switching to fallback model ${FALLBACK_MODEL} for the rest of this test\n`,
          );
          buildHealPage(page, FALLBACK_MODEL);
          fallbackTarget = { ...healPage.heal } as unknown as Record<string, HealFn>;
          healPage.heal = wrapped as unknown as HealMethods;
          result = await fallbackTarget[key].call(fallbackTarget, ...args);
        }
      }

      await attachHealScreenshot(page, testInfo, `heal-${n}-${key}-after`);
      return result;
    };
  }
  healPage.heal = wrapped as unknown as HealMethods;
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

    wrapHealMethods(page, healPage, testInfo);
    await use(healPage);

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
