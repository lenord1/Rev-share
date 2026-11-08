#!/usr/bin/env node
// Step 6 瀏覽器實測：必備頁面、頁尾連結、404。先 npm run build && npx astro preview --port 4321。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:4321';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let n = 0; const ok = (m) => { n++; console.log('✓', m); };

for (const u of ['/', '/dehumidifier/', '/dehumidifier/demo-dehumidifier-a/', '/dehumidifier/for/baby/', '/about/', '/disclosure/', '/privacy/']) {
  await page.goto(base + u);
  for (const href of ['/about/', '/disclosure/', '/privacy/'])
    assert.ok(await page.locator(`.site-foot a[href="${href}"]`).count(), `${u} 頁尾缺 ${href}`);
}
ok('首頁、品類頁、商品頁、情境頁與內容頁的頁尾都連到關於、揭露、隱私');
for (const u of ['/about/', '/disclosure/', '/privacy/']) {
  const r = await page.goto(base + u);
  assert.equal(r.status(), 200);
  assert.equal(await page.locator('h1').count(), 1);
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
}
ok('三個內容頁 200、單一 H1、手機無橫向捲動');
await page.goto(base + '/about/');
assert.doesNotMatch(await page.textContent('main'), /聯絡我們/);
ok('站長資訊未填時，不顯示聯絡區塊（不放佔位文字）');
await page.goto(base + '/disclosure/');
assert.match(await page.textContent('main'), /蝦皮、酷澎/);
const r404 = await page.goto(base + '/no-such-page/');
assert.equal(r404.status(), 404);
assert.match(await page.textContent('main'), /找不到這一頁/);
await page.click('main a.btn:has-text("回首頁")');
await page.waitForURL(base + '/');
ok('404 頁回應 404，且「回首頁」可返回');
assert.equal(await page.locator('meta[name=robots]').count(), 0);
await browser.close();
console.log(`\n-- ${n} 項通過`);
