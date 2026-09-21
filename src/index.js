import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MIN_COVERAGE_RATIO, COVERAGE_DROP_ALERT } from './config.js';
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

  const snapshot = { scannedAt, products };
  const currCount = Object.keys(products).length;
  const prevCount = isFirstRun ? null : Object.keys(previous.products).length;

  // Coverage anomaly guard: a run finding far fewer products than last time is almost
  // certainly a broken scrape — don't overwrite the baseline, don't emit (false) alerts.
  if (prevCount != null && currCount < Math.max(1, Math.floor(prevCount * MIN_COVERAGE_RATIO))) {
    const notice =
      `scan found only ${currCount} products vs ${prevCount} last run — treating this run as ` +
      `unreliable. The snapshot was NOT updated. The site may be blocking requests or have changed.`;
    console.warn(`[${shop.id}] ⚠️ coverage anomaly: ${notice}`);
    return {
      report: { name: shop.name, changes: { new: [], backInStock: [] }, notice },
      summaryLine: `- **${shop.name}**: ⚠️ coverage anomaly (${currCount} vs ${prevCount})`,
    };
  }

  const changes = diff(previous, snapshot);

  if (isFirstRun || productsChanged(previous.products, products)) {
    await writeFileEnsured(shop.stateFile, JSON.stringify(snapshot, null, 2) + '\n');
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
