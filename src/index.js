import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { STATE_PATH, MIN_COVERAGE_RATIO, COVERAGE_DROP_ALERT } from './config.js';
import { scan } from './scan.js';
import { diff, hasChanges, totalChanges } from './diff.js';
import { renderMarkdown, renderHtml, renderTelegram, renderTitle, renderSummary } from './report.js';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeFileEnsured(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

// Append a `key=value` (or multiline heredoc) to a GitHub Actions env file, if present.
async function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `__EOF_${key}__`;
  await appendFile(file, `${key}<<${delim}\n${value}\n${delim}\n`);
}

async function writeStepSummary(text) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, text + '\n');
}

// Have any product-level fields changed between two snapshots (ignoring the scan
// timestamp)? Used to decide whether to persist a new snapshot / commit. This is
// broader than the alert signals on purpose: transitions like "sold out" must be
// saved so a later restock is detected relative to the out-of-stock state.
function productsChanged(prev, curr) {
  const prevIds = Object.keys(prev);
  const currIds = Object.keys(curr);
  if (prevIds.length !== currIds.length) return true;
  const fields = ['name', 'url', 'sku', 'price', 'currency', 'status', 'image'];
  for (const id of currIds) {
    const before = prev[id];
    if (!before) return true;
    const after = curr[id];
    for (const f of fields) {
      if ((before[f] ?? null) !== (after[f] ?? null)) return true;
    }
  }
  return false;
}

// Write the report files + Actions outputs for a notification (changes and/or a notice).
async function emitNotification(changes, scannedAt, notice) {
  await writeFile('report.md', renderMarkdown(changes, scannedAt, notice));
  await writeFile('report.html', renderHtml(changes, scannedAt, notice));
  await writeFile('report.telegram.txt', renderTelegram(changes, notice));
  await writeFile('changes.json', JSON.stringify(changes, null, 2));
  const subject = renderTitle(changes, scannedAt, notice);
  await setOutput('subject', subject);
  await setOutput('has_changes', 'true');
  await writeStepSummary('\n' + renderMarkdown(changes, scannedAt, notice));
  console.log(`\n${subject}`);
}

async function main() {
  const scannedAt = new Date().toISOString();
  const previous = await readJson(STATE_PATH);
  const isFirstRun = !previous;

  const snapshot = await scan({ scannedAt });
  const currCount = Object.keys(snapshot.products).length;
  const prevCount = isFirstRun ? null : Object.keys(previous.products).length;
  const noChanges = { new: [], backInStock: [] };

  // Coverage anomaly guard: a run that finds far fewer products than last time is almost
  // certainly a scrape failure (store blocked us, layout/param changed), not a real catalog
  // change. Do NOT overwrite the good snapshot and do NOT emit new/restock alerts (they'd be
  // false — e.g. everything would look "removed", then flood as "new" when the site recovers).
  // Send a coverage-anomaly alert instead so the problem is visible.
  if (prevCount != null && currCount < Math.max(1, Math.floor(prevCount * MIN_COVERAGE_RATIO))) {
    const notice =
      `scan found only ${currCount} products vs ${prevCount} last run — treating this run as ` +
      `unreliable. The snapshot was NOT updated. The store may be blocking requests or have ` +
      `changed its page layout; check the scanner.`;
    console.warn(`\n⚠️ Coverage anomaly: ${notice}`);
    await emitNotification(noChanges, scannedAt, notice);
    return; // keep the previous snapshot as the baseline
  }

  const changes = diff(previous, snapshot);

  // Persist the snapshot only when product data actually changed (not just the timestamp).
  const shouldPersist = isFirstRun || productsChanged(previous.products, snapshot.products);
  if (shouldPersist) {
    await writeFileEnsured(STATE_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  }

  if (isFirstRun) {
    const msg = `Baseline established: ${currCount} products. No alert sent.`;
    console.log(`\n${msg}`);
    await writeStepSummary(`### 🎴 Ram-scanner\n${msg}`);
    await setOutput('has_changes', 'false');
    return;
  }

  // Smaller-but-notable drop: still a real run, but flag it as a heads-up.
  const drop = prevCount - currCount;
  const notice =
    drop >= COVERAGE_DROP_ALERT
      ? `tracked product count dropped from ${prevCount} to ${currCount} (−${drop}). ` +
        `Could be normal delistings, or a partial scan issue worth a glance.`
      : null;

  const changed = hasChanges(changes);
  const summary = renderSummary(changes);
  console.log(`\n${summary}${notice ? ' | ⚠️ coverage drop' : ''}`);

  if (changed || notice) {
    await emitNotification(changes, scannedAt, notice);
  } else {
    await setOutput('has_changes', 'false');
  }
  await writeStepSummary(
    `### 🎴 Ram-scanner\n${changed ? `**${totalChanges(changes)} change(s)** — ` : 'No changes — '}${summary}` +
      (notice ? `\n\n⚠️ ${notice}` : ''),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
