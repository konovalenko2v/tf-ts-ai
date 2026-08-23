export interface RunHeaderEvent {
  type: 'run';
  phase: 'begin' | 'end';
  runId: string;
  startedAt?: string;
  endedAt?: string;
  ci: boolean;
  playwrightVersion?: string;
  projects?: string[];
  totals?: { passed: number; failed: number; skipped: number; flaky: number };
}

export interface StepTarget {
  action: string;
  selector?: string;
  value?: string;
  urlPath?: string;
}

export interface StepError {
  message: string;
  snippet?: string;
  stackTop?: string[];
}

export interface RecoveredError {
  action: string;
  selector?: string;
  durationMs: number;
  message: string;
}

export interface StepEvent {
  type: 'step';
  runId: string;
  testId: string;
  testTitlePath: string;
  project: string;
  retry: number;
  stepTitle: string;
  stepIndex: number;
  startedAt: string;
  durationMs: number;
  outcome: 'passed' | 'failed' | 'passed_with_recovery';
  target?: StepTarget;
  error?: StepError;
  recoveredErrors?: RecoveredError[];
}

export interface TestArtifact {
  name: string;
  contentType: string;
  path: string;
}

export interface TestSummaryEvent {
  type: 'test';
  runId: string;
  testId: string;
  testTitlePath: string;
  project: string;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  outcome: 'skipped' | 'expected' | 'unexpected' | 'flaky';
  retry: number;
  durationMs: number;
  stepCount: number;
  recoveredStepCount: number;
  error?: StepError;
  artifacts: TestArtifact[];
}

export type ObservabilityEvent = RunHeaderEvent | StepEvent | TestSummaryEvent;
