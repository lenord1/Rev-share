# BUILD_LOG

> 這份檔案是建站流程的唯一狀態來源。每完成一步由 Claude 更新；新對話只要讀它就能接續。

## 決策
| 項目 | 選擇 |
|---|---|
| 起點 | 從零開始 |
| 品類 | 除濕機、洗衣機、熱水器、冷氣、掃地機 |
| 啟用通路 | 蝦皮 + 酷澎（第一階段預設，對應 channels.json） |
| 內容範圍 | 家電（旅遊於 Step 14 後期再加） |
| 價格資料來源 | 酷澎：官方 API 已確認存在（文件連結待提供，Step 15）；蝦皮：待確認，預設 manual |
| 情境頁 | （想先做的情境與導言：待 Step 5 決定） |
| sub_id 歸因 | （待確認聯盟後台是否支援，Step 12 延伸） |
| 點擊追蹤方案 | （Umami／Plausible／自架 endpoint／暫不送） |
| 站名 | （Step 9 再定） |
| 正式網域 | （Step 9 再定） |
| 視覺風格／主色 | 極簡 / |
| 評測依據標示 | （規格整理／評價彙整／實測） |
| 作者呈現方式 | |
| 每步 commit | 否 |
| Step 7 | 使用者決定先以模擬方式跳過（2026-11-07）：沒有聯盟帳號前，/go/ 只驗證轉址設定與 rel、data-track，不做真實連結與手機 App 喚醒實測；拿到蝦皮、酷澎聯盟連結後回頭補做 |
| 帳號 | GitHub: ☐　Vercel: ☐　聯盟: ☐（皆未備，之後再處理） |

## 進度
- [ ] Step 0 定位與決策
- [ ] Step 1 專案初始化與首次部署
- [ ] Step 2 規格資料庫
- [ ] Step 3 轉址、Layout、防掉單
- [ ] Step 4 首頁與 3 秒選購精靈
- [ ] Step 5 pSEO 評測頁母版
- [ ] Step 6 必備頁面與內容
- [ ] Step 7 聯盟連結落地與歸因實測（模擬跳過，待補：真實連結、手機喚醒 App、聯盟後台點擊紀錄）
- [ ] Step 8 SEO 技術檢查（檢查完成，5 項已修，待 npm run local:check 通過並經你確認後打勾）
- [ ] Step 9 網域與 HTTPS
- [ ] Step 10 上線前檢查
- [ ] Step 11 上線與維運
- [ ] Step 12 成長（選配）
- [ ] Step 13 新通路上線（酷澎等）
- [ ] Step 14 旅遊分潤模組（後期）
- [ ] Step 15 自動化資料來源（確認官方 API 後）
- [ ] Step 16 內容與社群半自動（人工核准）

## Step 8 SEO 技術檢查結果（2026-11-07，由 claude.ai 對 dist 執行）
- `verify.mjs 8`／`audit-dist`：0 錯誤 0 警告（5 個商品頁、1 個情境頁；sitemap、robots 封鎖 /go/、JS 共 17.3 KB）
- 每頁 title、description、canonical、單一 H1：齊全；JSON-LD：商品頁 BreadcrumbList＋Product＋FAQPage，情境頁 BreadcrumbList＋FAQPage
- 效能（Chromium 模擬 Moto G4、4 倍 CPU 降速、慢速 4G；非正式 Lighthouse）：LCP 0.6–0.8 秒、CLS 0、單頁傳輸 28–46 KB。目前沒有商品圖，加圖後要重量。正式分數待部署後用 PageSpeed Insights 跑
- 已處理：新增 `public/og-default.png`（1200×630 分享縮圖），`Layout.astro` 預設使用並加上 twitter:card
- **待修項目已由 claude.ai 直接改好原始碼（2026-11-07，語法檢查通過，尚未在本機建置）**：
  1. ✅ sitemap 排除 noindex 頁：新增 `src/lib/indexing.mjs`，`astro.config.mjs` 的 sitemap filter 與各頁 `<meta robots>` 共用
  2. ✅ 到手價明細加「結帳金額」（標價−現折），與 Product JSON-LD 的 offers.price 一致
  3. ✅ 首頁加 WebSite JSON-LD（站名取自 site.json）
  4. ✅ 404 頁不輸出 canonical（Layout 支援 `canonical={false}`）
  5. ✅ 內部連結：商品頁「也可以這樣挑」、首頁「依情境挑」連到情境頁
  6. ⏳ 有真實商品圖後：Product JSON-LD 加 `image`，商品頁 og:image 改用商品圖
  - 另修：情境頁 `<script>` 移進 Layout（原本輸出在 `</html>` 之後）；示範除濕機 C 的規格改成與 A 不同
- **本機環境**：新增 `scripts/serve-local.mjs`（照 vercel.json 套用 /go/ 302 與 headers；`--sim` 讓示範商品停在模擬轉址頁）與 `scripts/local-check.mjs`（一鍵完整檢查）。指令：`npm run local`、`npm run local:check`
- **下一步**：執行 `npm run local:check`。全部通過後，由你在 `npm run local` 開的網站上目視確認，再勾選 Step 8

## 人工驗收紀錄
（每步使用者確認過的項目與日期）

## 已知問題 / 待辦
- 手機商品頁：確認「到手價明細」按鈕可見時 StickyCta 確實收起（整頁截圖看起來重疊，需實機確認）
- site.json 營運者、聯絡信箱未填；astro.config.mjs 的 site 仍為佔位網址（Step 9）
- 商品圖尚未提供（需官方或授權圖片）

## 需實測項目結果
- Vercel redirect 是否附加原 query：
- /go/ headers 是否出現在 redirect 回應：
- Threads 內嵌瀏覽器 UA 字串：

## 營運紀錄
- 價格最後記錄日：
- 最後一次連結健康檢查（日期／結果）：
- 最近一次週對帳（週別／比率）：

## 交接：下一個對話要做的事（2026-11-08）

目前進度：Step 0–6 程式完成待驗收、Step 7 模擬跳過、Step 8 待本機驗證後打勾。本機用 `npm run local` 看網站、`npm run local:check` 跑完整檢查。

資料現況：45 個品類（分 5 個大類）、91 台**示範**商品（全部 `demo: true`，不收錄）。含模擬價格紀錄（`node scripts/sim-demo-history.mjs`，`--clear` 可移除）、痛點 SEO 文章（`article` 欄位）、優點（`strength` 欄位）。

### 商品匯入工具（貼連結 → 草稿商品）
**狀態（2026-11-08）**：通用部分已完成並有離線測試（`npm run test:import`，24 項）；說明見 `docs/product-import.md`。
- 已做：網址解析（蝦皮 shopId／itemId、酷澎 productId）、一般網站 OpenGraph／JSON-LD、robots.txt 與限速、圖片下載與來源登記（`src/data/image-sources.json`）、草稿（`src/data/drafts/`）、轉正式驗證（缺點／優點／評論彙整／圖片授權）、`import-product.yml`。
- **待你提供後才能做**：蝦皮聯盟後台（台灣）是否有官方資料介面與文件；酷澎官方 API 文件連結。介面已預留在 `scripts/providers/{shopee,coupang}-product.mjs`（`implemented = false`，不猜簽名、不爬網頁）。
- 待你實測：`import-product.yml` 第一次在 GitHub 手機版執行（需先開啟 Actions 建立 PR 的權限）；找一個有 OpenGraph／JSON-LD 的真實品牌官網商品頁試一次。
- 待你確認：各聯盟條款對圖片使用的規定（確認前，所有匯入圖片維持「待確認授權」，不會上線）。

決策：
- 放在專案的 `scripts/`，不做成網站上的頁面（公開靜態站不放寫入表單）。
- 入口有兩個：手機 Claude（Code 分頁）說「新增這個商品」；或 GitHub 手機版執行工作流程 `import-product.yml`（輸入欄位 url），結果為 PR。
- 依網域分流：蝦皮、酷澎走各自 API（`scripts/providers/`，設定驅動，不猜簽名）；其他網站只讀公開的 OpenGraph／JSON-LD，遵守 robots.txt、放慢速度；抓不到就請使用者手動貼。
- 不爬蝦皮／酷澎網頁（違反條款、會被擋）。
- 產出為「草稿」：放候選清單，不出現在網站；補完缺點、優點、評論彙整並通過驗證器才轉正式。
- 圖片下載到 `src/assets/products/`，記錄來源與抓取日期；他站圖片預設標「待確認授權」，不自動上線。
- API 金鑰只放 GitHub Secrets，不進對話與專案檔案。
- 選品不以佣金排序，以評價與銷量為準。

待使用者確認：蝦皮聯盟後台（台灣）是否有開放 API、欄位與簽名文件；酷澎 API 官方文件連結；各聯盟條款對圖片使用的規定。

### 內容策略（已決定）
- 定位為「評論彙整」，不假裝實測。每條痛點要有樣本數、來源平台、彙整日期；樣本不足就顯示「評論樣本不足」；商品問題與賣家／物流問題分開。
- 之後要加：資料結構 `painPoints`（則數、樣本、來源）、「缺點但非致命」區塊、任選 2–3 台並排比較、「我們怎麼彙整」頁、更新紀錄。
- 上線時只放做過深度內容的品類（先 3–5 個），其餘維持不收錄。

### 上線順序（Step 9–11）
專案推上 GitHub → Vercel 匯入 → 網域 → 蝦皮聯盟帳號 → 示範資料換成真實商品、跑嚴格驗證 → 手機實測 /go/ 轉址與 App 喚醒（Step 7）。
