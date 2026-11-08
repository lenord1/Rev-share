# 商品匯入工具（貼連結 → 草稿商品）

目標：貼一個商品網址，得到「草稿」與圖片；草稿補完才能轉正式。草稿放在 `src/data/drafts/`，網站、`validate-products`、`vercel.json` 都不會讀到。

## 入口
1. 手機 GitHub：Actions → `import-product` → Run workflow → 填 `url`（可選 `category`）→ 產生 PR（內含缺項清單）。第一次要到 Settings → Actions → General 開啟「Allow GitHub Actions to create and approve pull requests」。
2. Claude Code（手機或電腦）：說「新增這個商品 <網址>」，或自己跑 `npm run import-product -- <網址>`。

## 依網域分流
| 網址 | 做法 |
|---|---|
| 蝦皮（shopee.tw） | 只解析 shopId／itemId；名稱、價格、圖片等官方資料介面接上後自動取得，現在手動補。短網址（shp.ee）不展開（要連到蝦皮），請貼完整網址 |
| 酷澎（coupang.com） | 只解析 productId／itemId／vendorItemId；同上，等官方 API 文件 |
| 其他網站 | 讀公開的 JSON-LD（Product）與 OpenGraph；遵守 robots.txt、同網域間隔 ≥3 秒、2 MB／8 MB 上限、不重試；轉址逐跳檢查，不進蝦皮／酷澎、不進內網位址 |

抓不到公開資料時結束碼為 3，改用 `--name --price --image-file` 手動補。

## 草稿檔
`src/data/drafts/<代號>.json`：`source`（來源網址、取得方式、日期）、`extracted`（來源原樣）、`images`（來源、日期、sha256、授權狀態）、`product`（待補的商品欄位）、`editorial`（缺點、優點、評論彙整）、`notes`。來源網址只留在草稿，轉正式時不會寫進商品資料。

## 轉正式的條件（`node scripts/drafts.mjs check <代號>`）
- 具體缺點 `flaw`、優點 `strength`（有規格或官方說明作依據）。
- 評論彙整：來源平台＋則數、`sampleSize` 等於合計、彙整日期、自己寫的摘要、至少一條優點與缺點；樣本 <10 則會提醒頁面要標「評論樣本不足」。商品問題與賣家／物流問題分開記（`sellerLogisticsNotes`）。
- 至少一張已確認授權的圖片：`node scripts/drafts.mjs license <代號> <檔名> official|owned|licensed`。他站圖片預設 `pending-review`，不會上線。
- 品類、slug、型號、價格、tldr、規格、你從聯盟後台取得的分潤連結。
- `node scripts/drafts.mjs promote <代號>` 會寫入 `products.json` 並跑 `validate-products`，失敗自動還原。之後 `npm run sync`、`npm run local:check`。

## 不做的事
不爬蝦皮／酷澎網頁、不猜 API 簽名、金鑰不進對話或檔案（之後只放 GitHub Secrets）、不以佣金排序選品、不替你確認圖片授權。
