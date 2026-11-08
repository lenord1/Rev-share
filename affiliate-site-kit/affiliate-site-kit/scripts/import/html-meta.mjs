// 從 HTML 字串讀「公開」的商品資料：JSON-LD（Product）> OpenGraph > <title>。零相依、只用正規表示式。
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const clean = (s, max = 500) => (typeof s === 'string' ? decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, max) : '');

function tagAttrs(tag) {
  const out = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const inner = tag.replace(/^<\s*[a-z0-9]+/i, '');
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

export function collectMeta(html) {
  const map = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = tagAttrs(tag);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (!key || a.content == null) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a.content);
  }
  return map;
}

export function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const typeOf = (n) => [].concat(n?.['@type'] ?? []).map(String);
const isProductNode = (n) => typeOf(n).some((t) => t === 'Product' || t === 'ProductGroup');

function* walk(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) { for (const x of node) yield* walk(x, depth + 1); return; }
  yield node;
  for (const k of ['@graph', 'mainEntity', 'itemListElement', 'item']) if (node[k]) yield* walk(node[k], depth + 1);
}

export function jsonLdNodes(html) {
  const nodes = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
    try { nodes.push(...walk(JSON.parse(text))); } catch { /* 格式壞掉的 JSON-LD 略過 */ }
  }
  return nodes;
}

function offerOf(node) {
  const cands = [].concat(node.offers ?? []);
  if (!cands.length && Array.isArray(node.hasVariant)) for (const v of node.hasVariant) cands.push(...[].concat(v?.offers ?? []));
  for (const o of cands) {
    if (!o || typeof o !== 'object') continue;
    const spec = [].concat(o.priceSpecification ?? [])[0] ?? {};
    const amount = parsePrice(o.price ?? o.lowPrice ?? spec.price);
    if (amount != null) return { amount, currency: String(o.priceCurrency ?? spec.priceCurrency ?? '').toUpperCase() || null };
  }
  return null;
}

function imagesOf(v) {
  const out = [];
  for (const x of [].concat(v ?? [])) {
    if (typeof x === 'string') out.push(x);
    else if (x && typeof x === 'object') out.push(x.url ?? x.contentUrl);
  }
  return out.filter((s) => typeof s === 'string' && s.trim());
}

const absUrl = (v, base) => {
  try { const u = new URL(decodeEntities(v).trim(), base); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
};

/** 回傳 { name, description, brand, sku, price:{amount,currency}|null, imageUrls, canonical, methods } */
export function extractProduct(html, baseUrl) {
  html = String(html).slice(0, 1_500_000);
  const meta = collectMeta(html);
  const first = (k) => meta.get(k)?.[0];
  const ld = jsonLdNodes(html).find(isProductNode);
  const methods = [];
  if (ld) methods.push('jsonld');

  const titleTag = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '', 200);
  const ogName = clean(first('og:title') ?? first('twitter:title'), 200);
  const name = clean(ld?.name, 200) || ogName || titleTag;
  if (!clean(ld?.name, 200) && ogName) methods.push('opengraph');
  else if (!clean(ld?.name, 200) && titleTag) methods.push('title');

  const description = clean(ld?.description) || clean(first('og:description') ?? first('description') ?? first('twitter:description'));
  const brandRaw = typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name;
  const brand = clean(brandRaw ?? first('product:brand') ?? first('og:brand'), 100) || null;
  const sku = clean(ld?.sku ?? ld?.mpn, 100) || null;

  let price = ld ? offerOf(ld) : null;
  if (!price) {
    const amount = parsePrice(first('product:price:amount') ?? first('og:price:amount'));
    if (amount != null) {
      price = { amount, currency: String(first('product:price:currency') ?? first('og:price:currency') ?? '').toUpperCase() || null };
      if (!methods.includes('opengraph')) methods.push('opengraph');
    }
  }

  const rawImgs = [...imagesOf(ld?.image), ...(meta.get('og:image') ?? []), ...(meta.get('og:image:secure_url') ?? []), ...(meta.get('twitter:image') ?? [])];
  const imageUrls = [...new Set(rawImgs.map((u) => absUrl(u, baseUrl)).filter(Boolean))];
  if (imageUrls.length && !ld?.image && !methods.includes('opengraph')) methods.push('opengraph');

  const canon = /<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html);
  const canonical = (canon && absUrl(tagAttrs(canon[0]).href ?? '', baseUrl)) || (first('og:url') && absUrl(first('og:url'), baseUrl)) || null;

  return { name, description, brand, sku, price, imageUrls, canonical, methods };
}
