#!/usr/bin/env node
// 驗證 channels.json / products.json / travel.json / price-history.json。
// 用法：node scripts/validate-products.mjs [--strict]
// --strict（Step 10 上線前）：示範資料、佔位網址、未確認通路、價格過期一律視為錯誤。
import { pathToFileURL } from 'node:url';
import { matchIntentProducts } from '../src/lib/intents.mjs';
import { readJson, loadConfig, hostAllowed, createReport, isIsoDate, exists, loadChannels } from './lib.mjs';

const KINDS = ['hotel', 'tour', 'ticket', 'sim', 'insurance', 'transport', 'other'];
const SELLERS = ['official', 'mall', 'third-party'];

export function validateProducts({ strict = false } = {}) {
  const r = createReport(strict ? '資料驗證（strict）' : '資料驗證');
  const cfg = loadConfig();
  const soft = strict ? r.error : r.warn;

  // ── 通路 ──
  const channels = loadChannels();
  if (!channels.length) r.error('找不到 src/data/channels.json 或內容為空');
  const chById = new Map(channels.map((c) => [c.id, c]));
  for (const c of channels) {
    if (!/^[a-z0-9]+$/.test(c.id)) r.error(`通路 id「${c.id}」只能用小寫英數（不可含連字號，會用在 /go/ 路徑）`);
    if (!c.hosts?.length) r.error(`通路 ${c.id} 沒有 hosts`);
    if (c.enabled && !c.confirmed) soft(`通路 ${c.id} 已啟用但尚未 confirmed（請對照聯盟後台實際連結確認 hosts 與參數）`);
    if (c.enabled && !c.requiredParams?.length) r.warn(`通路 ${c.id} 未設定 requiredParams，連結健康檢查無法驗證聯盟參數是否還在`);
  }
  const enabled = new Set(channels.filter((c) => c.enabled).map((c) => c.id));
  const allowed = channels.filter((c) => c.enabled).flatMap((c) => c.hosts);

  const checkAff = (label, ch, url, vertical, err) => {
    const c = chById.get(ch);
    if (!c) return err(`${label}: 未知通路「${ch}」`);
    if (!enabled.has(ch)) return err(`${label}: 通路 ${ch} 尚未啟用（channels.json 設 enabled: true）`);
    if (!c.verticals.includes(vertical)) return err(`${label}: 通路 ${ch} 不支援 ${vertical}`);
    let u;
    try { u = new URL(url); } catch { return err(`${label}: ${ch} 網址無效`); }
    if (u.protocol !== 'https:') err(`${label}: ${ch} 必須是 https`);
    if (cfg.placeholderHosts.includes(u.hostname)) soft(`${label}: ${ch} 還是佔位網址（${u.hostname}）`);
    else if (!hostAllowed(u.hostname, c.hosts)) err(`${label}: ${ch} 網域 ${u.hostname} 不在該通路 hosts 內`);
  };

  const codes = new Map(); // 全站 /go/ 代碼唯一
  const claimCode = (code, where, err) => {
    if (!/^[a-z0-9-]+$/.test(code ?? '')) return err('代碼只能用小寫英數與連字號（會用在 /go/ 路徑）');
    if (codes.has(code)) err(`代碼「${code}」與 ${codes.get(code)} 重複`);
    codes.set(code, where);
  };

  // ── 商品 ──
  if (!exists('src', 'data', 'products.json')) { r.error('找不到 src/data/products.json'); return r; }
  let data;
  try { data = readJson('src', 'data', 'products.json'); }
  catch (e) { r.error('products.json 不是合法 JSON：' + e.message); return r; }
  const cats = new Set((data.categories ?? []).map((c) => c.slug));
  if (!cats.size) r.error('categories 為空');
  const products = data.products ?? [];
  if (!products.length) r.error('products 為空');
  const byCode = new Map(products.map((x) => [x.modelCode, x]));
  const seenSlug = new Set();
  const now = Date.now();
  let featured = 0;

  for (const [i, x] of products.entries()) {
    const id = x.modelCode ?? x.slug ?? `#${i}`;
    const err = (m) => r.error(`[${id}] ${m}`);
    const warn = (m) => r.warn(`[${id}] ${m}`);
    const sf = (m) => soft(`[${id}] ${m}`);

    for (const k of ['category', 'slug', 'modelCode', 'titleTemplate', 'tldr', 'flaw']) {
      if (typeof x[k] !== 'string' || !x[k].trim()) err(`缺少必填欄位 ${k}`);
    }
    if (x.category && !cats.has(x.category)) err(`category「${x.category}」不在 categories 內`);
    if (x.slug && !/^[a-z0-9-]+$/.test(x.slug)) err('slug 只能用小寫英數與連字號');
    if (x.slug === 'for') err('slug 不可為 for（保留給情境頁 /{品類}/for/{情境}）');
    if (seenSlug.has(`${x.category}/${x.slug}`)) err('slug 重複');
    seenSlug.add(`${x.category}/${x.slug}`);
    claimCode(x.modelCode, `商品 ${id}`, err);

    if (x.titleTemplate && /20\d\d/.test(x.titleTemplate)) err('titleTemplate 不可寫死年份，請用 {year}');
    else if (x.titleTemplate && !x.titleTemplate.includes('{year}')) warn('titleTemplate 沒有 {year}');
    if (typeof x.flaw === 'string' && x.flaw.trim().length < cfg.minFlawLength) err(`flaw 太短或太空泛（至少 ${cfg.minFlawLength} 字，需為具體缺點）`);

    if (x.strength != null && (typeof x.strength !== 'string' || !x.strength.trim())) err('strength（優點）若有填必須是非空字串，且要有規格或官方說明作依據');
    if (x.article != null) {
      const a = x.article;
      if (typeof a.lead !== 'string' || a.lead.trim().length < 40) err('article.lead 至少 40 字，要從讀者的痛點寫起');
      if (!Array.isArray(a.sections) || a.sections.length < 2 || a.sections.some((s) => !s || typeof s.h !== 'string' || !s.h.trim() || typeof s.body !== 'string' || s.body.trim().length < 12)) err('article.sections 至少 2 段，每段要有 h（小標）與 body（至少 12 字）');
    }
    if (!Number.isInteger(x.price) || x.price <= 0) err('price 必須是正整數（TWD）');
    if (!isIsoDate(x.priceUpdatedAt)) err('priceUpdatedAt 必須是有效日期');
    else if ((now - Date.parse(x.priceUpdatedAt)) / 864e5 > cfg.priceStaleDays) sf(`價格已超過 ${cfg.priceStaleDays} 天未更新（${x.priceUpdatedAt}）`);
    for (const k of ['discount', 'taxRefund']) if (x[k] !== undefined && (!Number.isInteger(x[k]) || x[k] < 0)) err(`${k} 必須是 0 或正整數`);
    if ((x.discount ?? 0) + (x.taxRefund ?? 0) >= x.price) err('折扣加退稅不可大於等於售價');
    if ((x.discount ?? 0) + (x.taxRefund ?? 0) > 0) {
      if (!x.promoValidUntil) warn('有折扣/退稅但缺 promoValidUntil（促銷到期日，過期自動不計入）');
      if ((x.taxRefund ?? 0) > 0 && !x.subsidyNote) warn('有 taxRefund 但缺 subsidyNote（資格說明）');
    }
    if (x.promoValidUntil) {
      if (!isIsoDate(x.promoValidUntil)) err('promoValidUntil 不是有效日期');
      else if (Date.parse(x.promoValidUntil) + 864e5 < now) warn('promoValidUntil 已過期（前端會自動不計入）');
    }

    if (x.tags !== undefined) {
      if (!Array.isArray(x.tags) || x.tags.some((t) => typeof t !== 'string')) err('tags 必須是字串陣列');
      else for (const t of x.tags) if (cfg.tagVocabulary && !cfg.tagVocabulary.includes(t)) err(`tags 含詞庫外的標籤「${t}」（允許：${cfg.tagVocabulary.join('、')}；要新增請改 scripts/config.json 的 tagVocabulary）`);
    }
    if (!Array.isArray(x.specs) || x.specs.length < cfg.minSpecs) err(`specs 至少需要 ${cfg.minSpecs} 項`);
    else for (const s of x.specs) {
      if (!s.key || s.value === undefined) err('specs 每項需有 key 與 value');
      if (s.score !== undefined && typeof s.score !== 'number') err(`specs「${s.key}」的 score 必須是數字`);
    }
    if (!Array.isArray(x.faq) || !x.faq.length) warn('沒有 faq（FAQPage 結構化資料將不輸出）');
    else for (const f of x.faq) if (!f.q || !f.a) err('faq 每項需有 q 與 a');

    // 通路與連結
    const aff = x.affiliate ?? {};
    const chs = Object.keys(aff).filter((c) => aff[c]);
    if (!chs.length) err('affiliate 至少要有一個通路網址');
    for (const c of chs) checkAff(`[${id}] affiliate`, c, aff[c], 'appliance', r.error);
    if (x.primaryChannel && !chs.includes(x.primaryChannel)) err('primaryChannel 必須是已填 affiliate 的通路');
    if (x.prices) for (const [c, v] of Object.entries(x.prices)) {
      if (!Number.isInteger(v) || v <= 0) err(`prices.${c} 必須是正整數`);
      if (!chs.includes(c)) err(`prices.${c} 沒有對應的 affiliate 連結`);
    }

    if (x.pricesUpdatedAt) for (const [c, d] of Object.entries(x.pricesUpdatedAt)) {
      if (!isIsoDate(d)) err(`pricesUpdatedAt.${c} 需為 YYYY-MM-DD`);
      if (!chs.includes(c)) err(`pricesUpdatedAt.${c} 沒有對應的 affiliate 連結`);
    }
    if (x.channelIds) for (const [c, v] of Object.entries(x.channelIds)) {
      if (typeof v !== 'string' || !v.trim()) err(`channelIds.${c} 必須是非空字串（該通路官方 API 的商品 ID）`);
      if (!chs.includes(c)) err(`channelIds.${c} 沒有對應的 affiliate 連結`);
    }
    // delivery：只有附來源與日期的到貨資訊才能支持抽屜的「較快到貨」標籤
    if (x.delivery) for (const [c, d] of Object.entries(x.delivery)) {
      if (!chs.includes(c)) err(`delivery.${c} 沒有對應的 affiliate 連結`);
      if (!d || typeof d.note !== 'string' || !d.note.trim() || typeof d.source !== 'string' || !d.source.trim() || !isIsoDate(d.checkedAt))
        err(`delivery.${c} 需有 note、source（資訊來源）與 checkedAt（YYYY-MM-DD）`);
      else if (d.fast === true && (Date.now() - Date.parse(d.checkedAt)) / 864e5 > cfg.priceStaleDays) sf(`delivery.${c} 的到貨資訊已超過 ${cfg.priceStaleDays} 天未確認，「較快到貨」標籤將不顯示`);
    }

    // 轉換與信任欄位
    if (!Array.isArray(x.notFor) || !x.notFor.length) sf('缺 notFor（「不適合你的情況」至少 1 條）');
    if (!x.policy || !SELLERS.includes(x.policy.seller)) sf(`缺 policy.seller（${SELLERS.join('/')}）`);
    else if (!x.policy.warranty || !x.policy.returns) sf('policy 需有 warranty 與 returns 說明');
    if (cfg.installCategories.includes(x.category) && !x.extraCosts) sf('此品類通常有安裝/運送/回收費用，請填 extraCosts（沒有就填空陣列 []）');
    if (x.extraCosts) for (const e of x.extraCosts) if (!e.label || (e.amount === undefined && !e.note)) err('extraCosts 每項需有 label 與 amount 或 note');
    if (x.alternative) {
      if (!byCode.has(x.alternative.modelCode) || x.alternative.modelCode === x.modelCode) err('alternative.modelCode 必須是另一個存在的商品');
      if (!x.alternative.when) err('alternative 需有 when（什麼情況改選它）');
    } else warn('沒有 alternative（「如果是 X 情況改選另一台」）');
    if (x.lastChecked && !isIsoDate(x.lastChecked)) err('lastChecked 不是有效日期');

    // 圖片：放在 src/assets/products/，由 Astro 的 <Image> 最佳化；alt 必填
    if (!x.image?.file) sf('缺 image.file（圖片放 src/assets/products/，使用官方提供素材或自有授權圖片）');
    else {
      if (!x.image.alt?.trim()) err('image.alt 必填（無障礙與 SEO）');
      if (!exists('src', 'assets', 'products', x.image.file)) sf(`找不到圖片 src/assets/products/${x.image.file}`);
    }

    if (x.featured) featured++;
    if (x.demo) sf('仍是示範資料（demo: true），上線前請換成真實資料並移除此旗標');
  }
  if (featured === 0) r.warn('沒有任何 featured 商品，首頁九宮格會是空的');
  if (featured > 9) r.warn(`featured 有 ${featured} 個，首頁九宮格只取前 9 個`);
  if (strict && featured !== 9) r.error(`上線前 featured 應為 9 個，目前 ${featured}`);
  for (const c of cats) if (!products.some((x) => x.category === c)) r.warn(`品類 ${c} 沒有任何商品`);

  // ── 旅遊 ──
  if (exists('src', 'data', 'travel.json')) {
    let t;
    try { t = readJson('src', 'data', 'travel.json'); } catch (e) { r.error('travel.json 不是合法 JSON：' + e.message); t = { guides: [] }; }
    const slugs = new Set();
    for (const g of t.guides ?? []) {
      const id = g.slug ?? '?';
      const err = (m) => r.error(`[travel/${id}] ${m}`);
      const sf = (m) => soft(`[travel/${id}] ${m}`);
      for (const k of ['slug', 'destination', 'titleTemplate', 'summary']) if (!g[k]) err(`缺少必填欄位 ${k}`);
      if (g.slug && !/^[a-z0-9-]+$/.test(g.slug)) err('slug 只能用小寫英數與連字號');
      if (slugs.has(g.slug)) err('slug 重複'); slugs.add(g.slug);
      if (g.titleTemplate && /20\d\d/.test(g.titleTemplate)) err('titleTemplate 不可寫死年份');
      if (!isIsoDate(g.lastReviewed)) err('lastReviewed 必須是有效日期');
      else if ((now - Date.parse(g.lastReviewed)) / 864e5 > 90) sf('內容超過 90 天未覆核（旅遊資訊變動快）');
      if (!g.offers?.length) err('offers 至少 1 項');
      for (const o of g.offers ?? []) {
        const oid = `[travel/${id}] offer ${o.code ?? '?'}`;
        if (!KINDS.includes(o.kind)) r.error(`${oid}: kind 必須是 ${KINDS.join('/')}`);
        if (!o.label) r.error(`${oid}: 缺 label`);
        claimCode(o.code, `旅遊 ${id}`, (m) => r.error(`${oid}: ${m}`));
        checkAff(oid, o.channel, o.affiliate, 'travel', r.error);
        if (o.price !== undefined) r.error(`${oid}: 旅遊 offer 不存精確價格（價格變動快，請用 note 寫「價格以平台頁面為準」）`);
      }
      if (g.demo) sf('仍是示範資料（demo: true）');
    }
  }

  // ── 價格紀錄 ──
  if (exists('src', 'data', 'price-history.json')) {
    try {
      const h = readJson('src', 'data', 'price-history.json');
      for (const [code, arr] of Object.entries(h)) {
        if (!byCode.has(code)) r.warn(`price-history 有未知型號 ${code}`);
        for (const e of arr) if (!isIsoDate(e.date) || !Number.isInteger(e.price) || !chById.has(e.channel)) r.error(`price-history[${code}] 有無效紀錄：${JSON.stringify(e)}`);
      }
    } catch (e) { r.error('price-history.json 不是合法 JSON：' + e.message); }
  }

  const linkCount = products.reduce((n, x) => n + Object.keys(x.affiliate ?? {}).length, 0);
  if (linkCount > 1000) r.warn(`轉址已達 ${linkCount} 條：請查 Vercel 官方文件確認 vercel.json 的 redirects 數量上限，必要時改用 Edge Middleware 或大量轉址功能`);
  if (!r.errors) r.ok(`${products.length} 個商品通過驗證`);

  // ── 情境頁 intents.json（/{品類}/for/{情境}）──
  if (exists('src', 'data', 'intents.json')) {
    let it;
    try { it = readJson('src', 'data', 'intents.json'); } catch (e) { r.error('intents.json 不是合法 JSON：' + e.message); it = { intents: [] }; }
    const seen = new Set(); let built = 0;
    for (const n of it.intents ?? []) {
      const id = `${n.category}/for/${n.slug}`; const err = (m) => r.error(`[intent ${id}] ${m}`);
      for (const k of ['category', 'slug', 'title', 'tag']) if (!n[k]) err(`缺少必填欄位 ${k}`);
      if (n.slug && !/^[a-z0-9-]+$/.test(n.slug)) err('slug 只能用小寫英數與連字號');
      if (!cats.has(n.category)) err('category 不在 categories 內');
      if (cfg.tagVocabulary && n.tag && !cfg.tagVocabulary.includes(n.tag)) err(`tag「${n.tag}」不在 tagVocabulary`);
      if (seen.has(id)) err('重複'); seen.add(id);
      const matches = matchIntentProducts(data.products ?? [], n);
      const need = cfg.minIntentProducts ?? 2;
      if (matches.length < need) { r.warn(`[intent ${id}] 符合的商品只有 ${matches.length} 台（至少 ${need}），不會產生此頁`); continue; }
      if (!n.introApproved) { r.warn(`[intent ${id}] 導言尚未審核（introApproved: true 才會產生頁面）`); continue; }
      if (typeof n.intro !== 'string' || n.intro.trim().length < 40) err('intro 太短（至少 40 字，需為這個情境專屬、不可套模板）');
      for (const f of n.faq ?? []) if (!f.q || !f.a) err('faq 每項需有 q 與 a');
      built++;
    }
    r.ok(`情境頁：${built} 頁會產生`);
  }
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(validateProducts({ strict: process.argv.includes('--strict') }).print() ? 1 : 0);
}
