#!/usr/bin/env node
// Step 5 瀏覽器實測（需 playwright；先 npm run build && npx astro preview --port 4321）。
// 用法：node scripts/e2e-step5.mjs [網址，預設 http://localhost:4321]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:4321';
const page_ = '/dehumidifier/demo-dehumidifier-a/';
const browser = await chromium.launch();
let n = 0;
const ok = (m) => { n++; console.log('✓', m); };
const open = async (vp, scheme = 'light') => {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
};

// 桌機：右側明細欄黏性、手機底部列隱藏
{
  const { ctx, page, errors } = await open({ width: 1280, height: 900 });
  await page.goto(base + page_);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.aside')).position), 'sticky');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#sticky-cta')).display), 'none');
  const y0 = (await page.locator('.aside').boundingBox()).y;
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(200);
  const box = await page.locator('.aside').boundingBox();
  assert.ok(box.y >= 0 && box.y < 40, `捲動後明細欄應黏在上方，y=${box.y}`);
  ok('桌機：右側到手價明細欄黏性、底部購買列不顯示');
  const a = await page.locator('.aside').boundingBox(), m = await page.locator('.c-tldr').boundingBox();
  assert.ok(a.x > m.x + m.width - 1, '明細欄在右側');
  const rc = await page.textContent('.receipt');
  assert.match(rc, /標價\s*\$12,900/); assert.match(rc, /現折\s*−\$500/); assert.match(rc, /退稅／補助\s*−\$1,200/); assert.match(rc, /到手價\s*\$11,200/);
  ok('到手價算式正確：12,900 − 500 − 1,200 = 11,200');
  assert.match(rc, /蝦皮看最新價格/); assert.match(rc, /酷澎標價 \$13,200，比蝦皮高 \$300/);
  ok('多通路：誠實標出酷澎較高、價差 $300');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// 手機：底部列顯示、明細 CTA 進入視窗時讓位
{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.goto(base + page_);
  // 到手價明細緊接在 TL;DR 後，其 CTA 在第一屏內，所以底部列一開始就讓位
  assert.equal(await page.getAttribute('#sticky-cta', 'data-hidden'), 'true');
  ok('手機：明細 CTA 在視窗內時，底部列讓位（避免重複）');
  await page.evaluate(() => document.querySelector('#h-spec').scrollIntoView());
  await page.waitForTimeout(400);
  assert.equal(await page.getAttribute('#sticky-cta', 'data-hidden'), 'false');
  assert.ok(await page.locator('#sticky-cta').isVisible());
  ok('手機：捲過明細後，底部固定購買列出現');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  assert.equal(await page.getAttribute('#sticky-cta', 'data-hidden'), 'false');
  const foot = await page.locator('.site-foot').boundingBox(), bar = await page.locator('#sticky-cta').boundingBox();
  assert.ok(foot.y + foot.height <= bar.y + bar.height + 1);
  ok('手機：捲到底底部列回來，頁尾不被遮住');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// 360px：無橫向溢出、表格可橫滑、首欄固定、勝出格有文字標記
{
  const { ctx, page } = await open({ width: 360, height: 800 });
  await page.goto(base + page_);
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  ok('360px：頁面無橫向捲動');
  const w = await page.evaluate(() => { const e = document.querySelector('.tablewrap'); return [e.scrollWidth, e.clientWidth]; });
  assert.ok(w[0] > w[1], '表格應可橫滑');
  await page.evaluate(() => (document.querySelector('.tablewrap').scrollLeft = 200));
  const th = await page.locator('tbody th').first().boundingBox(), wrap = await page.locator('.tablewrap').boundingBox();
  assert.ok(Math.abs(th.x - wrap.x) < 4, `首欄應固定在左側 (th.x=${th.x}, wrap.x=${wrap.x})`);
  ok('360px：規格表可橫滑，首欄固定');
  const winTxt = await page.evaluate(() => getComputedStyle(document.querySelector('td.win'), '::after').content);
  assert.match(winTxt, /勝出/);
  assert.equal(await page.locator('td.win').count(), 4); // 日除濕量、噪音、水箱、到手價（A 贏三項、B 贏價格）… 見下
  await ctx.close();
}

// 深色模式與內容完整性
{
  const { ctx, page } = await open({ width: 390, height: 844 }, 'dark');
  await page.goto(base + page_);
  const t = await page.textContent('main');
  for (const s of ['要先知道的缺點', '示範缺點：水箱取出時偏重', '不適合你的情況', '示範：坪數超過 20 坪的空間', '買之前確認', '運費', '免費', '示範：舊機回收', '示範：官方保固一年', '價格資料累積中', '如果只能選一台', '示範除濕機 B', '常見問題', '示範資料'])
    assert.ok(t.includes(s), `頁面缺少：${s}`);
  ok('頁面包含：缺點、不適合、額外費用、保固退貨、走勢（資料累積中）、替代款、FAQ');
  assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex, nofollow');
  ok('示範資料頁帶 noindex');
  const ld = await page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => JSON.parse(e.textContent)));
  const types = ld.map((j) => j['@type']);
  assert.deepEqual(types.sort(), ['BreadcrumbList', 'FAQPage', 'Product']);
  assert.ok(!JSON.stringify(ld).match(/aggregateRating|review/));
  ok('JSON-LD：BreadcrumbList / Product / FAQPage，沒有評分欄位');
  await ctx.close();
}

// 購買意圖抽屜：真實商品頁上缺點區累計 5 秒出現
{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.goto(base + page_);
  await page.waitForTimeout(1500);
  assert.equal(await page.getAttribute('#intent-drawer', 'data-show'), 'false');
  await page.evaluate(() => document.querySelector('[data-intent-zone=flaw]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(5800);
  assert.equal(await page.getAttribute('#intent-drawer', 'data-show'), 'true');
  assert.equal(await page.getAttribute('#sticky-cta', 'data-hidden'), 'true');
  ok('商品頁：缺點區累計 5 秒後抽屜出現，底部購買列讓位');
  const box = await page.locator('#intent-drawer').boundingBox(), vh = 844;
  assert.ok(box.y + box.height <= vh + 1);
  await page.click('[data-drawer-close]');
  await page.waitForTimeout(300);
  assert.equal(await page.getAttribute('#intent-drawer', 'data-show'), 'false');
  ok('關閉後抽屜消失');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// 情境頁、品類頁、站內連結
{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.goto(base + '/dehumidifier/for/baby/');
  const t = await page.textContent('main');
  assert.match(t, /示範導言/);
  const cards = await page.locator('#intent-list li').count();
  assert.ok(cards >= 2);
  for (const li of await page.locator('#intent-list li').all()) {
    assert.match(await li.textContent(), /缺點：/);
    assert.match(await li.locator('h3 a').getAttribute('href'), /^\/dehumidifier\/demo-/);
  }
  ok(`情境頁：${cards} 台比較卡，每台有缺點、到手價並連到自己的評測頁`);
  await page.goto(base + '/dehumidifier/');
  assert.equal(await page.locator('.results li').count(), 3);
  assert.match(await page.textContent('main'), /家有嬰幼兒的除濕機怎麼選/);
  ok('品類頁：列出該品類商品並連到情境頁');
  // 全站內部連結不得 404（首頁、品類、商品、情境頁）
  const seen = new Set(), queue = ['/'];
  while (queue.length) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const res = await page.goto(base + u);
    assert.equal(res.status(), 200, `${u} 回應 ${res.status()}`);
    for (const h of await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href'))))
      if (!h.startsWith('/go/') && !seen.has(h)) queue.push(h);
  }
  ok(`站內 ${seen.size} 個頁面互相連結，沒有 404`);
  assert.deepEqual(errors, []);
  await ctx.close();
}
await browser.close();
console.log(`\n-- ${n} 項通過`);
