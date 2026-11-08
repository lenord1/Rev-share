#!/usr/bin/env node
// 每週營運報告（Markdown，寫入 reports/weekly-YYYY-MM-DD.md 並印出）：
// 價格新鮮度、7 天內到期的促銷、價格變動、最近連結檢查與對帳結果、待辦。
import fs from 'node:fs';
import { p, exists, readJson, loadConfig } from './lib.mjs';
import { priceStats, daysLeft, verdictLabel } from '../src/lib/pricing.mjs';

const cfg = loadConfig();
const now = Date.now();
const today = new Date(now + 8 * 36e5).toISOString().slice(0, 10);
const prods = readJson('src', 'data', 'products.json').products.filter((x) => !x.demo);
const hist = exists('src', 'data', 'price-history.json') ? readJson('src', 'data', 'price-history.json') : {};
const L = [`# 每週營運報告 ${today}`, ''];

const stale = prods.filter((x) => (now - Date.parse(x.priceUpdatedAt)) / 864e5 > 7);
L.push('## 該更新價格的商品（超過 7 天）', stale.length ? stale.map((x) => `- ${x.modelCode}（${x.priceUpdatedAt}）`).join('\n') : '- 無', '');

const expiring = prods.map((x) => [x, daysLeft(x, now)]).filter(([, d]) => d !== null && d <= 7);
L.push('## 7 天內到期的促銷/補助', expiring.length ? expiring.map(([x, d]) => `- ${x.modelCode}：剩 ${d} 天（${x.promoValidUntil}）`).join('\n') : '- 無', '');

const rows = [];
for (const x of prods) {
  const ch = x.primaryChannel ?? Object.keys(x.affiliate ?? {})[0];
  const st = priceStats((hist[x.modelCode] ?? []).filter((e) => e.channel === ch), { ...cfg.priceHistory, now });
  rows.push(`- ${x.modelCode}：` + (st.enough ? `${verdictLabel[st.verdict]}（最低 ${st.min} / 最高 ${st.max} / 現在 ${st.current}）` : `資料累積中（${st.count} 筆）`));
}
L.push('## 價格走勢', rows.length ? rows.join('\n') : '- 尚無真實商品', '');

const latest = (prefix) => (exists('reports') ? fs.readdirSync(p('reports')).filter((f) => f.startsWith(prefix)).sort().at(-1) : null);
const lc = latest('link-check-');
if (lc) { const j = readJson('reports', lc); L.push('## 最近一次連結檢查', `- ${lc}：${j.errors} 個錯誤、${j.warns} 個警告`, ''); }
else L.push('## 最近一次連結檢查', '- 尚無報告（請執行 node scripts/check-links.mjs --base 你的網址）', '');
if (exists('reports', 'reconcile.json')) {
  const r = readJson('reports', 'reconcile.json').slice(-4);
  L.push('## 最近對帳', ...r.map((x) => `- ${x.week} ${x.channel}：本站 ${x.site} / 後台 ${x.dashboard} = ${x.ratio}　${x.note ?? ''}`), '');
} else L.push('## 最近對帳', '- 尚無紀錄（每週執行 node scripts/reconcile.mjs）', '');

L.push('## 這週待辦', '- [ ] 更新價格並 npm run update-prices，commit 部署', '- [ ] 手機抽測 3 條 /go/ 連結', '- [ ] 本機執行連結檢查 --follow 並看無法判斷的項目', '- [ ] 聯盟後台點擊 vs 本站點擊對帳');
const out = L.join('\n') + '\n';
fs.mkdirSync(p('reports'), { recursive: true });
fs.writeFileSync(p('reports', `weekly-${today}.md`), out);
console.log(out);
