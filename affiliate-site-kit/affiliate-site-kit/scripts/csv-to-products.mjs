#!/usr/bin/env node
// 把 data/products.csv 轉成 src/data/products.json（保留既有 categories）。
// 用法：node scripts/csv-to-products.mjs [csv路徑]
// 通路網址欄：shopee、coupang，或 aff_<通路id>（如 aff_klook）。
// CSV 欄位：category,slug,modelCode,titleTemplate,price,priceUpdatedAt,discount,taxRefund,subsidyNote,
//   promoValidUntil,promoBadge,featured,featuredOrder,tldr,flaw,shopee,coupang,specs,finder,faq,demo,
//   primaryChannel,prices,policy,extraCosts,notFor,alternative,lastChecked
// 其中 specs / finder / faq / prices / policy / extraCosts / notFor / alternative 欄位填 JSON 字串。
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { p, exists, readJson } from './lib.mjs';

export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}

const DEFAULT_CATEGORIES = [
  { slug: 'dehumidifier', name: '除濕機' },
  { slug: 'washer', name: '洗衣機' },
  { slug: 'water-heater', name: '熱水器' },
  { slug: 'air-conditioner', name: '冷氣' },
  { slug: 'robot-vacuum', name: '掃地機' },
];
const INT = ['price', 'discount', 'taxRefund', 'featuredOrder'];
const BOOL = ['featured', 'demo'];
const JSONF = ['specs', 'finder', 'faq', 'prices', 'policy', 'extraCosts', 'notFor', 'alternative'];

export function csvToProducts(text) {
  const [head, ...body] = parseCsv(text);
  if (!head) throw new Error('CSV 是空的');
  return body.map((cells, n) => {
    const o = {}; const aff = {};
    head.forEach((h, i) => {
      const v = (cells[i] ?? '').trim();
      if (v === '') return;
      const am = h.match(/^aff_([a-z0-9]+)$/);
      if (am) aff[am[1]] = v;
      else if (h === 'shopee' || h === 'coupang') aff[h] = v;
      else if (INT.includes(h)) { if (!/^-?\d+$/.test(v)) throw new Error(`第 ${n + 2} 列 ${h} 不是整數：${v}`); o[h] = Number(v); }
      else if (BOOL.includes(h)) o[h] = ['true', '1', 'yes', 'y', 'TRUE'].includes(v);
      else if (JSONF.includes(h)) { try { o[h] = JSON.parse(v); } catch { throw new Error(`第 ${n + 2} 列 ${h} 不是合法 JSON`); } }
      else o[h] = v;
    });
    o.affiliate = aff;
    return o;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const csvPath = process.argv[2] ?? p('data', 'products.csv');
  if (!fs.existsSync(csvPath)) { console.error(`✗ 找不到 ${csvPath}`); process.exit(1); }
  try {
    const products = csvToProducts(fs.readFileSync(csvPath, 'utf8'));
    const categories = exists('src', 'data', 'products.json') ? readJson('src', 'data', 'products.json').categories : DEFAULT_CATEGORIES;
    fs.mkdirSync(p('src', 'data'), { recursive: true });
    fs.writeFileSync(p('src', 'data', 'products.json'), JSON.stringify({ categories, products }, null, 2) + '\n');
    console.log(`✓ 已寫入 src/data/products.json（${products.length} 個商品）。接著執行 node scripts/validate-products.mjs`);
  } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
}
