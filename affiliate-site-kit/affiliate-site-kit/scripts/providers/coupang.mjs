// 酷澎官方 API provider（使用者已確認酷澎提供官方 API）。
// 依官方文件填寫 scripts/config.json 的 providers.coupang：
//   urlTemplate  含 {id} 的請求網址（{id} 會換成商品的 channelIds.coupang）
//   tokenEnv     存放憑證的環境變數名稱（憑證只放 GitHub Secrets / 本機環境變數，不寫進任何檔案）
//   tokenHeader / tokenPrefix  憑證放在哪個標頭、什麼前綴
//   pricePath    回應 JSON 中價格的路徑，如 "data.salePrice"
// 官方若採用簽章式驗證（非固定 token），請依官方文件改寫 buildHeaders()；本檔不猜測簽章演算法。
// 單筆失敗只略過該筆（記錄原因），不中斷整批；低頻率請求（delayMs）。
// 測試用：COUPANG_FIXTURE=<json 檔路徑>（格式 { "<id>": <價格> }）可不連網乾跑。
import fs from 'node:fs';
import { p, readJson, loadConfig, exists } from '../lib.mjs';
export const name = 'coupang';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (obj, path) => path.split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function buildHeaders(cfg, env = process.env) {
  const headers = { accept: 'application/json', 'user-agent': 'affiliate-price-observer/1.0 (site owner)' };
  const token = env[cfg.tokenEnv];
  if (!token) throw new Error(`缺少環境變數 ${cfg.tokenEnv}（請到 GitHub Secrets 或本機設定；不要貼給 AI）`);
  headers[cfg.tokenHeader || 'Authorization'] = `${cfg.tokenPrefix ?? ''}${token}`;
  return headers;
}

export async function fetchObservations({ log = (m) => console.warn(m) } = {}) {
  const cfg = loadConfig().providers?.coupang ?? {};
  const products = readJson('src', 'data', 'products.json').products.filter((x) => x.channelIds?.coupang && x.affiliate?.coupang && !x.demo);
  if (!products.length) return [];
  const fx = process.env.COUPANG_FIXTURE ? JSON.parse(fs.readFileSync(process.env.COUPANG_FIXTURE, 'utf8')) : null;
  if (!fx && (!cfg.urlTemplate || !cfg.pricePath)) throw new Error('providers.coupang 尚未設定 urlTemplate / pricePath（請依官方 API 文件填寫）');
  const headers = fx ? {} : buildHeaders(cfg);
  const out = [];
  for (const x of products) {
    const id = x.channelIds.coupang;
    try {
      let price;
      if (fx) price = fx[id];
      else {
        const res = await fetch(cfg.urlTemplate.replace('{id}', encodeURIComponent(id)), { method: cfg.method || 'GET', headers, signal: AbortSignal.timeout(cfg.timeoutMs ?? 10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        price = pick(await res.json(), cfg.pricePath);
        await sleep(cfg.delayMs ?? 800);
      }
      price = Number(price);
      if (!Number.isInteger(price) || price <= 0) throw new Error('回應沒有可用的整數價格');
      out.push({ modelCode: x.modelCode, channel: 'coupang', price, observedAt: new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10) });
    } catch (e) {
      log(`[coupang] ${x.modelCode} 略過：${e.message}`);
    }
  }
  return out;
}
