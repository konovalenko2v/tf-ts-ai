import { expect, Page } from '@playwright/test';
import { Goal } from '../goal';
import { config } from '../../core/config';

// The one check that proves the agent picked the RIGHT button out of four look-alike "Click me"
// buttons on this page (plain alert / timed alert / confirm / prompt — see
// docs/page-knowledge/alerts.md) and handled the resulting native dialog correctly, rather than
// registering a generic dialog.accept() on page load and clicking whichever button first fires
// one. Playwright auto-dismisses any dialog with no listener registered before the triggering
// click resolves, so a driver that clicks first and attaches the handler after would hang or
// silently lose the dialog — this is the actual difficulty, not "find a locator".
export const alertsConfirmGoal: Goal<Page> = {
  id: 'alerts-confirm',
  description:
    `On ${config.alertsHost}, trigger the confirmation dialog (note: only one of the four ` +
    'buttons on this page produces a confirm-type dialog with an Ok/Cancel choice — figure out ' +
    "which one from the page-knowledge notes, don't assume) and accept it so the page shows the " +
    'result of an accepted confirmation, not a cancelled one.',
  pageKnowledgeFile: 'docs/page-knowledge/alerts.md',
  driverFile: 'src/ui/pages/alerts.page.ts',
  achieveSignature: 'export async function achieve(page: HealPage): Promise<void>',
  succeedsWhen: async (page) => {
    await expect(page.locator('#confirmResult')).toHaveText('You selected Ok');
    // Negative check: a driver that fired the alert/timer-alert/prompt buttons instead (or
    // accepted-then-dismissed the same confirm twice) must not pass just because SOME dialog
    // was handled.
    await expect(page.locator('#promptResult')).toHaveCount(0);
  },
};
