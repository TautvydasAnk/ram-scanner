import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MIN_COVERAGE_RATIO, COVERAGE_DROP_ALERT, ANOMALY_PERSIST_RUNS } from './config.js';
import { shops } from './shops/registry.js';
import { diff, hasChanges, totalChanges } from './diff.js';
import { renderReport } from './report.js';

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
// timestamp)? Decides whether to persist a new snapshot. Broader than the alert signals:
// transitions like "sold out" must be saved so a later restock is detected correctly.
function productsChanged(prev, curr) {
  const prevIds = Object.keys(prev);
  const currIds = Object.keys(curr);
  if (prevIds.length !== currIds.length) return true;
  const fields = ['name', 'url', 'price', 'currency', 'status'];
  for (const id of currIds) {
    const before = prev[id];
    if (!before) return true;
    const after = curr[id];
    for (const f of fields) if ((before[f] ?? null) !== (after[f] ?? null)) return true;
  }
  return false;
}

// Scan one shop and return { report?, summaryLine }. `report` (for notification) is set only
// when there's something to alert (changes or a coverage/scan problem).
async function processShop(shop, scannedAt) {
  const log = (m) => console.log(`[${shop.id}] ${m}`);
  const previous = await readJson(shop.stateFile);
  const isFirstRun = !previous;

  let products;
  try {
    products = await shop.scan({ scannedAt, log });
  } catch (err) {
    const notice = `scan failed: ${err.message}. Snapshot not updated — the site or its API may be down or changed.`;
    console.error(`[${shop.id}] ⚠️ ${notice}`);
    return {
      report: { name: shop.name, changes: { new: [], backInStock: [] }, notice },
      summaryLine: `- **${shop.name}**: ⚠️ scan FAILED`,
    };
  }

  const currCount = Object.keys(products).length;
  const prevCount = isFirstRun ? null : Object.keys(previous.products).length;
  const prevStreak = previous?.guard?.anomalyStreak ?? 0;
  const writeState = (prods, streak) =>
    writeFileEnsured(shop.stateFile, JSON.stringify({ scannedAt, products: prods, guard: { anomalyStreak: streak } }, null, 2) + '\n');

  // Coverage anomaly guard (with hysteresis). A run finding far fewer products than the
  // baseline is *usually* a broken scrape (block/layout/API glitch) — but it can also be a
  // genuine large catalog change. A glitch clears within a run or two; a real change persists.
  // So: while the drop is fresh, hold the baseline and don't emit (false) new/restock alerts.
  // Once it has persisted for ANOMALY_PERSIST_RUNS runs, accept it as the new normal.
  const isAnomaly = prevCount != null && currCount < Math.max(1, Math.floor(prevCount * MIN_COVERAGE_RATIO));
  if (isAnomaly && prevStreak + 1 < ANOMALY_PERSIST_RUNS) {
    const streak = prevStreak + 1;
    await writeState(previous.products, streak); // hold the baseline, remember the streak
    const notice =
      `scan found only ${currCount} products vs ${prevCount} last run — holding the baseline ` +
      `(run ${streak}/${ANOMALY_PERSIST_RUNS}) in case it's a temporary glitch. If it keeps up it'll ` +
      `be accepted as the new normal and alerts resume.`;
    console.warn(`[${shop.id}] ⚠️ coverage anomaly ${currCount} vs ${prevCount} (streak ${streak}/${ANOMALY_PERSIST_RUNS})`);
    return {
      // Warn only on the first detection, then stay quiet until it resolves or is accepted.
      report: streak === 1 ? { name: shop.name, changes: { new: [], backInStock: [] }, notice } : null,
      summaryLine: `- **${shop.name}**: ⚠️ coverage anomaly ${currCount} vs ${prevCount} (run ${streak}/${ANOMALY_PERSIST_RUNS}, baseline held)`,
    };
  }
  if (isAnomaly) {
    log(`coverage drop persisted ${prevStreak + 1} runs — accepting ${currCount} products as the new baseline`);
  }

  const snapshot = { scannedAt, products };
  const changes = diff(previous, snapshot);

  if (isFirstRun || prevStreak > 0 || productsChanged(previous.products, products)) {
    await writeState(products, 0); // reset the streak on any normal/accepted run
  }

  if (isFirstRun) {
    log(`baseline established: ${currCount} products. No alert sent.`);
    return { report: null, summaryLine: `- **${shop.name}**: baseline established (${currCount} products)` };
  }

  const drop = prevCount - currCount;
  const notice =
    drop >= COVERAGE_DROP_ALERT
      ? `tracked product count dropped from ${prevCount} to ${currCount} (−${drop}). ` +
        `Could be normal delistings, or a partial scan issue worth a glance.`
      : null;

  const changed = hasChanges(changes);
  const summaryLine =
    `- **${shop.name}**: ${changed ? `${totalChanges(changes)} change(s)` : 'no changes'} ` +
    `(New ${changes.new.length}, Back ${changes.backInStock.length}; ${currCount} products)` +
    (notice ? ' ⚠️ drop' : '');
  log(`New ${changes.new.length} | Back in stock ${changes.backInStock.length}${notice ? ' | ⚠️ coverage drop' : ''}`);

  return {
    report: changed || notice ? { name: shop.name, changes, notice } : null,
    summaryLine,
  };
}

async function main() {
  const scannedAt = new Date().toISOString();
  const reports = [];
  const summaryLines = [];

  for (const shop of shops) {
    console.log(`\n▶ ${shop.name}`);
    const { report, summaryLine } = await processShop(shop, scannedAt);
    if (report) reports.push(report);
    summaryLines.push(summaryLine);
  }

  if (reports.length > 0) {
    const { subject, markdown, html, telegram } = renderReport(reports, scannedAt);
    await writeFile('report.md', markdown);
    await writeFile('report.html', html);
    await writeFile('report.telegram.txt', telegram);
    await setOutput('subject', subject);
    await setOutput('has_changes', 'true');
    console.log(`\n${subject}`);
  } else {
    await setOutput('has_changes', 'false');
    console.log('\nNo notifications this run.');
  }

  await writeStepSummary(`### 🎴 Ram-scanner\n${summaryLines.join('\n')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
