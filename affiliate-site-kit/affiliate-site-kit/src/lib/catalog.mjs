// 建置期把 products.json 整理成頁面與 client 共用的精簡資料。到手價一律走 pricing.mjs。
import { priceBreakdown, priceStats, verdictLabel } from './pricing.mjs';

/** 商品短名：優先用 shortName，否則取 titleTemplate 在「評測」或冒號之前的部分。 */
export function productName(p) {
  if (p.shortName) return p.shortName;
  return p.titleTemplate.replace('{year}', '').split(/[：:]|\s*評測/)[0].trim();
}

export function primaryChannel(p) {
  return p.primaryChannel ?? Object.keys(p.affiliate ?? {})[0];
}

/** client 端（精靈、搜尋）需要的欄位；促銷是否有效在建置時就算好。 */
export function histSummary(history, p, now = Date.now()) {
  const ch = primaryChannel(p);
  const entries = (history?.[p.modelCode] ?? []).filter((e) => e.channel === ch);
  const s = priceStats(entries, { now });
  const demo = p.demo === true;
  return s.enough ? { enough: true, demo, count: s.count, min: s.min, max: s.max, verdict: s.verdict } : { enough: false, demo, count: s.count };
}

/** 圖卡上的價格紀錄一行字。資料不足只說「累積中」，不下划算或偏高的判斷。 */
export function histLine(h, money) {
  if (!h) return '';
  const text = h.enough
    ? `近 30 天標價 ${money(h.min)}–${money(h.max)}・${verdictLabel[h.verdict]}`
    : `價格紀錄累積中（${h.count} 筆）`;
  return h.demo ? `示範・${text}` : text;
}

export function slimProduct(p, now = Date.now(), history = {}) {
  const b = priceBreakdown(p, now);
  const hasPromo = b.active && (b.discount > 0 || b.taxRefund > 0);
  return {
    code: p.modelCode,
    category: p.category,
    slug: p.slug,
    name: productName(p),
    price: b.price,
    discount: b.discount,
    taxRefund: b.taxRefund,
    final: b.final,
    badge: hasPromo ? p.promoBadge ?? '' : '',
    tags: p.tags ?? [],
    finder: p.finder ?? {},
    officialStore: !!p.officialStore,
    priceUnverified: !!p.priceUnverified,
    flaw: p.flaw,
    strength: p.strength ?? '',
    hist: histSummary(history, p, now),
    channel: primaryChannel(p),
  };
}

/** 只留有商品的品類（沒有商品的品類不顯示，避免點了是空的）。 */
export function activeCategories(data) {
  return data.categories.filter((c) => data.products.some((p) => p.category === c.slug));
}

export function featuredProducts(products, limit = 9) {
  // 蝦皮商城／品牌官方賣場（officialStore: true）一律推薦，排在前面且不受 limit 限制；
  // 其餘 featured 商品補滿到 limit。
  const byOrder = (a, b) => (a.featuredOrder ?? 99) - (b.featuredOrder ?? 99);
  const official = products.filter((p) => p.officialStore).sort(byOrder);
  const rest = products.filter((p) => p.featured && !p.officialStore).sort(byOrder);
  return [...official, ...rest.slice(0, Math.max(0, limit - official.length))];
}

/** 放進 <script type="application/json"> 前，避免 </script> 或 HTML 註解提早結束。 */
export function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
