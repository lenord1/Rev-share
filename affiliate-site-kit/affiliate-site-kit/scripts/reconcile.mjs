#!/usr/bin/env node
// 每週對帳：本站記錄的出站點擊 vs 聯盟後台點擊。重點是「比率突然下滑」，而不是絕對值相等
// （去重、內嵌瀏覽器、廣告攔截都會造成合理差距）。
// 用法：node scripts/reconcile.mjs --week 2026-W45 --site shopee=420 --dashboard shopee=388
//       node scripts/reconcile.mjs --show
import fs from 'node:fs';
import { p, exists, readJson } from './lib.mjs';

const f = p('reports', 'reconcile.json');
const log = exists('reports', 'reconcile.json') ? readJson('reports', 'reconcile.json') : [];
const get = (flag) => {
  const out = {};
  process.argv.forEach((a, i) => { if (a === flag) { const [k, v] = (process.argv[i + 1] ?? '').split('='); if (k && v !== undefined) out[k] = Number(v); } });
  return out;
};
if (process.argv.includes('--show')) { console.table(log.map(({ week, channel, site, dashboard, ratio }) => ({ week, channel, site, dashboard, ratio }))); process.exit(0); }
const wi = process.argv.indexOf('--week');
const week = wi > -1 ? process.argv[wi + 1] : undefined;
const site = {}, dash = {};
process.argv.forEach((a, i) => {
  if (a === '--site' || a === '--dashboard') { const [k, v] = (process.argv[i + 1] ?? '').split('='); (a === '--site' ? site : dash)[k] = Number(v); }
});
if (!week || !Object.keys(site).length) { console.error('用法：--week 2026-W45 --site shopee=420 --dashboard shopee=388'); process.exit(2); }
let flagged = 0;
for (const ch of Object.keys(site)) {
  if (!(ch in dash)) { console.error(`✗ 缺 --dashboard ${ch}=…`); process.exit(2); }
  const ratio = site[ch] ? +(dash[ch] / site[ch]).toFixed(3) : null;
  const prev = log.filter((x) => x.channel === ch && x.week !== week && x.ratio != null).map((x) => x.ratio).sort((a, b) => a - b);
  const median = prev.length ? prev[Math.floor(prev.length / 2)] : null;
  let note = '基準累積中（需 ≥3 週）';
  if (prev.length >= 3 && ratio != null) {
    note = ratio < median * 0.6 ? `⚠ 比率 ${ratio} 比歷史中位數 ${median} 低 40% 以上：檢查連結/聯盟參數/內嵌瀏覽器流程` : `正常（歷史中位數 ${median}）`;
    if (ratio < median * 0.6) flagged++;
  }
  const rec = { week, channel: ch, site: site[ch], dashboard: dash[ch], ratio, note };
  const i = log.findIndex((x) => x.week === week && x.channel === ch);
  i > -1 ? (log[i] = rec) : log.push(rec);
  console.log(`${week} ${ch}: 本站 ${site[ch]} / 後台 ${dash[ch]} = ${ratio}　${note}`);
}
fs.mkdirSync(p('reports'), { recursive: true });
fs.writeFileSync(f, JSON.stringify(log, null, 2) + '\n');
process.exit(flagged ? 1 : 0);
