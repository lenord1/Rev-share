// 蝦皮商品資料來源（預留）。
// 目前沒有已確認的官方資料介面：待你提供蝦皮聯盟後台（台灣）的官方 API 文件（欄位、驗證與簽名方式）後，
// 才在 fetchProduct() 實作。在那之前不猜簽名、不爬網頁；匯入時只建立含 shopId／itemId 的骨架草稿，
// 名稱、價格、圖片請手動補（--name --price --image-file）。
import { ProviderNotConfigured } from './product-source.mjs';
export const name = 'shopee-product';
export const implemented = false;

export async function fetchProduct(/* { shopId, itemId }, ctx */) {
  throw new ProviderNotConfigured('shopee', '蝦皮官方 API 尚未接上（等待官方文件）；請手動補名稱、價格、圖片。');
}
