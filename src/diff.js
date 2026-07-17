// Compare two snapshots and return the alertable changes.
//
// Signals (as requested): new products and back-in-stock only. Price changes are
// intentionally NOT alerted — they churn too often and create noise. (The current
// price is still stored in the snapshot; it just never triggers a notification.)
// A missing `prev` (first run) yields no changes — the caller seeds the baseline.

const UNAVAILABLE = new Set(['OutOfStock', 'PreOrder']);

export function diff(prev, curr) {
  const changes = { new: [], backInStock: [] };
  if (!prev || !prev.products) return changes; // first run: baseline only

  const prevProducts = prev.products;
  for (const [id, product] of Object.entries(curr.products)) {
    const before = prevProducts[id];

    if (!before) {
      changes.new.push(product);
      continue; // a brand-new product isn't also a "restock"
    }

    // Back in stock: was unavailable, now purchasable.
    if (UNAVAILABLE.has(before.status) && product.status === 'InStock') {
      changes.backInStock.push({ ...product, previousStatus: before.status });
    }
  }

  return changes;
}

export function hasChanges(changes) {
  return changes.new.length > 0 || changes.backInStock.length > 0;
}

export function totalChanges(changes) {
  return changes.new.length + changes.backInStock.length;
}
