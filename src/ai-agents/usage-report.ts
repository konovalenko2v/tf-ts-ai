// Aggregates .observability/ai-usage.jsonl (written by cli-fallback.ts's runClaude/runGemini)
// into a per-caller, per-model cost/token summary — the missing piece the "enterprise
// applicability" review flagged: without this, AI spend was only ever visible per-call in scrolled-
// past terminal output, never as a total anyone could budget against.
//
// Usage: npm run ai-usage-report [-- --json]

import { readAiUsage, AiUsageEvent } from './usage-log';

interface Bucket {
  calls: number;
  successes: number;
  failures: number;
  timeouts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costUsdKnown: boolean; // false when every call in this bucket lacked a cost figure (Gemini tiers)
}

function emptyBucket(): Bucket {
  return { calls: 0, successes: 0, failures: 0, timeouts: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costUsdKnown: false };
}

function fold(bucket: Bucket, event: AiUsageEvent): void {
  bucket.calls += 1;
  if (event.outcome === 'success') bucket.successes += 1;
  if (event.outcome === 'failure') bucket.failures += 1;
  if (event.outcome === 'timeout') bucket.timeouts += 1;
  bucket.inputTokens += event.inputTokens ?? 0;
  bucket.outputTokens += event.outputTokens ?? 0;
  if (event.costUsd !== undefined) {
    bucket.costUsd += event.costUsd;
    bucket.costUsdKnown = true;
  }
}

function main(): void {
  const events = readAiUsage();
  if (events.length === 0) {
    process.stdout.write('No AI usage recorded yet — .observability/ai-usage.jsonl does not exist or is empty.\n');
    return;
  }

  const byCaller = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  const overall = emptyBucket();

  for (const event of events) {
    fold(overall, event);
    fold(byCaller.get(event.caller) ?? byCaller.set(event.caller, emptyBucket()).get(event.caller)!, event);
    fold(byModel.get(event.model) ?? byModel.set(event.model, emptyBucket()).get(event.model)!, event);
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(
        {
          overall,
          byCaller: Object.fromEntries(byCaller),
          byModel: Object.fromEntries(byModel),
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  const printTable = (title: string, rows: Map<string, Bucket>) => {
    process.stdout.write(`\n${title}\n`);
    for (const [key, b] of rows) {
      const cost = b.costUsdKnown
        ? `$${b.costUsd.toFixed(4)}`
        : 'n/a (no cost figure for any call in this row — Gemini reports tokens only, and/or every call failed before reporting usage)';
      process.stdout.write(
        `  ${key.padEnd(20)} calls=${b.calls} (ok=${b.successes} fail=${b.failures} timeout=${b.timeouts})  ` +
          `tokens in/out=${b.inputTokens}/${b.outputTokens}  cost=${cost}\n`,
      );
    }
  };

  process.stdout.write(`AI usage report — ${events.length} recorded call(s), from .observability/ai-usage.jsonl\n`);
  printTable('By caller (module that invoked runAgenticEdit):', byCaller);
  printTable('By model:', byModel);
  process.stdout.write(
    `\nTotal known cost: ${overall.costUsdKnown ? `$${overall.costUsd.toFixed(4)}` : 'n/a'} ` +
      `(Claude-tier calls only — Gemini's CLI json output does not report a dollar figure, see usage-log.ts)\n`,
  );
}

main();
