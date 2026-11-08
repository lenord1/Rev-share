// 檔案餵入資料來源：讀 data/price-feed.json（陣列），由「你自己的、合規的」收集流程寫入，
// 例如：你手動整理、聯盟後台匯出轉檔、或日後確認過官方 API 後另寫的腳本。
// 格式：[{ "modelCode": "…", "channel": "shopee", "price": 12900, "observedAt": "2026-11-06" }]
// 本套件不內建爬蟲：自動抓取賣場頁面可能違反使用條款且容易失效，請先確認各平台官方 API/條款。
import fs from 'node:fs';
import { p, exists } from '../lib.mjs';
export const name = 'feed';
export async function fetchObservations() {
  if (!exists('data', 'price-feed.json')) return [];
  return JSON.parse(fs.readFileSync(p('data', 'price-feed.json'), 'utf8'));
}
