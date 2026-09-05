# Book Store — Login & Profile — https://demoqa.com/login → https://demoqa.com/profile

## Login form is NOT reCAPTCHA-protected (unlike `/register`)

Confirmed live: filling `#userName` / `#password` with valid credentials (a user created via
`POST /Account/v1/User` — see `docs/page-knowledge/book-store-register.md`) and clicking `#login`
navigates straight to `/profile`, no CAPTCHA step. This is the opposite of `/register`, so
login-based UI flows are achievable without the API-only workaround register needs.

## Rapid repeated logins for the same account can be rejected

Confirmed live: running two tests back-to-back in the same suite run, each doing a fresh UI login
as the same account, the second `#login` click returned "Invalid username or password!" on the
page even though the credentials were unchanged and `POST /Account/v1/GenerateToken` kept
succeeding for that exact username/password throughout. This is UI-login-specific throttling (or
similar), not a credentials problem — don't "fix" it by rotating passwords or re-registering.
**Mitigation**: share one login across multiple assertions in the same test rather than logging in
once per test for the same account.

## Locators

| Element | Locator | Notes |
|---|---|---|
| Username input | `#userName` | |
| Password input | `#password` | |
| Login button | `#login` | navigation to `/profile` takes ~1-2s; wait on `page.waitForURL(/\/profile$/)`, not a fixed timeout |
| Logged-in username (on `/profile`) | `#userName-value` | same id as the page-count value on the list/detail page (`docs/page-knowledge/book-store-list.md`) — confirmed this is a reused template id, not page-specific, so always scope or verify by context |

## Profile page — book collection table

Each collected book renders as a `tbody tr` with:

- A cover image `<td>`
- A title `<td>` containing `<span id="see-book-<Title>"><a href="/books?search=<ISBN>">`
- Author `<td>`, Publisher `<td>` (plain text, no id)
- A delete `<td>` containing `<span id="delete-record-<ISBN>">` (SVG trash icon)

Safest locator for "is book X in this user's collection": filter `tbody tr` rows by
`[id="see-book-<Title>"]` inside them, rather than matching visible text alone — the id is
title-scoped and avoids partial-text false positives.

`tbody tr` is empty until the collection table finishes rendering — wait on
`profileRows.first()` before reading a count, don't read it immediately after navigation/login.

## Removing a book from the collection

Confirmed live (headless Playwright, throwaway user + 2 books added via
`BookStoreClient.addBookToCollection`): clicking `#delete-record-<ISBN>` does NOT delete
immediately — it opens a React modal (not a native browser dialog, no `page.on('dialog')` involved):

```
Delete Book
Do you want to delete this book?
[OK] [Cancel]
```

The modal's confirm button is `#closeSmallModal-ok` — **not** safe to find via
`getByRole('button', { name: 'OK' })`, which resolves to 3 elements on this page (`#gotoStore`
"Go To Book Store", `#submit` "Delete All Books", and `#closeSmallModal-ok` "OK") and throws a
strict-mode violation. Clicking `#closeSmallModal-ok` removes exactly that row from `tbody tr`
(verified: 2 rows → 1 row, the correct remaining title). Cancel was not exercised.

There is also a bulk `#submit` "Delete All Books" button on the profile page — a one-click way to
empty the whole collection, distinct from per-book deletion via `#delete-record-<ISBN>`.

**Token reuse gotcha**: in one throwaway probe script, a token minted via
`POST /Account/v1/GenerateToken` *before* the UI login was later rejected (401) by
`DELETE /Account/v1/User/{id}` cleanup. Only observed once, and on that same run the delete-book
click never actually fired (a timing bug in the probe), so the 401 could have another cause —
treat "UI login invalidates a pre-existing token" as a hypothesis, not confirmed. Regardless of
cause, generating any cleanup token fresh, after the browser work is done, is strictly safer than
reusing setup's token, and costs nothing — do that rather than relying on the untested assumption.

## Source of truth

Confirmed live via a headless Playwright script (`chromium.launch({ headless: true })`, per the
project's hard rule against `claude-in-chrome` for anything test-related) against
`https://demoqa.com/login` and the resulting `/profile` page, logged in as a user previously
created via the API and given a book (`Speaking JavaScript`, ISBN `9781449365035`) through
`BookStoreClient.addBookToCollection`. First artifact for this page.

Delete-flow section added in a later session: same technique, throwaway user with 2 books
(`Speaking JavaScript` + "You Don't Know JS"), input to
`src/goal-evolution/goals/book-store-remove-books.ts`.
