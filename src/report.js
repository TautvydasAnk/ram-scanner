import { totalChanges } from './diff.js';

// A "report" is one shop's result: { name, changes, notice }. renderReport() combines
// several into a single email / Telegram message and subject, grouped by shop.

function money(value, currency) {
  if (value == null) return 'n/a';
  return `${Number(value).toFixed(2)} ${currency || 'EUR'}`;
}

const statusWord = (s) => (s === 'InStock' ? 'in stock' : s === 'PreOrder' ? 'preorder' : 'out of stock');

// ---- aggregate helpers -------------------------------------------------------
function totals(reports) {
  let neu = 0;
  let back = 0;
  let notices = 0;
  for (const r of reports) {
    neu += r.changes?.new.length ?? 0;
    back += r.changes?.backInStock.length ?? 0;
    if (r.notice) notices++;
  }
  return { neu, back, notices };
}

/** Email / message subject summarising all shops. */
export function renderSubject(reports, scannedAt) {
  const when = scannedAt.slice(0, 16).replace('T', ' ');
  const { neu, back, notices } = totals(reports);
  const parts = [];
  if (neu) parts.push(`${neu} new`);
  if (back) parts.push(`${back} back in stock`);
  if (parts.length === 0 && notices) return `⚠️ Ram-scanner: coverage warning — ${when} UTC`;
  const prefix = notices ? '⚠️ ' : '🎴 ';
  return `${prefix}Ram-scanner: ${parts.join(', ')} — ${when} UTC`;
}

// ---- Markdown (plain-text email fallback + Actions step summary) --------------
function mdLink(p) {
  return p.url ? `[${p.name}](${p.url})` : p.name;
}

function shopMarkdown(r) {
  const lines = [`## ${r.name}`];
  if (r.notice) lines.push(`> ⚠️ **Coverage warning:** ${r.notice}`, '');
  const c = r.changes;
  if (c?.backInStock.length) {
    lines.push(`### ✅ Back in stock (${c.backInStock.length})`);
    for (const p of c.backInStock)
      lines.push(`- **${mdLink(p)}** — ${money(p.price, p.currency)} _(was ${p.previousStatus})_`);
    lines.push('');
  }
  if (c?.new.length) {
    lines.push(`### 🆕 New products (${c.new.length})`);
    for (const p of c.new)
      lines.push(`- **${mdLink(p)}** — ${money(p.price, p.currency)} _(${statusWord(p.status)})_`);
    lines.push('');
  }
  return lines;
}

export function renderMarkdown(reports, scannedAt) {
  const lines = [`Ram-scanner update — ${scannedAt} UTC`, ''];
  for (const r of reports) lines.push(...shopMarkdown(r));
  lines.push('---', '_Automated by ram-scanner._');
  return lines.join('\n');
}

// ---- HTML email --------------------------------------------------------------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function htmlName(p) {
  const n = esc(p.name);
  return p.url ? `<a href="${esc(p.url)}" style="color:#0969da;text-decoration:none;">${n}</a>` : n;
}
function shopHtml(r) {
  const c = r.changes;
  const section = (title, items) => `
    <h3 style="font-size:15px;margin:16px 0 6px;color:#111;">${title}</h3>
    <ul style="margin:0;padding-left:20px;line-height:1.6;">${items.join('')}</ul>`;
  const parts = [`<h2 style="font-size:18px;margin:22px 0 6px;color:#111;border-bottom:1px solid #d0d7de;padding-bottom:4px;">${esc(r.name)}</h2>`];
  if (r.notice) {
    parts.push(`<div style="background:#fff8c5;border:1px solid #d4a72c;border-radius:6px;
      padding:10px 12px;margin:0 0 12px;color:#7a5c00;font-size:14px;">
      ⚠️ <strong>Coverage warning:</strong> ${esc(r.notice)}</div>`);
  }
  if (c?.backInStock.length) {
    parts.push(section(`✅ Back in stock (${c.backInStock.length})`, c.backInStock.map(
      (p) => `<li>${htmlName(p)} — <strong>${esc(money(p.price, p.currency))}</strong>
        <span style="color:#57606a;">(was ${esc(p.previousStatus)})</span></li>`)));
  }
  if (c?.new.length) {
    parts.push(section(`🆕 New products (${c.new.length})`, c.new.map(
      (p) => `<li>${htmlName(p)} — ${esc(money(p.price, p.currency))}
        <span style="color:#57606a;">(${statusWord(p.status)})</span></li>`)));
  }
  return parts.join('');
}

export function renderHtml(reports, scannedAt) {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;max-width:680px;margin:0 auto;padding:8px 4px;">
    ${reports.map(shopHtml).join('')}
    <hr style="border:none;border-top:1px solid #d0d7de;margin:24px 0 8px;">
    <p style="font-size:12px;color:#8c959f;">Automated by ram-scanner · ${esc(scannedAt)} UTC</p>
  </body></html>`;
}

// ---- Telegram (HTML parse mode, small tag subset) ----------------------------
function tgEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function tgName(p) {
  const n = tgEsc(p.name);
  return p.url ? `<a href="${tgEsc(p.url)}">${n}</a>` : n;
}
function shopTelegram(r) {
  const lines = [`🏬 <b>${tgEsc(r.name)}</b>`];
  if (r.notice) lines.push(`⚠️ <b>Coverage warning:</b> ${tgEsc(r.notice)}`);
  const c = r.changes;
  if (c?.backInStock.length) {
    lines.push(`✅ <b>Back in stock (${c.backInStock.length})</b>`);
    for (const p of c.backInStock) lines.push(`• ${tgName(p)} — <b>${tgEsc(money(p.price, p.currency))}</b>`);
  }
  if (c?.new.length) {
    lines.push(`🆕 <b>New products (${c.new.length})</b>`);
    for (const p of c.new) lines.push(`• ${tgName(p)} — ${tgEsc(money(p.price, p.currency))} (${statusWord(p.status)})`);
  }
  return lines;
}

export function renderTelegram(reports) {
  const lines = ['🎴 <b>Ram-scanner</b>'];
  for (const r of reports) {
    lines.push('');
    lines.push(...shopTelegram(r));
  }
  let msg = lines.join('\n');
  if (msg.length > 3900) msg = msg.slice(0, 3900) + '\n…';
  return msg;
}

/** Everything the workflow needs for one combined notification. */
export function renderReport(reports, scannedAt) {
  return {
    subject: renderSubject(reports, scannedAt),
    markdown: renderMarkdown(reports, scannedAt),
    html: renderHtml(reports, scannedAt),
    telegram: renderTelegram(reports),
  };
}
