// Runs after `allure generate` — the report's uid tree only exists in its output
// (allure-report/data/suites.json), so this cannot merge into run.ts (which runs before
// generate and only has the raw observability/heal-events data). Building #suites/<uid>/<uid>/
// by hashing titles ourselves was tried and abandoned: Allure2's suiteUid/testUid come from its
// own internal hashing, which doesn't match a plain md5 of the title path — the only reliable
// source is the generator's own output.
//
// Caveat worth knowing: testUid is assigned per generate, not derived stably from the test name
// (confirmed by diffing two allure-report/data/suites.json outputs for the identical test across
// two runs — same suiteUid, different testUid). So a link posted to one run's step summary points
// at *that* deployment; once a later run overwrites GitHub Pages, the uid in an old summary may
// no longer resolve to the same test. That's an acceptable tradeoff for a same-run "jump to this
// result" link, not for a permanent bookmark.

import * as fs from 'fs';
import * as path from 'path';

const SUITES_JSON = path.join('allure-report', 'data', 'suites.json');

interface SuiteNode {
  name: string;
  uid?: string;
  parentUid?: string;
  children?: SuiteNode[];
  tags?: string[];
}

// suites.json nodes only carry their own uid, not their parent's — parentUid is stamped only on
// leaf (test) nodes. Walk with the enclosing suite uid threaded down so each leaf can pair its
// own uid with the uid of the suite one level up (the pair the #suites/<suiteUid>/<testUid>/
// route expects), and collect every self-healed leaf found along the way.
function collectSelfHealedTests(node: SuiteNode, parentSuiteUid: string | undefined, out: { name: string; suiteUid: string; testUid: string }[]): void {
  const isLeaf = !node.children || node.children.length === 0;
  if (isLeaf && node.uid && parentSuiteUid && node.tags?.includes('self-healed')) {
    out.push({ name: node.name, suiteUid: parentSuiteUid, testUid: node.uid });
    return;
  }
  for (const child of node.children ?? []) {
    collectSelfHealedTests(child, node.uid ?? parentSuiteUid, out);
  }
}

function main(): void {
  if (!fs.existsSync(SUITES_JSON)) return;

  const baseUrl = process.env.ALLURE_REPORT_URL;
  if (!baseUrl) return;

  const root: SuiteNode = JSON.parse(fs.readFileSync(SUITES_JSON, 'utf-8'));
  const found: { name: string; suiteUid: string; testUid: string }[] = [];
  collectSelfHealedTests(root, undefined, found);
  if (found.length === 0) return;

  const lines = ['', '## Self-healed test reports', ''];
  for (const t of found) {
    const url = `${baseUrl.replace(/\/$/, '')}/#suites/${t.suiteUid}/${t.testUid}/`;
    lines.push(`- [${t.name}](${url})`);
  }
  lines.push('', '_Link points at this deployment; a later run overwriting GitHub Pages may change the uid._');

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}

main();
