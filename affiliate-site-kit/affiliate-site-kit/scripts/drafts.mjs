#!/usr/bin/env node
// 草稿管理：node scripts/drafts.mjs <指令>
//   list [--all]                         列出草稿（預設只列 status=draft）
//   check <代號> [--ready]               顯示轉正式前還缺什麼；--ready：有缺項就以結束碼 1 結束
//   license <代號> <檔名> <授權> [--note 說明]   授權：owned／official／licensed／rejected／pending-review
//   attach-image <代號> <商品型號> [檔名]   把草稿圖片掛到示範商品（demo: true）做預覽測試；正式商品不可
//   promote <代號> [--dry-run]           補齊且通過 validate-products 才寫入 products.json（失敗會還原）
import fs from 'node:fs';
import { p } from './lib.mjs';
import { listDrafts, readDraft, writeDraft, validateDraft, promoteDraft, attachImageToDemo, readLedger, writeLedger, ledgerEntry, LICENSES } from './import/draft.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--') && a !== '--note'));
const noteIdx = rest.indexOf('--note');
const note = noteIdx >= 0 ? rest[noteIdx + 1] ?? '' : '';
const pos = rest.filter((a, i) => !a.startsWith('--') && !(noteIdx >= 0 && i === noteIdx + 1));
const die = (m, c = 1) => { console.error('✗ ' + m); process.exit(c); };

if (cmd === 'list') {
  const rows = listDrafts().filter((d) => flags.has('--all') || d.status === 'draft');
  if (!rows.length) console.log('沒有草稿。');
  for (const d of rows) {
    const v = validateDraft(d);
    console.log(`${d.draftId}\t${d.status}\t${d.name || '(未命名)'}\t缺 ${v.blockers.length} 項`);
  }
} else if (cmd === 'check') {
  const d = readDraft(pos[0]);
  if (!d) die(`找不到草稿 ${pos[0]}`, 2);
  const v = validateDraft(d);
  for (const e of v.errors) console.log('✗ ' + e);
  for (const b of v.blockers) console.log('□ ' + b);
  for (const w of v.warnings) console.log('△ ' + w);
  console.log(v.errors.length ? '草稿結構有誤。' : v.blockers.length ? `還缺 ${v.blockers.length} 項，不能轉正式。` : '✓ 可以轉正式（node scripts/drafts.mjs promote ' + d.draftId + '）');
  process.exit(v.errors.length || (flags.has('--ready') && v.blockers.length) ? 1 : 0);
} else if (cmd === 'license') {
  const [id, file, lic] = pos;
  if (!id || !file || !LICENSES.includes(lic)) die(`用法：license <代號> <檔名> <${LICENSES.join('|')}> [--note 說明]`, 2);
  const d = readDraft(id);
  const img = d?.images.find((i) => i.file === file);
  if (!img) die(`草稿 ${id} 沒有圖片 ${file}`, 2);
  img.license = lic; img.licenseNote = note;
  writeDraft(d);
  const l = readLedger(); l.images[file] = ledgerEntry(id, img); writeLedger(l);
  console.log(`✓ ${file} 授權標記為 ${lic}`);
} else if (cmd === 'attach-image') {
  const [id, code, file] = pos;
  if (!id || !code) die('用法：attach-image <草稿代號> <商品型號> [檔名]', 2);
  const r = attachImageToDemo(id, code, file);
  if (!r.ok) die(r.message);
  console.log(`✓ 已把 ${r.file}（授權：${r.license}）掛到示範商品 ${code}`);
} else if (cmd === 'promote') {
  const r = promoteDraft(pos[0], { dryRun: flags.has('--dry-run') });
  for (const w of r.warnings ?? []) console.log('△ ' + w);
  if (!r.ok) { for (const m of r.messages) console.error('□ ' + m); die('未轉正式（products.json 沒有變動）'); }
  console.log(r.dryRun ? '✓ 試轉通過（--dry-run，未寫入）' : `✓ 已轉為正式商品 ${r.product.category}/${r.product.slug}\n接著：npm run sync（更新 vercel.json）→ npm run local:check`);
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 2 : 0);
}
