import * as fs from 'fs';
import * as path from 'path';

// allure-playwright only ever appends result files — it never clears allure-results/ between
// separate `playwright test` invocations. Left alone, every local run's *-result.json files pile
// up forever: a stale entry becomes a fake "retry" of a since-deleted or renamed test in Allure's
// Retries/History tabs, and the Overview's total test count silently grows past the actual suite
// size (confirmed live: 9961 files, 332 vs the real 305). npm run allure:generate's own
// history/*.json copy (package.json) must survive this — it's what carries Trend/History across
// runs — so this clears every entry in allure-results/ except that one subdirectory.
const ALLURE_RESULTS_DIR = 'allure-results';

export default async function cleanAllureResults(): Promise<void> {
  if (!fs.existsSync(ALLURE_RESULTS_DIR)) return;
  for (const entry of fs.readdirSync(ALLURE_RESULTS_DIR)) {
    if (entry === 'history') continue;
    fs.rmSync(path.join(ALLURE_RESULTS_DIR, entry), { recursive: true, force: true });
  }
}
