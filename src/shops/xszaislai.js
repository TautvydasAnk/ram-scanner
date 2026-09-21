import { politePostJson } from '../fetch.js';

// xszaislai.lt runs Magento PWA — a JS storefront backed by a GraphQL API. Scraping the
// HTML shell yields nothing (products load client-side), so we query GraphQL directly:
// it's structured and authoritative (name, sku, stock_status, price, url). We track the
// "pokemon asmodee" search — the focused Pokémon TCG set (~123 items). Plain "pokemon"
// (~349) drags in plush/figures/toys the user doesn't care about. The search returns
// out-of-stock items too, so back-in-stock detection works.

const ENDPOINT = 'https://www.xszaislai.lt/graphql';
const STORE = 'lt_LT';
const SEARCH = 'pokemon asmodee';
const PAGE_SIZE = 100; // Magento caps page size at 100
const MAX_PAGES = 20; // safety cap (~2 pages needed today)
const SITE = 'https://www.xszaislai.lt';

const query = (page) => `{
  products(search: "${SEARCH}", pageSize: ${PAGE_SIZE}, currentPage: ${page}) {
    total_count
    page_info { total_pages }
    items {
      sku
      name
      stock_status
      url_rewrites { url }
      price_range { minimum_price { final_price { value currency } } }
    }
  }
}`;

async function scan({ log = console.log } = {}) {
  const products = {};
  let totalPages = 1;
  let totalCount = null;

  for (let page = 1; page <= MAX_PAGES && page <= totalPages; page++) {
    const res = await politePostJson(ENDPOINT, { query: query(page) }, { Store: STORE });
    if (res.errors) throw new Error(`GraphQL error: ${JSON.stringify(res.errors).slice(0, 300)}`);
    const data = res?.data?.products;
    if (!data) throw new Error('GraphQL: unexpected response shape');
    totalPages = data.page_info?.total_pages ?? 1;
    totalCount = data.total_count;

    for (const it of data.items ?? []) {
      if (!it?.sku) continue;
      const slug = it.url_rewrites?.[0]?.url;
      const fp = it.price_range?.minimum_price?.final_price;
      products[it.sku] = {
        id: it.sku,
        name: it.name?.trim() || '(unnamed)',
        url: slug ? `${SITE}/${slug}` : SITE,
        price: fp?.value ?? null,
        currency: fp?.currency || 'EUR',
        // Magento only reports IN_STOCK / OUT_OF_STOCK; no preorder concept here.
        status: it.stock_status === 'IN_STOCK' ? 'InStock' : 'OutOfStock',
      };
    }
  }

  const inStock = Object.values(products).filter((p) => p.status === 'InStock').length;
  log(`✔ ${Object.keys(products).length} products (of ${totalCount} reported) — InStock ${inStock}`);
  return products;
}

export const xszaislai = {
  id: 'xszaislai',
  name: 'Žaislų pasaulis (xszaislai.lt) — Pokémon',
  stateFile: 'data/state-xszaislai.json',
  scan,
};
