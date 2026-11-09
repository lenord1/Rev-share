// 哪些頁面不給搜尋引擎收錄（noindex）。頁面的 <meta robots> 與 sitemap 的排除清單共用這一份，避免兩邊不一致。
import { buildableIntents } from './intents.mjs';

/** 示範商品、價格尚未核對的商品不收錄。 */
export const noindexProduct = (p) => p.demo === true || p.priceUnverified === true;

/** 品類內全是示範商品時不收錄。 */
export function noindexCategory(products, slug) {
  const list = products.filter((p) => p.category === slug);
  return list.length === 0 || list.every((p) => p.demo === true);
}

/** 情境頁本身是示範，或頁面上（前 4 台）全是示範商品時不收錄。intent 需為 buildableIntents 的結果（含 products）。 */
export const noindexIntent = (intent) => intent.demo === true || intent.products.slice(0, 4).every((p) => p.demo === true);

/** 所有 noindex 頁的路徑（/a/b/ 格式），給 sitemap filter 用。 */
export function noindexPaths(products, intents, { minProducts = 2, categories = [] } = {}) {
  const out = new Set(['/404/']);
  for (const p of products) if (noindexProduct(p)) out.add(`/${p.category}/${p.slug}/`);
  for (const slug of new Set([...products.map((p) => p.category), ...categories.map((c) => c.slug)])) if (noindexCategory(products, slug)) out.add(`/${slug}/`);
  for (const n of buildableIntents(products, intents, { minProducts })) if (noindexIntent(n)) out.add(`/${n.category}/for/${n.slug}/`);
  return out;
}
