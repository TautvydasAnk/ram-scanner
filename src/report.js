import { totalChanges } from './diff.js';

function money(value, currency) {
  if (value == null) return 'n/a';
  return `${Number(value).toFixed(2)} ${currency || 'EUR'}`;
}

function link(p) {
  return p.url ? `[${p.name}](${p.url})` : p.name;
}

/** Email subject line. */
export function renderTitle(changes, scannedAt) {
  const parts = [];
  if (changes.new.length) parts.push(`${changes.new.length} new`);
  if (changes.backInStock.length) parts.push(`${changes.backInStock.length} back in stock`);
  if (changes.priceChanged.length) parts.push(`${changes.priceChanged.length} price`);
  const when = scannedAt.slice(0, 16).replace('T', ' ');
  return `🎴 Ram-scanner: ${parts.join(', ')} — ${when} UTC`;
}

/** Markdown body — used as the plain-text email fallback and the Actions step summary. */
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
  lines.push('_Automated by ram-scanner._');
  return lines.join('\n');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlName(p) {
  const name = esc(p.name);
  return p.url ? `<a href="${esc(p.url)}" style="color:#0969da;text-decoration:none;">${name}</a>` : name;
}

/** HTML email body — a clean, self-contained (inline-styled) message. */
export function renderHtml(changes, scannedAt) {
  const section = (title, items) => `
    <h2 style="font-size:16px;margin:20px 0 8px;color:#111;">${title}</h2>
    <ul style="margin:0;padding-left:20px;line-height:1.6;">${items.join('')}</ul>`;

  const parts = [];

  if (changes.backInStock.length) {
    const items = changes.backInStock.map(
      (p) => `<li>${htmlName(p)} — <strong>${esc(money(p.price, p.currency))}</strong>
        <span style="color:#57606a;">(was ${esc(p.previousStatus)})</span></li>`,
    );
    parts.push(section(`✅ Back in stock (${changes.backInStock.length})`, items));
  }

  if (changes.new.length) {
    const items = changes.new.map((p) => {
      const status = p.status === 'InStock' ? 'in stock' : p.status === 'PreOrder' ? 'preorder' : 'out of stock';
      return `<li>${htmlName(p)} — ${esc(money(p.price, p.currency))}
        <span style="color:#57606a;">(${status})</span></li>`;
    });
    parts.push(section(`🆕 New products (${changes.new.length})`, items));
  }

  if (changes.priceChanged.length) {
    const items = changes.priceChanged.map((p) => {
      const down = p.direction === 'down';
      const arrow = down ? '🔻' : '🔺';
      const color = down ? '#1a7f37' : '#cf222e';
      return `<li>${arrow} ${htmlName(p)} —
        <span style="color:#57606a;text-decoration:line-through;">${esc(money(p.previousPrice, p.currency))}</span>
        → <strong style="color:${color};">${esc(money(p.price, p.currency))}</strong></li>`;
    });
    parts.push(section(`💶 Price changes (${changes.priceChanged.length})`, items));
  }

  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;max-width:680px;margin:0 auto;padding:8px 4px;">
    <p style="font-size:14px;color:#57606a;margin:0 0 4px;">
      <strong>${totalChanges(changes)} change(s)</strong> detected at ${esc(scannedAt)} UTC.</p>
    ${parts.join('')}
    <hr style="border:none;border-top:1px solid #d0d7de;margin:24px 0 8px;">
    <p style="font-size:12px;color:#8c959f;">Automated by ram-scanner.</p>
  </body></html>`;
}

/** Compact one-line-per-section summary for the Actions run log / step summary. */
export function renderSummary(changes) {
  return (
    `New: ${changes.new.length} | ` +
    `Back in stock: ${changes.backInStock.length} | ` +
    `Price changes: ${changes.priceChanged.length}`
  );
}
