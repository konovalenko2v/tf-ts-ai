// Deterministic layer: healwright already recorded the working replacement for a broken
// selector in .self-heal/healed_locators.json, keyed by the exact contextName that sits next to
// the broken locator in source. When that record exists, building the replacement is a lookup
// plus a fixed template per strategy type — no AI call needed, nothing to get wrong.
//
// This only fires on an exact contextName match. Anything else (no cache entry, a strategy type
// this module doesn't know how to render) falls through to the AI fallback in fix-proposer.ts.

export interface HealedStrategy {
  type: string;
  role?: string | null;
  name?: string | null;
  selector?: string | null;
  text?: string | null;
  value?: string | null;
  exact?: boolean | null;
  context: string;
}

export function loadHealedCache(json: string): Record<string, HealedStrategy> {
  return JSON.parse(json);
}

export function findByContext(
  cache: Record<string, HealedStrategy>,
  contextName: string,
): HealedStrategy | undefined {
  return Object.values(cache).find((entry) => entry.context === contextName);
}

export function renderLocatorExpression(strategy: HealedStrategy): string | undefined {
  switch (strategy.type) {
    case 'role':
      if (!strategy.role || !strategy.name) return undefined;
      return strategy.exact
        ? `page.getByRole('${strategy.role}', { name: '${strategy.name}', exact: true })`
        : `page.getByRole('${strategy.role}', { name: '${strategy.name}' })`;
    case 'testid':
      return strategy.value ? `page.getByTestId('${strategy.value}')` : undefined;
    case 'label':
      return strategy.text ? `page.getByLabel('${strategy.text}')` : undefined;
    case 'placeholder':
      return strategy.text ? `page.getByPlaceholder('${strategy.text}')` : undefined;
    case 'text':
      return strategy.text ? `page.getByText('${strategy.text}')` : undefined;
    case 'altText':
      return strategy.text ? `page.getByAltText('${strategy.text}')` : undefined;
    case 'title':
      return strategy.text ? `page.getByTitle('${strategy.text}')` : undefined;
    case 'css':
      return strategy.selector ? `page.locator('${strategy.selector}')` : undefined;
    default:
      return undefined;
  }
}
