# 導購站專案（Astro + Tailwind + Vercel + JSON pSEO）

商業目標：讀者進站 30 秒內完成規格篩選，點擊官方商城連結直接下單。

## 架構（已定案，不要改走 WordPress / 資料庫 / CMS）
- **以 Astro 為核心**：前端全部由 Astro 完成（頁面、元件、`<Image>` 圖片最佳化、sitemap、JSON-LD、建置期資料驗證 integration），靜態輸出 + Tailwind（深色模式）+ Vercel。零 JS 為預設，只有 SmartFinder、個人化層（QuizDialog / SmartSearch / IntentDrawer）、InAppWarning、StickyCta 帶最小量 script。不引入 React/Vue 等前端框架。
- **範圍**：第一階段只做家電 + 蝦皮 + 酷澎；旅遊是後期（Step 14），啟用前不要建立旅遊頁。
- 資料來源（皆在 `src/data/`）：`channels.json`（通路註冊表）、`products.json`（家電）、`travel.json`（旅遊，Step 14 後期才建立）、`price-history.json`（價格紀錄，腳本追加，勿手改）。CSV 維護用 `scripts/csv-to-products.mjs`。
- 到手價、促銷有效性、價格走勢統一用 `src/lib/pricing.mjs`，元件內不得重寫邏輯。
- 分潤連結只存在 `products.json` 的 `affiliate`（旅遊啟用後加 `travel.json` 的 offers）；HTML 一律 `/go/{通路}-{modelCode}`，由 `vercel.json` 302。
- **`vercel.json` 是產生檔但必須 commit**：改資料後在本機 `npm run sync` 再 commit。不要在建置時才產生，Vercel 的轉址設定很可能在建置前就已決定（需實測）。`integrations/validate-data.mjs` 在每次 `astro build` 前檢查資料與 vercel.json 是否同步，不同步就中止建置。
- 圖片放 `src/assets/products/`，用 Astro `<Image>`（自動寬高與最佳化）；每張必有 `alt`。只用官方提供素材或自有授權圖片。
- **UI 依 `docs/ui-spec.md` 與 `design/` 參考稿實作**（token、元件、文案規則）；不自行發明樣式。每個頁面類型完成後做視覺 QA（截圖比對）。
- **自動化到底**：`.github/workflows/`（由 templates 複製）的 ci / daily / weekly / link-check 負責驗證、價格觀測、commit 部署、重建、告警與週報；價格來源透過 `scripts/providers/`（預設 manual；本套件不內建爬蟲，需先確認官方 API 與條款）。
- **個人化意圖推薦（Step 4）依 `docs/personalization-spec.md`，參考稿 `design/personalize.html`**：問卷、搜尋語意排序、購買意圖抽屜三個模組只透過共享的 `userProfile`（`src/lib/profile.js`）串聯；純原生 JS、偏好只存 localStorage、抽屜的價格與「較低／較快」說法必須有資料支持（`pricing.mjs` 的 `priceStats` / `compareChannels`）。商品 `tags` 限用 `scripts/config.json` 的 `tagVocabulary`。
- **情境落地頁** `/{品類}/for/{情境}`：資料在 `src/data/intents.json`，產生規則在 `src/lib/intents.mjs`（符合商品數達門檻且導言已審核才產生）；導言由我審核，不得套模板量產。商品 slug 不可為 `for`。
- **酷澎官方 API 已確認存在**：Step 15 依官方文件實作 `scripts/providers/coupang.mjs`（已有骨架；請我提供官方文件連結，不要向我索取金鑰）。商品用 `channelIds.coupang` 存 API 商品 ID。蝦皮若沒有官方資料介面，維持 manual/feed。
- 語系 `zh-Hant-TW`；金額 TWD；年份由建置動態產生，不寫死。

## 指令
- `node scripts/validate-products.mjs [--strict]`：資料驗證（編輯 products.json 後 hook 會自動跑）
- `npm run sync`（= `node scripts/gen-redirects.mjs`）：由資料產生 vercel.json；`--check` 只比對
- `npm run build` 然後 `node scripts/audit-dist.mjs [--strict]`：建置稽核
- `node scripts/check-links.mjs [--base <網址> [--follow]]`：連結健康檢查（靜態／線上／追蹤落點）
- `node scripts/record-price.mjs [--stats]`：記錄價格（每次更新價格後執行）
- `node scripts/reconcile.mjs --week … --site … --dashboard …`：每週點擊對帳
- `node scripts/daily.mjs [--dry]`：每日管線（價格觀測→驗證→記錄→同步，失敗自動還原）
- `node scripts/weekly-report.mjs`：每週營運報告
- `node scripts/screenshot.mjs <url|檔案> <前綴>`：視覺 QA 截圖（需 playwright）
- `/draft-guide <品類>`、`/social-drafts <slug>`：內容與貼文起草（只起草，發布需我核准）
- `npm run local`：建置後在 http://localhost:4322 開本機網站，照 vercel.json 套用 /go/ 轉址（示範商品停在模擬轉址頁）；`npm run local:serve` 不重新建置
- `npm run local:check`：本機一鍵完整檢查（驗證、建置、閘門 0–8、全站頁面、/go/ 302、404、連結檢查、瀏覽器實測），結果寫入 reports/local-check.json。**部署前每次改動都先跑它**
- `node scripts/import-product.mjs <商品網址> [--category …]`：貼連結產生**草稿**商品與圖片（`src/data/drafts/`，不進網站）；`node scripts/drafts.mjs list|check|license|promote`：補完缺點、優點、評論彙整、圖片授權後才轉正式；`npm run test:import` 離線測試。蝦皮／酷澎只解析網址編號，資料等官方 API（`scripts/providers/*-product.mjs`），不爬網頁。說明：`docs/product-import.md`
- `node scripts/verify.mjs <0-16|all>`：步驟閘門（建站流程用 `/affiliate-site-architect`）

## 不可違反
1. HTML 內不得出現賣場網址；所有 `/go/` 連結 `rel="sponsored nofollow noopener"`。
2. 每個商品必有一個具體缺點（`flaw`）與到手價算式（價格 − 折扣 − 退稅，促銷過期則不計）。缺資料就讓建置報錯，不要補編。促銷到期是「建置時」判斷，所以依賴每日重建。
3. 不捏造規格、價格、評價；沒有真實評價資料就不輸出 `aggregateRating` / `review`。示範資料必須帶 `demo: true`。
4. FAQPage 的問答必須在頁面上看得到。每頁都有分潤揭露。
5. 不向使用者索取密碼、API key、token、聯盟後台登入資訊；登入、付款、DNS、後台操作由使用者自己做，你只指引。
6. 聯盟條款、Vercel/DNS 實際設定值、App 喚醒行為：標示「需實測」，以官方後台為準，不憑記憶斷言。
7. 購買意圖抽屜只在「缺點區或規格區 ≥50% 在畫面內累計 ≥5 秒」時出現、每商品每工作階段一次；偏好不上傳；沒有價格資料不得說「歷史最低」，沒有（附來源與日期的）資料不得標「標價較低／較快到貨」，不得寫沒有來源的到貨承諾。價格走勢資料不足（<3 筆或跨度 <14 天）時不得顯示「划算／偏高」判斷；倒數只在有真實到期日時出現；旅遊頁不存、不顯示精確價格；連結檢查只低頻看狀態碼，403/429 是「無法判斷」不是「失效」。
8. 新增通路只改 `channels.json` 與資料；`confirmed: true` 必須由使用者對照聯盟後台實際連結後確認。
9. 不主動 commit / push；除非 `BUILD_LOG.md` 決策表寫了「每步 commit：是」。（GitHub Actions 的 bot 自動 commit 資料檔不在此限。）
10. AI 產出的內容與貼文一律先存為草稿，經使用者審核才發布；事實主張要有來源，第一手經驗只能寫使用者真實提供的。價格觀測異常（變動超過門檻）不得自動套用。API 金鑰只放 Secrets/環境變數。

## 流程狀態
目前進度與決策在 `BUILD_LOG.md`。建站請用 `/affiliate-site-architect`（可帶參數：`status`、`next`、`links`、步驟號碼）。
