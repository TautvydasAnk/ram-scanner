// Compare two snapshots and return the alertable changes.
//
// Signals (as requested): new products, back-in-stock, and price changes.
// A missing `prev` (first run) yields no changes — the caller seeds the baseline.

const UNAVAILABLE = new Set(['OutOfStock', 'PreOrder']);

export function diff(prev, curr) {
  const changes = { new: [], backInStock: [], priceChanged: [] };
  if (!prev || !prev.products) return changes; // first run: baseline only

  const prevProducts = prev.products;
  for (const [id, product] of Object.entries(curr.products)) {
    const before = prevProducts[id];

    if (!before) {
      changes.new.push(product);
      continue; // a brand-new product isn't also a "restock" or "price change"
    }

    // Back in stock: was unavailable, now purchasable.
    if (UNAVAILABLE.has(before.status) && product.status === 'InStock') {
      changes.backInStock.push({ ...product, previousStatus: before.status });
    }

    // Price change: both known and numerically different.
    if (
      before.price != null &&
      product.price != null &&
      Number(before.price) !== Number(product.price)
    ) {
      changes.priceChanged.push({
        ...product,
        previousPrice: Number(before.price),
        direction: Number(product.price) < Number(before.price) ? 'down' : 'up',
      });
    }
  }

  return changes;
}

export function hasChanges(changes) {
  return (
    changes.new.length > 0 ||
    changes.backInStock.length > 0 ||
    changes.priceChanged.length > 0
  );
}

export function totalChanges(changes) {
  return changes.new.length + changes.backInStock.length + changes.priceChanged.length;
}
