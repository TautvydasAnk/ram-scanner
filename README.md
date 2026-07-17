# 🎴 ram-scanner

Automated stock tracker for an online Pokémon TCG catalog. Every 30 minutes it scans the whole
catalog, compares against the previous scan, and —
**only when something changed** — emails you reporting:

- 🆕 **New products** — a listing that wasn't there before (incl. newly opened preorders)
- ✅ **Back in stock** — an item that went from out-of-stock / preorder → in stock

No servers, no cost. It runs entirely on GitHub Actions and emails you via Gmail.

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

1. `src/scan.js` fetches the category landing page and every type/set **sub-category** page.
2. `src/parse.js` reads each page's embedded **JSON-LD** (structured product data the site renders
   server-side) — name, stable `productID`, SKU, price, availability, URL.
3. Products are merged by `productID` using the **best availability seen** (see the gotcha below).
4. `src/diff.js` compares the new snapshot to `data/state.json` (the previous scan).
5. If there are changes, an HTML report is generated and the workflow emails it to you.
6. The new snapshot is committed back to `data/state.json`, so the next run has something to
   compare against. The git history of that file is a free audit log of every change over time.

### Why not Playwright / a headless browser?
The store renders all product data as JSON-LD in the initial HTML, so a plain HTTP request is enough
— faster and far more reliable in CI. A browser was tested and **did not** improve data quality.

### The stock-rendering gotcha (important)
Only the **first** 48-product listing view reports correct stock. Secondary paginated views
(`?p=2`, `?p=3`, and the `r1-5…r4-5` rating filters) are served with **everything marked
out-of-stock**. The bug only ever *under*-reports stock (never the reverse), so the scanner fetches
the base page **plus the small type/set sub-category pages** (which each render correctly) and takes
the **best status seen per product**. This provably recovers the true stock and covers all ~139
products. This is why we crawl sub-categories instead of paginating.

## Run it locally

```bash
npm run scan
```

- First run (no `data/state.json`): establishes a **baseline** and sends no alert.
- Later runs: print a summary and, if anything changed, write `report.md` + `changes.json`.

## Configuration

Everything tunable lives in [`src/config.js`](src/config.js):

- **`categories`** — a list, so you can track more sections or even other similar stores by adding
  another `{ name, baseUrl }` entry. No other code changes needed.
- **`REQUEST_DELAY_MS`** — politeness delay between page fetches (default 400 ms).
- **`SKIP_SLUG`** — sub-category slugs to ignore (the broken rating-filter duplicates).

### Schedule
Defined in [`.github/workflows/scan.yml`](.github/workflows/scan.yml) as `*/30 4-22 * * *`
(UTC). That covers ~**07:00–24:00 Lithuania time** across both summer (UTC+3) and winter (UTC+2).
Adjust the `cron` if you want a different window. You can also trigger a run any time from the
**Actions** tab → **Stock scan** → **Run workflow**.

> GitHub's scheduled runs are best-effort and can be delayed a few minutes under load. The periodic
> snapshot commits keep the repo active so the schedule isn't auto-disabled for inactivity.

## Project layout

```
src/config.js   what to scan + tuning knobs
src/fetch.js    HTTP fetch with browser UA, retry/backoff, timeout
src/parse.js    JSON-LD → products; sub-category discovery
src/scan.js     orchestrates fetching + best-status merge
src/diff.js     new / back-in-stock / price-change detection
src/report.js   Markdown + HTML email body, and the subject line
src/index.js    entry point: scan → diff → write state + report
data/state.json committed snapshot of the last scan
```
