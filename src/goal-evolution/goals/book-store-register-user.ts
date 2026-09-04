import { APIRequestContext, expect } from '@playwright/test';
import { Goal } from '../goal';
import { config } from '../../core/config';

export interface BookStoreRegisterCtx {
  request: APIRequestContext;
  userName: string;
  password: string;
}

// Cleanup-only helper — NOT part of the oracle, and the trust rule is deliberately different here:
// the oracle above never trusts the driver's own report of what it did (that's what makes it an
// oracle). Cleanup has no such requirement — it's best-effort hygiene (reviewer-tests check #4),
// not a correctness check — so it's fine for it to use the userId the driver's successful POST
// returned. There is no other way to get it: GenerateToken doesn't echo userId, and the only
// endpoint that does is POST /Account/v1/User itself. If the driver didn't return one (e.g. it
// failed before this point), userId is undefined and cleanup is skipped — nothing to delete.
export async function cleanupUser(
  request: APIRequestContext,
  userName: string,
  password: string,
  userId: string | undefined,
): Promise<void> {
  if (!userId) {
    process.stderr.write('[book-store-register-user] cleanup skipped — no userId (driver did not report one)\n');
    return;
  }
  const tokenResponse = await request.post(`${config.bookStoreHost}/Account/v1/GenerateToken`, { data: { userName, password } });
  if (tokenResponse.status() !== 200) {
    process.stderr.write(
      `[book-store-register-user] cleanup could not get a token (status ${tokenResponse.status()}) — user ${userId} left behind on demoqa.com\n`,
    );
    return;
  }
  const { token } = await tokenResponse.json();
  const deleteResponse = await request.delete(`${config.bookStoreHost}/Account/v1/User/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (deleteResponse.status() !== 204) {
    process.stderr.write(
      `[book-store-register-user] cleanup DELETE failed (status ${deleteResponse.status()}) — user ${userId} left behind on demoqa.com\n`,
    );
  } else {
    process.stderr.write(`[book-store-register-user] cleanup OK — user ${userId} deleted\n`);
  }
}

// The one thing that would make a "the agent solved it" claim dishonest for this goal: if the
// driver were allowed to pick the username it hands the oracle, a driver that POSTed, got a 406
// "User exists!", and silently swallowed that failure would still pass — GenerateToken and GET
// /User/{id} both succeed for a pre-existing user, not just a freshly created one. So the harness
// (not the driver) generates a guaranteed-fresh userName/password and passes it INTO achieve() —
// the driver never gets to choose or substitute the identity the oracle checks. See goal.ts's
// header comment.
function checkNoHardcodedIdentity(source: string): string[] {
  const violations: string[] = [];
  if (/userName\s*[:=]\s*['"`][^'"`]+['"`]/.test(source)) {
    violations.push(
      'driver appears to hardcode a userName instead of accepting it as a parameter — the harness must control the identity the oracle checks',
    );
  }
  return violations;
}

export const bookStoreRegisterUserGoal: Goal<BookStoreRegisterCtx> = {
  id: 'book-store-register-user',
  description:
    'Create a new user account for the Book Store on demoqa.com. You will be given a username and ' +
    'password to register with — figure out from the page-knowledge notes which layer of the site ' +
    'actually lets you do this (not every path documented there necessarily works).',
  pageKnowledgeFile: 'docs/page-knowledge/book-store-register.md',
  driverFile: 'src/api/clients/book-store.client.ts',
  achieveSignature:
    'export async function achieve(request: APIRequestContext, userName: string, password: string): ' +
    "Promise<string | undefined> // returns the created user's userID (extracted from the 201 response body), " +
    'or undefined if registration did not succeed — never the raw APIResponse object',
  contractChecks: checkNoHardcodedIdentity,
  succeedsWhen: async ({ request, userName, password }) => {
    // Independent of whatever the driver's own POST /Account/v1/User response claimed: re-derive
    // proof the user was actually created, using only the credentials the harness generated —
    // never the driver's own report of what it did.
    //
    // GenerateToken is the strongest single check available here: it can only return
    // status:"Success" if a user with this exact username+password combination actually exists
    // server-side. There is no separate "get user by credentials" endpoint (GenerateToken's
    // response carries no userId — confirmed live), so a second, independent confirmation is
    // POSTing to /Account/v1/User again with the SAME credentials: a real API responds 406
    // "User exists!" for an already-registered username, which is itself proof of existence,
    // distinguishable from the 201 a genuinely new registration would produce.
    const tokenResponse = await request.post(`${config.bookStoreHost}/Account/v1/GenerateToken`, {
      data: { userName, password },
    });
    expect(tokenResponse.status(), 'GenerateToken should succeed for a genuinely created user').toBe(200);
    const tokenBody = await tokenResponse.json();
    expect(tokenBody.status).toBe('Success');

    const reRegisterResponse = await request.post(`${config.bookStoreHost}/Account/v1/User`, {
      data: { userName, password },
    });
    expect(reRegisterResponse.status(), 'a second registration attempt with the same username must be rejected as a duplicate').toBe(406);
    const reRegisterBody = await reRegisterResponse.json();
    expect(reRegisterBody.code).toBe('1204');
  },
};
