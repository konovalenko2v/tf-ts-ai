# Buttons — https://demoqa.com/buttons

## Locators

| Element | Locator | Notes |
|---|---|---|
| "Click Me" button | **no stable id** — `id` is regenerated on every page load (observed `Ii9O4` on one load, `QYyO7` on the next). Locate by role+text: `getByRole('button', { name: 'Click Me', exact: true })` | never hardcode the id — it will break on the very next run |
| "Double Click Me" button | `#doubleClickBtn` | stable id, safe to use directly |
| "Right Click Me" button | `#rightClickBtn` | stable id, safe to use directly |
| Dynamic-click result message | `#dynamicClickMessage` | absent from the DOM until the "Click Me" button is clicked |
| Double-click result message | `#doubleClickMessage` | absent from the DOM until double-clicked |
| Right-click result message | `#rightClickMessage` | absent from the DOM until right-clicked |

## Behavior notes

- All three message elements do **not exist in the DOM** on page load (confirmed: 0 `[id*="Message"]`
  elements before any interaction) — they're inserted only after the matching interaction, so
  asserting on them requires waiting for the element to appear, not just checking text on an
  already-present node.
- Message text is exact: `"You have done a dynamic click"`, `"You have done a double click"`,
  `"You have done a right click"`.
- The three buttons are independent — clicking one does not affect the other two's messages, and
  triggering the wrong interaction on a button (e.g. a plain click on "Double Click Me") produces
  no message at all.
- The first `<button>` on the page is the navbar hamburger toggle (`.navbar-toggler`), not one of
  the three demo buttons — don't select by `document.querySelectorAll('button')[0]`.

## Source of truth

Confirmed live against the site via direct DOM inspection (`javascript_tool` + screenshots), same
methodology as `text-box.md`/`check-box.md`. No page object exists yet for this page — this file
is the first artifact for it, written as the input to a goal-based test-generation run (see
`src/goal-evolution/`) rather than to a hand-authored page object.
