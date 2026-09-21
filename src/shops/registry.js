import { ramcards } from './ramcards.js';
import { xszaislai } from './xszaislai.js';

// The shops to scan each run. Add another adapter here to track a new store — each must
// expose { id, name, stateFile, scan({ scannedAt, log }) -> productsMap }, where a product
// is { id, name, url, price, currency, status } and status is InStock | PreOrder | OutOfStock.
export const shops = [ramcards, xszaislai];
