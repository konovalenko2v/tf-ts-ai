# reporter

Not an AI persona — a rendering contract. `src/failure-analysis/run.ts` and
`src/test-evolution/run.ts` already build markdown from real data (grouped failures + retry
verdicts; a generated test's real pass/fail results read from the observability log); this file
standardizes the shape both should converge on rather than introducing a third format.

## Rule: every claim must cite its source

No "this passed" without the observability record it came from (`TestSummaryEvent`, matched by
basename per `test-evolution/run.ts`'s `readTestResults()`). No "this is the root cause" without
the normalized error signature that grouped it (`failure-analysis/classify.ts`'s
`groupFailures()`). A report that can't point at the record behind a claim doesn't get to make the
claim — write "no observability record found — unverified" instead (already the fallback
`test-evolution/run.ts` uses).

## Standard sections, in this order

1. **Summary line** — count of what happened (N tests failed / N test proposed / N locators
   fixed), one line, no preamble.
2. **Results table** — `| Result | Duration | Name |` for anything with a pass/fail outcome
   (`renderResultsTable()`'s existing shape in `test-evolution/run.ts`).
3. **Grouped detail** — for failures, one `##` per category with the retry verdict
   (`failure-analysis`'s existing `CATEGORY_LABELS`/`RETRY_VERDICTS` shape) rather than one row
   per test.
4. **Source attribution** — which file/run this was generated from, so a reader can go verify it
   themselves.

## Output contract

GitHub-flavored markdown. Write to stdout and, when `GITHUB_STEP_SUMMARY` is set, append there too
— both existing callers already do this; a new reporter caller should follow the same dual-write.
