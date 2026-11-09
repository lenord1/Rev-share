#!/usr/bin/env node
// 商品匯入工具的離線測試（不連網、不碰真實資料：在暫存資料夾操作）。用法：node scripts/test-import.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const real = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-test-'));
fs.cpSync(path.join(real, 'src', 'data'), path.join(tmp, 'src', 'data'), { recursive: true });
fs.rmSync(path.join(tmp, 'src', 'data', 'drafts'), { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'src', 'assets', 'products'), { recursive: true });
process.env.SITE_ROOT = tmp; // 必須在載入 lib.mjs 之前

const { parseProductUrl, draftIdFor } = await import('./import/url.mjs');
const { extractProduct, parsePrice, decodeEntities } = await import('./import/html-meta.mjs');
const { parseRobots, robotsAllows } = await import('./import/robots.mjs');
const { isPrivateIp, createFetcher, ImportError } = await import('./import/net.mjs');
const { sniffImage } = await import('./import/images.mjs');
const { runImport } = await import('./import-product.mjs');
const { readDraft, writeDraft, validateDraft, promoteDraft, listDrafts, attachImageToDemo } = await import('./import/draft.mjs');
const { validateProducts } = await import('./validate-products.mjs');
const { processRequests } = await import('./run-import-requests.mjs');

let n = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);

// ── 網址解析 ──
t('蝦皮：三種網址格式都取得 shopId／itemId，並去掉追蹤參數', () => {
  for (const u of ['https://shopee.tw/Foo-Bar-i.123.456?sp_atk=x&xptdk=y', 'https://shopee.tw/product/123/456', 'https://shopee.tw/opaanlp/123/456?x=1', 'https://m.shopee.tw/universal-link/product/123/456']) {
    const r = parseProductUrl(u);
    assert.ok(r.ok, u);
    assert.deepEqual(r.ids, { shopId: '123', itemId: '456' });
    assert.equal(r.canonicalUrl, 'https://shopee.tw/product/123/456');
  }
  assert.equal(draftIdFor(parseProductUrl('https://shopee.tw/a-i.1.2')), 'shopee-1-2');
});
t('蝦皮短網址、其他地區、看不出編號：明確拒絕', () => {
  assert.equal(parseProductUrl('https://shp.ee/abc').code, 'short-link');
  assert.equal(parseProductUrl('https://s.shopee.tw/abc').code, 'short-link');
  assert.equal(parseProductUrl('https://shopee.sg/a-i.1.2').code, 'region');
  assert.equal(parseProductUrl('https://shopee.tw/search?keyword=x').code, 'unsupported-path');
});
t('酷澎：取 productId／itemId／vendorItemId；短網址拒絕', () => {
  const r = parseProductUrl('https://www.tw.coupang.com/vp/products/777?itemId=1&vendorItemId=2&src=x');
  assert.deepEqual(r.ids, { productId: '777', itemId: '1', vendorItemId: '2' });
  assert.equal(r.canonicalUrl, 'https://www.tw.coupang.com/vp/products/777?itemId=1&vendorItemId=2');
  assert.equal(parseProductUrl('https://coupa.ng/x').code, 'short-link');
  assert.equal(parseProductUrl('https://www.coupang.com/np/search?q=x').code, 'unsupported-path');
});
t('一般網站：去追蹤參數；IP、localhost、內網、非 http 一律拒絕', () => {
  assert.equal(parseProductUrl('https://example.com/p?id=3&utm_source=a&fbclid=b#x').canonicalUrl, 'https://example.com/p?id=3');
  for (const u of ['http://127.0.0.1/x', 'http://localhost/x', 'http://[::1]/x', 'http://192.168.1.1/', 'http://nas.local/x', 'ftp://example.com/x', 'file:///etc/passwd', 'http://2130706433/']) assert.equal(parseProductUrl(u).ok, false, u);
  assert.equal(draftIdFor(parseProductUrl('https://example.com/p')).startsWith('web-'), true);
});

// ── HTML metadata ──
const PAGE = `<!doctype html><html><head><title>備用標題</title>
<meta property="og:title" content="OG 標題 &amp; 測試"><meta property="og:image" content="/img/og.jpg">
<meta property="og:description" content="OG 描述">
<link rel="canonical" href="/p/abc">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"JSON-LD 商品名","description":"說明文字","brand":{"@type":"Brand","name":"品牌甲"},"sku":"SKU-1","image":["https://cdn.example.com/a.jpg",{"@type":"ImageObject","url":"/img/b.png"}],"offers":[{"@type":"Offer","price":"12,900","priceCurrency":"TWD"}]}]}</script>
</head><body></body></html>`;
t('JSON-LD 優先於 OpenGraph：名稱、品牌、價格、圖片（相對網址補全、去重）', () => {
  const x = extractProduct(PAGE, 'https://shop.example.com/p/abc?x=1');
  assert.equal(x.name, 'JSON-LD 商品名');
  assert.equal(x.brand, '品牌甲');
  assert.deepEqual(x.price, { amount: 12900, currency: 'TWD' });
  assert.deepEqual(x.imageUrls, ['https://cdn.example.com/a.jpg', 'https://shop.example.com/img/b.png', 'https://shop.example.com/img/og.jpg']);
  assert.equal(x.canonical, 'https://shop.example.com/p/abc');
  assert.ok(x.methods.includes('jsonld'));
});
t('只有 OpenGraph：用 og:title；解碼 HTML 實體；沒有價格就是 null', () => {
  const x = extractProduct('<meta property="og:title" content="A &amp; B &#x4E2D;"><meta property="og:image" content="https://x.com/i.png">', 'https://x.com/');
  assert.equal(x.name, 'A & B 中');
  assert.equal(x.price, null);
  assert.deepEqual(x.methods, ['opengraph']);
  assert.equal(decodeEntities('&lt;b&gt;'), '<b>');
});
t('product:price 與壞掉的 JSON-LD：壞的略過、價格格式解析', () => {
  const html = '<script type="application/ld+json">{壞掉</script><meta property="og:title" content="X"><meta property="product:price:amount" content="NT$ 1,299.00"><meta property="product:price:currency" content="twd">';
  assert.deepEqual(extractProduct(html, 'https://x.com/').price, { amount: 1299, currency: 'TWD' });
  assert.equal(parsePrice('12,900'), 12900);
  assert.equal(parsePrice('abc'), null);
  assert.equal(parsePrice('1,2,3'), null);
  assert.equal(parsePrice(0), null);
});
t('沒有任何商品資訊：name 為空字串', () => {
  assert.equal(extractProduct('<html><body>hi</body></html>', 'https://x.com/').name, '');
});

// ── robots ──
t('robots：最長路徑優先、萬用字元、$、Crawl-delay、指定 UA 優先於 *', () => {
  const txt = `User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\nCrawl-delay: 5\n\nUser-agent: affiliate-product-importer\nDisallow: /nope\n`;
  const star = parseRobots(txt, 'somebot/1.0');
  assert.equal(robotsAllows(star, '/private/x'), false);
  assert.equal(robotsAllows(star, '/private/ok/x'), true);
  assert.equal(robotsAllows(star, '/a/b.pdf'), false);
  assert.equal(robotsAllows(star, '/a/b.pdf?x'), true);
  assert.equal(star.delay, 5);
  const me = parseRobots(txt, 'affiliate-product-importer/1.0 (x)');
  assert.equal(robotsAllows(me, '/private/x'), true);
  assert.equal(robotsAllows(me, '/nope/1'), false);
  assert.equal(robotsAllows({ allowAll: true }, '/x'), true);
  assert.equal(robotsAllows({ denyAll: true }, '/x'), false);
});

// ── 安全抓取 ──
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const mkFetch = (routes) => async (url) => {
  const u = new URL(url);
  const r = routes[u.host + u.pathname] ?? routes[u.pathname];
  if (!r) return new Response('nf', { status: 404 });
  return typeof r === 'function' ? r() : r;
};
const mkFetcher = (routes, extra = {}) => createFetcher({ fetchImpl: mkFetch(routes), lookup: async (h) => (h === 'private.test' ? [{ address: '10.0.0.5', family: 4 }] : PUBLIC), sleep: async () => {}, delayMs: 0, ...extra });
t('私有 IP 判斷', () => {
  for (const ip of ['10.1.1.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});
t('抓取：robots 不允許就不抓；允許就抓到內容', async () => {
  const f1 = mkFetcher({ '/robots.txt': new Response('User-agent: *\nDisallow: /secret\n'), '/secret/a': new Response('x') });
  await assert.rejects(f1.get('https://a.example.com/secret/a'), (e) => e.code === 'robots');
  const f2 = mkFetcher({ '/robots.txt': new Response('User-agent: *\nDisallow: /secret\n'), '/ok': () => new Response('<html>hi</html>', { headers: { 'content-type': 'text/html' } }) });
  const r = await f2.get('https://a.example.com/ok');
  assert.equal(r.body.toString(), '<html>hi</html>');
});
t('抓取：robots.txt 讀不到（500／403）保守視為不允許；404 視為允許', async () => {
  await assert.rejects(mkFetcher({ '/robots.txt': new Response('', { status: 500 }), '/ok': new Response('x') }).get('https://a.example.com/ok'), (e) => e.code === 'robots');
  await assert.rejects(mkFetcher({ '/robots.txt': new Response('', { status: 403 }), '/ok': new Response('x') }).get('https://a.example.com/ok'), (e) => e.code === 'robots');
  const r = await mkFetcher({ '/ok': new Response('x') }).get('https://a.example.com/ok');
  assert.equal(r.status, 200);
});
t('抓取：轉址到蝦皮／酷澎或內網位址會被擋；直接給蝦皮網址也擋', async () => {
  const mk = (loc) => mkFetcher({ '/go': () => new Response(null, { status: 302, headers: { location: loc } }) });
  await assert.rejects(mk('https://shopee.tw/product/1/2').get('https://a.example.com/go'), (e) => e.code === 'marketplace');
  await assert.rejects(mk('https://www.coupang.com/vp/products/1').get('https://a.example.com/go'), (e) => e.code === 'marketplace');
  await assert.rejects(mk('https://private.test/x').get('https://a.example.com/go'), (e) => e.code === 'private-host');
  await assert.rejects(mkFetcher({}).get('https://shopee.tw/product/1/2'), (e) => e.code === 'marketplace');
  await assert.rejects(mkFetcher({}).get('http://169.254.169.254/latest'), (e) => e.code === 'host');
});
t('抓取：太大、HTTP 403／429、轉址過多都明確失敗（不重試）', async () => {
  await assert.rejects(mkFetcher({ '/big': new Response('x'.repeat(100)) }).get('https://a.example.com/big', { maxBytes: 10 }), (e) => e.code === 'too-large');
  await assert.rejects(mkFetcher({ '/b': new Response('no', { status: 403 }) }).get('https://a.example.com/b'), (e) => e.code === 'http-403');
  await assert.rejects(mkFetcher({ '/l': () => new Response(null, { status: 302, headers: { location: '/l' } }) }).get('https://a.example.com/l'), (e) => e.code === 'redirects');
});
t('抓取：同網域請求之間會等待（礼貌間隔）', async () => {
  let clock = 1000; const waits = [];
  const f = createFetcher({ fetchImpl: mkFetch({ '/a': new Response('a'), '/b': () => new Response('b') }), lookup: async () => PUBLIC, delayMs: 3000, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  await f.get('https://a.example.com/a');
  await f.get('https://a.example.com/b');
  assert.ok(waits.length >= 1 && waits.every((w) => w > 0 && w <= 3000), JSON.stringify(waits));
});

// ── 圖片 ──
const png = (w, h) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpeg = (w, h) => { const b = Buffer.alloc(64); Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0]).copy(b); Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08]).copy(b, 8); b.writeUInt16BE(h, 13); b.writeUInt16BE(w, 15); return b; };
t('圖片：以檔頭判斷格式與尺寸；GIF／SVG／純文字不收', () => {
  assert.deepEqual(sniffImage(png(800, 600)), { ext: 'png', mime: 'image/png', width: 800, height: 600 });
  assert.deepEqual(sniffImage(jpeg(1000, 700)), { ext: 'jpg', mime: 'image/jpeg', width: 1000, height: 700 });
  assert.equal(sniffImage(Buffer.from('GIF89a' + 'x'.repeat(30))), null);
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

// ── 端對端（暫存資料夾）──
const PAGE_URL = 'https://shop.example.com/p/abc';
const fakeFetcher = () => ({
  async get(url) {
    if (url === PAGE_URL) return { url, status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(PAGE) };
    if (url.endsWith('a.jpg')) return { url, status: 200, contentType: 'image/jpeg', body: jpeg(900, 900) };
    if (url.endsWith('b.png')) return { url, status: 200, contentType: 'image/png', body: png(100, 100) }; // 太小
    if (url.endsWith('og.jpg')) return { url, status: 200, contentType: 'image/jpeg', body: jpeg(900, 900) }; // 與 a.jpg 重複
    throw new ImportError('http-404', 'HTTP 404');
  },
});
// 正式資料已無示範商品；掛圖測試需要示範商品，在暫存副本上把指定型號標成 demo
const markDemo = (...codes) => {
  const file = path.join(tmp, 'src/data/products.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const p of j.products) if (codes.includes(p.modelCode)) p.demo = true;
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
};
const productsRaw = () => fs.readFileSync(path.join(tmp, 'src/data/products.json'), 'utf8');

t('匯入一般網站：建立草稿、下載圖片、登記來源，不動 products.json', async () => {
  const before = productsRaw();
  const r = await runImport({ _: [PAGE_URL + '?utm_source=zz'], category: 'dehumidifier' }, { fetcher: fakeFetcher(), log: () => {} });
  const d = readDraft(r.draft.draftId);
  assert.equal(d.status, 'draft');
  assert.equal(d.source.url, PAGE_URL);
  assert.equal(d.product.price, 12900);
  assert.equal(d.product.titleTemplate, 'JSON-LD 商品名 評測：{year} 值不值得買');
  assert.equal(d.images.length, 1);
  assert.equal(d.images[0].license, 'pending-review');
  assert.ok(d.images[0].fetchedAt && d.images[0].sourceUrl.endsWith('a.jpg') && d.images[0].sha256);
  assert.ok(fs.existsSync(path.join(tmp, 'src/assets/products', d.images[0].file)));
  assert.ok(d.notes.some((x) => x.includes('b.png') && x.includes('尺寸太小')));
  assert.ok(d.notes.some((x) => x.includes('重複')));
  const ledger = JSON.parse(fs.readFileSync(path.join(tmp, 'src/data/image-sources.json'), 'utf8'));
  assert.equal(ledger.images[d.images[0].file].license, 'pending-review');
  assert.equal(productsRaw(), before);
  await assert.rejects(runImport({ _: [PAGE_URL] }, { fetcher: fakeFetcher() }), (e) => e.code === 'exists');
});
t('草稿不會被網站讀到：src 與 gen-redirects 都不引用 drafts', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(real, 'src')).filter((f) => /\.(astro|mjs|js|ts)$/.test(f))) assert.ok(!/data\/drafts/.test(fs.readFileSync(f, 'utf8')), f);
  assert.ok(!/drafts/.test(fs.readFileSync(path.join(here, 'gen-redirects.mjs'), 'utf8')));
});
t('蝦皮連結：只記編號，產生骨架草稿，不連線', async () => {
  const noNet = { get() { throw new Error('不該連線'); } };
  const r = await runImport({ _: ['https://shopee.tw/Foo-i.9.8'] }, { fetcher: noNet });
  assert.equal(r.draft.draftId, 'shopee-9-8');
  assert.deepEqual(r.draft.source.ids, { shopId: '9', itemId: '8' });
  assert.equal(r.draft.source.method, 'manual');
  assert.ok(r.draft.notes.some((x) => x.includes('官方 API 尚未接上')));
  const c = await runImport({ _: ['https://www.coupang.com/vp/products/55'], name: '手動名稱', price: '5990' }, { fetcher: noNet });
  assert.equal(c.draft.product.price, 5990);
  assert.equal(c.draft.name, '手動名稱');
});
t('抓不到公開資料：結束碼 3 的錯誤，提示手動補', async () => {
  const f = { async get(url) { return { url, status: 200, contentType: 'text/html', body: Buffer.from('<html><body></body></html>') }; } };
  await assert.rejects(runImport({ _: ['https://bare.example.com/x'] }, { fetcher: f }), (e) => e.code === 'no-metadata' && e.exitCode === 3);
  const ok = await runImport({ _: ['https://bare.example.com/x'], name: '手動商品' }, { fetcher: f });
  assert.equal(ok.draft.name, '手動商品');
  assert.equal(ok.draft.product.titleTemplate, '手動商品 評測：{year} 值不值得買');
});
t('非 TWD 幣別不帶入價格', async () => {
  const html = '<meta property="og:title" content="外幣商品"><script type="application/ld+json">{"@type":"Product","name":"外幣商品","offers":{"price":"99.9","priceCurrency":"USD"}}</script>';
  const r = await runImport({ _: ['https://usd.example.com/p'] }, { fetcher: { async get(u) { return { url: u, status: 200, contentType: 'text/html', body: Buffer.from(html) }; } } });
  assert.equal(r.draft.product.price, null);
  assert.ok(r.draft.notes.some((x) => x.includes('USD')));
});

t('未補完的草稿：列出缺項，不能轉正式，products.json 不變', () => {
  const d = listDrafts().find((x) => x.source.url === PAGE_URL);
  const v = validateDraft(d);
  for (const k of ['缺點', '優點', '評論彙整', '圖片授權未確認', 'slug', 'modelCode', 'affiliate']) assert.ok(v.blockers.some((b) => b.includes(k)), k + '\n' + v.blockers.join('\n'));
  const before = productsRaw();
  const r = promoteDraft(d.draftId);
  assert.equal(r.ok, false);
  assert.equal(productsRaw(), before);
});
t('各項驗證規則：評論樣本數須等於來源合計、授權 rejected 不算、分潤網域須屬通路', () => {
  const base = JSON.parse(JSON.stringify(listDrafts().find((x) => x.source.url === PAGE_URL)));
  base.editorial.reviewSummary = { sources: [{ platform: '蝦皮', count: 5 }], sampleSize: 9, summarizedAt: '2026-11-08', summary: '這是一段超過二十個字的評論彙整摘要，用自己的話寫成。', pros: ['a'], cons: ['b'] };
  assert.ok(validateDraft(base).blockers.some((b) => b.includes('sampleSize')));
  base.editorial.reviewSummary.sampleSize = 5;
  const v = validateDraft(base);
  assert.ok(!v.blockers.some((b) => b.includes('sampleSize')));
  assert.ok(v.warnings.some((w) => w.includes('評論樣本不足')));
  base.images[0].license = 'rejected';
  assert.ok(validateDraft(base).blockers.some((b) => b.includes('圖片授權未確認')));
  base.product.affiliate = { shopee: 'https://evil.example.net/x' };
  assert.ok(validateDraft(base).blockers.some((b) => b.includes('affiliate.shopee')));
});
t('補齊後轉正式：通過 validate-products，圖片授權與評論彙整寫入商品，草稿標記 promoted', () => {
  const d = listDrafts().find((x) => x.source.url === PAGE_URL);
  const file = d.images[0].file;
  Object.assign(d.product, {
    category: 'dehumidifier', slug: 'import-test-a', modelCode: 'import-test-a',
    affiliate: { shopee: 'https://shopee.tw/import-test-a' }, tldr: '適合 10–15 坪的客廳，重視靜音的人。',
    specs: [{ key: '日除濕量', value: '20', unit: 'L/日' }, { key: '運轉噪音', value: '42', unit: 'dB' }, { key: '水箱容量', value: '4.5', unit: 'L' }],
  });
  d.editorial.flaw = '水箱取出時偏重且把手位置不順手';
  d.editorial.strength = '標示運轉噪音 42 dB，在同品類偏安靜';
  d.editorial.reviewSummary = { sources: [{ platform: '蝦皮', count: 30 }, { platform: '酷澎', count: 12 }], sampleSize: 42, summarizedAt: '2026-11-08', summary: '多數留言提到運轉聲音小、日常除濕夠用；少數提到水箱重。', pros: ['安靜'], cons: ['水箱重'] };
  d.images[0].license = 'official';
  writeDraft(d);
  const before = JSON.parse(productsRaw()).products.length;
  const dry = promoteDraft(d.draftId, { dryRun: true });
  assert.ok(dry.ok, JSON.stringify(dry));
  assert.equal(JSON.parse(productsRaw()).products.length, before);
  const r = promoteDraft(d.draftId);
  assert.ok(r.ok, JSON.stringify(r));
  const prods = JSON.parse(productsRaw()).products;
  assert.equal(prods.length, before + 1);
  const added = prods.at(-1);
  assert.equal(added.demo, undefined);
  assert.equal(added.image.file, file);
  assert.equal(added.image.license, 'official');
  assert.equal(added.reviewSummary.sampleSize, 42);
  assert.ok(!JSON.stringify(added).includes('shop.example.com'), '來源網址不可進商品資料');
  assert.equal(readDraft(d.draftId).status, 'promoted');
  assert.equal(promoteDraft(d.draftId).ok, false);
});

const OFF = 'https://brand.example.com/tw/md181qwe0';
const offFetcher = () => ({ async get(url) { return url === OFF ? { url, status: 200, contentType: 'text/html', body: Buffer.from(PAGE) } : fakeFetcher().get(url); } });
t('蝦皮連結＋官方頁：名稱與圖片取自官方頁、不取官網價格、圖片待確認授權、蝦皮編號保留', async () => {
  const r = await runImport({ _: ['https://shopee.tw/LG-i.55.66?sp_atk=x'], 'official-url': OFF, category: 'dehumidifier' }, { fetcher: offFetcher() });
  const d = readDraft('shopee-55-66');
  assert.equal(d.source.kind, 'shopee');
  assert.deepEqual(d.source.ids, { shopId: '55', itemId: '66' });
  assert.equal(d.name, 'JSON-LD 商品名');
  assert.equal(d.product.price, null, '官網價格不可當蝦皮價格');
  assert.equal(d.official.url, OFF);
  assert.equal(d.source.method, 'official-page');
  assert.equal(d.images.length, 1);
  assert.equal(d.images[0].license, 'pending-review');
  assert.equal(d.images[0].pageUrl, OFF);
  assert.ok(r.validation.blockers.some((b) => b.includes('product.price')));
  await assert.rejects(runImport({ _: ['https://shopee.tw/LG-i.55.67'], 'official-url': 'https://shopee.tw/product/1/2' }, { fetcher: offFetcher() }), (e) => e.code === 'args');
  await assert.rejects(runImport({ _: ['https://shopee.tw/LG-i.55.67'], 'official-url': 'http://127.0.0.1/x' }, { fetcher: offFetcher() }), (e) => e.code === 'args');
});
t('--force 重新匯入：保留已填的內容與已確認的圖片授權；已存在時沒有 --force 會拒絕', async () => {
  const d0 = readDraft('shopee-55-66');
  d0.editorial.flaw = '手填的具體缺點內容';
  d0.product.modelCode = 'keep-me';
  d0.images[0].license = 'official';
  writeDraft(d0);
  const args = { _: ['https://shopee.tw/LG-i.55.66'], 'official-url': OFF };
  await assert.rejects(runImport(args, { fetcher: offFetcher() }), (e) => e.code === 'exists');
  await runImport({ ...args, force: true }, { fetcher: offFetcher() });
  const d = readDraft('shopee-55-66');
  assert.equal(d.editorial.flaw, '手填的具體缺點內容');
  assert.equal(d.product.modelCode, 'keep-me');
  assert.equal(d.product.category, 'dehumidifier');
  assert.equal(d.images.length, 1);
  assert.equal(d.images[0].license, 'official');
});
t('attach-image：只能掛在示範商品；掛上後帶授權狀態並通過驗證；正式商品與不存在的草稿被拒絕', () => {
  markDemo('sampo-ad-s512t', 'panasonic-f-y22pn');
  const r = attachImageToDemo('shopee-55-66', 'sampo-ad-s512t');
  assert.ok(r.ok, JSON.stringify(r));
  const prod = JSON.parse(productsRaw()).products.find((x) => x.modelCode === 'sampo-ad-s512t');
  assert.equal(prod.image.file, readDraft('shopee-55-66').images[0].file);
  assert.equal(prod.image.license, 'official');
  assert.ok(prod.image.alt);
  assert.equal(validateProducts().errors, 0);
  const real = attachImageToDemo('shopee-55-66', 'import-test-a');
  assert.equal(real.ok, false);
  assert.ok(/示範商品/.test(real.message));
  assert.equal(attachImageToDemo('nope-1', 'sampo-ad-s512t').ok, false);
});

t('匯入請求檔：處理成功寫出結果並刪除請求；失敗只記錄原因，不影響其他請求', async () => {
  const dir = path.join(tmp, 'import-requests');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a-ok.json'), JSON.stringify({ url: 'https://shopee.tw/LG-i.77.88', officialUrl: OFF, category: 'dehumidifier', attachTo: 'panasonic-f-y22pn' }));
  fs.writeFileSync(path.join(dir, 'b-bad.json'), JSON.stringify({ url: 'https://shopee.tw/LG-i.77.89', officialUrl: 'https://shopee.tw/product/1/2' }));
  fs.writeFileSync(path.join(dir, 'c-broken.json'), '{壞掉');
  const out = await processRequests({ fetcher: offFetcher() });
  assert.deepEqual(out.map((r) => r.ok), [true, false, false]);
  assert.equal(out[0].draftId, 'shopee-77-88');
  assert.equal(out[0].images.length, 1);
  assert.equal(out[0].attach.ok, true);
  assert.equal(out[1].error.code, 'args');
  assert.equal(out[2].error.code, 'bad-json');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'results', 'a-ok.json'), 'utf8')).draftId, 'shopee-77-88');
});

for (const [name, fn] of queue) {
  try { await fn(); n++; console.log('✓', name); }
  catch (e) { console.error('✗', name, '\n  ', e?.stack ?? e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} 項測試全部通過`);
