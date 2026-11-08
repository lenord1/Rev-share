#!/usr/bin/env node
// 價格紀錄：把目前 products.json 的價格追加到 src/data/price-history.json（同日同通路覆蓋，不重複）。
// 用法：node scripts/record-price.mjs [--date YYYY-MM-DD] [--include-demo]
//       node scripts/record-price.mjs --stats      （列出各商品近 30 天統計，不寫檔）
// 紀錄的是「標價」(price / prices[通路])，不是到手價。示範資料預設不記錄，避免產生虛假走勢。
import fs from 'node:fs';
import { p, exists, readJson, loadConfig } from './lib.mjs';
import { priceStats, verdictLabel } from '../src/lib/pricing.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const products = readJson('src', 'data', 'products.json').products;
const histPath = p('src', 'data', 'price-history.json');
const hist = exists('src', 'data', 'price-history.json') ? readJson('src', 'data', 'price-history.json') : {};
const cfg = loadConfig().priceHistory;

if (process.argv.includes('--stats')) {
  for (const x of products) {
    const ch = x.primaryChannel ?? Object.keys(x.affiliate ?? {})[0];
    const st = priceStats((hist[x.modelCode] ?? []).filter((e) => e.channel === ch), cfg);
    console.log(`${x.modelCode}\t${ch}\t` + (st.enough ? `${verdictLabel[st.verdict]}（最低 ${st.min} / 最高 ${st.max} / 現在 ${st.current}，${st.count} 筆）` : `資料累積中（${st.count} 筆 / ${st.spanDays} 天，需 ≥${cfg.minPoints} 筆且跨 ≥${cfg.minSpanDays} 天）`));
  }
  process.exit(0);
}

const date = arg('--date') ?? new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10); // 台灣日期
if (Number.isNaN(Date.parse(date))) { console.error('✗ --date 格式錯誤'); process.exit(1); }
const includeDemo = process.argv.includes('--include-demo');
let n = 0, skipped = 0;
for (const x of products) {
  if (x.demo && !includeDemo) { skipped++; continue; }
  const primary = x.primaryChannel ?? Object.keys(x.affiliate ?? {})[0];
  const prices = { ...(x.prices ?? {}), [primary]: x.price };
  const list = hist[x.modelCode] ?? [];
  for (const [channel, price] of Object.entries(prices)) {
    const i = list.findIndex((e) => e.date === date && e.channel === channel);
    const rec = { date, channel, price };
    i > -1 ? (list[i] = rec) : list.push(rec);
    n++;
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel));
  hist[x.modelCode] = list;
}
fs.writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');
console.log(`✓ ${date}：記錄 ${n} 筆價格` + (skipped ? `（略過 ${skipped} 個示範商品，要記錄請加 --include-demo）` : ''));
