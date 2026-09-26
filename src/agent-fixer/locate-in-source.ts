// Pure source-parsing logic pulled out of run.ts so it's unit-testable without a real git branch
// / file on disk — same split verify-stability.ts uses for its own pure evaluateStability().
const SKIP_MARKER = 'agent-fixer: skip';

export interface BrokenLocator {
  selector: string;
  contextName: string;
  lineIndex: number;
  testId: string;
}

// A selector is skipped if the nearest non-blank line above it is a comment carrying the marker
// — walking up stops at the first real code line, so it can't leak across an unrelated line.
export function isSkipped(fileLines: string[], matchLineIndex: number): boolean {
  for (let i = matchLineIndex - 1; i >= 0; i--) {
    const trimmed = fileLines[i].trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('//')) return false;
    if (trimmed.includes(SKIP_MARKER)) return true;
  }
  return false;
}

// Finds the contextName paired with `this.page.locator('<selector>')` inside a heal.<action>(...)
// call — the exact join key into healwright's cache (cache entry `context` field, see
// cache-lookup.ts's header comment: "the exact contextName that sits next to the broken locator
// in source").
//
// This used to be a same-line regex (`,\s*'([^']+)'\s*\)`) run against ONLY the line the selector
// was found on. That silently never matched any real call in this repo: every heal.click(...) call
// here is Prettier-wrapped across multiple lines (`heal.click(\n  this.page.locator(...),\n
// '<context>',\n)`), so the selector's own line never has a comma+string on it — locateInSource
// always fell through to "could not extract contextName for X — skipping", meaning auto-fix could
// never actually resolve a broken selector's context in this codebase, cache or AI fallback,
// regardless of source shape. Fixed by scanning forward from the selector's line, across as many
// lines as it takes, for the first quoted string that appears after the selector — which handles
// both the wrapped call sites that exist today and a plain getter shape like
// `get x() { return this.page.locator('#x'); }` with the context passed at the *call* site instead
// (see findEnclosingGetterName below) without requiring the whole call to fit on one line.
function findContextAfter(fileLines: string[], selectorLineIndex: number, selectorEndCol: number): string | undefined {
  const maxLinesToScan = 5; // generous for Prettier's wrapping; a real call is never this spread out
  for (let i = selectorLineIndex; i < Math.min(fileLines.length, selectorLineIndex + maxLinesToScan); i++) {
    // Stop-condition checked BEFORE matching this line — a line that opens a fresh statement (its
    // own `this.` call, closing the enclosing function, etc.) with no string on it means the
    // context isn't there, so it must not fall through to matching a string that belongs to the
    // NEXT statement (e.g. `await this.page.locator('#next-thing')...` right after the call this
    // selector lives in — checking the match first used to return '#next-thing' as this selector's
    // own context, which is wrong).
    if (i > selectorLineIndex && /^\s*(await|const|let|function|\}|\/\/)/.test(fileLines[i])) break;
    const line = i === selectorLineIndex ? fileLines[i].slice(selectorEndCol) : fileLines[i];
    const m = line.match(/'([^']+)'/);
    if (m) return m[1];
  }
  return undefined;
}

// Scans up to a few lines above the locator line for an enclosing `get <name>(` — covers both a
// single-line getter (`get x() { return this.page.locator(...); }`) and Prettier's multi-line
// form (`get x() {` on its own line, `return this.page.locator(...);` on the next). Stops early on
// a line that closes a block or starts an unrelated statement, so it never reads past the getter
// it's actually inside of.
function findEnclosingGetterName(fileLines: string[], locatorLineIndex: number): string | undefined {
  const maxLinesToScan = 3;
  for (let i = locatorLineIndex; i >= Math.max(0, locatorLineIndex - maxLinesToScan); i--) {
    const m = fileLines[i].match(/^\s*get\s+(\w+)\s*\(/);
    if (m) return m[1];
    if (i < locatorLineIndex && /\}\s*$/.test(fileLines[i])) break;
  }
  return undefined;
}

// Finds each broken selector's line in source and extracts the contextName. Handles both:
//   - the direct call site: this.page.heal.click(this.page.locator('<sel>'), '<context>')
//   - a getter indirection: this.<x> is a `get x() { return this.page.locator('<sel>'); }` and the
//     context is passed where the getter is actually USED — this.page.heal.click(this.x, '<context>')
//     — see CLAUDE.md rule #2's getter allowance for why this shape is legal in a page object.
export function locateInSource(source: string, brokenSelectors: Map<string, string>): BrokenLocator[] {
  const lines = source.split('\n');
  const found: BrokenLocator[] = [];

  for (const [selector, testId] of brokenSelectors) {
    const needle = `this.page.locator('${selector}')`;
    const lineIndex = lines.findIndex((l) => l.includes(needle));
    if (lineIndex === -1) {
      continue;
    }
    if (isSkipped(lines, lineIndex)) {
      continue;
    }

    const needleCol = lines[lineIndex].indexOf(needle);
    // A getter's `return this.page.locator(...)` line can be preceded by its own `get <name>(`
    // line (multi-line getter body) or share it (single-line). Scan a few lines up for the
    // nearest `get <name>(` — same "how far Prettier could plausibly wrap this" budget as
    // findContextAfter uses going forward.
    const getterName = findEnclosingGetterName(lines, lineIndex);

    let contextName: string | undefined;
    if (getterName) {
      // The context isn't on this line or the ones after it (a getter body is just `return
      // this.page.locator(...)`) — it's wherever the getter is invoked as this.<getterName>.
      // \b word boundary: a plain `includes('this.' + getterName)` would also match a longer
      // getter sharing the same prefix (this.stateOption vs this.stateOptionList).
      const usagePattern = new RegExp(`this\\.${getterName}\\b`);
      const usageIndex = lines.findIndex((l, idx) => idx !== lineIndex && usagePattern.test(l));
      if (usageIndex !== -1) {
        const usageMatch = lines[usageIndex].match(usagePattern)!;
        const usageCol = usageMatch.index! + usageMatch[0].length;
        contextName = findContextAfter(lines, usageIndex, usageCol);
      }
    } else {
      contextName = findContextAfter(lines, lineIndex, needleCol + needle.length);
    }

    if (!contextName) {
      continue;
    }
    found.push({ selector, contextName, lineIndex, testId });
  }
  return found;
}
