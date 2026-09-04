import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter';
import { capStackFrames, stripAnsi, toRelativePath, truncate } from './sanitize';
import { ObservabilityEvent, RecoveredError, StepError, StepTarget } from './types';
// Recorded in the run header so a stored run can be read back knowing which Playwright produced
// it. Imported (resolveJsonModule) rather than require()d — the rest of this file is ES imports,
// and the JSON import is type-checked instead of cast.
import { version as playwrightVersion } from '@playwright/test/package.json';

const MESSAGE_BYTE_BUDGET = 2048;
const STACK_FRAME_LIMIT = 10;
const OUTPUT_DIR = '.observability';

function sanitizeError(error: TestError): StepError {
  return {
    message: truncate(stripAnsi(error.message ?? ''), MESSAGE_BYTE_BUDGET),
    snippet: error.snippet ? truncate(stripAnsi(error.snippet), MESSAGE_BYTE_BUDGET) : undefined,
    stackTop: capStackFrames(error.stack, STACK_FRAME_LIMIT),
  };
}

// pw:api / expect step titles carry the action/selector/value inline, e.g.
// `Click locator('#foo')`, `Fill "John" locator('#firstName')`, `Navigate to "/path"`.
function extractTarget(step: TestStep, lastUrlPath: string | undefined): StepTarget {
  const title = step.title;
  const selectorMatch = title.match(/locator\('([^']+)'\)/);
  const navigateMatch = title.match(/Navigate to "([^"]+)"/);
  const action = title.split(' locator(')[0].split(' "')[0].trim();
  return {
    action,
    selector: selectorMatch?.[1],
    urlPath: navigateMatch?.[1] ?? lastUrlPath,
  };
}

function isTestStep(step: TestStep): boolean {
  return step.category === 'test.step';
}

export default class ObservabilityReporter implements Reporter {
  private runId = crypto.randomUUID().slice(0, 8);
  private outFile = '';
  private ci = !!process.env.CI;
  private lastUrlPath = new Map<string, string>(); // keyed by test.id
  private recoveredBuffer = new Map<TestStep, RecoveredError[]>();
  private stepIndex = new Map<string, number>(); // keyed by test.id
  private totals = { passed: 0, failed: 0, skipped: 0, flaky: 0 };

  onBegin(config: FullConfig, suite: Suite): void {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    this.outFile = path.join(OUTPUT_DIR, `run-${this.runId}.jsonl`);
    this.write({
      type: 'run',
      phase: 'begin',
      runId: this.runId,
      startedAt: new Date().toISOString(),
      ci: this.ci,
      playwrightVersion,
      projects: config.projects.map((p) => p.name),
    });
  }

  onStepBegin(): void {
    // no-op: all data needed is available in onStepEnd
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    const navigateMatch = step.title.match(/Navigate to "([^"]+)"/);
    if (navigateMatch) this.lastUrlPath.set(test.id, navigateMatch[1]);

    if (!isTestStep(step)) {
      if (step.error) {
        const target = extractTarget(step, this.lastUrlPath.get(test.id));
        const recovered: RecoveredError = {
          action: target.action,
          selector: target.selector,
          durationMs: step.duration,
          message: truncate(stripAnsi(step.error.message ?? ''), MESSAGE_BYTE_BUDGET),
        };
        const bucket = step.parent;
        if (bucket) {
          const existing = this.recoveredBuffer.get(bucket) ?? [];
          existing.push(recovered);
          this.recoveredBuffer.set(bucket, existing);
        } else {
          // no test.step ancestor (e.g. a bare API-layer expect) — emit standalone
          this.emitStepEvent(test, result, step, 'failed', target, sanitizeError(step.error));
        }
      }
      return;
    }

    const recovered = this.recoveredBuffer.get(step);
    this.recoveredBuffer.delete(step);

    if (step.error) {
      const target = recovered?.length ? { action: recovered[recovered.length - 1].action, selector: recovered[recovered.length - 1].selector } : undefined;
      this.emitStepEvent(test, result, step, 'failed', target, sanitizeError(step.error), recovered);
    } else if (recovered?.length) {
      const target = { action: recovered[recovered.length - 1].action, selector: recovered[recovered.length - 1].selector };
      this.emitStepEvent(test, result, step, 'passed_with_recovery', target, undefined, recovered);
    } else {
      this.emitStepEvent(test, result, step, 'passed');
    }
  }

  private emitStepEvent(
    test: TestCase,
    result: TestResult,
    step: TestStep,
    outcome: 'passed' | 'failed' | 'passed_with_recovery',
    target?: StepTarget,
    error?: StepError,
    recoveredErrors?: RecoveredError[],
  ): void {
    const idx = (this.stepIndex.get(test.id) ?? 0) + 1;
    this.stepIndex.set(test.id, idx);
    this.write({
      type: 'step',
      runId: this.runId,
      testId: test.id,
      testTitlePath: test.titlePath().join(' > '),
      project: test.parent.project()?.name ?? 'unknown',
      retry: result.retry,
      stepTitle: step.title,
      stepIndex: idx,
      startedAt: step.startTime.toISOString(),
      durationMs: step.duration,
      outcome,
      target,
      error,
      recoveredErrors: recoveredErrors?.length ? recoveredErrors : undefined,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const stepCount = this.stepIndex.get(test.id) ?? 0;
    this.stepIndex.delete(test.id);
    this.lastUrlPath.delete(test.id);

    switch (result.status) {
      case 'passed':
        this.totals.passed++;
        break;
      case 'failed':
      case 'timedOut':
      case 'interrupted':
        this.totals.failed++;
        break;
      case 'skipped':
        this.totals.skipped++;
        break;
    }
    if (test.outcome() === 'flaky') this.totals.flaky++;

    this.write({
      type: 'test',
      runId: this.runId,
      testId: test.id,
      testTitlePath: test.titlePath().join(' > '),
      project: test.parent.project()?.name ?? 'unknown',
      status: result.status,
      outcome: test.outcome(),
      retry: result.retry,
      durationMs: result.duration,
      stepCount,
      recoveredStepCount: 0,
      error: result.errors[0] ? sanitizeError(result.errors[0]) : undefined,
      artifacts: result.attachments
        .filter((a) => a.path)
        .map((a) => ({ name: a.name, contentType: a.contentType, path: toRelativePath(a.path!) })),
    });
  }

  onEnd(result: FullResult): void {
    this.write({
      type: 'run',
      phase: 'end',
      runId: this.runId,
      endedAt: new Date().toISOString(),
      ci: this.ci,
      totals: this.totals,
    });
    process.stderr.write(`[observability] wrote run events to ${this.outFile}\n`);
  }

  private write(event: ObservabilityEvent): void {
    fs.appendFileSync(this.outFile, JSON.stringify(event) + '\n', 'utf-8');
  }
}
