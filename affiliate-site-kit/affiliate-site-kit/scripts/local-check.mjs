#!/usr/bin/env node
// 本機一鍵完整檢查：在還沒部署、沒有聯盟帳號之前，確認網站在你電腦上一切正常。
// 用法：npm run local:check        （= node scripts/local-check.mjs）
//       node scripts/local-check.mjs --skip-build   沿用現有 dist/，不重新建置
// 流程：資料驗證 → 轉址設定同步 → 建置 → 步驟閘門 0–8 → 本機伺服器（照 vercel.json）→
//       全站頁面 200、/go/ 302 + noindex、404 頁 → 連結健康檢查（線上模式打本機）→ 瀏覽器實測（有 playwright 才跑）
// Step 7 依 BUILD_LOG 決策「模擬跳過」：照跑，但結果不計入通過與否。
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { p, exists, readText, readJson } from './lib.mjs';
import { createServer } from './serve-local.mjs';

const skipBuild = process.argv.includes('--skip-build');
const results = []; // { name, status: 'pass'|'fail'|'skip'|'info', note }
const add = (name, status, note = '') => { results.push({ name, status, note }); console.log(`${{ pass: '✓', fail: '✗', skip: '－', info: '△' }[status]} ${name}${note ? `：${note}` : ''}`); };
const node = (args) => spawnSync(process.execPath, args, { cwd: p(), encoding: 'utf8', env: process.env });
const lastLine = (s) => (s || '').trim().split('\n').filter((l) => l.startsWith('-- ')).at(-1)?.replace(/^-- /, '') ?? '';

console.log('== 本機完整檢查 ==\n');

// 1. 資料與轉址設定
let r = node(['scripts/validate-products.mjs']);
add('資料驗證', r.status === 0 ? 'pass' : 'fail', lastLine(r.stdout));
r = node(['scripts/gen-redirects.mjs', '--check']);
add('vercel.json 與資料同步', r.status === 0 ? 'pass' : 'fail', r.status === 0 ? '' : '請執行 npm run sync');

// 2. 建置
if (skipBuild) add('建置', 'skip', '沿用現有 dist/');
else {
  console.log('\n建置中（npm run build）…');
  const b = spawnSync('npm', ['run', 'build'], { cwd: p(), encoding: 'utf8', shell: true, env: process.env });
  if (b.status !== 0) {
    add('建置', 'fail', (b.stderr || b.stdout).trim().split('\n').slice(-8).join(' | '));
    finish();
  }
  add('建置', 'pass');
}
if (!exists('dist')) { add('dist/', 'fail', '找不到 dist/'); finish(); }

// 3. 步驟閘門
const skipped = /Step 7[^\n]*模擬跳過/.test(exists('BUILD_LOG.md') ? readText('BUILD_LOG.md') : '');
for (let n = 0; n <= 8; n++) {
  const v = node(['scripts/verify.mjs', String(n)]);
  const note = lastLine(v.stdout);
  if (n === 7 && skipped) add(`Step ${n} 閘門`, 'info', `模擬跳過，不計入（${note}）`);
  else add(`Step ${n} 閘門`, v.status === 0 ? 'pass' : 'fail', note);
}

// 4. 本機伺服器（正式模式：/go/ 302 到 vercel.json 的目的地）
const server = createServer({ sim: false });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const get = (u) => fetch(base + u, { redirect: 'manual' }).then(async (res) => { await res.arrayBuffer(); return res; });

// 4a. sitemap 內每一頁 + 不在 sitemap 的 noindex 頁都要 200
const pages = new Set(['/']);
for (const f of ['sitemap-0.xml', 'sitemap.xml']) if (exists('dist', f)) for (const m of readText('dist', f).matchAll(/<loc>([^<]+)<\/loc>/g)) pages.add(new URL(m[1]).pathname);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = d + '/' + e.name; e.isDirectory() ? walk(f, out) : out.push(f); } return out; };
for (const f of walk(p('dist'))) if (f.endsWith('/index.html')) pages.add(f.slice(p('dist').length).replace(/\\/g, '/').replace(/index\.html$/, ''));
let bad = [];
for (const u of pages) { const res = await get(u); if (res.status !== 200) bad.push(`${u} → ${res.status}`); }
add(`全站頁面可開啟（${pages.size} 頁）`, bad.length ? 'fail' : 'pass', bad.join('、'));

// 4b. /go/ 轉址
const vercel = readJson('vercel.json');
bad = [];
for (const rd of vercel.redirects ?? []) {
  const res = await get(rd.source);
  if (res.status !== 302) bad.push(`${rd.source} → ${res.status}`);
  else if (res.headers.get('location') !== rd.destination) bad.push(`${rd.source} Location 不符`);
  else if (!/noindex/i.test(res.headers.get('x-robots-tag') ?? '')) bad.push(`${rd.source} 缺 X-Robots-Tag`);
}
add(`/go/ 轉址 302 + noindex（${(vercel.redirects ?? []).length} 條）`, bad.length ? 'fail' : 'pass', bad.join('、'));

// 4c. 404
const nf = await get('/this-page-does-not-exist/');
add('不存在的網址回 404 頁', nf.status === 404 ? 'pass' : 'fail', `狀態 ${nf.status}`);

// 5. 連結健康檢查（線上模式打本機；只看本站的 302 與 header，不連到賣場）
const lc = await new Promise((ok) => {
  const c = spawn(process.execPath, ['scripts/check-links.mjs', '--base', base], { cwd: p(), env: process.env });
  let out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
  c.on('close', (code) => ok({ code, out }));
});
add('連結健康檢查（本機）', lc.code === 0 ? 'pass' : 'fail', lastLine(lc.out));

// 6. 瀏覽器實測（有安裝 playwright 才跑）
let pw;
try { pw = createRequire(import.meta.url)('playwright'); } catch { pw = null; }
if (!pw) add('瀏覽器實測', 'skip', '沒有安裝 playwright（npm i -D playwright && npx playwright install chromium）');
else {
  try {
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await page.goto(base + '/');
    const quiz = await page.waitForSelector('dialog[open]', { timeout: 3000 }).then(() => true).catch(() => false);
    if (quiz) for (const i of [0, 0, 1]) await page.click(`[data-pick="${i}"]`);
    await page.fill('#search-q', '除濕機 貓').catch(() => {});
    await page.waitForTimeout(200);
    const results = await page.$$eval('#search-list li', (e) => e.length).catch(() => 0);
    const prod = (readJson('src', 'data', 'products.json').products ?? [])[0];
    let drawer = false;
    if (prod) {
      await page.goto(`${base}/${prod.category}/${prod.slug}/`);
      await page.evaluate(() => document.querySelector('[data-intent-zone="flaw"]')?.scrollIntoView({ block: 'center' }));
      drawer = await page.waitForSelector('#intent-drawer[data-show="true"]', { timeout: 8000 }).then(() => true).catch(() => false);
    }
    await browser.close();
    const ok = quiz && results > 0 && drawer && !errs.length;
    add('瀏覽器實測（問卷、搜尋、購買抽屜）', ok ? 'pass' : 'fail',
      [quiz ? '' : '問卷沒出現', results ? '' : '搜尋沒有結果', drawer ? '' : '抽屜 8 秒內沒出現', errs.length ? `頁面錯誤：${errs.slice(0, 2).join('；')}` : ''].filter(Boolean).join('、'));
  } catch (e) {
    add('瀏覽器實測', 'fail', e.message.split('\n')[0]);
  }
}
server.close();
finish();

function finish() {
  const fail = results.filter((x) => x.status === 'fail').length;
  console.log(`\n== 結果：${results.filter((x) => x.status === 'pass').length} 通過、${fail} 失敗、${results.filter((x) => x.status === 'skip').length} 略過 ==`);
  fs.mkdirSync(p('reports'), { recursive: true });
  const f = p('reports', 'local-check.json');
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(fail ? '有失敗項目：把上面 ✗ 的訊息交給 Claude Code 修。' : '本機一切正常。npm run local 可以在瀏覽器裡實際操作。');
  console.log('報告：' + f);
  process.exit(fail ? 1 : 0);
}
