import { APIRequestContext, expect } from '@playwright/test';
import { HealPage } from 'healwright';
import { Goal } from '../goal';
import { BookStoreClient } from '../../api/clients/book-store.client';

export interface BookStoreRemoveBooksCtx {
  page: HealPage;
  request: APIRequestContext;
  userId: string;
  userName: string;
  password: string;
}

// Same trust rule as book-store-register-user.ts: the harness (not the driver) creates the
// account and adds the books being removed, and passes their identity in — a driver is never
// allowed to invent or substitute the account it operates on. See goal.ts's header comment.

// "Delete All Books" (#submit) is a real one-click way to empty the collection, but it isn't the
// behavior this goal exercises — the goal is specifically about removing the two books that were
// added, one at a time, via the per-row #delete-record-<ISBN> control documented in
// docs/page-knowledge/book-store-login.md. A driver that reaches for the bulk button proves
// nothing about that flow, so it's rejected here rather than silently accepted as "also valid".
//
// Matches raw source text, not just code — the same trap run.ts's own expect(...) check has (see
// book-store-profile.page.ts's history): a driver comment that merely mentions "#submit" or
// "Delete All Books" (e.g. explaining why it avoided the shortcut) trips this too. Keep any such
// explanation phrased without those literal strings if a future driver adds one.
function checkNoBulkDeleteShortcut(source: string): string[] {
  const violations: string[] = [];
  if (/#submit\b/.test(source) || /Delete All Books/i.test(source)) {
    violations.push(
      'driver appears to use the bulk "Delete All Books" (#submit) shortcut instead of removing each book individually via #delete-record-<ISBN> — that is a different behavior than this goal is meant to exercise',
    );
  }
  return violations;
}

export const bookStoreRemoveBooksGoal: Goal<BookStoreRemoveBooksCtx> = {
  id: 'book-store-remove-books',
  description:
    'Log in to the Book Store as the given user, whose collection already has 2 books, and remove ' +
    'both of them from the collection one at a time, the same way a user would using the delete ' +
    'control next to each book row. You will be given the username and password to log in with.',
  pageKnowledgeFile: 'docs/page-knowledge/book-store-login.md',
  driverFile: 'src/ui/pages/book-store-profile.page.ts',
  achieveSignature: 'export async function achieve(page: HealPage, userName: string, password: string): Promise<void>',
  contractChecks: checkNoBulkDeleteShortcut,
  succeedsWhen: async ({ page, request, userId, userName, password }) => {
    // Independent of whatever the driver's own UI actions appeared to do: re-derive proof the
    // collection is actually empty server-side, using a token generated fresh AFTER the browser
    // work (see docs/page-knowledge/book-store-login.md — a token minted before UI login was
    // rejected by the API afterward; reusing setup's token here would risk a false negative, not
    // a false positive, but it's still not "independent" if it's the same token the driver's own
    // session relied on).
    const client = new BookStoreClient(request);
    const tokenResponse = await client.generateToken(userName, password);
    expect(tokenResponse.status(), 'GenerateToken should still succeed after the delete flow').toBe(200);
    const { token } = await tokenResponse.json();

    const userResponse = await client.getUser(userId, token);
    expect(userResponse.status(), 'the account itself must still exist — this goal removes books, not the account').toBe(200);
    const userBody = await userResponse.json();
    expect(userBody.books, 'the collection must be empty after removing both added books').toEqual([]);

    // Secondary, UI-side check: reload the same driver-owned page and re-read the collection
    // table, rather than trusting whatever transient DOM state the driver's own actions left
    // behind (a stale reference to a row that already reported itself removed proves nothing).
    await page.reload();
    await expect(page.locator('tbody tr')).toHaveCount(0);
  },
};
