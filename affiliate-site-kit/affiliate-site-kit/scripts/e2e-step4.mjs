#!/usr/bin/env node
// Step 4 瀏覽器實測（需 playwright 與 chromium；先 npm run build && npx astro preview --port 4321）。
// 用法：node scripts/e2e-step4.mjs [網址，預設 http://localhost:4321]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:4321';
const browser = await chromium.launch();
let n = 0;
const ok = (m) => { n++; console.log('✓', m); };

async function fresh(viewport = { width: 390, height: 844 }, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}

// 1) 問卷：自動跳出一次 → 作答 → 重新整理仍記得
{
  const { ctx, page, errors } = await fresh();
  await page.goto(base);
  await page.waitForSelector('#quiz-dialog[open]', { timeout: 3000 });
  ok('第一次來會自動跳出問卷');
  await page.click('[data-pick="0"]'); // 有貓
  await page.click('[data-pick="0"]'); // 有小孩
  await page.click('[data-pick="1"]'); // 空間大
  await page.waitForSelector('#quiz-dialog:not([open])', { state: 'attached' });
  const bar = await page.textContent('#profilebar');
  assert.match(bar, /有貓/); assert.match(bar, /有小孩/); assert.match(bar, /空間偏大/);
  ok('問卷完成後畫像列顯示：有貓／有小孩／空間偏大');
  await page.reload();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#quiz-dialog[open]').count(), 0);
  assert.match(await page.textContent('#profilebar'), /有貓/);
  ok('重新整理仍記得，且不再自動跳問卷');
  assert.match(await page.textContent('#search-list li:first-child'), /寵物友善|符合有貓/);
  ok('有貓畫像：不輸入任何字，寵物友善款已排第一');
  await page.click('[data-clear-profile]');
  assert.doesNotMatch(await page.textContent('#profilebar'), /有貓/);
  ok('清除資料後回到預設');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// 2) 搜尋與跳過
{
  const { ctx, page, errors } = await fresh();
  await page.goto(base);
  await page.waitForSelector('#quiz-dialog[open]');
  await page.click('[data-skip]');
  await page.reload(); await page.waitForTimeout(1000);
  assert.equal(await page.locator('#quiz-dialog[open]').count(), 0);
  ok('「先跳過」後不再自動打擾');

  await page.fill('#search-q', '除濕機 貓');
  const parsed = await page.textContent('#search-parsed');
  assert.match(parsed, /除濕機/); assert.match(parsed, /有貓/); assert.match(parsed, /記住「有貓」/);
  assert.match(await page.textContent('#search-list li:first-child'), /示範除濕機 C/);
  ok('搜「除濕機 貓」：我的理解正確、寵物友善款排第一、提供「記住」而不擅自寫入');
  assert.doesNotMatch(await page.textContent('#profilebar'), /有貓/);
  await page.fill('#search-q', '毛小孩');
  const p2 = await page.textContent('#search-parsed');
  assert.match(p2, /寵物/); assert.doesNotMatch(p2, /有小孩/);
  ok('「毛小孩」不會被當成有小孩');

  // 自適應篩選：沒有商品的品類不出現；點了不會是空的
  await page.fill('#search-q', '');
  const filters = await page.textContent('#search-filters');
  assert.match(filters, /除濕機/); assert.match(filters, /洗衣機/);
  assert.doesNotMatch(filters, /熱水器|冷氣|掃地機/);
  ok('篩選選項只有真的有商品的品類');
  for (const b of await page.locator('[data-tag]').all()) {
    await b.click();
    assert.ok((await page.locator('#search-list li .name').count()) > 0, '篩選後不應為空');
    await page.locator('[data-tag].on').first().click();
  }
  ok('每個標籤篩選都不會出現空結果');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// 3) SmartFinder：每個品類 3 次點擊內出結果，且無外部請求
{
  const { ctx, page, errors } = await fresh();
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(base);
  await page.click('[data-skip]');
  for (const cat of await page.locator('#finder-cats button').all()) {
    await cat.click();
    let clicks = 0;
    while (!(await page.locator('#finder-body .result').count())) {
      await page.locator('#finder-body [data-opt]').first().click();
      clicks++;
      assert.ok(clicks <= 3, '超過 3 次點擊');
    }
    const href = await page.getAttribute('#finder-body .result a.btn', 'href');
    const rel = await page.getAttribute('#finder-body .result a.btn', 'rel');
    assert.match(href, /^\/go\/(shopee|coupang)-/); assert.match(rel, /sponsored nofollow noopener/);
    assert.match(await page.textContent('#finder-body .result'), /注意：/);
    ok(`精靈「${await cat.textContent()}」：${clicks} 次點擊出結果，CTA 走 /go/ 且帶 rel`);
  }
  assert.deepEqual(external, []);
  ok('沒有任何外部請求');
  const html = await page.content();
  assert.doesNotMatch(html, /shopee\.tw|coupang\.com/);
  ok('HTML 內沒有賣場網址');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// 4) 版面：手機 / 桌機 × 淺 / 深 沒有橫向捲動
for (const [name, vp] of [['手機', { width: 390, height: 844 }], ['桌機', { width: 1280, height: 900 }]]) {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await fresh(vp, scheme);
    await page.goto(base);
    await page.click('[data-skip]');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${name}/${scheme} 橫向溢出 ${over}px`);
    await ctx.close();
  }
}
ok('手機 390px／桌機 1280px × 淺色／深色：無橫向捲動');

// 5) IntentDrawer：用測試頁驗證 5 秒 / 50% 門檻（商品頁在 Step 5 才有，這裡用 Astro 產生的元件掛在暫時頁面不可行，
//    因此改為對 dist 內的元件腳本行為做獨立測試：見 scripts/e2e-drawer.mjs）
await browser.close();
console.log(`\n-- ${n} 項通過`);
