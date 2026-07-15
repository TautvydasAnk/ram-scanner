import { totalChanges } from './diff.js';

function money(value, currency) {
  if (value == null) return 'n/a';
  return `${Number(value).toFixed(2)} ${currency || 'EUR'}`;
}

function link(p) {
  return p.url ? `[${p.name}](${p.url})` : p.name;
}

/** Short title for the GitHub Issue / email subject. */
export function renderTitle(changes, scannedAt) {
  const parts = [];
  if (changes.new.length) parts.push(`${changes.new.length} new`);
  if (changes.backInStock.length) parts.push(`${changes.backInStock.length} back in stock`);
  if (changes.priceChanged.length) parts.push(`${changes.priceChanged.length} price`);
  const when = scannedAt.slice(0, 16).replace('T', ' ');
  return `🎴 Ram-scanner: ${parts.join(', ')} — ${when} UTC`;
}

/** Full Markdown body for the Issue (renders nicely in the notification email too). */
export function renderMarkdown(changes, scannedAt) {
  const lines = [];
  lines.push(`**${totalChanges(changes)} change(s)** detected at ${scannedAt} UTC.`);
  lines.push('');

  if (changes.backInStock.length) {
    lines.push(`## ✅ Back in stock (${changes.backInStock.length})`);
    for (const p of changes.backInStock) {
      lines.push(`- **${link(p)}** — ${money(p.price, p.currency)} _(was ${p.previousStatus})_`);
    }
    lines.push('');
  }

  if (changes.new.length) {
    lines.push(`## 🆕 New products (${changes.new.length})`);
    for (const p of changes.new) {
      const status = p.status === 'InStock' ? 'in stock' : p.status === 'PreOrder' ? 'preorder' : 'out of stock';
      lines.push(`- **${link(p)}** — ${money(p.price, p.currency)} _(${status})_`);
    }
    lines.push('');
  }

  if (changes.priceChanged.length) {
    lines.push(`## 💶 Price changes (${changes.priceChanged.length})`);
    for (const p of changes.priceChanged) {
      const arrow = p.direction === 'down' ? '🔻' : '🔺';
      lines.push(
        `- ${arrow} **${link(p)}** — ${money(p.previousPrice, p.currency)} → ` +
          `**${money(p.price, p.currency)}**`,
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('_Automated by [ram-scanner](../../actions). Close this issue once handled._');
  return lines.join('\n');
}

/** Compact one-line-per-section summary for the Actions run log / step summary. */
export function renderSummary(changes) {
  return (
    `New: ${changes.new.length} | ` +
    `Back in stock: ${changes.backInStock.length} | ` +
    `Price changes: ${changes.priceChanged.length}`
  );
}
