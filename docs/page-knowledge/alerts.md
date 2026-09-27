# Alerts (demoqa.com/alerts)

Four separate buttons, each producing a different kind of browser dialog. Verified live via headless Playwright:

| Button id           | Label      | Dialog produced                                                    | Result element      |
| -------------------- | ---------- | -------------------------------------------------------------------- | -------------------- |
| `#alertButton`        | "Click me" | Immediate `alert()` — "You clicked a button"                        | none (no result text) |
| `#timerAlertButton`   | "Click me" | `alert()` after a ~5s delay — "This alert appeared after 5 seconds" | none                  |
| `#confirmButton`      | "Click me" | `confirm()` — "Do you confirm action?"                               | `#confirmResult`      |
| `#promtButton`        | "Click me" | `prompt()` — "Please enter your name"                                | `#promptResult`       |

Note the typo in the real DOM id: `promtButton`, not `promptButton`.

`#confirmButton`'s dialog (verified live, both branches):
- Accepting (`dialog.accept()`) sets `#confirmResult` to exactly `You selected Ok`.
- Dismissing (`dialog.dismiss()`) sets `#confirmResult` to exactly `You selected Cancel`.

`#promtButton`'s dialog (verified live, both branches):
- Accepting with text `dialog.accept('some text')` sets `#promptResult` to `You entered some text`.
- Dismissing (`dialog.dismiss()`) leaves `#promptResult` absent from the DOM entirely — locating it
  returns `null`/times out, not empty text. A driver or oracle must not assume the element exists
  after a dismiss.

Playwright auto-dismisses any dialog it doesn't get a `page.on('dialog', ...)` handler for before
navigation/action completes — a driver MUST register the dialog handler before clicking the
button that triggers it, not after.
