# Book Store — Login & Profile — https://demoqa.com/login → https://demoqa.com/profile

## Login form is NOT reCAPTCHA-protected (unlike `/register`)

Confirmed live: filling `#userName` / `#password` with valid credentials (a user created via
`POST /Account/v1/User` — see `docs/page-knowledge/book-store-register.md`) and clicking `#login`
navigates straight to `/profile`, no CAPTCHA step. This is the opposite of `/register`, so
login-based UI flows are achievable without the API-only workaround register needs.

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
- A delete `<td>` containing `<span id="delete-record-<ISBN>">` (SVG trash icon, not explored further)

Safest locator for "is book X in this user's collection": filter `tbody tr` rows by
`[id="see-book-<Title>"]` inside them, rather than matching visible text alone — the id is
title-scoped and avoids partial-text false positives.

## Source of truth

Confirmed live via a headless Playwright script (`chromium.launch({ headless: true })`, per the
project's hard rule against `claude-in-chrome` for anything test-related) against
`https://demoqa.com/login` and the resulting `/profile` page, logged in as a user previously
created via the API and given a book (`Speaking JavaScript`, ISBN `9781449365035`) through
`BookStoreClient.addBookToCollection`. First artifact for this page.
