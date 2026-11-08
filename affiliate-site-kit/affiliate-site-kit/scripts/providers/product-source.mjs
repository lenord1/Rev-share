// 「商品資料來源」介面：貼蝦皮／酷澎商品連結時，名稱、價格、圖片應來自官方 API，不是爬網頁。
// 與同資料夾的價格 provider（fetchObservations）分開：這裡是單一商品的基本資料。
//
// 每個來源（shopee-product.mjs / coupang-product.mjs）要匯出：
//   name                    來源名稱
//   implemented             官方文件到位並完成實作後才改為 true
//   fetchProduct(ids, ctx)  回傳 SourceProduct（見下）；沒設定／失敗請丟 ProviderNotConfigured 或一般 Error
//
// SourceProduct = {
//   name: string, description?: string, brand?: string, sku?: string,
//   price?: { amount: number, currency: 'TWD' },   // 整數 TWD
//   imageUrls: string[],                            // 官方 API 回傳的圖片網址（授權仍需人工確認）
//   method: string,                                 // 例如 'shopee-api'，會寫進草稿的 source.method
// }
//
// 規則：不猜簽章方式、不抓網頁；金鑰只從環境變數（GitHub Secrets）讀，不寫進檔案。
export class ProviderNotConfigured extends Error {
  constructor(provider, message) { super(message); this.name = 'ProviderNotConfigured'; this.provider = provider; }
}

export async function loadProductSource(kind) {
  if (kind === 'shopee') return import('./shopee-product.mjs');
  if (kind === 'coupang') return import('./coupang-product.mjs');
  return null;
}
