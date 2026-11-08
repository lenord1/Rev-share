#!/usr/bin/env node
// 連結健康檢查。用法：
//   node scripts/check-links.mjs                      靜態檢查：vercel.json 與資料一致、302、網域白名單、聯盟參數設定
//   node scripts/check-links.mjs --base https://網域   線上檢查已部署的 /go/：302、Location、X-Robots-Tag
//   node scripts/check-links.mjs --base … --follow    再沿轉址鏈追到落點，檢查網域、聯盟參數、404/410
// 設計原則：低頻（逐一請求、預設間隔 1.5 秒）、只看狀態碼與 Location、不解析頁面內容。
// 403/429/5xx 一律視為「無法判斷」(警告)，不當成失效，因為賣場可能對機器人限流。
import fs from 'node:fs';
import { p, exists, readText, loadConfig, loadChannels, hostAllowed, createReport } from './lib.mjs';
import { collectLinks } from './gen-redirects.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const base = arg('--base')?.replace(/\/$/, '');
const follow = process.argv.includes('--follow');
const only = arg('--only');
const cfg = loadConfig().linkCheck;
const chans = new Map(loadChannels().map((c) => [c.id, c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hop(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': cfg.userAgent }, signal: ctl.signal });
    res.body?.cancel?.().catch(() => {});
    return { status: res.status, location: res.headers.get('location'), xrobots: res.headers.get('x-robots-tag') };
  } finally { clearTimeout(t); }
}

const r = createReport(`連結健康檢查${base ? `（線上 ${base}${follow ? ' + 追蹤落點' : ''}）` : '（靜態）'}`);
let links = collectLinks();
if (only) links = links.filter((l) => l.code === only || l.source === only);
if (!links.length) { r.error('沒有可檢查的連結'); process.exit(r.print() ? 1 : 0); }

// 靜態：vercel.json 對得上資料
const vercel = exists('vercel.json') ? JSON.parse(readText('vercel.json')) : { redirects: [] };
const vmap = new Map((vercel.redirects ?? []).map((x) => [x.source, x]));
for (const l of links) {
  const v = vmap.get(l.source);
  if (!v) r.error(`${l.source}: vercel.json 缺少此轉址（node scripts/gen-redirects.mjs）`);
  else if (v.destination !== l.destination) r.error(`${l.source}: vercel.json 目的地與資料不同步`);
  else if (v.statusCode !== 302) r.error(`${l.source}: 狀態碼不是 302`);
  const c = chans.get(l.channel);
  if (!c?.enabled) r.error(`${l.source}: 通路 ${l.channel} 未啟用`);
  else {
    const u = new URL(l.destination);
    if (!hostAllowed(u.hostname, c.hosts)) r.error(`${l.source}: 網域 ${u.hostname} 不在 ${l.channel} 白名單`);
    if (!follow) for (const k of c.requiredParams ?? []) if (!u.searchParams.has(k) && !u.pathname.includes(k)) r.warn(`${l.source}: 目的網址未見聯盟參數「${k}」（若參數在轉址後才附加，請看追蹤落點結果）`);
  }
}
if (!r.errors) r.ok(`靜態檢查：${links.length} 條連結與資料一致`);

const results = [];
if (base) {
  for (const l of links) {
    const row = { source: l.source, channel: l.channel, code: l.code, steps: [] };
    try {
      const h = await hop(base + l.source);
      row.steps.push({ url: base + l.source, ...h });
      if (h.status !== 302) r.error(`${l.source}: 線上回應 ${h.status}，應為 302`);
      else if (h.location !== l.destination) r.error(`${l.source}: 線上 Location 與資料不同（${h.location}）`);
      if (!/noindex/i.test(h.xrobots ?? '')) r.error(`${l.source}: 線上回應缺 X-Robots-Tag: noindex`);

      if (follow && h.status === 302) {
        const c = chans.get(l.channel);
        const chain = [l.destination];
        let url = l.destination, final = null;
        for (let i = 0; i < cfg.maxHops; i++) {
          await sleep(cfg.delayMs);
          const s = await hop(url);
          row.steps.push({ url, ...s });
          if (s.status >= 300 && s.status < 400 && s.location) {
            let next;
            try { next = new URL(s.location, url).toString(); } catch { break; }
            if (!/^https?:/i.test(s.location) && /^[a-z][a-z0-9+.-]*:/i.test(s.location)) { final = { status: 'app-scheme' }; break; }
            chain.push(next); url = next; continue;
          }
          final = s; break;
        }
        row.final = final;
        if (!final) r.warn(`${l.source}: 轉址鏈超過 ${cfg.maxHops} 跳或無法解析`);
        else if (final.status === 'app-scheme') r.ok(`${l.source}: 轉到 App 協定（視為正常）`);
        else if (final.status === 404 || final.status === 410) r.error(`${l.source}: 落點 ${final.status}，商品/頁面可能已下架`);
        else if ([403, 429].includes(final.status) || final.status >= 500) r.warn(`${l.source}: 落點回應 ${final.status}，無法判斷（可能是賣場限流），請人工用手機確認`);
        else if (final.status >= 200 && final.status < 300) r.ok(`${l.source}: 落點正常 (${final.status})`);
        else r.warn(`${l.source}: 落點狀態 ${final.status}`);
        const finalHost = new URL(chain.at(-1)).hostname;
        if (c && !hostAllowed(finalHost, c.hosts)) r.warn(`${l.source}: 落點網域 ${finalHost} 不在 ${l.channel} 的 hosts（若為正常的中介網域，請補進 channels.json）`);
        for (const k of c?.requiredParams ?? []) {
          if (chain.some((u) => u.includes(k))) continue;
          (final?.status === 'app-scheme' ? r.warn : r.error)(`${l.source}: 整條轉址鏈都找不到聯盟參數「${k}」` + (final?.status === 'app-scheme' ? '（落點為 App 協定，無法判斷，請用聯盟後台點擊報表確認）' : '，歸因可能遺失'));
        }
      }
    } catch (e) {
      r.warn(`${l.source}: 請求失敗（${e.name === 'AbortError' ? '逾時' : e.message}），無法判斷`);
    }
    results.push(row);
    if (base) await sleep(cfg.delayMs);
  }
}

if (base) {
  fs.mkdirSync(p('reports'), { recursive: true });
  const f = p('reports', `link-check-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), base, follow, errors: r.errors, warns: r.warns, results }, null, 2));
  console.log('報告已寫入 ' + f);
}
process.exit(r.print() ? 1 : 0);
