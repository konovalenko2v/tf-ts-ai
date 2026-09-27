// Deterministic headless recon for goal-evolution:new — never AI. The page-knowledge file this
// produces is the ONLY input the goal-solver agent gets about a page's real behavior; a guessed
// fact here (e.g. "the timer alert says the same thing as the immediate one") ships as if it were
// observed. Every fact below comes from an actual headless Playwright run against the live page,
// never from convention or assumption — this is the same discipline docs/page-knowledge/alerts.md
// was built with by hand, just automated.

import { chromium } from 'playwright';

export interface InteractiveElement {
  tag: string;
  id: string | null;
  role: string | null;
  text: string;
}

export interface DialogObservation {
  elementId: string;
  dialogType: string;
  message: string;
  // What happened after accepting/dismissing: the id of any element whose text appeared or
  // disappeared as a result, and what it said. Absent (not empty string) is itself a fact —
  // dismissing a prompt on this page leaves no result element in the DOM at all, and a driver
  // written against "empty text" instead of "element absent" would silently do the wrong wait.
  afterAccept?: { elementId: string; text: string | null };
  afterDismiss?: { elementId: string; text: string | null };
}

export interface ReconResult {
  url: string;
  elements: InteractiveElement[];
  idsUnstableAcrossLoads: string[];
  dialogs: DialogObservation[];
}

const DIALOG_WAIT_MS = 7000; // covers demoqa.com/alerts' own ~5s timer alert with margin

async function enumerateElements(url: string): Promise<InteractiveElement[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await page.goto(url);

    const handles = await page.locator('button, a, input, [role="button"]').all();
    const elements: InteractiveElement[] = [];
    for (const handle of handles) {
      const [tag, id, role, text] = await Promise.all([
        // A STRING pageFunction on an ElementHandle silently returned undefined here (confirmed
        // live — the function form works, the string form does not, unlike page.evaluate where a
        // string form works fine). Function form needs an explicit non-dom parameter type instead,
        // to sidestep the missing Element/tagName types this repo's tsconfig has (no "dom" lib).
        handle.evaluate((el: { tagName: string }) => el.tagName.toLowerCase()),
        handle.getAttribute('id'),
        handle.getAttribute('role'),
        handle.textContent(),
      ]);
      elements.push({ tag, id, role, text: (text ?? '').trim() });
    }
    return elements;
  } finally {
    await browser.close();
  }
}

// Catches the exact class of finding buttons.md documented by hand: an id that's regenerated on
// every load can't be used as a locator. Two independent loads, diffed by (tag, text, position) —
// not by id, since the id is precisely what might differ.
async function findUnstableIds(url: string): Promise<string[]> {
  const [first, second] = await Promise.all([enumerateElements(url), enumerateElements(url)]);
  const unstable: string[] = [];
  for (let i = 0; i < Math.min(first.length, second.length); i++) {
    const a = first[i];
    const b = second[i];
    if (a.tag === b.tag && a.text === b.text && a.id !== b.id) {
      if (a.id) unstable.push(a.id);
    }
  }
  return unstable;
}

// For each button-like element with a stable id, click it on a fresh page load and record any
// native dialog it produces, then probe both accept and dismiss branches (each on its own fresh
// load, since a dialog already resolved can't be re-triggered on the same page state). Elements
// that produce no dialog within DIALOG_WAIT_MS are skipped, not reported as "no dialog" — recon
// only asserts what it positively observed.
async function probeDialogs(url: string, elements: InteractiveElement[]): Promise<DialogObservation[]> {
  const observations: DialogObservation[] = [];
  const candidateIds = elements.filter((e) => e.id && (e.tag === 'button' || e.role === 'button')).map((e) => e.id as string);

  for (const elementId of candidateIds) {
    process.stderr.write(`[recon] probing #${elementId} (accept branch)...\n`);
    const acceptObs = await probeOneDialog(url, elementId, 'accept');
    if (!acceptObs) {
      process.stderr.write(`[recon] #${elementId} produced no dialog within ${DIALOG_WAIT_MS}ms — skipping\n`);
      continue; // no dialog fired — not a dialog-producing element, skip silently
    }
    process.stderr.write(`[recon] #${elementId} -> ${acceptObs.dialogType} dialog: "${acceptObs.message}"; probing dismiss branch...\n`);
    const dismissObs = await probeOneDialog(url, elementId, 'dismiss');

    observations.push({
      elementId,
      dialogType: acceptObs.dialogType,
      message: acceptObs.message,
      afterAccept: acceptObs.after,
      afterDismiss: dismissObs?.after,
    });
  }
  return observations;
}

// Every element on the page that carries an id, mapped to its current text — used to diff the
// DOM before and after a dialog is resolved. Deliberately NOT guessing a result element's id from
// the trigger's id (e.g. "confirmButton" -> "confirmButtonResult") — demoqa.com/alerts' own ids
// don't follow that pattern (#confirmButton's result is #confirmResult, not #confirmButtonResult),
// confirmed live: the guessed-id approach reported every single result as "not found" even though
// results were genuinely appearing. A full-page diff finds the real id regardless of its naming.
async function snapshotIdTexts(page: import('playwright').Page): Promise<Map<string, string>> {
  // This repo's tsconfig has no "dom" lib (see README's book-store-remove-books note on the same
  // issue), so the evaluate callback can't reference document/HTMLElement by type — evaluating a
  // string avoids that entirely, at the cost of no type-checking inside the browser-side code.
  const result: unknown = await page.evaluate(
    `Array.from(document.querySelectorAll('[id]')).map(function(el) { return [el.id, (el.textContent || '').trim()]; })`,
  );
  return new Map(result as [string, string][]);
}

async function probeOneDialog(
  url: string,
  elementId: string,
  action: 'accept' | 'dismiss',
): Promise<{ dialogType: string; message: string; after: { elementId: string; text: string | null } } | null> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await page.goto(url);

    const before = await snapshotIdTexts(page);

    // click() cannot resolve until the dialog it synchronously opens is handled, so it must run
    // concurrently with waitForEvent, not be awaited first — awaiting it here would deadlock
    // against the dialog it's about to open (confirmed live: this exact pattern hung for 30s).
    const dialogPromise = page.waitForEvent('dialog', { timeout: DIALOG_WAIT_MS }).catch(() => null);
    const clickPromise = page
      .locator(`#${elementId}`)
      .click()
      .catch(() => null);
    const dialog = await dialogPromise;
    if (!dialog) {
      await clickPromise;
      return null;
    }

    const dialogType = dialog.type();
    const message = dialog.message();
    if (action === 'accept') {
      // A prompt-type dialog needs text to produce its "you entered X" branch; any accepted text
      // works for recon purposes since the goal is observing the RESULT SHAPE, not a specific value.
      await dialog.accept(dialogType === 'prompt' ? 'recon probe text' : undefined);
    } else {
      await dialog.dismiss();
    }
    await clickPromise;
    await page.waitForTimeout(300);

    const after = await snapshotIdTexts(page);
    // Every id whose text changed — an ancestor container (e.g. React's #root) changes too,
    // since its textContent includes every descendant's, so picking the FIRST match risked
    // reporting the whole page's text as "the result" (confirmed live: #root won that race).
    // The shortest changed text is the most specific element — an ancestor's text is always a
    // superset of its descendant's, so it's never shorter. Multiple same-length changes would be
    // ambiguous, but none were observed live; if that ever happens, this reports the first tied
    // candidate and recon's output should be manually reviewed, same as any generated file.
    let changed: { elementId: string; text: string | null } | null = null;
    for (const [id, text] of after) {
      if (text && text !== (before.get(id) ?? '') && (!changed || text.length < changed.text!.length)) {
        changed = { elementId: id, text };
      }
    }
    return { dialogType, message, after: changed ?? { elementId: `${elementId}Result`, text: null } };
  } finally {
    await browser.close();
  }
}

export async function recon(url: string): Promise<ReconResult> {
  const elements = await enumerateElements(url);
  const idsUnstableAcrossLoads = await findUnstableIds(url);
  const dialogs = await probeDialogs(url, elements);
  return { url, elements, idsUnstableAcrossLoads, dialogs };
}

export function renderPageKnowledgeMarkdown(id: string, result: ReconResult): string {
  const lines: string[] = [];
  lines.push(`# ${id} (${result.url})`, '');
  lines.push(`_Auto-generated by \`npm run goal-evolution:new\` — observed facts only, ${new Date().toISOString().slice(0, 10)}._`, '');

  lines.push('## Interactive elements', '');
  lines.push('| Tag | id | role | Text |', '| --- | --- | --- | --- |');
  for (const el of result.elements) {
    lines.push(`| ${el.tag} | ${el.id ?? '_(none)_'} | ${el.role ?? '_(none)_'} | ${el.text || '_(empty)_'} |`);
  }
  lines.push('');

  if (result.idsUnstableAcrossLoads.length > 0) {
    lines.push('## IDs observed to change across page loads', '');
    lines.push('A locator on any of these ids will break on the next load — use role/text instead:', '');
    for (const id of result.idsUnstableAcrossLoads) lines.push(`- \`${id}\``);
    lines.push('');
  }

  if (result.dialogs.length > 0) {
    lines.push('## Native dialogs observed', '');
    for (const d of result.dialogs) {
      lines.push(`### \`#${d.elementId}\``, '');
      lines.push(`- Dialog type: \`${d.dialogType}\``);
      lines.push(`- Message: "${d.message}"`);
      if (d.afterAccept) {
        lines.push(
          d.afterAccept.text !== null
            ? `- Accepting sets \`#${d.afterAccept.elementId}\` to: "${d.afterAccept.text}"`
            : `- Accepting: \`#${d.afterAccept.elementId}\` was NOT found in the DOM afterward (element absent, not empty text)`,
        );
      }
      if (d.afterDismiss) {
        lines.push(
          d.afterDismiss.text !== null
            ? `- Dismissing sets \`#${d.afterDismiss.elementId}\` to: "${d.afterDismiss.text}"`
            : `- Dismissing: \`#${d.afterDismiss.elementId}\` was NOT found in the DOM afterward (element absent, not empty text)`,
        );
      }
      lines.push('');
    }
  }

  lines.push(
    '## Not covered by this recon',
    '',
    '- Timing/animation edge cases beyond a single fixed wait.',
    '- Any element requiring a prior action to become visible/enabled.',
    '- Multi-step flows (this recon only clicks one element per fresh page load).',
    '',
  );

  return lines.join('\n');
}
