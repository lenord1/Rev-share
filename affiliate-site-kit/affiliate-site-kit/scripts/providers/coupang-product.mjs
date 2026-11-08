// 酷澎商品資料來源（預留）。
// 酷澎官方 API 已確認存在，但實際網址、驗證與簽章方式要等你提供官方文件連結後才實作；不猜簽章演算法。
// 實作時：設定放 scripts/config.json 的 productSources.coupang，憑證只從環境變數（GitHub Secrets）讀取。
// 價格觀測請看同資料夾的 coupang.mjs（價格 provider，與本檔分開）。
import { ProviderNotConfigured } from './product-source.mjs';
export const name = 'coupang-product';
export const implemented = false;

export async function fetchProduct(/* { productId, itemId, vendorItemId }, ctx */) {
  throw new ProviderNotConfigured('coupang', '酷澎官方 API 尚未接上（等待官方文件）；請手動補名稱、價格、圖片。');
}
