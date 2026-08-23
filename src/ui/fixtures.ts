import { test as base, Page } from '@playwright/test';
import { withHealing, HealError, HealPage, HealMethods } from 'healwright';

// withHealing() mutates and returns the same `page` object (it attaches `.heal` and marks it
// with a global symbol) rather than creating a fresh wrapper, so healPage === page here.
const HEAL_SYMBOL = Symbol.for('healwright');

const PRIMARY_MODEL = process.env.AI_MODEL;
const FALLBACK_MODEL = process.env.AI_MODEL_FALLBACK;

function isQuotaExhausted(err: unknown): boolean {
  if (!(err instanceof HealError)) return false;
  const message = String((err as Error).message ?? '');
  return message.includes('RESOURCE_EXHAUSTED') || message.includes('"code":429');
}

function buildHealPage(page: Page, model: string | undefined): HealPage {
  delete (page as unknown as Record<symbol, unknown>)[HEAL_SYMBOL];
  return withHealing(page, model ? { model } : undefined);
}

// Free-tier Gemini quotas are tracked per model (confirmed by the 429 payload itself:
// quotaId "GenerateRequestsPerDayPerProjectPerModel-FreeTier", scoped to one `model`), so a
// second model still has its own untouched daily allowance. The call that hit the 429 is retried
// once against AI_MODEL_FALLBACK; every later heal.* call in the same test also goes straight to
// the fallback, since withHealing mutates the shared page object rather than returning a copy.
type HealFn = (...args: unknown[]) => unknown;

function withModelFallback(page: Page, healPage: HealPage): HealPage {
  if (!FALLBACK_MODEL) return healPage;

  const original = { ...healPage.heal } as unknown as Record<string, HealFn>;
  const methodNames = Object.keys(original);
  if (methodNames.length === 0) {
    throw new Error('[healwright] heal methods were not enumerable — fallback wiring is broken');
  }

  let switchedToFallback = false;
  const wrapped: Record<string, HealFn> = {};
  for (const key of methodNames) {
    const fn = original[key];
    if (typeof fn !== 'function') continue;
    wrapped[key] = async (...args: unknown[]) => {
      const currentHeal = healPage.heal as unknown as Record<string, HealFn>;
      // Once switched, every call goes straight through the current page.heal[key] — never the
      // `fn` closed over above, which is permanently bound to the primary model's provider.
      if (switchedToFallback) {
        return await currentHeal[key].apply(healPage.heal, args);
      }
      try {
        return await fn.apply(healPage.heal, args);
      } catch (err) {
        if (!isQuotaExhausted(err)) throw err;
        switchedToFallback = true;
        process.stderr.write(
          `[healwright] ${PRIMARY_MODEL ?? 'default model'} quota exhausted — switching to fallback model ${FALLBACK_MODEL} for the rest of this test\n`,
        );
        buildHealPage(page, FALLBACK_MODEL);
        const fallbackHeal = healPage.heal as unknown as Record<string, HealFn>;
        return await fallbackHeal[key].apply(healPage.heal, args);
      }
    };
  }
  healPage.heal = wrapped as unknown as HealMethods;
  return healPage;
}

export const test = base.extend<{ page: HealPage }>({
  page: async ({ page }, use) => {
    const healPage = buildHealPage(page, PRIMARY_MODEL);
    await use(withModelFallback(page, healPage));
  },
});
export { expect } from '@playwright/test';
