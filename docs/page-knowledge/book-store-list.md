# Book Store — List & Detail — https://demoqa.com/books

## Search box filters the list client-side

`#searchBox` filters the visible `tbody tr` rows as you type (confirmed live: typing a full title
leaves exactly 1 row). No network request fires — it's a client-side filter over the already-loaded
book list, not a fresh API call.

## Row → detail navigation is via `?search=<isbn>`, same route

Each row's title is a link: `<a href="/books?search=<ISBN>">`, wrapped in
`<span id="see-book-<Title>">`. Clicking it (or navigating straight to
`https://demoqa.com/books?search=<ISBN>`) renders the **detail view in place of the list**, on the
exact same `/books` route — there is no separate `/books/:isbn` path. Confirmed live for ISBN
`9781491904244` ("You Don't Know JS"): the list table is replaced by a labeled field panel showing
ISBN, Title, Sub Title, Author, Publisher, Total Pages, Description, Website, and a "Back To Book
Store" link.

## Detail-view field locators

| Field | Wrapper id | Label id | Value locator | Notes |
|---|---|---|---|---|
| ISBN | `#ISBN-wrapper` | — | — | not individually id'd beyond the wrapper |
| Title | `#title-wrapper` | `#title-label` | — | |
| Sub Title | `#subtitle-wrapper` | `#subtitle-label` | — | |
| Author | `#author-wrapper` | `#author-label` | — | |
| Publisher | `#publisher-wrapper` | `#publisher-label` | — | |
| Total Pages | `#pages-wrapper` | `#pages-label` | `#userName-value` | **id is a leftover/mislabeled template id, not a copy-paste error in this doc** — confirmed live via DOM dump, the page count sits in a `<label id="userName-value">` inside `#pages-wrapper`, sibling to `#pages-label` |
| Description | `#description-wrapper` | `#description-label` | — | |
| Website | `#website-wrapper` | — | — | |

Since only the pages value has its own distinct id, and it's the oddly-named `#userName-value`,
the safest scoped locator for it is `page.locator('#pages-wrapper #userName-value')` — pinning it
inside `#pages-wrapper` guards against the id being reused/regenerated elsewhere in the app (it is
visibly a template artifact, not a page-specific name).

## No page-knowledge for pagination / login-gated actions

This page also shows "Previous / Page 1 of 1 / Next" pagination controls and a "Login" link in the
top-right, neither explored — out of scope for a read-only page-count check. Only the list, search,
and detail-view field locators above are confirmed.

## Source of truth

Confirmed live via a headless Playwright script (`chromium.launch({ headless: true })`, per the
project's hard rule against `claude-in-chrome` for anything test-related) against
`https://demoqa.com/books` and `https://demoqa.com/books?search=9781491904244`, same session as
this file's creation. First artifact for this page — `docs/page-knowledge/book-store-register.md`
covers the separate `/register` form and `/Account/v1` API only, not this list/detail page.
