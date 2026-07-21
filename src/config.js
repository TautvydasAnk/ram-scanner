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

// Sub-category slugs to skip. The `rN-5` rating filters are duplicate views of the
// full catalog; the ones past the first are served in a broken "all out of stock"
// state, so we skip them entirely (type + set sub-categories already cover everything).
export const SKIP_SLUG = /^r\d-5$/;

// Politeness / robustness knobs.
export const REQUEST_DELAY_MS = 400; // pause between page fetches
export const MAX_RETRIES = 3; // per request, on network / 5xx / 429
export const REQUEST_TIMEOUT_MS = 30_000;

// Detail-page verification pass: after the listing scan, re-check out-of-stock items
// against their authoritative detail page (the listing bug can only hide stock, never
// invent it). Verifying ALL out-of-stock items is ~120 extra fetches/run; to keep the
// store footprint reasonable at higher scan frequencies (e.g. every 15 min), only the
// N most recently-added out-of-stock items (highest product IDs) are verified — that's
// where new arrivals and their restocks concentrate. Set to 0 to disable, Infinity for all.
export const VERIFY_LIMIT = 30;

// A real browser User-Agent — the store serves the SSR JSON-LD to browsers.
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Where the committed snapshot lives (relative to repo root).
export const STATE_PATH = 'data/state.json';
