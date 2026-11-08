// 商品進站後自動分類：由規格與價格推出選購精靈用的 finder（適用坪數、預算級距、需求標籤）。
// 規則（估算值，不是官方標示；要覆寫就手寫 finder 並不要設 finderAuto）：
//   適用坪數 ≈ 日除濕量(L/日) × 0.8 ～ × 1.2；預算 = 同品類到手價三等分；噪音 ≤ 40 dB → quiet；
//   日除濕量 ≥ 14 → family；名稱含「烘乾／衣物乾燥」→ dryer；預算低檔 → budget。
// 用法：node scripts/classify-finder.mjs [--check]。轉正式（drafts promote）時會自動執行。
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { p } from './lib.mjs';
import { priceBreakdown } from '../src/lib/pricing.mjs';

// 區間（例如 34–39）取最大值：噪音拿最吵的檔位判斷，除濕量也不高估
const num = (v) => {
  const m = String(v ?? '').match(/\d+(?:\.\d+)?/g);
  return m ? Math.max(...m.map(Number)) : null;
};
const spec = (x, re) => (x.specs ?? []).find((s) => re.test(s.key));
const round = (n) => Math.round(n * 2) / 2;

/** 回傳需要（重新）分類的商品數。會直接修改 products。 */
export function classifyProducts(products) {
  const needs = (x) => !x.finder || x.finderAuto;
  const todo = products.filter(needs);
  const finals = {};
  for (const x of products) (finals[x.category] ??= []).push(priceBreakdown(x).final);
  for (const k of Object.keys(finals)) finals[k].sort((a, b) => a - b);
  for (const x of todo) {
    const sorted = finals[x.category];
    const f = priceBreakdown(x).final;
    const rank = sorted.length > 1 ? sorted.indexOf(f) / (sorted.length - 1) : 0.5;
    const budget = rank < 1 / 3 ? 'low' : rank > 2 / 3 ? 'high' : 'mid';
    const out = { budget, tags: [] };
    const cap = num(spec(x, /除濕量/)?.value);
    if (cap) {
      out.area = [round(cap * 0.8), round(cap * 1.2)];
      if (cap >= 14) out.tags.push('family');
    }
    const db = num(spec(x, /噪音/)?.value);
    if (db && db <= 40) out.tags.push('quiet');
    if (/烘乾|衣物乾燥/.test(`${x.titleTemplate ?? ''}${x.tldr ?? ''}`)) out.tags.push('dryer');
    if (budget === 'low') out.tags.push('budget');
    x.finder = out;
    x.finderAuto = true;
  }
  return todo.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = p('src', 'data', 'products.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.argv.includes('--check')) {
    const miss = data.products.filter((x) => !x.finder).map((x) => x.modelCode);
    console.log(miss.length ? `缺 finder：${miss.join(', ')}` : '✓ 全部商品都有 finder');
    process.exit(miss.length ? 1 : 0);
  }
  const n = classifyProducts(data.products);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ 已分類 ${n} 個商品`);
}
