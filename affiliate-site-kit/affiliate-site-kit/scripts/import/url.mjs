// 商品網址解析：只做字串解析，不連線。
// 蝦皮取 shopId／itemId、酷澎取 productId（itemId／vendorItemId），其他網站正規化後走公開 metadata。
import { createHash } from 'node:crypto';

const TRACKING = /^(utm_.+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|yclid|_ga|_gl)$/i;
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const ok = (v) => ({ ok: true, ...v });

/** 不該連線的主機：IP、localhost、內網網域、單一標籤。回傳原因字串或 null。 */
export function literalHostProblem(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h) return '沒有主機名稱';
  if (h.includes(':') || /^\d+(\.\d+){3}$/.test(h) || /^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return '不接受 IP 位址';
  if (h === 'localhost' || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(h)) return '不接受內部網域';
  if (!h.includes('.')) return '網域不完整';
  return null;
}

const isHostOrSub = (host, base) => host === base || host.endsWith('.' + base);
export const isShopeeHost = (host) => isHostOrSub(host, 'shopee.tw') || isHostOrSub(host, 'shp.ee');
export const isCoupangHost = (host) => isHostOrSub(host, 'coupang.com') || isHostOrSub(host, 'coupa.ng');

function parseShopee(u, host) {
  if (isHostOrSub(host, 'shp.ee') || host === 's.shopee.tw') {
    return fail('short-link', '蝦皮短網址要連到蝦皮才能展開，本工具不連蝦皮網頁。請貼完整商品頁網址（含 -i.店家編號.商品編號 或 /product/店家編號/商品編號）。', { kind: 'shopee' });
  }
  const path = u.pathname;
  const m =
    /^\/product\/(\d{1,20})\/(\d{1,20})\/?$/.exec(path) ||
    /^\/opaanlp\/(\d{1,20})\/(\d{1,20})\/?$/.exec(path) ||
    /^\/universal-link\/product\/(\d{1,20})\/(\d{1,20})\/?$/.exec(path) ||
    /-i\.(\d{1,20})\.(\d{1,20})\/?$/.exec(path);
  if (!m) return fail('unsupported-path', '看不出蝦皮的店家／商品編號。支援格式：/product/店家/商品、…-i.店家.商品。', { kind: 'shopee' });
  const [, shopId, itemId] = m;
  return ok({ kind: 'shopee', host: 'shopee.tw', ids: { shopId, itemId }, canonicalUrl: `https://shopee.tw/product/${shopId}/${itemId}` });
}

function parseCoupang(u, host) {
  if (isHostOrSub(host, 'coupa.ng')) {
    return fail('short-link', '酷澎短網址要連到酷澎才能展開，本工具不連酷澎網頁。請貼完整商品頁網址（/vp/products/商品編號）。', { kind: 'coupang' });
  }
  const m = /\/vp\/products\/(\d{1,20})/.exec(u.pathname);
  if (!m) return fail('unsupported-path', '酷澎網址需為商品頁（/vp/products/商品編號）。', { kind: 'coupang' });
  const ids = { productId: m[1] };
  const itemId = u.searchParams.get('itemId');
  const vendorItemId = u.searchParams.get('vendorItemId');
  if (/^\d{1,20}$/.test(itemId ?? '')) ids.itemId = itemId;
  if (/^\d{1,20}$/.test(vendorItemId ?? '')) ids.vendorItemId = vendorItemId;
  const qs = new URLSearchParams();
  if (ids.itemId) qs.set('itemId', ids.itemId);
  if (ids.vendorItemId) qs.set('vendorItemId', ids.vendorItemId);
  const q = qs.toString();
  return ok({ kind: 'coupang', host, ids, canonicalUrl: `https://${host}/vp/products/${ids.productId}${q ? '?' + q : ''}` });
}

export function parseProductUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return fail('empty', '沒有提供網址');
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw); }
  catch { return fail('invalid', '網址格式不正確'); }
  if (!['http:', 'https:'].includes(u.protocol)) return fail('protocol', '只接受 http／https 網址');
  u.username = ''; u.password = ''; u.hash = '';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const bad = literalHostProblem(host);
  if (bad) return fail('host', bad);

  if (isShopeeHost(host)) return parseShopee(u, host);
  if (/(^|\.)shopee\.[a-z.]+$/.test(host)) return fail('region', '目前只支援蝦皮台灣（shopee.tw）', { kind: 'shopee' });
  if (isCoupangHost(host)) return parseCoupang(u, host);

  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  return ok({ kind: 'generic', host, ids: {}, canonicalUrl: u.toString() });
}

/** 草稿代號：同一個商品永遠得到同一個代號，用來擋重複匯入。 */
export function draftIdFor(parsed) {
  if (parsed.kind === 'shopee') return `shopee-${parsed.ids.shopId}-${parsed.ids.itemId}`;
  if (parsed.kind === 'coupang') return `coupang-${parsed.ids.productId}` + (parsed.ids.itemId ? `-${parsed.ids.itemId}` : '');
  return 'web-' + createHash('sha256').update(parsed.canonicalUrl).digest('hex').slice(0, 8);
}
