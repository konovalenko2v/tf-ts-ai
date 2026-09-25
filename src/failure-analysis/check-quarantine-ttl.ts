// CI gate step: fail loudly if any quarantine.json entry has passed its TTL. An expired entry is
// a decision someone must make (renew with a new expiresAt, or remove the test from quarantine so
// its failures block the gate again) — silence here is exactly how a quarantine list turns into a
// permanent graveyard of ignored flaky tests. TTL itself is per-entry (expiresAt in
// quarantine.json, set by hand when the entry is added) — there is no repo-wide default.
import { readQuarantineList, expiredEntries, QUARANTINE_FILE } from './quarantine';

function main(): void {
  const entries = readQuarantineList(QUARANTINE_FILE);
  const expired = expiredEntries(entries);

  if (expired.length === 0) {
    process.stdout.write(`[quarantine] ${entries.length} active entrie(s) in ${QUARANTINE_FILE}, none expired\n`);
    return;
  }

  process.stderr.write(`[quarantine] ${expired.length} entrie(s) in ${QUARANTINE_FILE} past their TTL — needs a human decision:\n`);
  for (const e of expired) {
    process.stderr.write(`  - ${e.signature} (expired ${e.expiresAt}) — tests: ${e.testTitlePaths.join(', ')}\n`);
  }
  process.exitCode = 1;
}

main();
