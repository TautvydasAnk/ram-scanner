# 🎴 ram-scanner

Automated stock tracker for online Pokémon TCG shops. On a schedule it scans each shop, compares
against the previous scan, and — **only when something changed** — notifies you (email + Telegram):

- 🆕 **New products** — a listing that wasn't there before (incl. newly opened preorders)
- ✅ **Back in stock** — an item that went from out-of-stock / preorder → in stock

### Tracked shops
| Shop | Source | Notes |
|------|--------|-------|
| **RamCards** (ramcards.ro) | HTML + JSON-LD (GoMag) | Full catalog via base + `?o=news` + `?p=1..N` + sub-categories, with detail-page stock verification |
| **Žaislų pasaulis** (xszaislai.lt) | GraphQL API (Magento PWA) | `pokemon asmodee` search (~123 items); structured stock/price direct from the API |

Each shop is a small **adapter** in `src/shops/` that returns a normalized product list; the diff,
reporting, notification and coverage-guard logic are shared. Adding another store = one new adapter
in `src/shops/` plus an entry in `src/shops/registry.js`. Each shop keeps its own snapshot file in
`data/`, and a run sends a **single combined notification** grouped by shop.

No servers, no cost. It runs entirely on GitHub Actions and notifies via Gmail + Telegram.

---

## How you get notified

When stock changes, the workflow sends you an **HTML email** over Gmail SMTP. Credentials live in
encrypted **repository secrets** — never in the code — so this is safe even in a public repo.

**One-time setup (add three repository secrets):**
1. Use a Gmail account (a spare/throwaway one is fine). Enable **2-Step Verification**, then create
   an **App Password**: Google Account → Security → 2-Step Verification → App passwords. Copy the
   16-character password.
2. In this repo: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `MAIL_USERNAME` — the Gmail address (e.g. `you@gmail.com`)
   - `MAIL_PASSWORD` — the 16-char App Password (no spaces)
   - `MAIL_TO` — where alerts should go (can be any inbox, including your main email)

A change is reported exactly once (on the run where it happens); you won't be re-pinged for the
same thing on later runs. No changes → no notification.

### Optional: Telegram push (free, instant phone notification)

Runs alongside the email (both fire on the same change; each is independent). Add two more secrets:
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the **bot token**.
2. Open your new bot and send it any message (so it can reply to you).
3. Get your **chat ID**: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy
   `result[].message.chat.id`.
4. Add repo secrets `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID`. If they're absent, the step is skipped.

## How it works

1. For each shop in `src/shops/registry.js`, `src/index.js` calls the shop's **adapter** to get a
   normalized product list (`{ id, name, url, price, currency, status }`, status ∈
   `InStock | PreOrder | OutOfStock`).
2. `src/diff.js` compares that list to the shop's previous snapshot (`data/state*.json`) and emits
   two signals: **new products** and **back-in-stock**.
3. If any shop has changes (or a coverage warning), `src/report.js` builds **one combined**
   HTML/Markdown/Telegram report grouped by shop, and the workflow sends it via email + Telegram.
4. Each changed snapshot is committed back to `data/`, so the next run has something to compare
   against. The git history of those files is a free audit log of every change over time.

### Shop adapters
- **RamCards** (`src/shops/ramcards.js` → `src/scan.js` + `src/parse.js`): the GoMag store renders
  server-side **JSON-LD**. No single listing view is complete, so it unions the base page, the
  newest-added view (`?o=news`), **every main-listing page** (`?p=1..N`), and every sub-category,
  merging by product ID with the **best availability seen**. Then a **verification pass** re-checks
  the newest `VERIFY_LIMIT` (default 50) out-of-stock items against their authoritative **detail
  page** — the listing bug can only *hide* stock, never invent it, so this catches buried restocks.
- **Žaislų pasaulis** (`src/shops/xszaislai.js`): Magento PWA — the HTML is a JS shell, so we query
  the **GraphQL API** directly (`pokemon asmodee` search). Stock/price come structured from the API;
  no scraping or verification pass needed.

### Coverage safeguards
Because no single view on this store is complete, a future site change could silently hide products
again. Two guards in `src/index.js` catch that:
- **Anomaly guard** — if a run finds fewer than `MIN_COVERAGE_RATIO` (default 50%) of the previous
  product count, the run is treated as an unreliable scrape: the snapshot is **not** overwritten and
  no new/restock alerts are sent (they'd be false); instead a **coverage-anomaly alert** is emailed/
  pinged. This prevents a block or layout change from corrupting the baseline and flooding you later.
- **Coverage-drop notice** — a smaller drop (≥ `COVERAGE_DROP_ALERT`, default 5) still processes
  normally but adds a heads-up line to the notification. Both thresholds live in `config.js`.

### RamCards: why not Playwright / a headless browser?
RamCards renders all product data as JSON-LD in the initial HTML, so a plain HTTP request is enough
— faster and far more reliable in CI. A browser was tested and **did not** improve data quality.
(xszaislai.lt is the opposite — a JS shell — but its GraphQL API sidesteps the need for a browser too.)

### RamCards: the stock-rendering gotcha (important)
Only the **first** 48-product view of any RamCards listing reports correct stock. Secondary
paginated views (`?p=2`, `?p=3`, the `r1-5…r4-5` rating filters) are served with **everything marked
out-of-stock**. The bug only ever *under*-reports stock (never the reverse), so the scanner unions
several correctly-rendered views (base, `?o=news`, the paginated main listing, and small
sub-category pages), takes the **best status seen per product**, and then verifies any remaining
out-of-stock items against their detail page. Paginated pages are still fetched for *discovery*
(product IDs are correct there even when stock isn't).

## Run it locally

```bash
npm run scan
```

- First run for a shop (no `data/state*.json`): establishes a **baseline** and sends no alert.
- Later runs: print a per-shop summary and, if anything changed, write `report.md` / `report.html` /
  `report.telegram.txt`.

## Configuration

- **Add a shop:** create an adapter in [`src/shops/`](src/shops/) exposing
  `{ id, name, stateFile, scan({ scannedAt, log }) }` (returns a product map) and register it in
  [`src/shops/registry.js`](src/shops/registry.js).
- **RamCards tuning** lives in [`src/config.js`](src/config.js): `categories`, `VERIFY_LIMIT`,
  `MAX_LISTING_PAGES`, `REQUEST_DELAY_MS`, `SKIP_SLUG`.
- **Coverage guards** (all shops): `MIN_COVERAGE_RATIO`, `COVERAGE_DROP_ALERT` in `config.js`.

### Reliable scheduling (external cron → GitHub)

GitHub's built-in `schedule:` cron is best-effort — it runs late and drops ticks under load — so
timing is driven by an **external scheduler** ([cron-job.org](https://cron-job.org), free) that calls
the GitHub API to dispatch the workflow on an exact, timezone-aware schedule. The workflow keeps only
the `workflow_dispatch` trigger (also the manual **Actions → Stock scan → Run workflow** button).

**Setup:**
1. Create a **fine-grained Personal Access Token**: GitHub → Settings → Developer settings →
   Fine-grained tokens → *Generate new token*. Repository access: **only `ram-scanner`**.
   Permissions: **Actions → Read and write**. Copy the token.
2. On [cron-job.org](https://cron-job.org), create a job:
   - **URL:** `https://api.github.com/repos/TautvydasAnk/ram-scanner/actions/workflows/scan.yml/dispatches`
   - **Method:** `POST`
   - **Request body:** `{"ref":"main"}`
   - **Headers:**
     - `Authorization: Bearer <YOUR_TOKEN>`
     - `Accept: application/vnd.github+json`
     - `X-GitHub-Api-Version: 2022-11-28`
   - **Schedule:** every 30 min, hours **07–23**, timezone **Europe/Vilnius** (DST-correct year-round).
3. Save. A successful trigger returns HTTP **204** and a run appears in the Actions tab
   (event = `workflow_dispatch`).

## Project layout

```
src/index.js            orchestrator: for each shop → scan → diff → coverage guard → combined report
src/shops/registry.js   the list of shops to scan
src/shops/ramcards.js   RamCards adapter (wraps scan.js/parse.js)
src/shops/xszaislai.js  Žaislų pasaulis adapter (Magento GraphQL)
src/scan.js             RamCards scan engine (multi-view union + verification pass)
src/parse.js            JSON-LD → products; sub-category discovery (RamCards)
src/fetch.js            HTTP GET (HTML) + POST (GraphQL) with browser UA, retry/backoff, timeout
src/diff.js             new-product / back-in-stock detection (shared)
src/report.js           combined email/Telegram report + subject (shared)
src/config.js           RamCards tuning + shared coverage-guard knobs
data/state.json             RamCards snapshot          (committed)
data/state-xszaislai.json   Žaislų pasaulis snapshot   (committed)
```
