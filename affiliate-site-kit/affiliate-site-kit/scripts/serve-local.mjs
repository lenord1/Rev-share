#!/usr/bin/env node
// 本機正式環境模擬：用 dist/ 當網站，並照 vercel.json 套用轉址（302）與 headers，行為與 Vercel 上線後一致。
// 零相依，Node 18+。`npm run preview` 不會套用 vercel.json，所以 /go/ 會 404；改用這支。
//
// 用法：
//   node scripts/serve-local.mjs                 http://localhost:4322，/go/ 照 vercel.json 302 到真實目的地
//   node scripts/serve-local.mjs --sim           示範商品（demo: true）或 Step 7 尚未完成時，/go/ 改到本機「模擬轉址」頁，
//                                                頁面上會顯示原本要去的網址，不會真的跳到賣場
//   node scripts/serve-local.mjs --port 5000
// 搭配：npm run local（建置 + --sim）、npm run local:check（完整本機檢查）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, exists, readJson } from './lib.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** Vercel 的 source 樣式（:name、(.*)）轉成正規式。只支援本專案用得到的寫法。 */
const toRegex = (src) => new RegExp('^' + src.split('(.*)').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, '([^/]+)')).join('(.*)') + '$');

export function createServer({ sim = false, root = path.resolve(p('dist')) } = {}) {
  const vercel = exists('vercel.json') ? readJson('vercel.json') : {};
  const redirects = (vercel.redirects ?? []).map((r) => ({ ...r, re: toRegex(r.source) }));
  const headerRules = (vercel.headers ?? []).map((h) => ({ ...h, re: toRegex(h.source) }));
  const demoCodes = new Set();
  if (sim && exists('src', 'data', 'products.json')) {
    for (const x of readJson('src', 'data', 'products.json').products ?? []) if (x.demo) demoCodes.add(x.modelCode);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    const pathname = decodeURIComponent(url.pathname);
    for (const h of headerRules) if (h.re.test(pathname)) for (const { key, value } of h.headers) res.setHeader(key, value);

    // 模擬轉址頁
    if (pathname === '/__sim/go') return simPage(res, url.searchParams.get('to') ?? '', url.searchParams.get('from') ?? '');

    // 轉址（與 Vercel 一樣，在檔案之前處理）
    const rd = redirects.find((r) => r.re.test(pathname));
    if (rd) {
      const code = pathname.replace(/^\/go\/[a-z0-9]+-/, '');
      const useSim = sim && demoCodes.has(code);
      const location = useSim ? `/__sim/go?to=${encodeURIComponent(rd.destination)}&from=${encodeURIComponent(pathname)}` : rd.destination;
      res.writeHead(rd.statusCode ?? (rd.permanent ? 308 : 307), { Location: location });
      return res.end();
    }

    // 靜態檔：/a/ → /a/index.html；/a → /a.html 或 /a/index.html
    let rel = pathname.replace(/^\/+/, '');
    const candidates = rel === '' || rel.endsWith('/') ? [path.join(rel, 'index.html')] : [rel, rel + '.html', path.join(rel, 'index.html')];
    for (const c of candidates) {
      const f = path.join(root, c);
      if (!f.startsWith(root)) break; // 防止 ../ 跳出 dist
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    const nf = path.join(root, '404.html');
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    return fs.existsSync(nf) ? fs.createReadStream(nf).pipe(res) : res.end('404');
  });
}

function simPage(res, to, from) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ch = /coupang|coupa\.ng/.test(to) ? '酷澎' : /shopee|shp\.ee/.test(to) ? '蝦皮' : '賣場';
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'X-Robots-Tag': 'noindex, nofollow' });
  res.end(`<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>模擬轉址（本機）</title><style>
body{margin:0;background:#eef2f0;color:#16231f;font:16px/1.7 "PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}
main{max-width:34em;margin:0 auto;padding:48px 16px}h1{font-size:26px;line-height:1.3;margin:12px 0}
.b{display:inline-block;background:#fff3d6;color:#7a4b00;border-radius:999px;padding:2px 12px;font-size:13px;font-weight:700}
code{display:block;background:#fff;border:1px solid #d3dbd8;border-radius:10px;padding:12px 14px;margin:8px 0 16px;word-break:break-all;font-size:14px}
a{color:#1f4fd8;font-weight:700}
@media (prefers-color-scheme:dark){body{background:#0e1512;color:#e8efec}code{background:#162019;border-color:#2a3832}a{color:#7c9cff}}
</style></head><body><main>
<span class="b">本機模擬．Step 7 尚未完成</span>
<h1>正式上線後，這裡會跳到${ch}</h1>
<p>站內連結</p><code>${esc(from)}</code>
<p>302 轉址目的地（取自 vercel.json）</p><code>${esc(to)}</code>
<p>這是示範商品，目的地不是真實商品頁，所以本機先停在這裡。換成真實商品與聯盟連結後，不加 <b>--sim</b> 就會直接轉過去。</p>
<p><a href="javascript:history.back()">← 回上一頁</a></p>
</main></body></html>`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!exists('dist')) { console.error('找不到 dist/，請先執行 npm run build'); process.exit(1); }
  const port = Number(arg('--port') ?? 4322);
  const sim = process.argv.includes('--sim');
  createServer({ sim }).listen(port, () => {
    console.log(`本機網站：http://localhost:${port}/`);
    console.log(sim ? '模擬模式：示範商品的 /go/ 會停在本機模擬轉址頁' : '正式模式：/go/ 依 vercel.json 302 到真實目的地');
    console.log('按 Ctrl+C 結束');
  });
}
