import { expect, Page } from '@playwright/test';
import { Goal } from '../goal';
import { config } from '../../core/config';

// The one check that actually proves goal-resolution worked rather than got lucky once: the
// "Click Me" button's id is regenerated on every page load (Ii9O4 -> QYyO7 observed across two
// loads, see docs/page-knowledge/buttons.md). Find the line that assigns whatever locator gets
// clicked for "Click Me" and confirm it's role/text-based, not an id selector — checked on that
// one line, not the whole file, so an unrelated id-based locator elsewhere (e.g. the double- or
// right-click buttons, which DO have stable ids) can't mask a real violation via AND-with-file.
function checkClickMeLocator(source: string): string[] {
  const clickMeLine = source.split('\n').find((l) => /clickMe/i.test(l) && /=\s*page\./.test(l));
  if (clickMeLine && /page\.locator\(\s*['"`]#/.test(clickMeLine)) {
    return [`"Click Me" locator uses a hardcoded #id selector, which will break on the next page load: ${clickMeLine.trim()}`];
  }
  return [];
}

// The oracle: written by a human, fixed before the agent ever runs. Checks the ONE thing that
// actually proves the "Click Me" button was clicked correctly rather than some other button on
// the page, or a hardcoded stale id that happened to still resolve to *a* button.
export const buttonsDynamicClickGoal: Goal<Page> = {
  id: 'buttons-dynamic-click',
  description:
    `On ${config.buttonsHost}, click the button labeled "Click Me" (note: only one of the three ` +
    'buttons on this page is a plain single left-click target — figure out which one from the ' +
    "page-knowledge notes, don't assume) and make the page show its confirmation message.",
  pageKnowledgeFile: 'docs/page-knowledge/buttons.md',
  driverFile: 'src/ui/pages/buttons.page.ts',
  achieveSignature: 'export async function achieve(page: HealPage): Promise<void>',
  contractChecks: checkClickMeLocator,
  succeedsWhen: async (page) => {
    await expect(page.locator('#dynamicClickMessage')).toHaveText('You have done a dynamic click');
    // Negative check: the other two messages must NOT have appeared — a driver that clicked
    // everything on the page to be safe should not pass this goal either.
    await expect(page.locator('#doubleClickMessage')).toHaveCount(0);
    await expect(page.locator('#rightClickMessage')).toHaveCount(0);
  },
};
