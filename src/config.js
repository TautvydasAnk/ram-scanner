// Configuration for the stock scanner.
//
// `categories` is a list so you can track more sections (or other GoMag stores)
// later without touching any other code — just add another entry.

export const categories = [
  {
    // Human-readable label used in logs and the alert title.
    name: 'Pokémon TCG',
    // The category landing page. Its stock is rendered correctly, and it also
    // links to every type/set sub-category we crawl for full coverage.
    baseUrl: 'https://www.ramcards.ro/en/pokemon-tcg',
    // Extra listing views to also scan (merged by product ID). `?o=news` sorts by
    // newest-added, so brand-new listings appear at the top there — often days before
    // they climb the default "Most purchased" sort, and while still out of stock. This
    // is our earliest signal for a freshly added product. It renders correct stock too.
    extraUrls: ['https://www.ramcards.ro/en/pokemon-tcg?o=news'],
  },
];

// Origin used to resolve/keep only on-site links when discovering sub-categories.
export const SITE_ORIGIN = 'https://www.ramcards.ro';

// DNS fallbacks: hostname -> the name it CNAMEs to. If a host's own DNS fails (e.g. its
// nameservers go unreachable — ramcards.ro did this in Oct 2026, SERVFAIL on Google/Cloudflare
// and GitHub runners), we resolve the CNAME target instead and connect to that IP while still
// sending the original hostname (TLS/SNI and Host header unchanged, so the cert stays valid).
// Normal DNS is always tried first, so this is a no-op once the shop's DNS is healthy.
export const DNS_FALLBACKS = {
  'www.ramcards.ro': 'ramcards.gomag.ro',
};

// Sub-category slugs to skip. The `rN-5` rating filters are duplicate views of the
// full catalog; the ones past the first are served in a broken "all out of stock"
// state, so we skip them entirely (type + set sub-categories already cover everything).
export const SKIP_SLUG = /^r\d-5$/;

// Safety cap on how many main-listing pages (?p=1..N) to walk. The catalog is ~3 pages;
// this just prevents an unbounded loop if pagination ever misbehaves.
export const MAX_LISTING_PAGES = 30;

// Coverage safeguards (guard against silent scan regressions / the store blocking us).
// - A run that finds fewer than MIN_COVERAGE_RATIO of the previous product count is treated
//   as an unreliable scrape: it does NOT overwrite the saved snapshot and does NOT emit
//   new/restock alerts (which would be false) — instead it sends a coverage-anomaly alert.
// - A smaller drop of at least COVERAGE_DROP_ALERT products still updates normally but adds
//   a heads-up line to the notification.
export const MIN_COVERAGE_RATIO = 0.5;
export const COVERAGE_DROP_ALERT = 5;

// Hysteresis for the anomaly guard: a broken scrape recovers within a run or two, but a
// genuine large catalog change persists. If the low count sticks for this many consecutive
// runs, accept it as the new normal (re-baseline + resume alerts) instead of warning forever.
// The guard warns once when the drop first appears, then stays quiet until it resolves or is
// accepted — so a real change never leaves the tracker stuck.
export const ANOMALY_PERSIST_RUNS = 3;

// Politeness / robustness knobs.
// ramcards.ro (GoMag) rate-limits with HTTP 429; a full scan is ~120 requests, so at 400ms
// spacing it tripped the limit on most runs (Nov 2026). 1s spacing keeps a run at ~2-3 min.
export const REQUEST_DELAY_MS = 1000; // pause between page fetches
export const MAX_RETRIES = 4; // per request, on network / 5xx / 429
export const REQUEST_TIMEOUT_MS = 30_000;
// On 429: wait for the server's Retry-After if given, else these per-attempt waits. A
// sub-second retry just hits the same limit window again. Any wait is capped at the max.
export const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 45_000];
export const RATE_LIMIT_MAX_WAIT_MS = 90_000;

// Scan-failure alerting. A single failed run (e.g. a transient 429 or network blip) is not
// actionable and recovers on its own, so only alert once a shop has failed this many runs in a
// row. The alert is sent ONCE per outage, plus a single "recovered" note when it works again.
export const SCAN_FAIL_ALERT_RUNS = 3;

// Detail-page verification pass: after the listing scan, re-check out-of-stock items
// against their authoritative detail page (the listing bug can only hide stock, never
// invent it). Verifying ALL out-of-stock items is ~120 extra fetches/run; to keep the
// store footprint reasonable at higher scan frequencies (e.g. every 15 min), only the
// N most recently-added out-of-stock items (highest product IDs) are verified — that's
// where new arrivals and their restocks concentrate. Set to 0 to disable, Infinity for all.
export const VERIFY_LIMIT = 50;

// A real browser User-Agent — the store serves the SSR JSON-LD to browsers.
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Where the committed snapshot lives (relative to repo root).
export const STATE_PATH = 'data/state.json';
