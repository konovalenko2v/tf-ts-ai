// Unit coverage for src/agent-fixer/verify-stability.ts's decision logic — this file used to have
// zero tests despite being the exact gate that decides whether an AI-touched branch merges to
// master unreviewed; its own header comment flagged that as the repo's biggest risk. evaluateStability()
// is the pure decision function extracted for this purpose — the real getAffectedSpecs/execFileSync
// calls stay in main(), which is not covered here (that's process/subprocess plumbing, not a decision).
import { test, expect } from '@playwright/test';
import {
  evaluateStability,
  exitCodeFor,
  runPlaywright,
  REPEAT_EACH_TEST,
  REPEAT_WHOLE_SUITE,
} from '../../src/agent-fixer/verify-stability';
import { ALLOWED_TARGET_FILES } from '../../src/agent-fixer/safety-gates';
import { AffectedResult } from '../../src/test-selection/affected-tests';

function affected(overrides: Partial<AffectedResult> = {}): AffectedResult {
  return { specs: ['tests/ui/practice-form.spec.ts'], runAll: false, changedFiles: [...ALLOWED_TARGET_FILES], ...overrides };
}

test.describe('evaluateStability — defensive fallback path', () => {
  test('refuses to pass when runAll is true — never treat "run everything" as gate evidence', () => {
    const runner = () => true;
    const verdict = evaluateStability(affected({ runAll: true }), runner);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain('runAll=true');
  });

  test('refuses to pass when no specs are affected — no evidence is not passing evidence', () => {
    const runner = () => true;
    const verdict = evaluateStability(affected({ specs: [] }), runner);
    expect(verdict.passed).toBe(false);
  });

  test('never calls the runner at all on the fallback path', () => {
    let called = false;
    const runner = () => {
      called = true;
      return true;
    };
    evaluateStability(affected({ runAll: true }), runner);
    expect(called).toBe(false);
  });
});

test.describe('evaluateStability — scope gate', () => {
  test('fails when the branch touches a file outside ALLOWED_TARGET_FILES', () => {
    const runner = () => true;
    const verdict = evaluateStability(affected({ changedFiles: ['.github/workflows/regression.yml'] }), runner);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain('outside the allowed auto-merge scope');
    expect(verdict.reason).toContain('.github/workflows/regression.yml');
  });

  test('the scope gate runs BEFORE any Playwright invocation — an out-of-scope branch never gets its tests run', () => {
    let called = false;
    const runner = () => {
      called = true;
      return true;
    };
    evaluateStability(affected({ changedFiles: ['some/unexpected/file.ts'] }), runner);
    expect(called).toBe(false);
  });
});

test.describe('evaluateStability — repeat-each step', () => {
  test('invokes the runner with --repeat-each 5 and --retries=0 — dropping --retries=0 would let a flaky locator pass on a later attempt and make the gate decorative', () => {
    const calls: { specs: string[]; args: string[] }[] = [];
    const runner = (specs: string[], args: string[]) => {
      calls.push({ specs, args });
      return true;
    };
    evaluateStability(affected(), runner);
    expect(calls[0].args).toEqual(['--repeat-each', String(REPEAT_EACH_TEST), '--retries=0']);
    expect(calls[0].specs).toEqual(['tests/ui/practice-form.spec.ts']);
  });

  test('fails immediately if the repeat-each step fails, without attempting the suite-repeat step', () => {
    const calls: { specs: string[]; args: string[] }[] = [];
    const runner = (specs: string[], args: string[]) => {
      calls.push({ specs, args });
      return false;
    };
    const verdict = evaluateStability(affected(), runner);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain(`all ${REPEAT_EACH_TEST} repeats`);
    expect(calls.length).toBe(1);
  });
});

test.describe('evaluateStability — suite-repeat step', () => {
  test('runs the suite exactly REPEAT_WHOLE_SUITE times, each with --retries=0, after the repeat-each step passes', () => {
    const calls: { specs: string[]; args: string[] }[] = [];
    const runner = (specs: string[], args: string[]) => {
      calls.push({ specs, args });
      return true;
    };
    const verdict = evaluateStability(affected(), runner);
    expect(verdict.passed).toBe(true);
    expect(calls.length).toBe(1 + REPEAT_WHOLE_SUITE);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].args).toEqual(['--retries=0']);
    }
  });

  test('fails on the first unstable suite run and does not attempt a second', () => {
    let callCount = 0;
    const runner = () => {
      callCount++;
      return callCount !== 2; // repeat-each passes (call 1), first suite run fails (call 2)
    };
    const verdict = evaluateStability(affected(), runner);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain('suite run 1/');
    expect(callCount).toBe(2);
  });

  test('fails on the second unstable suite run even if the first suite run passed', () => {
    let callCount = 0;
    const runner = () => {
      callCount++;
      return callCount !== 3; // repeat-each + suite run 1 pass, suite run 2 fails
    };
    const verdict = evaluateStability(affected(), runner);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain('suite run 2/');
    expect(callCount).toBe(3);
  });
});

test.describe('evaluateStability — full pass', () => {
  test('passes only when every invocation (repeat-each + all suite repeats) succeeds', () => {
    const runner = () => true;
    const verdict = evaluateStability(affected(), runner);
    expect(verdict.passed).toBe(true);
    expect(verdict.reason).toContain('safe to auto-merge');
  });
});

// Added after mutation testing: the real runner and the exit-code decision both lived in untested
// code, and inverting either survived the whole suite — a gate that reported every Playwright
// failure as success, or never failed its CI job, looked identical to a working one.
test.describe('runPlaywright — the real runner', () => {
  test('reports success when Playwright exits 0, passing specs then args through verbatim', () => {
    const calls: unknown[][] = [];
    const ok = runPlaywright(['tests/ui/a.spec.ts'], ['--retries=0'], (...a) => calls.push(a));
    expect(ok).toBe(true);
    expect(calls).toEqual([['npx', ['playwright', 'test', 'tests/ui/a.spec.ts', '--retries=0'], { stdio: 'inherit' }]]);
  });

  test('reports failure when Playwright exits nonzero (execFileSync throws)', () => {
    const failing = () => {
      throw new Error('Command failed: npx playwright test');
    };
    expect(runPlaywright(['tests/ui/a.spec.ts'], [], failing)).toBe(false);
  });
});

test.describe('exitCodeFor — what the CI job actually gates on', () => {
  test('a failed verdict fails the job', () => {
    expect(exitCodeFor({ passed: false, reason: 'FAILED' })).toBe(1);
  });

  test('a passed verdict does not', () => {
    expect(exitCodeFor({ passed: true, reason: 'PASSED' })).toBe(0);
  });
});
