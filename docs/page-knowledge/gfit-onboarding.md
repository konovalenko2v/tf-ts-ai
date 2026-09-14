# gFit — onboarding funnel — https://app.gfit.world/

External third-party site, unrelated to this framework's SUTs (Restful Booker / Hygraph /
demoqa.com). Captured ad hoc via a headless Playwright crawl script (not saved in the repo — ran
from a scratch file, deleted after use) to answer "what can a client do on this site", per rule #1
(headless, not `claude-in-chrome`). No account was created, no email/payment entered, no CAPTCHA
touched.

## Confirmed live: unauthenticated onboarding funnel

Route sequence (`chromium.launch({headless:true})`, cookie banner rejected first):

| # | Route | Screen | Interaction |
|---|---|---|---|
| 0 | `/` | Landing — "Welcome to" + hero image | `GET STARTED` button |
| 1 | `/start_step` | "Do you already have a gFit account?" | Two-way fork: **Yes, log in** vs **No, let's create a fitness plan** |
| 2 | `/start_step` | "What should we call you?" | Free-text name input |
| 3 | `/start_quiz/greetings` | "Nice to meet you! Together, we'll create workouts that fit your goals, level, and lifestyle." | `START THE JOURNEY` |
| 4 | `/start_quiz/gender` | "Before we begin, please share your gender" | Single-select: Woman / Man |
| 5 | `/start_quiz/your_goal` | "What is your top health goal?" | Multi-select (10 options): Boost my physical health, Feel more energized, Lower my stress, Lose weight, Tone my body, Improve flexibility, Ease back discomfort, Stay active throughout the day, Build a workout habit, Feel more confident |
| 6 | `/start_quiz/your_health` | "BUILT FOR YOUR HEALTH — Staying active helps you feel more energized, sleep better, and stay hormonally balanced." (motivational interstitial, no input) | `CONTINUE` |
| 7 | `/start_quiz/about_you` | "Tell us about you" — biometric intake: unit toggle (cm/kg vs in/lb), birthdate scroll-picker (default landed on 53 YRS), height scroll-picker (default 160.4 cm), current-weight scroll-picker (default 115.4 kg), consent checkbox ("I consent to Gfit processing my health onboarding data...", links `Privacy Policy`) | `CONTINUE` (stayed **disabled** past this point in the crawl — see below) |

## Where the crawl stopped, and why

`/start_quiz/about_you`'s `CONTINUE` did not become clickable after checking the visible
`input[type=checkbox]` — the crawl script tried once and gave up rather than guess at a
custom-component checkbox implementation or start clicking through the numeric scroll-pickers to
force a "changed" state. This is a real gap in what was verified, not a claim that the funnel ends
here: `about_you` is clearly a biometric-data intake step (birthdate/height/weight), and pushing
past it live would mean generating and submitting a fake person's health data — out of scope for a
"describe the site" ask. Stopped here on purpose.

Two further branches were located but deliberately **not** entered, per the same
no-account/no-payment boundary used for demoqa.com's Book Store register form
(`docs/page-knowledge/book-store-register.md`):

- **`/auth/sign_in`** ("Log in to unlock your personal fitness program") — reachable from the
  landing page's "Yes, log in" fork. Fields: Email, Password, "Forgot your password?", `LOG IN`,
  "Continue as Guest", "Create Account". Not exercised — no credentials exist, and creating a
  guest/real session wasn't asked for.
- **Whatever comes after `about_you`** — on a typical fitness-quiz-funnel SaaS this shape (name →
  gender → goal → biometrics) leads to a generated-plan preview and then a subscription paywall,
  but that is a pattern-match against the genre, not something this crawl observed. Do not repeat
  it as fact.

## Site mechanics (confirmed)

- Next.js **App Router** (`/_next/static/...` chunks present; `window.__NEXT_DATA__` is *not*
  defined — that's a Pages Router artifact, its absence is consistent with App Router). No
  `_buildManifest.js` route-enumeration shortcut available because of this — App Router doesn't
  publish that file the way Pages Router does.
- UI kit is a HeroUI/NextUI-style React component library — quiz options render as real
  `<button type="button">` elements (not `<li>` or bare `<div>`), each wrapped in
  `data-react-aria-pressable` attributes.
- Client-side-only state: reloading `/` after progressing into the funnel did **not** reliably
  resume at the same step in every crawl run — one run went straight from `GET STARTED` to
  `/auth/sign_in` instead of `/start_step`. Not fully root-caused (could be a cold-session vs.
  session-cookie difference between crawl invocations); flagging as an observed inconsistency, not
  a documented mechanism.

## What this does NOT tell you

The actual client-facing product — workout plans, exercise library, tracking, any in-app
screen — lives behind either the login or the completed-onboarding-plus-paywall path. Nothing
above is a view into that. A confident feature list for "what a paying gFit client can do" would
have to come from the marketing/pricing copy (not captured here) or from an authenticated session,
neither of which this pass did.

## Source of truth

Headless Playwright crawl, `chromium.launch({headless:true})`, single session, 2026-09-09. Script
was a one-off in the OS scratchpad (not committed) — re-running it would need to be rewritten from
this table if a future task wants to re-verify or push further into `about_you`.
