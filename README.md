# 🎴 ram-scanner

Automated stock tracker for an online Pokémon TCG catalog. Every 30 minutes it scans the whole
catalog, compares against the previous scan, and —
**only when something changed** — opens a GitHub Issue (which emails you) reporting:

- 🆕 **New products** — a listing that wasn't there before (incl. newly opened preorders)
- ✅ **Back in stock** — an item that went from out-of-stock / preorder → in stock
- 💶 **Price changes** — up or down, with old → new price

No servers, no credentials, no cost. It runs entirely on GitHub Actions.

---

## How you get notified

When stock changes, the scheduled workflow opens an **Issue** in this repo, assigns it to you and
@mentions you. GitHub then sends you an **email** through your normal notification settings — so
there are no passwords or API keys stored anywhere.

**One-time setup to make sure emails arrive:**
1. On GitHub → your **Settings → Notifications**, ensure "Email" is enabled for
   Participating/@mentions (this is the default).
2. Optionally **Watch** this repo (top-right **Watch → All Activity**) to be emailed for every new
   issue as well.

Each change event creates one fresh issue = one email. Close the issue once you've handled it.
A change is reported exactly once (on the run where it happens); you won't be re-pinged for the
same thing on later runs.

## How it works

1. `src/scan.js` fetches the category landing page and every type/set **sub-category** page.
2. `src/parse.js` reads each page's embedded **JSON-LD** (structured product data the site renders
   server-side) — name, stable `productID`, SKU, price, availability, URL.
3. Products are merged by `productID` using the **best availability seen** (see the gotcha below).
4. `src/diff.js` compares the new snapshot to `data/state.json` (the previous scan).
5. If there are changes, `report.md` is generated and the workflow opens the alert issue.
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

## Optional: real HTML email instead of issues

If the issue-emails feel clunky, you can switch to proper email without exposing anything publicly —
GitHub **Actions Secrets** are encrypted and never visible in a public repo's code or logs. Add a
free [Resend](https://resend.com) API key (or a Gmail App Password) as a repository secret and swap
the "Open issue" workflow step for a send-email step. Ask and this can be wired up.

## Project layout

```
src/config.js   what to scan + tuning knobs
src/fetch.js    HTTP fetch with browser UA, retry/backoff, timeout
src/parse.js    JSON-LD → products; sub-category discovery
src/scan.js     orchestrates fetching + best-status merge
src/diff.js     new / back-in-stock / price-change detection
src/report.js   Markdown for the issue/email
src/index.js    entry point: scan → diff → write state + report
data/state.json committed snapshot of the last scan
```
