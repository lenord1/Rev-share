#!/usr/bin/env node
// 處理 import-requests/*.json（每個檔案一筆匯入請求），結果寫到 import-requests/results/<同檔名>，處理完的請求檔會刪除。
// 請求格式：{ "url": "蝦皮或其他商品網址", "officialUrl": "品牌官網商品頁（選填）", "category": "dehumidifier",
//            "force": false, "attachTo": "示範商品型號（選填，只限 demo: true）", "name": "手動名稱（選填）", "price": 12900 }
// 由 .github/workflows/import-requests.yml 在推送請求檔到 preview 分支時執行；失敗只記錄原因，不中斷其他請求。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p } from './lib.mjs';
import { runImport } from './import-product.mjs';
import { attachImageToDemo, today } from './import/draft.mjs';

export async function processRequests(deps = {}) {
  const dir = p('import-requests');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const out = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const res = { file: f, processedAt: today() };
    let req = null;
    try { req = JSON.parse(fs.readFileSync(full, 'utf8')); }
    catch (e) { res.ok = false; res.error = { code: 'bad-json', message: '請求檔不是合法 JSON：' + e.message }; }
    if (req) {
      try {
        if (!req.url) throw Object.assign(new Error('缺少 url'), { code: 'args' });
        const opts = { _: [String(req.url)] };
        if (req.officialUrl) opts['official-url'] = String(req.officialUrl);
        if (req.category) opts.category = String(req.category);
        if (req.force) opts.force = true;
        if (req.name) opts.name = String(req.name);
        if (req.price != null) opts.price = String(req.price);
        const r = await runImport(opts, deps);
        res.ok = true;
        res.draftId = r.draft.draftId;
        res.name = r.draft.name;
        res.images = r.draft.images.map((i) => ({ file: i.file, sourceUrl: i.sourceUrl, width: i.width, height: i.height, license: i.license }));
        res.blockers = r.validation.blockers;
        res.notes = r.draft.notes;
        if (req.attachTo) res.attach = attachImageToDemo(r.draft.draftId, String(req.attachTo));
      } catch (e) {
        res.ok = false;
        res.error = { code: e?.code ?? 'error', message: String(e?.message ?? e) };
      }
    }
    res.request = req;
    fs.mkdirSync(p('import-requests', 'results'), { recursive: true });
    fs.writeFileSync(p('import-requests', 'results', f), JSON.stringify(res, null, 2) + '\n');
    fs.unlinkSync(full);
    out.push(res);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await processRequests();
  if (!results.length) console.log('沒有待處理的請求');
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.file}　${r.ok ? r.draftId + '　圖片 ' + r.images.length + ' 張' : r.error.message}`);
}
