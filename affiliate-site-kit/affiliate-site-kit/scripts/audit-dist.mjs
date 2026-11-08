#!/usr/bin/env node
// 建置後稽核 dist/。用法：node scripts/audit-dist.mjs [--strict]
// 檢查：商品頁的 JSON-LD、FAQ 與可見內容一致、分潤網址未寫死、/go/ 連結 rel、揭露文字、lang、canonical、sitemap、robots。
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { p, exists, readJson, readText, loadConfig, allowedHosts, hostAllowed, createReport } from './lib.mjs';
import { priceBreakdown } from '../src/lib/pricing.mjs';
import { buildableIntents } from '../src/lib/intents.mjs';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    e.isDirectory() ? walk(f, out) : out.push(f);
  }
  return out;
}
const ldBlocks = (html) =>
  [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const stripScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
const flatTypes = (node, acc = new Set()) => {
  if (Array.isArray(node)) node.forEach((n) => flatTypes(n, acc));
  else if (node && typeof node === 'object') {
    if (node['@type']) [].concat(node['@type']).forEach((t) => acc.add(t));
    Object.values(node).forEach((v) => flatTypes(v, acc));
  }
  return acc;
};
const hasKey = (node, key) =>
  Array.isArray(node) ? node.some((n) => hasKey(n, key))
  : node && typeof node === 'object' ? key in node || Object.values(node).some((v) => hasKey(v, key))
  : false;

export function auditDist({ strict = false } = {}) {
  const r = createReport(strict ? '建置稽核（strict）' : '建置稽核');
  const cfg = loadConfig();
  if (!exists('dist')) { r.error('找不到 dist/，請先執行 npm run build'); return r; }
  const data = readJson('src', 'data', 'products.json');
  const hosts = allowedHosts();
  const travel = exists('src', 'data', 'travel.json') ? readJson('src', 'data', 'travel.json').guides ?? [] : [];
  const travelSlugs = new Set(travel.map((g) => g.slug));
  const cats = new Set(data.categories.map((c) => c.slug));
  const htmlFiles = walk(p('dist')).filter((f) => f.endsWith('.html'));
  const rel = (f) => path.relative(p('dist'), f).split(path.sep).join('/');

  const intents = exists('src', 'data', 'intents.json')
    ? buildableIntents(data.products, readJson('src', 'data', 'intents.json').intents, { minProducts: cfg.minIntentProducts ?? 2 }) : [];
  let productPages = 0, travelPages = 0, intentPages = 0;
  for (const f of htmlFiles) {
    const html = fs.readFileSync(f, 'utf8');
    const name = rel(f);
    const parts = name.replace(/\/index\.html$/, '').split('/');
    const isProduct = parts.length === 2 && cats.has(parts[0]);

    if (!/<html[^>]*lang=["']zh-Hant-TW["']/i.test(html)) r.error(`${name}: <html> 缺 lang="zh-Hant-TW"`);

    // 分潤網址不得寫死在 HTML
    for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
      const href = m[1];
      if (/^https?:\/\//i.test(href)) {
        let host; try { host = new URL(href).hostname; } catch { continue; }
        if (hostAllowed(host, hosts)) r.error(`${name}: 寫死外部賣場網址 ${href}（應改為 /go/ 連結）`);
      }
      if (/^\/go\//.test(href)) {
        const tag = m[0];
        const relAttr = (tag.match(/\brel=["']([^"']*)["']/i) ?? [])[1] ?? '';
        if (!/sponsored/.test(relAttr) || !/nofollow/.test(relAttr)) r.error(`${name}: /go/ 連結缺 rel="sponsored nofollow"（${href}）`);
        if (!/data-track=["']go["']/.test(tag)) r.warn(`${name}: /go/ 連結缺 data-track="go"（點擊追蹤與週對帳用）${href}`);
      }
    }

    // 情境頁 /{品類}/for/{情境}
    if (parts.length === 3 && parts[1] === 'for') {
      const n = intents.find((x) => x.category === parts[0] && x.slug === parts[2]);
      if (n) {
        const ierr = (m) => r.error(`${name}: ${m}`);
        const vis = stripScripts(html);
        if ((html.match(/<h1[\s>]/gi) ?? []).length !== 1) ierr('H1 數量必須剛好 1 個');
        if (!/<link[^>]*rel=["']canonical["']/i.test(html)) ierr('缺 canonical');
        if (!/分潤/.test(html)) ierr('頁面沒有分潤揭露文字');
        if (!vis.includes(n.intro.slice(0, 20))) ierr('情境導言未顯示在頁面上');
        const tt = new Set(); const nodes = [];
        for (const b of ldBlocks(html)) { try { const j = JSON.parse(b); nodes.push(j); flatTypes(j, tt); } catch { ierr('JSON-LD 不是合法 JSON'); } }
        if (!tt.has('BreadcrumbList')) ierr('缺 JSON-LD BreadcrumbList');
        if (hasKey(nodes, 'aggregateRating') || hasKey(nodes, 'review')) ierr('出現 aggregateRating/review');
        for (const x of n.products) {
          if (!vis.includes(x.flaw)) ierr(`商品 ${x.modelCode} 的缺點未顯示（情境頁每台都要列缺點）`);
          if (!html.includes(`/${x.category}/${x.slug}/`)) ierr(`商品 ${x.modelCode} 沒有連到自己的評測頁（內部連結）`);
        }
        for (const f of n.faq ?? []) if (!vis.includes(f.q)) ierr(`FAQ 問題未出現在可見內容：「${f.q}」`);
        intentPages++;
      }
      continue;
    }

    // 旅遊頁
    if (parts.length === 2 && parts[0] === 'travel' && travelSlugs.has(parts[1])) {
      const terr = (m) => r.error(`${name}: ${m}`);
      if (!/分潤/.test(html)) terr('頁面沒有分潤揭露文字');
      if (!/<link[^>]*rel=["']canonical["']/i.test(html)) terr('缺 canonical');
      const tt = new Set(); for (const b of ldBlocks(html)) { try { flatTypes(JSON.parse(b), tt); } catch { terr('JSON-LD 不是合法 JSON'); } }
      if (!tt.has('BreadcrumbList')) terr('缺 JSON-LD BreadcrumbList');
      if (tt.has('Product') || tt.has('Offer')) r.warn(`${name}: 旅遊頁不應輸出 Product/Offer（價格變動快，且無精確價格資料）`);
      const g = travel.find((x) => x.slug === parts[1]);
      for (const f of g.faq ?? []) if (!stripScripts(html).includes(f.q)) terr(`FAQ 問題未出現在可見內容：「${f.q}」`);
      if (!stripScripts(html).includes('價格') ) r.warn(`${name}: 建議註明「價格以平台頁面為準」`);
      travelPages++;
      continue;
    }
    if (!isProduct) continue;
    productPages++;
    const err = (m) => r.error(`${name}: ${m}`);
    const warn = (m) => r.warn(`${name}: ${m}`);

    if ((html.match(/<h1[\s>]/gi) ?? []).length !== 1) err('H1 數量必須剛好 1 個');
    if (!/<link[^>]*rel=["']canonical["']/i.test(html)) err('缺 canonical');
    if (!/<meta[^>]*name=["']description["']/i.test(html)) err('缺 meta description');
    if (/{year}/.test(html)) err('標題還有未取代的 {year}');
    if (!/分潤/.test(html)) err('頁面沒有分潤揭露文字');
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\bwidth=/.test(m[0]) || !/\bheight=/.test(m[0])) warn('有 <img> 缺 width/height（會造成版面位移 CLS），請改用 Astro <Image>');
      if (!/\balt=/.test(m[0])) err('有 <img> 缺 alt');
    }
    if (!/sticky/.test(html)) warn('找不到 sticky（規格表是否凍結首欄/表頭？）');
    if (!/overflow-x-auto/.test(html)) warn('找不到 overflow-x-auto（規格表是否可橫滑？）');
    if (!/\/go\//.test(html)) err('頁面沒有任何 /go/ CTA 連結');

    const blocks = ldBlocks(html); const types = new Set(); const nodes = [];
    for (const b of blocks) {
      try { const j = JSON.parse(b); nodes.push(j); flatTypes(j, types); } catch { err('JSON-LD 不是合法 JSON'); }
    }
    for (const t of ['BreadcrumbList', 'Product']) if (!types.has(t)) err(`缺 JSON-LD ${t}`);
    const prod = data.products.find((x) => x.category === parts[0] && x.slug === parts[1]);
    if (prod?.faq?.length) {
      if (!types.has('FAQPage')) err('缺 JSON-LD FAQPage');
      const visible = stripScripts(html);
      for (const f of prod.faq) if (!visible.includes(f.q)) err(`FAQ 問題未出現在可見內容：「${f.q}」`);
    }
    if (hasKey(nodes, 'aggregateRating') || hasKey(nodes, 'review')) err('出現 aggregateRating/review（沒有真實評價資料不可輸出）');
    if (prod) {
      const vis = stripScripts(html);
      if (!vis.includes(prod.flaw)) err('缺點（flaw）未顯示在頁面上');
      const bd = priceBreakdown(prod);
      if (!vis.includes(bd.final.toLocaleString('en-US'))) err(`到手價 ${bd.final.toLocaleString('en-US')} 未顯示在頁面上（或算式與資料不符）`);
      if (prod.notFor?.length && !vis.includes(prod.notFor[0])) err('「不適合你的情況」(notFor) 未顯示在頁面上');
      for (const e of prod.extraCosts ?? []) if (!vis.includes(e.label)) err(`額外費用「${e.label}」未顯示在頁面上`);
      if (prod.policy && !vis.includes(prod.policy.warranty)) err('保固說明 (policy.warranty) 未顯示在頁面上');
      if (prod.alternative && !vis.includes(prod.alternative.when)) warn('「改選另一台」(alternative.when) 未顯示');
      if (!/sticky[^"']*bottom|bottom-0/.test(html)) warn('找不到手機固定底部 CTA 列（fixed/sticky bottom）');
      if (/倒數|countdown/i.test(vis) && !prod.promoValidUntil) err('頁面出現倒數字樣但資料沒有真實到期日（promoValidUntil）');
    }
    if (html.length > 150_000) warn(`HTML 偏大（${Math.round(html.length / 1024)} KB）`);
  }
  if (!productPages) r.warn('沒有找到商品頁（dist/{category}/{slug}/index.html）');
  else r.ok(`稽核了 ${productPages} 個商品頁` + (intentPages ? `、${intentPages} 個情境頁` : '') + (travelPages ? `、${travelPages} 個旅遊頁` : ''));
  if (intents.length && intentPages < intents.length) r.error(`有 ${intents.length} 個應產生的情境頁，dist 只找到 ${intentPages} 個（/{品類}/for/{情境}/）`);
  if (travel.length && !travelPages) r.warn('有 travel.json 但 dist/travel/{slug}/ 找不到旅遊頁');

  // 站級檔案
  const sm = ['sitemap-index.xml', 'sitemap-0.xml', 'sitemap.xml'].some((n) => exists('dist', n));
  sm ? r.ok('sitemap 存在') : r.error('dist 內沒有 sitemap（確認已安裝 @astrojs/sitemap 並設定 site）');
  if (!exists('dist', 'robots.txt')) r.error('缺 robots.txt');
  else if (!/Disallow:\s*\/go\//i.test(readText('dist', 'robots.txt'))) r.error('robots.txt 沒有 Disallow: /go/');
  else r.ok('robots.txt 已封鎖 /go/');
  if (!exists('dist', '404.html')) (strict ? r.error : r.warn)('缺 404.html');

  // 前端 JS 預算（資訊性）
  const js = walk(p('dist')).filter((f) => f.endsWith('.js'));
  const kb = js.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024;
  const msg = `全站 JS 共 ${kb.toFixed(1)} KB（${js.length} 檔）`;
  kb > 60 ? r.warn(msg + '，偏大，檢查是否誤引入框架') : r.ok(msg);
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(auditDist({ strict: process.argv.includes('--strict') }).print() ? 1 : 0);
}
