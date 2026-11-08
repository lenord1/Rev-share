#!/usr/bin/env node
// 由 products.json + travel.json 產生 vercel.json 的 /go/ 轉址與 headers。保留 vercel.json 其他設定。
// 用法：node scripts/gen-redirects.mjs [--check]   (--check 只比對，不寫檔，不同步則 exit 1)
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { readJson, exists, p } from './lib.mjs';

export function collectLinks() {
  const out = [];
  const prods = readJson('src', 'data', 'products.json').products ?? [];
  for (const x of prods) for (const [ch, url] of Object.entries(x.affiliate ?? {})) if (url) out.push({ source: `/go/${ch}-${x.modelCode}`, channel: ch, code: x.modelCode, destination: url, kind: 'product' });
  if (exists('src', 'data', 'travel.json')) {
    for (const g of readJson('src', 'data', 'travel.json').guides ?? []) for (const o of g.offers ?? []) out.push({ source: `/go/${o.channel}-${o.code}`, channel: o.channel, code: o.code, destination: o.affiliate, kind: 'travel' });
  }
  return out;
}

export function buildVercelConfig() {
  const base = exists('vercel.json') ? readJson('vercel.json') : {};
  const redirects = collectLinks().map((l) => ({ source: l.source, destination: l.destination, statusCode: 302 }));
  const goHeaders = {
    source: '/go/(.*)',
    headers: [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Cache-Control', value: 'no-store' },
    ],
  };
  const headers = [...(base.headers ?? []).filter((h) => h.source !== goHeaders.source), goHeaders];
  return { ...base, redirects, headers };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = JSON.stringify(buildVercelConfig(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const cur = exists('vercel.json') ? fs.readFileSync(p('vercel.json'), 'utf8') : '';
    if (cur !== next) { console.error('✗ vercel.json 與資料不同步，請執行 node scripts/gen-redirects.mjs'); process.exit(1); }
    console.log('✓ vercel.json 與資料同步');
  } else {
    fs.writeFileSync(p('vercel.json'), next);
    console.log(`✓ 已寫入 vercel.json（${JSON.parse(next).redirects.length} 條轉址）`);
  }
}
