# Web Tables — https://demoqa.com/webtables

## Locators

| Element | Locator | Notes |
|---|---|---|
| Add button (opens the registration modal) | `#addNewRecordButton` | |
| Search box | `#searchBox` | filters visible rows client-side, live on every keystroke |
| Table | `table` (plain HTML `<table>`, not react-table) | one real semantic `<table>` — no `.rt-*` classes despite older DemoQA docs/screenshots; site has migrated off react-table |
| Table body rows | `table tbody tr` | each `<td>` in order: First Name, Last Name, Age, Email, Salary, Department, Action |
| Edit icon (per row) | `#edit-record-<id>` | `<id>` is a stable per-record integer assigned by the app, NOT the row's visual position — deleting a row does not renumber the others, and a newly added record gets the next unused id |
| Delete icon (per row) | `#delete-record-<id>` | same id as the edit icon for that record |
| Registration modal container | `.modal-content` | absent from the DOM entirely when closed — `.count()` is 0, not just hidden |
| Modal title | `#registration-form-modal` | text is always "Registration Form" for both Add and Edit — nothing in the DOM distinguishes "adding" from "editing" except which fields are pre-filled |
| First Name input | `#firstName` | `required`, `maxlength=25` |
| Last Name input | `#lastName` | `required`, `maxlength=25` |
| Email input | `#userEmail` | `required`, `pattern="^([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})$"` |
| Age input | `#age` | `required`, `pattern="\d*"`, `minlength=1`, `maxlength=2` |
| Salary input | `#salary` | `required`, `pattern="\d*"`, `minlength=1`, `maxlength=10` |
| Department input | `#department` | `required`, `maxlength=25` |
| Submit button (inside modal) | `#submit` | same id used for both Add and Edit — the form's mode, not the button, determines whether it creates or updates |

## Behavior notes

- **Validation is pure browser-native HTML5** (`required`/`pattern`/`minlength`/`maxlength`
  attributes on the inputs, `<form novalidate>` disabling the browser's own default bubble UI in
  favor of Bootstrap's `.was-validated`/`:invalid` styling) — there is no server-side or app-level
  validation layer to test independently. Submitting with any required field empty (confirmed:
  submitting a fully empty form) adds `class="was-validated"` to `<form id="userForm">` and every
  required-but-empty input becomes CSS `:invalid`; the modal stays open, nothing is added to the
  table.
- **Email uniqueness is NOT enforced.** Adding a new record with an email that already exists in
  the table (confirmed: reused an existing seed row's email) succeeds without any error — the
  duplicate is simply added as a new row. Do not assume uniqueness without checking; this is a
  common false assumption about "Email" fields in general.
- **A valid Add closes the modal automatically** and the new row appears at the end of the table
  body — `.modal-content` becomes count 0 in the DOM (not just hidden) immediately after a
  successful submit.
- **Edit reuses the exact same modal/form** as Add — clicking `#edit-record-<id>` opens
  `.modal-content` with all 6 inputs pre-filled from that row's current values, `#submit` updates
  the existing row in place (same position, same id) rather than appending a new one.
- **Record ids are stable, not positional.** The three seed rows are `edit-record-1`/`2`/`3`
  (Cierra/Alden/Kierra). A newly added 4th row got `edit-record-4` — confirmed the app assigns the
  next unused integer, not "index of this row in the current table." Deleting a row does not
  reuse or renumber ids for the rows that remain.
- **Delete removes the row immediately**, no confirmation dialog — row count in `table tbody tr`
  drops by exactly one right after clicking `#delete-record-<id>`.
- **Search (`#searchBox`) filters live, client-side, matching across all columns** (confirmed: a
  search on the added row's first name reduced the table to just that one row). A query matching
  no rows at all leaves `<table tbody>` completely empty — no "no results" message rendered
  anywhere, no placeholder row, just zero `<tr>` elements. Clearing the search box restores every
  row.
- Seed data on a fresh page load is always the same 3 rows: Cierra Vega / Alden Cantrell / Kierra
  Gentry, ids 1/2/3 — useful as a known starting state for a test that doesn't add its own row
  first, but any test relying on this should still treat prior test runs on a shared/non-fresh
  session as a risk (this project's tests each `navigate()` fresh per test via a new browser
  context, so seed data is reliably present at the start of every test).
- The page also exposes a pagination control (First/Previous/Next/Last, "Show N" page-size select)
  — not explored in depth since the seed data never exceeds one page; out of scope for the tests
  written from this note.

## Source of truth

`src/ui/pages/web-tables.page.ts`, `src/ui/steps/web-tables.steps.ts`, `tests/ui/web-tables.spec.ts`.
Confirmed against the live site via headless Playwright DOM inspection (add/edit/delete/search/
duplicate-email/empty-submit all exercised directly), not inferred from screenshots or older
DemoQA documentation — the site has migrated off react-table (`.rt-*` classes) to a plain
Bootstrap `<table>` since earlier snapshots of this page were written up elsewhere.
