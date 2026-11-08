#!/usr/bin/env node
// 步驟閘門：node scripts/verify.mjs <step|all>   （step 為 0–16）
// 每步只做「機器可檢查」的部分；需要人工/手機實測的項目會列在「人工驗收」。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { exists, readText, readJson, createReport, loadChannels, loadConfig, p } from './lib.mjs';
import { validateProducts } from './validate-products.mjs';
import { buildableIntents } from '../src/lib/intents.mjs';
import { auditDist } from './audit-dist.mjs';
import { buildVercelConfig } from './gen-redirects.mjs';

const has = (...f) => exists(...f);
function srcContains(re, dir = p('src')) {
  if (!fs.existsSync(dir)) return false;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = dir + '/' + e.name;
    if (e.isDirectory()) { if (srcContains(re, f)) return true; }
    else if (/\.(css|astro|ts|js|mjs)$/.test(e.name) && re.test(fs.readFileSync(f, 'utf8'))) return true;
  }
  return false;
}
const read = (...f) => (exists(...f) ? readText(...f) : '');

const manual = {
  0: ['確認 BUILD_LOG.md 決策表無誤'],
  1: ['Vercel 預覽網址可在瀏覽器開啟'],
  2: ['抽查 3 個商品的規格與官網一致'],
  3: ['curl -I 正式/預覽網址的 /go/ 路徑：302、Location、X-Robots-Tag', '用開發者工具改 UA，確認提示條觸發', '確認「需實測」三項：query 是否附加、headers 是否出現、重新部署耗時'],
  4: ['依 docs/ui-spec.md 做視覺 QA：截圖（手機/桌機×淺色/深色）並與 design/home.html 比對，無橫向捲動', '3 次點擊內能得到推薦'],
  5: ['Rich Results Test 貼網址驗證', '依 docs/ui-spec.md 做視覺 QA，與 design/product.html 比對：桌機右側黏性到手價明細、手機底部 CTA、勝出格清楚', '360px 寬度規格表可橫滑、首欄固定'],
  6: ['頁尾與文章頁連得到揭露與隱私頁'],
  7: ['手機實機點 /go/ 能喚醒 App', '聯盟後台點擊報表有紀錄（可能延遲）', 'IG / LINE / Threads 內嵌瀏覽器流程'],
  8: ['Lighthouse 手機版（LCP<2.5s、CLS<0.1）'],
  9: ['HTTPS 正常，另一個網址（apex/www）會轉址'],
  10: ['手機實機（iOS/Android）完整走一遍', '逐一點過所有 /go/ 連結'],
  11: ['Search Console 已驗證並提交 sitemap', '每日重建排程成功跑過一次'],
  12: [],
  13: ['用該通路後台實際產生的連結確認 channels.json 的 hosts 與 requiredParams', '手機實際點 /go/ 連結，確認落到正確商品並可喚醒 App', '聯盟後台點擊報表有紀錄'],
  15: ['已向各聯盟確認官方資料介面與條款（無則維持 manual/feed）', '乾跑 node scripts/daily.mjs --dry 的 applied/rejected 合理', '金鑰只存在 Secrets 或本機環境變數'],
  16: ['至少審核並發布一篇指南', '已發布內容的事實主張都有來源'],
  14: ['逐一確認每個 offer 的平台連結可用', '內容覆核日期為近期，且沒有未經查證的價格或優惠宣稱'],
};

const checks = {
  0() {
    const r = createReport('Step 0 定位與決策');
    has('BUILD_LOG.md') ? r.ok('BUILD_LOG.md 存在') : r.error('缺 BUILD_LOG.md');
    const t = read('BUILD_LOG.md');
    /## 決策/.test(t) ? r.ok('有決策表') : r.error('BUILD_LOG.md 缺「## 決策」區塊');
    return r;
  },
  1() {
    const r = createReport('Step 1 專案初始化');
    has('package.json') ? r.ok('package.json 存在') : r.error('缺 package.json');
    if (has('package.json')) {
      const pk = readJson('package.json'); const deps = { ...pk.dependencies, ...pk.devDependencies };
      deps.astro ? r.ok('已安裝 astro') : r.error('package.json 沒有 astro');
      deps.tailwindcss || deps['@tailwindcss/vite'] ? r.ok('已安裝 Tailwind') : r.error('沒有 Tailwind（npx astro add tailwind）');
      deps['@astrojs/sitemap'] ? r.ok('已安裝 sitemap 整合') : r.error('沒有 @astrojs/sitemap（npx astro add sitemap）');
    }
    const cfg = ['astro.config.mjs', 'astro.config.ts'].find((f) => has(f));
    cfg ? (/site\s*:/.test(read(cfg)) ? r.ok('astro.config 已設定 site') : r.error('astro.config 沒有 site')) : r.error('缺 astro.config');
    has('.gitignore') ? r.ok('.gitignore 存在') : r.warn('缺 .gitignore');
    return r;
  },
  2() {
    const r = validateProducts();
    has('src', 'data', 'channels.json') ? r.ok('channels.json 存在') : r.error('缺 src/data/channels.json');
    has('src', 'lib', 'pricing.mjs') ? r.ok('src/lib/pricing.mjs 存在') : r.error('缺 src/lib/pricing.mjs（到手價與價格走勢共用函式）');
    has('src', 'data', 'price-history.json') ? r.ok('price-history.json 已開始累積') : r.warn('尚無 price-history.json：資料換成真實商品後立刻執行 node scripts/record-price.mjs，越早開始累積越有價值');
    return r;
  },
  3() {
    const r = createReport('Step 3 轉址 / Layout / 防掉單');
    if (has('src', 'data', 'products.json') && has('vercel.json')) {
      const cur = JSON.stringify(readJson('vercel.json'));
      const want = JSON.stringify(buildVercelConfig());
      cur === want ? r.ok('vercel.json 與 products.json 同步') : r.error('vercel.json 與 products.json 不同步（node scripts/gen-redirects.mjs）');
      const v = readJson('vercel.json');
      (v.redirects ?? []).every((x) => x.statusCode === 302 && x.source.startsWith('/go/')) ? r.ok('所有轉址皆為 302 且在 /go/ 下') : r.error('有轉址不是 302 或不在 /go/');
    } else r.error('缺 vercel.json 或 products.json');
    const robots = read('public', 'robots.txt');
    /Disallow:\s*\/go\//i.test(robots) ? r.ok('robots.txt 封鎖 /go/') : r.error('public/robots.txt 缺 Disallow: /go/');
    /Sitemap:/i.test(robots) ? r.ok('robots.txt 有 Sitemap') : r.warn('robots.txt 沒有 Sitemap 行');
    for (const f of ['src/layouts/Layout.astro', 'src/components/InAppWarning.astro']) {
      has(...f.split('/')) ? r.ok(`${f} 存在`) : r.error(`缺 ${f}`);
    }
    const lay = read('src', 'layouts', 'Layout.astro');
    /zh-Hant-TW/.test(lay) ? r.ok('Layout 設 lang=zh-Hant-TW') : r.error('Layout 缺 lang="zh-Hant-TW"');
    /canonical/.test(lay) ? r.ok('Layout 有 canonical') : r.error('Layout 缺 canonical');
    /InAppWarning/.test(lay) ? r.ok('Layout 已掛載 InAppWarning') : r.error('Layout 沒有引入 InAppWarning');
    /分潤/.test(lay) ? r.ok('Layout 頁尾有分潤揭露') : r.error('Layout 頁尾缺分潤揭露');
    const acfg = ['astro.config.mjs', 'astro.config.ts'].find((f) => has(f));
    acfg && /validate-data/.test(read(acfg)) ? r.ok('astro.config 已註冊 validate-data integration（建置前驗證資料與 vercel.json 同步）') : r.error('astro.config 沒有註冊 integrations/validate-data.mjs');
    has('integrations', 'validate-data.mjs') ? r.ok('integrations/validate-data.mjs 存在') : r.error('缺 integrations/validate-data.mjs');
    has('src', 'lib', 'track.js') ? r.ok('src/lib/track.js 存在') : r.error('缺 src/lib/track.js');
    /initTrack/.test(lay) ? r.ok('Layout 已啟用 initTrack') : r.error('Layout 沒有呼叫 initTrack（點擊追蹤）');
    const w = read('src', 'components', 'InAppWarning.astro');
    /Line\/|Instagram|FBAN/.test(w) ? r.ok('InAppWarning 有 UA 偵測規則') : r.error('InAppWarning 缺 UA 偵測規則');
    return r;
  },
  4() {
    const r = createReport('Step 4 首頁、SmartFinder 與個人化層');
    for (const f of ['src/pages/index.astro', 'src/components/SmartFinder.astro']) has(...f.split('/')) ? r.ok(`${f} 存在`) : r.error(`缺 ${f}`);
    srcContains(/--paper|--accent|#1f4fd8|#eef2f0/i) ? r.ok('已套用設計 token（design/tokens.css）') : r.error('src 內找不到設計 token：請依 docs/ui-spec.md 把 design/tokens.css 帶入全域樣式與 Tailwind 主題');
    has('docs', 'ui-spec.md') && has('design', 'home.html') ? r.ok('設計參考稿與 UI 規範存在') : r.warn('缺 docs/ui-spec.md 或 design/ 參考稿');
    const sf = read('src', 'components', 'SmartFinder.astro');
    /aria-live/.test(sf) ? r.ok('SmartFinder 結果區有 aria-live') : r.warn('SmartFinder 缺 aria-live');
    /\/go\//.test(sf) ? r.ok('SmartFinder CTA 使用 /go/') : r.error('SmartFinder CTA 沒有使用 /go/');
    /sponsored/.test(sf) ? r.ok('CTA 有 rel sponsored') : r.error('SmartFinder CTA 缺 rel="sponsored nofollow noopener"');
    // 個人化層（docs/personalization-spec.md）
    for (const f of ['src/lib/profile.js', 'src/lib/rank.js', 'src/components/QuizDialog.astro', 'src/components/SmartSearch.astro', 'src/components/IntentDrawer.astro'])
      has(...f.split('/')) ? r.ok(`${f} 存在`) : r.error(`缺 ${f}（個人化層，見 docs/personalization-spec.md）`);
    const pf = read('src', 'lib', 'profile.js'), rk = read('src', 'lib', 'rank.js'), tt = read('src', 'components', 'IntentDrawer.astro');
    /localStorage/.test(pf) && /try\s*\{/.test(pf) ? r.ok('Profile 使用 localStorage 且有 try/catch 容錯') : r.error('profile.js 需用 localStorage 並以 try/catch 包住讀寫');
    /subscribe/.test(pf) ? r.ok('Profile 有 subscribe（跨模組串聯）') : r.error('profile.js 缺 subscribe');
    /寵物|pet/i.test(rk) && /parseQuery/.test(rk) ? r.ok('rank.js 有語意解析與寵物權重') : r.error('rank.js 缺 parseQuery 或寵物意圖');
    /IntersectionObserver/.test(tt) && /data-intent-zone/.test(tt + read('src', 'pages', '[category]', '[slug].astro')) ? r.ok('抽屜以 IntersectionObserver 偵測缺點區／規格區') : r.error('IntentDrawer 需用 IntersectionObserver 偵測 data-intent-zone（缺點區、規格區）');
    /5000/.test(tt) && /0\.5\b/.test(tt) ? r.ok('抽屜門檻：累計 5 秒、區塊 ≥50% 可見') : r.error('IntentDrawer 找不到 5000ms 與 0.5 可見比例門檻（集中放設定物件）');
    /compareChannels/.test(tt) ? r.ok('雙通路副標使用 compareChannels') : r.error('IntentDrawer 的「標價較低／較快到貨」必須由 pricing.mjs 的 compareChannels 決定');
    /sessionStorage/.test(tt) ? r.ok('抽屜每商品每工作階段一次（sessionStorage）') : r.error('IntentDrawer 缺 sessionStorage 防打擾');
    /role=["']status["']/.test(tt) ? r.ok('抽屜有 role="status"') : r.error('抽屜缺 role="status"');
    /prefers-reduced-motion/.test(tt + read('src', 'styles', 'global.css')) || srcContains(/prefers-reduced-motion/) ? r.ok('有 prefers-reduced-motion 處理') : r.warn('找不到 prefers-reduced-motion');
    /歷史最低|最低價/.test(tt) && !/isLowest|lowest|priceStats|低點/.test(tt) ? r.error('抽屜提到最低價但沒有依價格紀錄判斷（資料不足時不得說最低價）') : r.ok('抽屜價格說法有資料判斷');
    /倒數|剩\s*\d+\s*(件|台)|人正在看|明天到貨|明日到貨/.test(tt) ? r.error('抽屜出現假倒數／假庫存／在看人數字樣') : r.ok('抽屜沒有假催促字樣');
    const idx = read('src', 'pages', 'index.astro');
    /products\.json/.test(idx) ? r.ok('index 於建置期讀取 products.json') : r.warn('index.astro 沒有讀取 products.json');
    /fetch\(/.test(idx + sf) ? r.error('偵測到 client fetch，資料應在建置期注入') : r.ok('沒有 client fetch');
    return r;
  },
  5() {
    const r = createReport('Step 5 pSEO 母版');
    const f = ['src', 'pages', '[category]', '[slug].astro'];
    if (!has(...f)) { r.error('缺 src/pages/[category]/[slug].astro'); return r; }
    const t = read(...f);
    /getStaticPaths/.test(t) ? r.ok('使用 getStaticPaths') : r.error('缺 getStaticPaths');
    ['BreadcrumbList', 'Product', 'FAQPage'].forEach((k) => (t.includes(k) ? r.ok(`含 ${k}`) : r.error(`缺 JSON-LD ${k}`)));
    /aggregateRating|"review"/.test(t) ? r.error('母版出現 aggregateRating/review') : r.ok('沒有捏造評價欄位');
    /sticky/.test(t) && /left-0/.test(t) ? r.ok('規格表有凍結首欄') : r.error('規格表缺 sticky left-0（凍結首欄）');
    /overflow-x-auto/.test(t) ? r.ok('規格表可橫滑') : r.error('規格表缺 overflow-x-auto');
    /throw new Error/.test(t) ? r.ok('建置期有資料驗證') : r.warn('母版沒有 throw new Error 的建置期驗證');
    for (const [c, label] of [['StickyCta', '手機固定底部 CTA 列'], ['PriceHistory', '價格走勢'], ['TotalCost', '總成本/到手價拆解']]) {
      has('src', 'components', `${c}.astro`) ? r.ok(`${c}.astro 存在（${label}）`) : r.error(`缺 src/components/${c}.astro（${label}）`);
    }
    /priceBreakdown/.test(t + read('src', 'components', 'TotalCost.astro')) ? r.ok('使用 pricing.mjs 計算到手價') : r.error('到手價沒有使用 src/lib/pricing.mjs 的 priceBreakdown');
    /notFor/.test(t) ? r.ok('顯示 notFor（不適合你的情況）') : r.error('母版缺 notFor 區塊');
    /policy/.test(t + read('src', 'components', 'TotalCost.astro')) ? r.ok('顯示保固/退貨 policy') : r.error('缺保固/退貨 policy 區塊');
    /data-track/.test(t) ? r.ok('CTA 帶 data-track') : r.error('商品頁 CTA 缺 data-track 屬性');
    if (has('src', 'data', 'intents.json')) {
      const n = JSON.parse(read('src', 'data', 'intents.json')).intents ?? [];
      const prods = JSON.parse(read('src', 'data', 'products.json')).products;
      const build = buildableIntents(prods, n, { minProducts: loadConfig().minIntentProducts ?? 2 });
      if (build.length) {
        has('src', 'pages', '[category]', 'for', '[intent].astro') ? r.ok('情境頁 [category]/for/[intent].astro 存在') : r.error(`有 ${build.length} 個情境頁要產生，但缺 src/pages/[category]/for/[intent].astro`);
        /buildableIntents/.test(read('src', 'pages', '[category]', 'for', '[intent].astro')) ? r.ok('情境頁使用 buildableIntents') : r.error('情境頁必須使用 src/lib/intents.mjs 的 buildableIntents（與驗證器同一規則）');
      } else r.warn('intents.json 目前沒有可產生的情境頁（商品數不足或導言未審核）');
    }
    if (has('dist')) return merge(r, auditDist());
    r.warn('尚無 dist/，請 npm run build 後再跑一次以做建置稽核');
    return r;
  },
  6() {
    const r = createReport('Step 6 必備頁面');
    const pages = [['關於本站', ['about']], ['分潤揭露', ['disclosure', 'affiliate-disclosure']], ['隱私權政策', ['privacy']], ['404', ['404']]];
    for (const [name, slugs] of pages) {
      const ok = slugs.some((s) => has('src', 'pages', `${s}.astro`) || has('src', 'pages', `${s}.md`) || has('src', 'pages', s, 'index.astro'));
      ok ? r.ok(`${name}頁存在`) : r.error(`缺${name}頁（src/pages/${slugs[0]}.astro）`);
    }
    return r;
  },
  7() {
    const r = validateProducts();
    const v = has('vercel.json') ? readJson('vercel.json') : { redirects: [] };
    const ph = (v.redirects ?? []).filter((x) => /example\.(com|org)|localhost/.test(x.destination));
    ph.length ? r.error(`仍有 ${ph.length} 條佔位轉址`) : r.ok('沒有佔位轉址');
    const unconfirmed = loadChannels().filter((c) => c.enabled && !c.confirmed);
    unconfirmed.length ? r.error(`通路尚未 confirmed：${unconfirmed.map((c) => c.id).join(', ')}（對照聯盟後台實際連結確認 hosts 與 requiredParams 後改 confirmed: true）`) : r.ok('已啟用通路皆 confirmed');
    return r;
  },
  8() { return has('dist') ? auditDist() : fail('Step 8 SEO', '尚無 dist/，請先 npm run build'); },
  9() {
    const r = createReport('Step 9 網域');
    const cfg = ['astro.config.mjs', 'astro.config.ts'].find((f) => has(f));
    const m = cfg && read(cfg).match(/site\s*:\s*['"]([^'"]+)['"]/);
    if (!m) r.error('astro.config 沒有 site');
    else /vercel\.app|localhost/.test(m[1]) ? r.error(`site 還是預覽網址 ${m[1]}，請換成正式網域`) : r.ok(`site = ${m[1]}`);
    return r;
  },
  10() {
    const r = validateProducts({ strict: true });
    merge(r, has('dist') ? auditDist({ strict: true }) : fail('建置稽核', '尚無 dist/，請先 npm run build'));
    const log = read('BUILD_LOG.md');
    /\[ \]\s*Step\s*(?:[0-9]|10)\b/.test(log.replace(/Step 10[^\n]*/g, '')) && r.warn('BUILD_LOG.md 仍有 Step 0–9 未勾選');
    return r;
  },
  11() {
    const r = createReport('Step 11 維運');
    const wf = ['.github/workflows/rebuild.yml', '.github/workflows/daily-rebuild.yml'].find((f) => has(...f.split('/')));
    wf ? r.ok(`每日重建 workflow：${wf}`) : r.warn('找不到每日重建 workflow（.github/workflows/rebuild.yml）');
    for (const w of ['ci.yml', 'daily.yml', 'weekly.yml']) has('.github', 'workflows', w) ? r.ok(`${w} 存在`) : r.warn(`缺 .github/workflows/${w}（templates/ 內有範本）`);
    has('.github', 'workflows', 'link-check.yml') ? r.ok('每日連結健康檢查 workflow 存在') : r.warn('找不到 .github/workflows/link-check.yml（templates/ 內有範本）');
    return r;
  },
  15() {
    const r = createReport('Step 15 自動化資料來源');
    const prov = loadConfig().provider ?? 'manual';
    prov === 'manual' ? r.warn('provider 仍是 manual（未啟用自動取得價格；若尚未確認官方資料介面，維持 manual 也可以）') : r.ok(`provider = ${prov}`);
    has('scripts', 'providers', `${prov}.mjs`) ? r.ok(`providers/${prov}.mjs 存在`) : r.error(`找不到 scripts/providers/${prov}.mjs`);
    if (prov === 'coupang') {
      const cc = loadConfig().providers?.coupang ?? {};
      cc.urlTemplate && cc.urlTemplate.includes('{id}') && cc.pricePath ? r.ok('providers.coupang 已設定 urlTemplate 與 pricePath') : r.error('providers.coupang 需設定含 {id} 的 urlTemplate 與 pricePath（依官方 API 文件）');
      const ps = JSON.parse(read('src', 'data', 'products.json')).products.filter((x) => !x.demo && x.affiliate?.coupang);
      const miss = ps.filter((x) => !x.channelIds?.coupang).map((x) => x.modelCode);
      miss.length ? r.warn(`有酷澎連結但沒填 channelIds.coupang 的商品（不會被自動更新）：${miss.join('、')}`) : r.ok('酷澎商品都有 channelIds.coupang');
      has('.github', 'workflows', 'daily.yml') && /COUPANG_API_TOKEN/.test(read('.github', 'workflows', 'daily.yml')) ? r.ok('daily.yml 已預留 COUPANG_API_TOKEN secret') : r.warn('daily.yml 沒有 COUPANG_API_TOKEN（請從 templates 複製最新版）');
    }
    (loadConfig().maxPriceChangePct ?? 0) > 0 ? r.ok('已設定價格異常保護 maxPriceChangePct') : r.error('缺 maxPriceChangePct');
    if (has('scripts', 'daily.mjs')) {
      const out = spawnSync(process.execPath, [p('scripts', 'daily.mjs'), '--dry'], { encoding: 'utf8' });
      out.status === 0 ? r.ok('daily.mjs --dry 乾跑成功') : r.error('daily.mjs --dry 失敗：' + (out.stderr || out.stdout).slice(0, 200));
    }
    return r;
  },
  16() {
    const r = createReport('Step 16 內容與社群半自動');
    srcContains(/defineCollection|glob\(/) ? r.ok('已定義內容集合') : r.error('找不到內容集合定義（src/content.config.ts 或等效檔，依當前 Astro 版本）');
    has('src', 'pages', 'guides', '[slug].astro') ? r.ok('guides/[slug].astro 存在') : r.error('缺 src/pages/guides/[slug].astro');
    has('.claude', 'commands', 'draft-guide.md') && has('.claude', 'commands', 'social-drafts.md') ? r.ok('起草指令存在') : r.error('缺 .claude/commands/draft-guide.md 或 social-drafts.md');
    const dir = p('src', 'content', 'guides');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => /\.mdx?$/.test(x))) {
      const t = fs.readFileSync(dir + '/' + f, 'utf8');
      /^sources:/m.test(t) ? 0 : r.error(`${f}: 缺 sources`);
      /^author:/m.test(t) ? 0 : r.error(`${f}: 缺 author`);
      /^draft:\s*true/m.test(t) ? r.warn(`${f}: 仍是草稿（需你審核後才發布）`) : r.ok(`${f}: 已發布且有來源與作者`);
    }
    return r;
  },
  12() { const r = createReport('Step 12 成長'); r.ok('選配步驟，無自動檢查'); return r; },
  13() {
    const r = createReport('Step 13 新通路上線');
    const links = new Set();
    if (has('src', 'data', 'products.json')) for (const x of readJson('src', 'data', 'products.json').products) Object.keys(x.affiliate ?? {}).forEach((c) => links.add(c));
    if (has('src', 'data', 'travel.json')) for (const g of readJson('src', 'data', 'travel.json').guides ?? []) for (const o of g.offers ?? []) links.add(o.channel);
    const en = loadChannels().filter((c) => c.enabled);
    if (en.length < 2) r.warn('目前只啟用 1 個通路；本步驟的目的是啟用第二個以上通路');
    for (const c of en) {
      c.confirmed ? r.ok(`${c.id} 已 confirmed`) : r.error(`${c.id} 尚未 confirmed`);
      c.requiredParams?.length ? r.ok(`${c.id} 已設定 requiredParams`) : r.warn(`${c.id} 未設定 requiredParams`);
      links.has(c.id) ? r.ok(`${c.id} 已有商品/offer 使用`) : r.error(`${c.id} 已啟用但沒有任何連結使用`);
    }
    return merge(r, validateProducts());
  },
  14() {
    const r = createReport('Step 14 旅遊模組');
    has('src', 'data', 'travel.json') ? r.ok('travel.json 存在') : r.error('缺 src/data/travel.json');
    for (const f of ['src/pages/travel/index.astro', 'src/pages/travel/[slug].astro']) has(...f.split('/')) ? r.ok(`${f} 存在`) : r.error(`缺 ${f}`);
    const t = read('src', 'pages', 'travel', '[slug].astro');
    /BreadcrumbList/.test(t) ? r.ok('旅遊頁含 BreadcrumbList') : r.error('旅遊頁缺 BreadcrumbList');
    /"@type":\s*"Product"|'Product'/.test(t) ? r.error('旅遊頁不應輸出 Product 結構化資料') : r.ok('旅遊頁沒有 Product 結構化資料');
    /價格以平台頁面為準/.test(t) ? r.ok('有「價格以平台頁面為準」聲明') : r.error('旅遊頁缺「價格以平台頁面為準」聲明');
    return merge(r, validateProducts());
  },
};

function fail(title, msg) { const r = createReport(title); r.error(msg); return r; }
function merge(a, b) { return a.absorb(b); }

const arg = process.argv[2];
const steps = arg === 'all' ? [...Array(17).keys()] : [Number(arg)];
if (arg === undefined || steps.some((s) => !(s in checks))) { console.error('用法：node scripts/verify.mjs <0-16|all>'); process.exit(2); }
let bad = 0;
for (const s of steps) {
  const r = checks[s]();
  bad += r.print();
  if (arg !== 'all' && manual[s]?.length) { console.log('\n人工驗收（請使用者確認）：'); manual[s].forEach((m) => console.log('  ☐ ' + m)); }
}
process.exit(bad ? 1 : 0);
