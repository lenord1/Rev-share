#!/usr/bin/env node
// 貼商品連結 → 產生草稿商品（src/data/drafts/<代號>.json）與圖片（src/assets/products/）。
// 用法：node scripts/import-product.mjs <網址> [--category 品類] [--name 名稱] [--price 整數] [--brand 品牌]
//        [--image-file 本機圖片 [--image-license owned|official|licensed]] [--html-file 本機HTML(離線測試)]
//        [--official-url 品牌官網商品頁（蝦皮／酷澎連結搭配用：名稱、圖片取自官方頁，不取官網價格）]
//        [--max-images N] [--no-images] [--force] [--dry-run] [--json] [--summary-file 路徑]
// 結束碼：0 成功　2 網址或參數不對　3 抓不到公開資料（請手動）　4 草稿已存在（--force 覆蓋）　1 其他錯誤
// 蝦皮／酷澎：只解析網址取編號；名稱、價格、圖片等官方 API 接上後才自動取得（目前請手動補），本工具不連它們的網頁。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, loadConfig, loadChannels } from './lib.mjs';
import { parseProductUrl, draftIdFor } from './import/url.mjs';
import { extractProduct } from './import/html-meta.mjs';
import { createFetcher, ImportError, DEFAULT_BLOCKED_HOSTS } from './import/net.mjs';
import { downloadImages, saveImage } from './import/images.mjs';
import { loadProductSource, ProviderNotConfigured } from './providers/product-source.mjs';
import { buildDraft, mergePrevious, validateDraft, writeDraft, readDraft, readLedger, writeLedger, ledgerEntry, renderSummary, today, LICENSES } from './import/draft.mjs';

const VALUE_FLAGS = ['category', 'name', 'price', 'brand', 'image-file', 'image-license', 'html-file', 'max-images', 'summary-file', 'official-url'];
const BOOL_FLAGS = ['no-images', 'force', 'dry-run', 'json'];

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (BOOL_FLAGS.includes(k)) o[k] = true;
    else if (VALUE_FLAGS.includes(k)) { if (i + 1 >= argv.length) throw new ImportError('args', `--${k} 需要值`); o[k] = argv[++i]; }
    else throw new ImportError('args', `不認得的參數 --${k}`);
  }
  return o;
}

/** deps 可注入（測試用）：fetcher、log */
export async function runImport(opts, deps = {}) {
  const cfg = loadConfig();
  const ic = cfg.importer ?? {};
  const log = deps.log ?? ((m) => console.error(m));
  const parsed = parseProductUrl(opts._[0]);
  if (!parsed.ok) throw new ImportError('url', parsed.message);

  const fetchedAt = today();
  const id = draftIdFor(parsed);
  const prev = readDraft(id);
  if (prev && prev.status === 'promoted') throw new ImportError('exists', `草稿 ${id} 已轉為正式商品，不可覆蓋`);
  if (prev && !opts.force) throw new ImportError('exists', `草稿 ${id} 已存在（加 --force 重新匯入；已填的缺點、優點、評論彙整、型號、分潤連結與已確認的圖片授權會保留）`);

  const manual = {};
  if (opts.name) manual.name = opts.name.trim();
  if (opts.price != null) {
    const n = Number(opts.price);
    if (!Number.isInteger(n) || n <= 0) throw new ImportError('args', '--price 必須是正整數（TWD）');
    manual.price = n;
  }
  if (opts.category) {
    const cats = JSON.parse(fs.readFileSync(p('src', 'data', 'products.json'), 'utf8')).categories.map((c) => c.slug);
    if (!cats.includes(opts.category)) throw new ImportError('args', `--category「${opts.category}」不在品類內：${cats.join('、')}`);
  }
  const licenseFlag = opts['image-license'] ?? 'pending-review';
  if (!LICENSES.includes(licenseFlag)) throw new ImportError('args', `--image-license 只能是 ${LICENSES.join('／')}`);

  const blocked = [...new Set([...DEFAULT_BLOCKED_HOSTS, ...loadChannels().filter((c) => ['shopee', 'coupang'].includes(c.id)).flatMap((c) => c.hosts)])];
  const fetcher = deps.fetcher ?? createFetcher({ userAgent: ic.userAgent, delayMs: ic.delayMs, timeoutMs: ic.timeoutMs, maxRedirects: ic.maxRedirects, blockedHosts: blocked });

  let extracted = {};
  let method = 'manual';
  let official = null;
  const notes = [];

  if (parsed.kind === 'generic') {
    let html;
    let baseUrl = parsed.canonicalUrl;
    if (opts['html-file']) html = fs.readFileSync(opts['html-file'], 'utf8');
    else {
      try {
        const r = await fetcher.get(parsed.canonicalUrl, { maxBytes: ic.maxHtmlBytes });
        if (!/html|xml/i.test(r.contentType)) throw new ImportError('content-type', `不是網頁內容（${r.contentType || '未標示'}）`);
        html = r.body.toString('utf8');
        baseUrl = r.url;
      } catch (e) {
        if (e instanceof ImportError && !manual.name) { e.exitCode = 3; e.message += '；抓不到公開資料，請用 --name／--price／--image-file 手動補。'; }
        throw e;
      }
    }
    extracted = extractProduct(html, baseUrl);
    method = extracted.methods.length ? extracted.methods.join('+') : 'manual';
    if (!extracted.name && !manual.name) {
      const e = new ImportError('no-metadata', '這個網頁沒有公開的 OpenGraph／JSON-LD 商品資料，請用 --name／--price／--image-file 手動補。');
      e.exitCode = 3;
      throw e;
    }
  } else {
    const src = await loadProductSource(parsed.kind);
    try {
      if (!src.implemented) throw new ProviderNotConfigured(parsed.kind, '官方 API 尚未接上');
      const sp = await src.fetchProduct(parsed.ids, { log });
      extracted = { name: sp.name, description: sp.description ?? '', brand: sp.brand ?? null, sku: sp.sku ?? null, price: sp.price ?? null, imageUrls: sp.imageUrls ?? [], canonical: null };
      method = sp.method;
    } catch (e) {
      if (!(e instanceof ProviderNotConfigured)) throw e;
      notes.push(`${parsed.kind === 'shopee' ? '蝦皮' : '酷澎'}官方 API 尚未接上（等待官方文件），只記下商品編號；名稱、價格、圖片請手動補。本工具不抓取其網頁。`);
    }
    if (opts['official-url']) {
      const op = parseProductUrl(opts['official-url']);
      if (!op.ok || op.kind !== 'generic') throw new ImportError('args', '--official-url 要是品牌官網等一般商品頁網址，不可以是蝦皮／酷澎網址');
      let html;
      let baseUrl = op.canonicalUrl;
      if (opts['html-file']) html = fs.readFileSync(opts['html-file'], 'utf8');
      else {
        const r = await fetcher.get(op.canonicalUrl, { maxBytes: ic.maxHtmlBytes });
        if (!/html|xml/i.test(r.contentType)) throw new ImportError('content-type', `官方頁不是網頁內容（${r.contentType || '未標示'}）`);
        html = r.body.toString('utf8');
        baseUrl = r.url;
      }
      const ex = extractProduct(html, baseUrl);
      if (!ex.name && !manual.name) {
        const e = new ImportError('no-metadata', '官方頁沒有公開的 OpenGraph／JSON-LD 商品資料，請手動補。');
        e.exitCode = 3;
        throw e;
      }
      official = { url: op.canonicalUrl, fetchedAt, methods: ex.methods };
      extracted = { ...ex, price: null };
      // 官方頁的 og:image 常是通用分享圖：可另外指定同一官網網域下的商品圖網址（opts.officialImages）
      if (Array.isArray(opts.officialImages) && opts.officialImages.length) {
        const host = new URL(op.canonicalUrl).hostname;
        const same = opts.officialImages.map(String).filter((u) => { try { return new URL(u).hostname === host; } catch { return false; } });
        if (same.length) extracted.imageUrls = same;
      }
      method = 'official-page';
      notes.push(`名稱、說明、圖片取自官方頁 ${op.canonicalUrl}；不取官網價格（蝦皮價格另行維護）。`);
    }
  }
  if (opts.brand) extracted.brand = opts.brand.trim();

  // 圖片
  const destDir = p('src', 'assets', 'products');
  const baseName = id;
  let images = [];
  let skipped = [];
  if (!opts['no-images'] && !opts['dry-run']) {
    if ((parsed.kind === 'generic' || official) && extracted.imageUrls?.length && !opts['html-file']) {
      const r = await downloadImages({ urls: extracted.imageUrls, fetcher, destDir, baseName, pageUrl: official?.url ?? parsed.canonicalUrl, fetchedAt, max: Number(opts['max-images'] ?? ic.maxImages ?? 3), minSide: ic.minImageSide ?? 300, maxBytes: ic.maxImageBytes });
      images = r.images; skipped = r.skipped;
    }
    if (opts['image-file']) {
      const buf = fs.readFileSync(opts['image-file']);
      const out = saveImage({ buf, destDir, baseName, index: images.length + 1, sourceUrl: null, pageUrl: null, fetchedAt, minSide: ic.minImageSide ?? 300 });
      if (out.skipped) throw new ImportError('image', `--image-file：${out.skipped}`);
      out.image.provided = 'user';
      images.push(out.image);
    }
  }
  for (const s of skipped) notes.push(`圖片略過：${s.url}（${s.reason}）`);
  if (opts['html-file'] && extracted.imageUrls?.length) notes.push('離線模式（--html-file）：未下載圖片。');

  const draft = buildDraft({ parsed, extracted, manual, images, category: opts.category ?? null, method, notes, fetchedAt });
  draft.draftId = id;
  if (official) draft.official = official;
  if (prev && opts.force) mergePrevious(draft, prev, { category: opts.category });
  if (opts['image-file'] && licenseFlag !== 'pending-review') {
    const own = draft.images.find((i) => i.provided === 'user');
    if (own) { own.license = licenseFlag; own.licenseNote = '匯入時由使用者標記'; }
  }
  const v = validateDraft(draft);
  if (v.errors.length) throw new ImportError('draft', '產生的草稿結構不正確：' + v.errors.join('；'));

  if (!opts['dry-run']) {
    writeDraft(draft);
    const ledger = readLedger();
    for (const i of draft.images) ledger.images[i.file] = ledgerEntry(id, i);
    if (draft.images.length) writeLedger(ledger);
  }
  return { draft, validation: v, summary: renderSummary(draft, v) };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (!opts._.length) throw new ImportError('args', '用法：node scripts/import-product.mjs <商品網址> [選項]（見檔案開頭說明）');
    const r = await runImport(opts);
    if (opts['summary-file']) fs.writeFileSync(path.resolve(opts['summary-file']), r.summary);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `draft_id=${r.draft.draftId}\nname=${(r.draft.name || r.draft.draftId).replace(/[\r\n]+/g, ' ')}\n`);
    if (opts.json) console.log(JSON.stringify({ draftId: r.draft.draftId, blockers: r.validation.blockers, warnings: r.validation.warnings, dryRun: !!opts['dry-run'] }, null, 2));
    else console.log(r.summary + (opts['dry-run'] ? '\n（--dry-run：未寫入任何檔案）\n' : `\n已建立草稿：src/data/drafts/${r.draft.draftId}.json\n下一步：補齊缺項後  node scripts/drafts.mjs check ${r.draft.draftId}\n`));
  } catch (e) {
    if (!(e instanceof ImportError)) { console.error('✗ 失敗：' + (e?.stack ?? e)); process.exit(1); }
    console.error('✗ ' + e.message);
    process.exit(e.exitCode ?? ({ url: 2, args: 2, exists: 4 }[e.code] ?? 3));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
