// Human-owned. The agent (goal-solver persona, src/goal-evolution/propose-driver.ts) never edits
// this file and never sees it — its output scope is src/ui/pages/book-store-profile.page.ts only.
// This file is the only place the goal's oracle (bookStoreRemoveBooksGoal.succeedsWhen) actually
// runs, right after the agent-written achieve(page, ...) returns. See src/goal-evolution/goal.ts
// for why this split is what makes the goal-based result trustworthy instead of self-reported.
//
// The account and its 2 starting books are created HERE, not by the driver — same trust rule as
// book-store-register-user.ts: the driver must never be allowed to pick (or silently reuse) the
// account it operates on.

import { test } from '../../src/ui/fixtures';
import { achieve } from '../../src/ui/pages/book-store-profile.page';
import { bookStoreRemoveBooksGoal } from '../../src/goal-evolution/goals/book-store-remove-books';
import { BookStoreClient } from '../../src/api/clients/book-store.client';
import { config } from '../../src/core/config';

const ISBN_SPEAKING_JS = '9781449365035';
const ISBN_YOU_DONT_KNOW_JS = '9781491904244';

test.describe('DemoQA Book Store (goal-based)', () => {
  test(bookStoreRemoveBooksGoal.id, async ({ page, request }) => {
    const client = new BookStoreClient(request);
    const userName = `goal_book_store_remove_${Date.now()}`;
    const password = 'Str0ng!Pass1';

    const createResponse = await client.createUser(userName, password);
    const { userID: userId } = await createResponse.json();

    const setupTokenResponse = await client.generateToken(userName, password);
    const { token: setupToken } = await setupTokenResponse.json();
    await client.addBookToCollection(userId, ISBN_SPEAKING_JS, setupToken);
    await client.addBookToCollection(userId, ISBN_YOU_DONT_KNOW_JS, setupToken);

    try {
      await page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());

      // achieve() owns navigation and login itself — this spec only sets up the account/books
      // before it and checks the oracle after.
      await achieve(page, userName, password);

      await bookStoreRemoveBooksGoal.succeedsWhen({ page, request, userId, userName, password });
    } finally {
      // Fresh token, generated after the browser work — see docs/page-knowledge/book-store-login.md:
      // a token minted before UI login was rejected by the API afterward.
      const cleanupTokenResponse = await client.generateToken(userName, password);
      if (cleanupTokenResponse.status() === 200) {
        const { token: cleanupToken } = await cleanupTokenResponse.json();
        const deleteResponse = await request.delete(`${config.bookStoreHost}/Account/v1/User/${userId}`, {
          headers: { Authorization: `Bearer ${cleanupToken}` },
        });
        if (deleteResponse.status() !== 204) {
          process.stderr.write(
            `[book-store-remove-books] cleanup DELETE failed (status ${deleteResponse.status()}) — user ${userId} left behind on demoqa.com\n`,
          );
        }
      } else {
        process.stderr.write(
          `[book-store-remove-books] cleanup could not get a token (status ${cleanupTokenResponse.status()}) — user ${userId} left behind on demoqa.com\n`,
        );
      }
    }
  });
});
