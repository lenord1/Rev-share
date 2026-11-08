#!/usr/bin/env node
// 每日自動化管線（供 GitHub Actions 與本機共用）：
//   取得價格觀測（provider）→ 套用（含異常保護）→ 驗證 → 記錄價格 → 同步 vercel.json → 寫報告
// 用法：node scripts/daily.mjs [--dry]      --dry 只顯示會改什麼，不寫檔
// 設計原則：任何一步失敗就還原檔案並以非 0 結束，避免把壞資料 commit 出去。
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { p, exists, readJson, loadConfig } from './lib.mjs';
import { validateProducts } from './validate-products.mjs';
import { buildVercelConfig } from './gen-redirects.mjs';

const today = () => new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);

/** 把觀測套用到 products（純函式，方便測試）。回傳 { applied, rejected, products }。 */
export function applyObservations(products, observations, { maxChangePct = 40, date = today() } = {}) {
  const byCode = new Map(products.map((x) => [x.modelCode, x]));
  const applied = [], rejected = [];
  for (const o of observations) {
    const x = byCode.get(o.modelCode);
    const why = (reason) => rejected.push({ ...o, reason });
    if (!x) { why('未知型號'); continue; }
    if (x.demo) { why('示範資料不套用'); continue; }
    if (!Number.isInteger(o.price) || o.price <= 0) { why('價格不是正整數'); continue; }
    if (!x.affiliate?.[o.channel]) { why('此通路沒有連結'); continue; }
    const primary = x.primaryChannel ?? Object.keys(x.affiliate)[0];
    const cur = o.channel === primary ? x.price : x.prices?.[o.channel];
    if (cur && Math.abs(o.price - cur) / cur * 100 > maxChangePct) { why(`變動超過 ${maxChangePct}%（${cur} → ${o.price}），需人工確認`); continue; }
    if (o.channel === primary) { x.price = o.price; x.priceUpdatedAt = o.observedAt ?? date; }
    else { x.prices = { ...(x.prices ?? {}), [o.channel]: o.price }; x.pricesUpdatedAt = { ...(x.pricesUpdatedAt ?? {}), [o.channel]: o.observedAt ?? date }; }
    applied.push({ modelCode: o.modelCode, channel: o.channel, from: cur ?? null, to: o.price });
  }
  return { applied, rejected, products };
}

async function main() {
  const dry = process.argv.includes('--dry');
  const cfg = loadConfig();
  const providerName = cfg.provider ?? 'manual';
  const provider = await import(`./providers/${providerName}.mjs`);
  const raw = fs.readFileSync(p('src', 'data', 'products.json'), 'utf8');
  const data = JSON.parse(raw);
  const obs = await provider.fetchObservations();
  const { applied, rejected } = applyObservations(data.products, obs, { maxChangePct: cfg.maxPriceChangePct ?? 40 });
  const summary = { date: today(), provider: providerName, observations: obs.length, applied, rejected, validation: null, redirectsChanged: false };

  if (applied.length && !dry) fs.writeFileSync(p('src', 'data', 'products.json'), JSON.stringify(data, null, 2) + '\n');
  const v = validateProducts();
  summary.validation = { errors: v.errors, warns: v.warns };
  if (v.errors) {
    fs.writeFileSync(p('src', 'data', 'products.json'), raw); // 還原
    v.print();
    console.error('✗ 驗證失敗，已還原 products.json，未做任何變更');
    process.exitCode = 1;
  } else if (!dry) {
    if (applied.length) await import('node:child_process').then(({ execFileSync }) => execFileSync(process.execPath, [p('scripts', 'record-price.mjs')], { stdio: 'inherit' }));
    const next = JSON.stringify(buildVercelConfig(), null, 2) + '\n';
    const cur = exists('vercel.json') ? fs.readFileSync(p('vercel.json'), 'utf8') : '';
    if (cur !== next) { fs.writeFileSync(p('vercel.json'), next); summary.redirectsChanged = true; }
  }
  if (!dry) { fs.mkdirSync(p('reports'), { recursive: true }); fs.writeFileSync(p('reports', `daily-${summary.date}.json`), JSON.stringify(summary, null, 2) + '\n'); }
  console.log(JSON.stringify({ ...summary, dry }, null, 2));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
