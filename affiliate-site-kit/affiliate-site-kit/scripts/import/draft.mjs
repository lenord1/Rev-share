// 草稿商品：存在 src/data/drafts/<代號>.json，不會被網站、驗證器或 vercel.json 讀到。
// 轉正式的條件（validateDraft 的 blockers）：具體缺點、優點、評論彙整（來源與樣本數）、已確認授權的圖片、
// 品類／slug／型號／價格／分潤連結／規格都補齊；最後還要通過 validate-products。
import fs from 'node:fs';
import path from 'node:path';
import { p, exists, readJson, loadConfig, loadChannels, hostAllowed, isIsoDate } from '../lib.mjs';
import { validateProducts } from '../validate-products.mjs';

export const today = () => new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
export const LICENSES = ['pending-review', 'owned', 'official', 'licensed', 'rejected'];
const draftsDir = () => p('src', 'data', 'drafts');
export function draftFile(id) {
  if (!/^[a-z0-9-]+$/.test(id ?? '')) throw new Error(`草稿代號格式不正確：${id}`);
  return path.join(draftsDir(), id + '.json');
}
export function readDraft(id) {
  const f = draftFile(id);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
export function writeDraft(d) {
  fs.mkdirSync(draftsDir(), { recursive: true });
  fs.writeFileSync(draftFile(d.draftId), JSON.stringify(d, null, 2) + '\n');
}
export function listDrafts() {
  if (!fs.existsSync(draftsDir())) return [];
  return fs.readdirSync(draftsDir()).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(draftsDir(), f), 'utf8')));
}

// ── 圖片來源登記（草稿轉正式或刪除後仍保留紀錄）──
const LEDGER_NOTE = '圖片來源與抓取日期登記。license：pending-review＝待確認授權（不得上線）；owned／official／licensed＝已確認；rejected＝不可用。';
export function readLedger() {
  return exists('src', 'data', 'image-sources.json') ? readJson('src', 'data', 'image-sources.json') : { _說明: LEDGER_NOTE, images: {} };
}
export function writeLedger(l) {
  const images = Object.fromEntries(Object.entries(l.images ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(p('src', 'data', 'image-sources.json')), { recursive: true });
  fs.writeFileSync(p('src', 'data', 'image-sources.json'), JSON.stringify({ _說明: LEDGER_NOTE, images }, null, 2) + '\n');
}
export function ledgerEntry(draftId, img) {
  return { draftId, sourceUrl: img.sourceUrl ?? null, pageUrl: img.pageUrl ?? null, fetchedAt: img.fetchedAt, sha256: img.sha256, license: img.license, licenseNote: img.licenseNote ?? '' };
}

// ── 建立草稿 ──
export function buildDraft({ parsed, extracted = {}, manual = {}, images = [], category = null, method, notes = [], fetchedAt = today() }) {
  const name = (manual.name ?? extracted.name ?? '').trim();
  const notesOut = [...notes];
  let price = null;
  if (manual.price != null) price = { amount: manual.price, currency: 'TWD' };
  else if (extracted.price) {
    if (extracted.price.currency === 'TWD') price = extracted.price;
    else notesOut.push(`來源標示的幣別是「${extracted.price.currency ?? '未標示'}」，不是 TWD，沒有帶入價格（${extracted.price.amount}）。請手動確認後填 product.price。`);
  }
  let priceInt = null;
  if (price) {
    priceInt = Math.round(price.amount);
    if (Math.abs(priceInt - price.amount) > 0.005) notesOut.push(`來源價格 ${price.amount} 不是整數，已四捨五入為 ${priceInt}。`);
    if (priceInt <= 0) priceInt = null;
  }
  const imgs = images.map((i) => ({ ...i, license: 'pending-review', licenseNote: '', alt: name }));
  return {
    draftId: undefined, // 由呼叫端填入
    status: 'draft',
    name,
    createdAt: fetchedAt,
    source: {
      kind: parsed.kind, url: parsed.canonicalUrl, host: parsed.host, ids: parsed.ids, method,
      fetchedAt, siteCanonical: extracted.canonical ?? null,
    },
    extracted: { name: extracted.name ?? '', description: extracted.description ?? '', brand: extracted.brand ?? null, sku: extracted.sku ?? null, price: extracted.price ?? null, imageUrls: extracted.imageUrls ?? [] },
    images: imgs,
    product: {
      category, slug: null, modelCode: null,
      titleTemplate: name ? `${name} 評測：{year} 值不值得買` : '',
      price: priceInt, priceUpdatedAt: priceInt ? fetchedAt : null,
      affiliate: {}, tldr: '', specs: [], faq: [], notFor: [],
    },
    editorial: {
      flaw: '',
      strength: '',
      reviewSummary: { sources: [], sampleSize: 0, summarizedAt: null, summary: '', pros: [], cons: [], sellerLogisticsNotes: [] },
    },
    notes: notesOut,
  };
}

// 重新匯入（--force）時保留人工填過的內容：editorial、product 欄位、已確認授權的圖片（依檔案雜湊比對）。
export function mergePrevious(draft, prev, { category } = {}) {
  const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  for (const [k, v] of Object.entries(prev.product ?? {})) if (k !== 'titleTemplate' && !empty(v)) draft.product[k] = v;
  if (category) draft.product.category = category;
  draft.editorial = prev.editorial ?? draft.editorial;
  const bySha = new Map((prev.images ?? []).map((i) => [i.sha256, i]));
  for (const i of draft.images) {
    const o = bySha.get(i.sha256);
    if (o) { i.license = o.license; i.licenseNote = o.licenseNote ?? ''; i.alt = o.alt ?? i.alt; }
  }
  const newFiles = new Set(draft.images.map((i) => i.file));
  const newShas = new Set(draft.images.map((i) => i.sha256));
  draft.images.push(...(prev.images ?? []).filter((i) => !newFiles.has(i.file) && !newShas.has(i.sha256)));
  draft.notes = [...new Set([...(prev.notes ?? []), ...draft.notes])];
}

// 測試用：把草稿的圖片掛到「示範商品」（demo: true）。授權未確認的圖片只允許掛在示範商品上；
// 示範商品過不了嚴格的上線檢查，所以不會誤上線。正式商品請走 license → promote。
export function attachImageToDemo(draftId, modelCode, file) {
  const d = readDraft(draftId);
  if (!d) return { ok: false, message: `找不到草稿 ${draftId}` };
  const img = file ? d.images.find((i) => i.file === file) : d.images.find((i) => i.license !== 'rejected');
  if (!img || img.license === 'rejected') return { ok: false, message: '草稿沒有可用的圖片' };
  if (!exists('src', 'assets', 'products', img.file)) return { ok: false, message: `找不到圖片檔 src/assets/products/${img.file}` };
  const f = p('src', 'data', 'products.json');
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const prod = data.products.find((x) => x.modelCode === modelCode);
  if (!prod) return { ok: false, message: `找不到商品 ${modelCode}` };
  if (!prod.demo) return { ok: false, message: '只能掛在示範商品（demo: true）。正式商品請先 license 確認授權，再 promote。' };
  prod.image = { file: img.file, alt: String(img.alt || d.name || prod.modelCode).trim(), license: img.license, fetchedAt: img.fetchedAt };
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
  return { ok: true, file: img.file, license: img.license };
}

// ── 驗證 ──
export function validateDraft(d, ctx = {}) {
  const cfg = ctx.cfg ?? loadConfig();
  const errors = []; const blockers = []; const warnings = [];
  const data = ctx.data ?? (exists('src', 'data', 'products.json') ? readJson('src', 'data', 'products.json') : { products: [], categories: [] });
  const channels = ctx.channels ?? loadChannels();

  if (!d || typeof d !== 'object') return { errors: ['草稿不是物件'], blockers, warnings };
  if (!/^[a-z0-9-]+$/.test(d.draftId ?? '')) errors.push('draftId 格式不正確');
  if (!['draft', 'promoted', 'rejected'].includes(d.status)) errors.push('status 必須是 draft／promoted／rejected');
  if (!d.source?.url || !d.source?.kind) errors.push('缺少 source.url／source.kind');
  if (!Array.isArray(d.images)) errors.push('images 必須是陣列');
  if (!d.product || typeof d.product !== 'object') errors.push('缺少 product');
  if (!d.editorial || typeof d.editorial !== 'object') errors.push('缺少 editorial');
  if (errors.length) return { errors, blockers, warnings };

  const pr = d.product; const ed = d.editorial;
  const minLen = cfg.minFlawLength ?? 8;
  const need = (cond, msg) => { if (!cond) blockers.push(msg); };

  // 缺點、優點
  need(typeof ed.flaw === 'string' && ed.flaw.trim().length >= minLen, `缺點（editorial.flaw）要具體，至少 ${minLen} 字`);
  need(typeof ed.strength === 'string' && ed.strength.trim().length >= minLen, `優點（editorial.strength）要有規格或官方說明作依據，至少 ${minLen} 字`);

  // 評論彙整
  const rs = ed.reviewSummary ?? {};
  const srcs = Array.isArray(rs.sources) ? rs.sources : [];
  const srcOk = srcs.length > 0 && srcs.every((s) => typeof s?.platform === 'string' && s.platform.trim() && Number.isInteger(s.count) && s.count > 0);
  need(srcOk, '評論彙整（editorial.reviewSummary.sources）要列出來源平台與則數，例如 {"platform":"蝦皮","count":120}');
  if (srcOk) {
    const total = srcs.reduce((a, s) => a + s.count, 0);
    need(rs.sampleSize === total, `reviewSummary.sampleSize（${rs.sampleSize}）要等於各來源則數合計（${total}）`);
    if (rs.sampleSize === total && total < (cfg.importer?.minReviewSample ?? 10)) warnings.push(`評論樣本只有 ${total} 則（低於 ${cfg.importer?.minReviewSample ?? 10}），頁面應標示「評論樣本不足」`);
  }
  need(isIsoDate(rs.summarizedAt), '評論彙整日期（reviewSummary.summarizedAt）要是有效日期');
  need(typeof rs.summary === 'string' && rs.summary.trim().length >= 20, '評論彙整摘要（reviewSummary.summary）至少 20 字，並用自己的話寫');
  need(Array.isArray(rs.pros) && rs.pros.some((x) => String(x).trim()) && Array.isArray(rs.cons) && rs.cons.some((x) => String(x).trim()), '評論彙整要有至少一條優點（pros）與一條缺點（cons）');

  // 商品欄位
  const cats = new Set((data.categories ?? []).map((c) => c.slug));
  need(pr.category && cats.has(pr.category), `product.category 要是既有品類之一（目前：${pr.category ?? '空'}）`);
  const slugOk = /^[a-z0-9-]+$/.test(pr.slug ?? '') && pr.slug !== 'for' && !String(pr.slug).startsWith('draft');
  need(slugOk, 'product.slug 要填小寫英數與連字號（不可為 for）');
  need(/^[a-z0-9-]+$/.test(pr.modelCode ?? '') && !String(pr.modelCode).startsWith('draft'), 'product.modelCode 要填官方型號（小寫英數與連字號，全站唯一）');
  if (slugOk && (data.products ?? []).some((x) => x.category === pr.category && x.slug === pr.slug)) blockers.push(`slug「${pr.category}/${pr.slug}」已存在`);
  if (pr.modelCode && (data.products ?? []).some((x) => x.modelCode === pr.modelCode)) blockers.push(`modelCode「${pr.modelCode}」已存在`);
  need(typeof pr.titleTemplate === 'string' && pr.titleTemplate.includes('{year}') && !/20\d\d/.test(pr.titleTemplate), 'product.titleTemplate 要含 {year} 且不可寫死年份');
  need(Number.isInteger(pr.price) && pr.price > 0, 'product.price 要是正整數（TWD）');
  need(isIsoDate(pr.priceUpdatedAt), 'product.priceUpdatedAt 要是有效日期');
  need(typeof pr.tldr === 'string' && pr.tldr.trim(), 'product.tldr 一句話結論未填');
  need(Array.isArray(pr.specs) && pr.specs.length >= (cfg.minSpecs ?? 3), `product.specs 至少 ${cfg.minSpecs ?? 3} 項（只填官方標示的規格）`);

  // 分潤連結（必須由你從聯盟後台取得；不可是原始賣場網址）
  const aff = pr.affiliate ?? {};
  const affChs = Object.keys(aff).filter((k) => aff[k]);
  need(affChs.length > 0, 'product.affiliate 要放你從聯盟後台取得的連結（例如 {"shopee":"https://…"}）');
  for (const ch of affChs) {
    const c = channels.find((x) => x.id === ch);
    let host = '';
    try { host = new URL(aff[ch]).hostname; } catch { /* 下面報錯 */ }
    if (!c) blockers.push(`affiliate.${ch}：未知通路`);
    else if (!host || !hostAllowed(host, c.hosts)) blockers.push(`affiliate.${ch}：網址無效或網域不在 channels.json 的 ${ch}.hosts 內`);
    if (aff[ch] === d.source.url) warnings.push(`affiliate.${ch} 與來源網址相同：這是賣場原始網址，不是分潤連結嗎？`);
  }

  // 圖片：至少一張已確認授權，且有替代文字、檔案存在
  const approved = cfg.importer?.approvedImageLicenses ?? ['owned', 'official', 'licensed'];
  const usable = d.images.filter((i) => approved.includes(i.license));
  need(usable.length > 0, d.images.length ? '圖片授權未確認：用 node scripts/drafts.mjs license <代號> <檔名> official|owned|licensed 標記（確認官方素材或自有授權後才可）' : '沒有圖片：請補 --image-file，且授權需確認');
  for (const i of usable) {
    if (!String(i.alt ?? '').trim()) blockers.push(`圖片 ${i.file} 的 alt 未填`);
    if (!exists('src', 'assets', 'products', i.file)) blockers.push(`找不到圖片檔 src/assets/products/${i.file}`);
  }
  if (d.images.some((i) => i.license === 'pending-review')) warnings.push('仍有授權待確認的圖片（不會被使用，轉正式前可保留或刪除）');
  return { errors, blockers, warnings };
}

// ── 轉正式 ──
export function promoteDraft(id, { dryRun = false } = {}) {
  const d = readDraft(id);
  if (!d) return { ok: false, messages: [`找不到草稿 ${id}`] };
  if (d.status !== 'draft') return { ok: false, messages: [`草稿狀態是 ${d.status}，不能轉正式`] };
  const v = validateDraft(d);
  if (v.errors.length || v.blockers.length) return { ok: false, messages: [...v.errors, ...v.blockers], warnings: v.warnings };

  const approved = loadConfig().importer?.approvedImageLicenses ?? ['owned', 'official', 'licensed'];
  const img = d.images.find((i) => i.file === d.product.imageFile && approved.includes(i.license)) ?? d.images.find((i) => approved.includes(i.license));
  const { imageFile, category, slug, modelCode, titleTemplate, affiliate, price, priceUpdatedAt, tldr, ...rest } = d.product;
  const rs = d.editorial.reviewSummary;
  const product = {
    category, slug, modelCode, titleTemplate, affiliate, price, priceUpdatedAt, tldr,
    flaw: d.editorial.flaw.trim(), strength: d.editorial.strength.trim(),
    ...rest,
    image: { file: img.file, alt: img.alt.trim(), license: img.license, fetchedAt: img.fetchedAt },
    reviewSummary: { sources: rs.sources, sampleSize: rs.sampleSize, summarizedAt: rs.summarizedAt, summary: rs.summary.trim(), pros: rs.pros, cons: rs.cons, ...(rs.sellerLogisticsNotes?.length ? { sellerLogisticsNotes: rs.sellerLogisticsNotes } : {}) },
  };

  const file = p('src', 'data', 'products.json');
  const original = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(original);
  data.products.push(product);
  let report;
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    report = validateProducts();
  } finally {
    if (dryRun || report?.errors || !report) fs.writeFileSync(file, original);
  }
  if (report.errors) return { ok: false, messages: report.items.filter((i) => i.level === 'error').map((i) => i.msg), warnings: v.warnings };
  if (dryRun) return { ok: true, dryRun: true, product, warnings: v.warnings };

  d.status = 'promoted';
  d.promotedAt = today();
  d.promotedAs = `${category}/${slug}`;
  writeDraft(d);
  const ledger = readLedger();
  for (const i of d.images) ledger.images[i.file] = ledgerEntry(d.draftId, i);
  writeLedger(ledger);
  return { ok: true, product, warnings: v.warnings };
}

export function renderSummary(d, v) {
  const L = [];
  L.push(`## 商品草稿：${d.name || d.draftId}`);
  L.push('', `- 代號：\`${d.draftId}\`　來源類型：${d.source.kind}　取得方式：${d.source.method}　日期：${d.source.fetchedAt}`);
  if (d.product.price) L.push(`- 價格：NT$ ${d.product.price.toLocaleString('en-US')}（來源當下，需自行確認）`);
  if (d.images.length) L.push(`- 圖片：${d.images.map((i) => `\`${i.file}\`（${i.width ?? '?'}×${i.height ?? '?'}）`).join('、')}　**授權待確認，未確認前不會上線**`);
  else L.push('- 圖片：無');
  if (d.notes.length) { L.push('', '### 注意'); for (const n of d.notes) L.push(`- ${n}`); }
  L.push('', '### 轉正式前還缺（共 ' + v.blockers.length + ' 項）');
  for (const b of v.blockers) L.push(`- [ ] ${b}`);
  if (v.warnings.length) { L.push('', '### 提醒'); for (const w of v.warnings) L.push(`- ${w}`); }
  L.push('', '> 草稿放在 `src/data/drafts/`，不會出現在網站。合併這個 PR 只是把草稿存進專案。');
  return L.join('\n') + '\n';
}
