// Human-owned. The agent (goal-solver persona, src/goal-evolution/propose-driver.ts) never edits
// this file and never sees it — its output scope is src/api/clients/book-store.client.ts only.
// This file is the only place the goal's oracle (bookStoreRegisterUserGoal.succeedsWhen) actually
// runs, right after the agent-written achieve() returns. See src/goal-evolution/goal.ts for why
// this split is what makes the goal-based result trustworthy instead of self-reported.
//
// The username/password are generated HERE, not by the driver — see book-store-register-user.ts's
// header comment for why letting the driver choose its own identity would let a swallowed
// duplicate-registration failure pass anyway.

import { test } from '@playwright/test';
import { achieve } from '../../src/api/clients/book-store.client';
import { bookStoreRegisterUserGoal, cleanupUser } from '../../src/goal-evolution/goals/book-store-register-user';

test.describe('DemoQA Book Store (goal-based)', () => {
  test(bookStoreRegisterUserGoal.id, async ({ request }) => {
    const userName = `goal_book_store_${Date.now()}`;
    const password = 'Str0ng!Pass1';
    let userId: string | undefined;

    try {
      userId = await achieve(request, userName, password);
      await bookStoreRegisterUserGoal.succeedsWhen({ request, userName, password });
    } finally {
      await cleanupUser(request, userName, password, userId);
    }
  });
});
