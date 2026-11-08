#!/usr/bin/env node
// 示範用：替示範商品（demo: true）產生「模擬」的價格紀錄，讓你在還沒有真實資料時看見價格走勢長什麼樣子。
// 用法：node scripts/sim-demo-history.mjs           產生（以各商品的 priceUpdatedAt 為終點，往前推 22 天）
//       node scripts/sim-demo-history.mjs --clear   移除所有示範商品的紀錄
// 只寫入 demo: true 的商品；真實商品的紀錄不會被動到。示範商品換成真實商品時，請執行 --clear。
import fs from 'node:fs';
import { p, exists, readJson } from './lib.mjs';

// 每個商品的走勢：[往前幾天, 與「目前價」的差]。刻意做出不同狀態：最低、偏高、中段、偏低、資料不足。
const SHAPES = {
  'demo-wm-a': { shopee: [[0, 0], [3, 1000], [7, 2000], [10, 2000], [14, 1000], [18, -400], [22, 2000]] }, // 低於多數時間
  'demo-wm-b': { shopee: [[0, 0], [5, 0]] }, // 只有 2 筆：展示「累積中」
  'demo-wh-a': { shopee: [[0, 0], [3, 300], [7, 500], [10, 500], [14, 200], [18, 400], [22, 500]] }, // 目前是低點
  'demo-wh-b': { shopee: [[0, 0], [3, 0], [7, 0], [10, 0], [14, 0], [22, 0]] }, // 價格穩定
  'demo-ac-a': { shopee: [[0, 0], [3, 800], [7, 1500], [10, 2000], [14, 1500], [18, 1000], [22, 2000]] }, // 目前是低點
  'demo-ac-b': { shopee: [[0, 0], [3, -500], [7, -800], [10, -300], [14, -600], [18, -400], [22, -200]] }, // 偏高
  'demo-rv-a': { shopee: [[0, 0], [3, 600], [7, -300], [10, 400], [14, 800], [18, -500], [22, 200]] }, // 中段
  'demo-rv-b': { shopee: [[0, 0], [4, 0], [9, 0]] }, // 3 筆但跨度不足 14 天：展示「累積中」
};
// 沒有手寫走勢的示範商品：依順序輪流套用五種狀態（千分比，相對目前價；四捨五入到 100 元）
const CYCLE = [
  [[0, 0], [3, 30], [7, 50], [10, 50], [14, 20], [18, 40], [22, 50]], // 目前是低點
  [[0, 0], [3, -30], [7, -50], [10, -50], [14, -20], [18, -40], [22, -30]], // 偏高
  [[0, 0], [3, 30], [7, -20], [10, 25], [14, 40], [18, -30], [22, 15]], // 中段
  [[0, 0], [3, 60], [7, 90], [10, 90], [14, 50], [18, -20], [22, 90]], // 偏低
  [[0, 0], [5, 0]], // 資料不足
];
const shapeFor = (x, i) => SHAPES[x.modelCode] ?? { [x.primaryChannel ?? Object.keys(x.affiliate ?? {})[0]]: CYCLE[i % CYCLE.length].map(([b, m]) => [b, Math.round((x.price * m) / 1000 / 100) * 100]) };
const day = (end, back) => new Date(Date.parse(end) - back * 864e5).toISOString().slice(0, 10);

const file = p('src', 'data', 'price-history.json');
const hist = exists('src', 'data', 'price-history.json') ? readJson('src', 'data', 'price-history.json') : {};
const products = readJson('src', 'data', 'products.json').products;
const demoCodes = products.filter((x) => x.demo).map((x) => x.modelCode);

if (process.argv.includes('--clear')) {
  for (const c of demoCodes) delete hist[c];
  fs.writeFileSync(file, JSON.stringify(hist, null, 2) + '\n');
  console.log(`✓ 已移除 ${demoCodes.length} 個示範商品的模擬紀錄`);
  process.exit(0);
}
let n = 0;
let demoIdx = 0;
for (const x of products.filter((y) => y.demo)) {
  const shape = shapeFor(x, demoIdx++);
  const primary = x.primaryChannel ?? Object.keys(x.affiliate ?? {})[0];
  const list = [];
  for (const [channel, pts] of Object.entries(shape)) {
    const base = channel === primary ? x.price : x.prices?.[channel];
    if (!Number.isInteger(base)) continue;
    for (const [back, diff] of pts) list.push({ date: day(x.priceUpdatedAt, back), channel, price: base + diff });
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel));
  hist[x.modelCode] = list;
  n += list.length;
}
fs.writeFileSync(file, JSON.stringify(hist, null, 2) + '\n');
console.log(`✓ 已為示範商品產生 ${n} 筆模擬價格紀錄（${file}）`);
