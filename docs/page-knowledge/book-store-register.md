# Book Store — Register — https://demoqa.com/register (UI) / https://demoqa.com/Account/v1 (API)

## Why this is API-only, not UI

The `/register` UI form is protected by reCAPTCHA. Confirmed live: filling all four fields with
valid data (a strong password, a fresh username) and clicking `#register` returns
`"Please verify reCaptcha to register!"` in the `#name` error paragraph — the form never submits
without solving the CAPTCHA. Bypassing CAPTCHA is out of policy scope for this framework
(automated CAPTCHA-solving is a prohibited technique), so **no goal-based UI test can achieve
"create a user" against the live site** — this is a real, permanent limitation of the site, not a
gap in the framework.

The underlying REST API (`/Account/v1/User`) has **no CAPTCHA check** — confirmed working via a
direct POST. This is the only achievable path to this goal, so the goal targets the API layer.

## Locators (UI form, for reference only — do not build a goal driver against this)

| Element | Locator | Notes |
|---|---|---|
| First Name input | `#firstname` | |
| Last Name input | `#lastname` | |
| UserName input | `#userName` | |
| Password input | `#password` | |
| Register button | `#register` | |
| Error/status message | `#name` | reused for every register-page error, including the CAPTCHA one — not just password errors |

> [!WARNING]
> The `input.value = ...` + a synthetic `input` event does NOT work on this form — it's a React
> app and the fields silently reset to empty on submit unless filled via real keyboard/click
> events (confirmed: programmatic `.value` assignment left all four fields blank after clicking
> Register). Playwright's `.fill()` uses native input simulation and is unaffected — this note is
> for anyone debugging via raw `page.evaluate`/devtools, not a Playwright gotcha.

## API — `POST https://demoqa.com/Account/v1/User`

Request body: `{ "userName": string, "password": string }`

| Scenario | Status | Response body |
|---|---|---|
| New username, password meets strength rule | `201` | `{ "userID": "<uuid>", "username": "<echoed>", "books": [] }` |
| Username already registered | `406` | `{ "code": "1204", "message": "User exists!" }` |
| Password fails the strength rule | `400` | `{ "code": "1300", "message": "Passwords must have at least one non alphanumeric character, one digit ('0'-'9'), one uppercase ('A'-'Z'), one lowercase ('a'-'z'), one special character and Password must be eight characters or longer." }` |

Password rule (from the message above, confirmed against a real `400`): at least 8 characters, one
uppercase, one lowercase, one digit, one non-alphanumeric/special character. All four classes
required together — a password missing any one of them is rejected.

## API — independent verification (do NOT trust the POST /User response alone as the oracle)

- `POST https://demoqa.com/Account/v1/GenerateToken` with the same `{ userName, password }` →
  `200` with `{ "token": "...", "status": "Success", "result": "User authorized successfully." }`
  only if the user was actually created with that exact password. This is the strongest
  independent check — it proves the credentials work, not just that some response object was
  returned.
- `GET https://demoqa.com/Account/v1/User/{userID}` with `Authorization: Bearer <token from
  GenerateToken>` → `200` with `{ "userId", "username", "books": [] }` confirms the record persists
  server-side under that id.

## Source of truth

Confirmed live via direct `curl` calls against `https://demoqa.com/Account/v1/*` and direct DOM/UI
interaction on `/register` (screenshot + `#name` error text), same session as
`docs/page-knowledge/buttons.md`. No existing client/page object covers this API yet — first
artifact for it, input to `src/goal-evolution/goals/book-store-register-user.ts`.
