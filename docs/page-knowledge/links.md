# Links — https://demoqa.com/links

Two groups of links in `#linkWrapper`: two open a new tab (`target="_blank"`, real anchors), the
rest fire a fake API call in-place and print the result into `#linkResponse` — none of them are
real `href`s (see below).

## Locators

| Element | Locator | Notes |
|---|---|---|
| "Home" (new tab) | `#simpleLink` | real link, `href="https://demoqa.com"` |
| "Home9gi84" (new tab) | `#dynamicLink` | same target, id suffix is randomized per page load |
| Created (201) | `#created` | |
| No Content (204) | `#no-content` | |
| Moved (301) | `#moved` | see "Permanently Moved" below |
| Bad Request (400) | `#bad-request` | |
| Unauthorized (401) | `#unauthorized` | |
| Forbidden (403) | `#forbidden` | |
| Not Found (404) | `#invalid-url` | id does not match its visible text ("Not Found") |
| Response text | `#linkResponse` | absent from the DOM until the first API-call link is clicked |

## The "Permanently Moved" link

The visible label is **"Moved"**, not "Permanently Moved" — "Permanently Moved" is the status
text the click produces, not the link text itself. Clicking `#moved` sets `#linkResponse` to:

```
Link has responded with staus 301 and status text Moved Permanently
```

`"staus"` is the live site's own typo (not a transcription error here) — assert on it literally,
don't correct it in the expected string.

## Behavior notes

- The six API-call links are **not real anchors with real hrefs**: `href="javascript:throw new
  Error('React has blocked a javascript: URL as a security precaution.')"` on every one of them.
  Clicking still works (React's onClick handler runs and updates `#linkResponse`), but this is
  confirmed to be a client-side fetch-and-render, not real navigation — never wait for a
  navigation/load event on these clicks, only for `#linkResponse`'s text to update.
- Each of the two "new tab" links opens a real second tab/page (`target="_blank"`) — assert via
  `context.waitForEvent('page')` around the click, not `page.waitForNavigation()` (this page
  itself never navigates).
- `#linkResponse` persists and is overwritten on each subsequent API-call-link click within the
  same page load — clicking `#created` then `#moved` leaves only the `#moved` text behind, not
  both.

## Source of truth

Confirmed live via headless Playwright script (`chromium.launch({ headless: true })`), not
`claude-in-chrome` and not screenshots — direct DOM/text inspection of `#linkWrapper` and
`#linkResponse`.
