#!/usr/bin/env node
// 視覺檢查截圖（選配，需已安裝 playwright）：
//   node scripts/screenshot.mjs <網址或本機檔案> <輸出前綴> 例：node scripts/screenshot.mjs http://localhost:4321/ reports/shots/home
// 產出 4 張：手機/桌機 × 淺色/深色。用來和 design/ 參考稿並排比對，不是自動判分。
import fs from 'node:fs';
import path from 'node:path';
const [target, prefix] = process.argv.slice(2);
if (!target || !prefix) { console.error('用法：node scripts/screenshot.mjs <url|檔案路徑> <輸出前綴>'); process.exit(2); }
let chromium;
import { createRequire } from 'node:module';
try { ({ chromium } = await import('playwright')); } catch {
  try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* 下方統一處理 */ }
}
if (!chromium) { console.error('✗ 沒有安裝 playwright（npm i -D playwright && npx playwright install chromium）。可改用瀏覽器開發者工具手動截圖。'); process.exit(1);
}
const url = /^https?:|^file:/.test(target) ? target : 'file://' + path.resolve(target);
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const browser = await chromium.launch();
for (const [name, w, h] of [['mobile', 390, 844], ['desktop', 1280, 900]]) {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle' });
    const out = `${prefix}-${name}-${scheme}.png`;
    await page.screenshot({ path: out, fullPage: true });
    console.log('✓ ' + out);
    await page.close();
  }
}
await browser.close();
