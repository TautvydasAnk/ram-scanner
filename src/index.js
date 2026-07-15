import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { STATE_PATH } from './config.js';
import { scan } from './scan.js';
import { diff, hasChanges, totalChanges } from './diff.js';
import { renderMarkdown, renderTitle, renderSummary } from './report.js';

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

async function main() {
  const scannedAt = new Date().toISOString();
  const previous = await readJson(STATE_PATH);
  const isFirstRun = !previous;

  const snapshot = await scan({ scannedAt });
  const changes = diff(previous, snapshot);

  // Persist the snapshot only when product data actually changed (not just the
  // timestamp) — this avoids a no-op commit every run while still saving every real
  // transition for the next comparison.
  const shouldPersist = isFirstRun || productsChanged(previous.products, snapshot.products);
  if (shouldPersist) {
    await writeFileEnsured(STATE_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  }

  if (isFirstRun) {
    const msg = `Baseline established: ${Object.keys(snapshot.products).length} products. No alert sent.`;
    console.log(`\n${msg}`);
    await writeStepSummary(`### 🎴 Ram-scanner\n${msg}`);
    await setOutput('has_changes', 'false');
    return;
  }

  const changed = hasChanges(changes);
  const summary = renderSummary(changes);
  console.log(`\n${summary}`);

  await setOutput('has_changes', changed ? 'true' : 'false');
  await writeStepSummary(`### 🎴 Ram-scanner\n${changed ? `**${totalChanges(changes)} change(s)** — ${summary}` : `No changes — ${summary}`}`);

  if (changed) {
    const body = renderMarkdown(changes, scannedAt);
    const title = renderTitle(changes, scannedAt);
    await writeFile('report.md', body);
    await writeFile('changes.json', JSON.stringify(changes, null, 2));
    await setOutput('issue_title', title);
    await writeStepSummary('\n' + body);
    console.log(`\n${title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
