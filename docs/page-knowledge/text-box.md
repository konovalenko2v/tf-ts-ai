# Text Box — https://demoqa.com/text-box

## Locators

| Element | Locator | Notes |
|---|---|---|
| Full Name input | `#userName` | |
| Email input | `#userEmail` | |
| Current Address textarea | `#currentAddress` | shares its id with the output `<p>` below — scope reads inside `#output`, never reuse this locator for the output |
| Permanent Address textarea | `#permanentAddress` | same id collision as above |
| Submit button | `#submit` | |
| Output wrapper | `#output` | only exists in the DOM after a submit that produced something to show — see below |
| Output field (per field) | `#output #name` / `#output #email` / `#output #currentAddress` / `#output #permanentAddress` | text format: `Name:<value>`, `Email:<value>`, `Current Address :<value> ` (trailing space), `Permananet Address :<value>` (site's own typo, not ours) |
| Bordered output check | `#output .border` | present only when at least one field was actually recorded |

## Behavior notes

- Submitting with **every field empty** still creates `#output` in the DOM, but without the
  `.border` wrapper class and with no child `<p>` elements at all — this is what "nothing was
  recorded" looks like. It is *not* the same as `#output` being absent.
- An **invalid email** (fails the browser's own email format check) marks `#userEmail` with a
  `field-error` class and leaves `#output` exactly as it was before the submit — no error text is
  rendered anywhere. This is the *only* user-visible signal a submit was rejected; there's no
  error message to assert against.
- `#output` never clears itself between submits — a later valid submit overwrites only the fields
  it actually filled; anything not filled this time keeps its previous value/absence from before.
- Fields are independently optional: submitting with only `name` filled renders only `#name`
  inside `#output`, nothing else.

## Source of truth

`src/ui/pages/text-box.page.ts`, `src/ui/steps/text-box.steps.ts`, `tests/ui/text-box.spec.ts`
(PET-2). Confirmed against the live site via direct DOM inspection, not inferred from screenshots.
