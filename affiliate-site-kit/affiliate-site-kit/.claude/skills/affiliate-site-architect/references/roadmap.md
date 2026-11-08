# 建站路線圖（Step 0–16）

每步格式：**目標／要問／產出／驗收／選配延伸**。「要問」只問必要決策，附推薦預設。選配延伸預設不做。

## 機器閘門對照

| Step | 閘門指令 | 備註 |
|---|---|---|
| 0 | `node scripts/verify.mjs 0` | BUILD_LOG 決策表 |
| 1 | `node scripts/verify.mjs 1` + `npm run build` | 套件、site 設定 |
| 2 | `node scripts/verify.mjs 2` | 即 `validate-products.mjs` |
| 3 | `node scripts/verify.mjs 3` | vercel.json 同步、302、robots、Layout |
| 4 | `node scripts/verify.mjs 4` + `npm run build` | |
| 5 | `npm run build` → `node scripts/verify.mjs 5` | 含 `audit-dist.mjs`（含情境頁） |
| 6 | `node scripts/verify.mjs 6` | 必備頁面存在 |
| 7 | `node scripts/verify.mjs 7` | 無佔位轉址 |
| 8 | `npm run build` → `node scripts/verify.mjs 8` | |
| 9 | `node scripts/verify.mjs 9` | site 為正式網域 |
| 10 | `npm run launch-check` + `launch-reviewer` 子代理 | strict 模式 |
| 11 | `node scripts/verify.mjs 11` | 重建與連結檢查 workflow 存在 |
| 13 | `node scripts/verify.mjs 13` | 新通路 confirmed、有連結使用 |
| 14 | `npm run build` → `node scripts/verify.mjs 14` | 旅遊頁與稽核 |
| 15 | `node scripts/verify.mjs 15` | provider 設定、coupang 設定完整性與乾跑 |
| 16 | `node scripts/verify.mjs 16` | 內容集合與草稿規則 |

機器閘門只檢查能自動檢查的部分；每步仍須完成 verify 列出的「人工驗收」項目，使用者確認後才勾選。

## 目錄
- Step 0 定位與決策
- Step 1 專案初始化與首次部署
- Step 2–5 程式碼步驟（規格在 stages.md）
- Step 6 必備頁面與內容
- Step 7 聯盟連結落地與歸因實測
- Step 8 SEO 技術檢查
- Step 9 網域與 HTTPS
- Step 10 上線前檢查
- Step 11 上線與維運
- Step 12 成長（選配）
- Step 13 新增其他通路（日後擴充）
- Step 14 旅遊分潤模組（後期）
- Step 15 自動化資料來源（確認官方 API 後）
- Step 16 內容與社群半自動（人工核准）
- 附錄：日常營運節奏

---

## Step 0 定位與決策

**目標**：把後面所有步驟需要的決策一次定下來，避免來回改。
**要問**（用選項，附推薦）：
1. 起點：從零開始（推薦）／已有 Astro 專案／指定某一步。
2. 品類：預設五類（除濕機、洗衣機、熱水器、冷氣、掃地機，推薦）或自訂。
3. 通路：第一階段預設蝦皮 + 酷澎（`channels.json` 已啟用）。若只有其中一個聯盟帳號，另一個先改 `enabled: false`，之後 Step 13 再開。
3b. 內容範圍：第一階段只做家電；旅遊放後期（Step 14），不在此時建立。
4. 站名與網域：已決定／還沒（沒關係，Step 9 再處理）。
5. 是否已有 GitHub、Vercel 帳號與聯盟帳號（通過與否）。
**產出**：`BUILD_LOG.md` 決策表。
**驗收**：使用者確認決策表無誤。
**延伸**：看 2–3 個同類型站的版面作參考；站名與網域候選清單。

## Step 1 專案初始化與首次部署

**目標**：本機跑得起來，且已有 Vercel 預覽網址（早期就串好部署，後面每步都能立刻看到線上結果）。
**要問**：本機是否有 Node 與 git（請使用者執行 `node -v`、`git --version` 回報；版本需求以 Astro 官方文件為準，不憑記憶寫死）。有檔案與 Bash 工具就直接檢查。
**產出**：
- `npm create astro@latest`、`npx astro add tailwind`、`npx astro add sitemap` 的指令序列。
- `astro.config.mjs` 的 `site`（先用 Vercel 預覽網址，Step 9 再換正式網域）。
- `.gitignore`、推上 GitHub、在 Vercel 匯入 repo（使用者操作）。
**驗收**：`npm run dev` 看到預設頁；`npm run build` 成功；Vercel 預覽網址可開。
**延伸**：Prettier／ESLint；`.nvmrc` 鎖 Node 版本；分支預覽流程說明。

## Step 2 規格資料庫

規格見 stages.md「Step 2」。專案已附示範資料與驗證腳本（`validate-products.mjs`、`csv-to-products.mjs`）。
**要問**：先放幾個型號（推薦每品類 2–3 個、先做 1–2 個品類跑通流程）；用 CSV 試算表維護，還是直接編輯 JSON（推薦 CSV）。
**提醒**：規格請以官方網站為準，自行整理；商品圖片使用官方提供素材或自有授權的圖，不直接盜用賣場圖片。示範資料要標註。
**價格紀錄從這步開始**：資料一換成真實商品，立刻執行 `node scripts/record-price.mjs`，之後每次更新價格都再執行一次（同日覆蓋、不重複；示範資料不會被記錄）。走勢要累積 ≥3 筆且跨 ≥14 天才會在前台顯示判斷，所以越早開始越好。紀錄的是標價，不是到手價。
**通路設定**：確認 `src/data/channels.json` 只啟用你現有的通路；`confirmed` 要等你對照聯盟後台實際產生的連結確認網域與參數後才改為 true（Step 7 前必須完成）。
**驗收**：資料轉換成功；故意刪掉一個 `flaw` 確認會報錯；`price-history.json` 開始累積。
**延伸**：規格欄位標準化對照表；資料來源欄位（`sourceUrl`）方便日後核對。

## Step 3 轉址、Layout、防掉單

規格見 stages.md「Step 3」。**重點**：`vercel.json` 用 `npm run sync` 產生並 commit；`astro.config` 註冊 `integrations/validate-data.mjs`，每次建置前檢查資料與 vercel.json 同步。`gen-redirects.mjs` 已附；把 `templates/package-scripts.json` 合併進 package.json。
**要問**：目前有沒有真實分潤網址？沒有就先用佔位網址，Step 7 再換。
**驗收**：`curl -I` 檢查 302、Location、X-Robots-Tag；改 UA 測試提示條。需實測項目逐項確認。
**點擊追蹤**：Layout 啟用 `initTrack()`，所有 `/go/` 連結帶 `data-track="go"` 與 `data-channel`、`data-code`、`data-slot`。要問使用者要把事件送去哪裡（Umami／Plausible／自架 endpoint／先不送），以其方案與價格為準，你不憑記憶斷言各平台功能限制。
**延伸**：Edge Middleware 在轉址當下計數（比前端 beacon 精確，但較複雜，beacon 不夠用再升級）；兩通路自動 fallback。

## Step 4 首頁與 3 秒選購精靈

規格見 stages.md「Step 4」。
**視覺依據**：`docs/ui-spec.md` 與 `design/` 參考稿（已定案的設計語彙，Astro 元件要對齊，不要重新設計）。
**要問**：站名與品牌色是否沿用參考稿（預設沿用；只想換主色就改 `accent` token）。
**驗收**：3 次點擊內出結果；依 `docs/ui-spec.md` 的「視覺 QA」截圖並與 `design/home.html` 比對（手機/桌機 × 淺色/深色）；使用者目視確認。
**個人化層（必做）**：依 `docs/personalization-spec.md` 實作 `profile.js`、`rank.js`、`QuizDialog`、`SmartSearch`、`ProfileBar`、`IntentDrawer`（缺點區／規格區可見 5 秒觸發、雙通路 CTA）、自適應篩選；對照 `design/personalize.html` 的行為與文案。SmartFinder 的答案也寫入同一個 Profile。驗收加測規格書「驗收」第 2 點的 8 項情境。
**延伸**：精靈結果可分享連結；精靈問答題目依品類客製。

## Step 5 pSEO 評測頁母版

規格見 stages.md「Step 5」。
**要問**：評測依據怎麼標示（規格整理／使用者評價彙整／實測，推薦如實標示，不假裝實測）。
**驗收**：`npm run build` 每商品一頁；Rich Results Test 無錯誤；360px 表格可橫滑、首欄固定；依「視覺 QA」與 `design/product.html` 比對（桌機要有右側黏性到手價明細、手機要有底部 CTA）；使用者目視確認。
**轉換元件**（stages.md Step 5 有規格）：`StickyCta`（手機固定底部列）、`PriceHistory`（價格走勢，資料不足不下判斷）、`TotalCost`（到手價拆解＋額外費用＋保固退貨）、「不適合你的情況」、「如果只能選一台」。多通路有價格時並列顯示並誠實標出較低者。倒數只在有真實到期日且 ≤14 天時出現。
**情境落地頁（必做）**：`src/pages/[category]/for/[intent].astro`，資料 `src/data/intents.json`，產生規則用 `src/lib/intents.mjs` 的 `buildableIntents`（符合商品 ≥2 台且 `introApproved`）。要問：想先做哪幾個情境（如：家有嬰兒、養寵物、小坪數、預算有限），並請你提供或審核每頁專屬導言（不得套模板量產）。驗收：`npm run build` 後 `audit-dist` 的情境頁檢查通過；每頁每台都有缺點與到手價、連到自己的評測頁；使用者確認導言真實。
**延伸**：品類索引頁 `[category]/index.astro`；兩商品直接比較頁。

## Step 6 必備頁面與內容

**目標**：補齊信任與合規頁面，並寫出第一批真正有用的內容。
**要問**：站長／作者如何呈現（真實姓名、團隊或匿名，推薦如實標示編輯原則）；是否需要「買前指南」類文章。
**產出**：關於本站（選品原則、如何獲利）、分潤揭露頁、隱私權政策、聯絡方式、404 頁、品類索引頁；每品類 1 篇買前指南（選購重點、常見誤區）。內容以幫讀者做決定為主，避免堆關鍵字。
**驗收**：頁尾與文章頁都連到揭露與隱私頁；404 頁可返回首頁。
**延伸**：常見問題總頁；更新日誌頁。

## Step 7 聯盟連結落地與歸因實測

**目標**：把真實分潤連結換進資料庫，確認連結健康、歸因參數還在、點擊確實被聯盟後台記錄。
**使用者自己做**：登入聯盟後台產生連結（你不代操作、不要憑證）。
**要問**：各通路連結是否已取得；聯盟條款是否允許轉址與短網址、揭露要求為何（請使用者對照官方條款，你不憑記憶斷言）；連結裡哪個參數代表「你的聯盟身分」（填進 channels.json 的 `requiredParams`）。
**產出**：真實連結填入資料；`channels.json` 的 `hosts`、`requiredParams` 依實際連結修正並設 `confirmed: true`；執行 `gen-redirects`；部署。
**連結健康檢查**（`scripts/check-links.mjs`，四層）：
1. 靜態：`node scripts/check-links.mjs`（vercel.json 與資料一致、302、網域白名單）。
2. 線上轉址：`node scripts/check-links.mjs --base https://預覽或正式網址`（302、Location、X-Robots-Tag）。
3. 落點追蹤：加 `--follow`（沿轉址鏈到落點：404/410 視為下架；403/429/5xx 只是「無法判斷」，不算失效；整條鏈找不到聯盟參數視為歸因風險）。腳本低頻、只看狀態碼，不解析頁面，也不要改成大量爬取。
4. 佣金層（人工）：手機從 Safari/Chrome 點 `/go/…` 確認落到正確商品並喚醒 App；到聯盟後台看點擊報表有紀錄（可能延遲）；測 IG／LINE／Threads 內嵌瀏覽器流程。
**驗收**：`verify 7` 通過；`check-links --base … --follow` 無錯誤；報告存於 `reports/`。
**延伸**：失效連結自動開 issue；兩通路價差顯示。

## Step 8 SEO 技術檢查

**產出與檢查**：sitemap 有產出且網址正確；`robots.txt`；每頁 canonical、title、description；Open Graph 圖；三種 JSON-LD 驗證；Lighthouse 手機版跑一次並回報分數與主要問題；內部連結（首頁→品類→商品→相關商品）。
**驗收**：Lighthouse 達標或列出待修清單。
**延伸**：自動產生 OG 圖；RSS。

## Step 9 網域與 HTTPS

**使用者自己做**：購買網域、在 Vercel 專案加入網域、依 Vercel 後台顯示的值設定 DNS（不憑記憶給記錄值）。
**要問**：主網址用 apex 還是 `www`（推薦擇一為主，另一個轉址過去）。
**產出**：更新 `astro.config.mjs` 的 `site`，重新部署。
**驗收**：HTTPS 正常；另一個網址會轉址到主網址；canonical 與 sitemap 都是正式網域。
**延伸**：自訂 email 寄件網域（若要做電子報）。

## Step 10 上線前檢查

逐項勾選，回報未通過項目：
- 所有 `/go/` 連結逐一點過，目的地正確。
- 每個商品都有缺點欄位、到手價算式正確、補助未過期。
- 價格更新日期與「價格以賣場頁面為準」的聲明可見。
- 分潤揭露在文章頁與頁尾都有。
- 手機實機測試（iOS、Android）與內嵌瀏覽器提示。
- Lighthouse 手機版、無 console 錯誤、404 頁正常。
- 沒有殘留示範資料、佔位連結、測試文字。

## Step 11 上線與維運

**使用者自己做**：在 Google Search Console 驗證網站並提交 sitemap。
**產出**：
- 複製 `templates/.github/workflows/` 的 `ci.yml`、`daily.yml`、`weekly.yml`、`link-check.yml` 到 `.github/workflows/`：
  - `ci.yml`：每個 PR/推送跑驗證、同步檢查、建置、稽核。
  - `daily.yml`：每日跑 `scripts/daily.mjs`（價格觀測→驗證→記錄→同步），有變動 bot 自動 commit 部署，沒變動就觸發 Deploy Hook 重建；失敗自動開 issue。需 Secrets `VERCEL_DEPLOY_HOOK`；main 有分支保護時 bot 無法直接 push，需調整。
  - `weekly.yml`：每週一產生營運報告並開 issue。
  - `link-check.yml`：每日檢查自己網域的 `/go/`，失敗自動開 issue（`--follow` 改每週在本機跑）。
- GitHub Variables 設定 `SITE_URL`（連結檢查用）；分支保護與 bot 權限依你的 repo 設定確認
- 點擊追蹤的資料去處：確認 Step 3 選的方案已實際收到事件（做一次測試點擊），讓價格日期與標題年份保持新。
- 維運節奏：每週（價格、失效連結、補助到期）；每月（Search Console 查詢表現、更新舊文章）。
- 選配：隱私友善的流量分析。
**驗收**：排程成功跑一次；Search Console 已收到 sitemap。
**延伸**：流量與點擊週報；補助到期提醒。
（日常節奏見文末「附錄」。）

## Step 12 成長（選配）

**`sub_id` 歸因**：先請使用者到蝦皮、酷澎聯盟後台確認有沒有可帶的子追蹤參數（需實測、以後台為準）；有的話用 Edge Middleware 在 `/go/` 轉址時依來源位置（`drawer-shopee`、`tldr`、`sticky` 等）附上，之後可精準對帳。確認前沿用前端 `data-slot` 計數與每週對帳。
社群導流（UTM 參數與內嵌瀏覽器流程）、擴充品類、比較頁、電子報、季節檔期專頁（雙 11 等，用 `promoBadge` 與到期日控制）。逐項詢問使用者想做哪一項再展開。

## Step 13 新增其他通路（日後擴充）

**目標**：在不改程式的前提下新增一個通路，並確保它同樣被驗證、轉址、健康檢查。
**使用者自己做**：確認已有該通路的聯盟帳號，並從後台產生至少一條真實連結。
**要問**：這個通路要用在哪些商品；價格要不要並列顯示（有 `prices` 才會並列）。
**產出**：
1. `channels.json`：該通路 `enabled: true`，`hosts`、`requiredParams` 依真實連結設定，確認後 `confirmed: true`。
2. 商品資料加上該通路的 `affiliate`，需要比價的加 `prices`（每個價格通路都必須有對應連結）；`primaryChannel` 決定主要 CTA。
3. `gen-redirects` → `check-links --base … --follow` → `verify 13`。
**驗收**：`verify 13` 通過；健康檢查無錯誤；手機實測可喚醒 App、聯盟後台有點擊。
**延伸**：兩通路價差提示；依通路分別的揭露文字。

## Step 14 旅遊分潤模組（後期）

**前提**：Step 10 已上線且家電站運作穩定後再做。
**目標**：新增旅遊內容類型，與家電共用同一套 `/go/` 轉址與驗證，但頁面邏輯不同：旅遊價格與庫存變動快，所以**不存、不顯示精確價格**，內容以目的地攻略＋平台比較為主。
**使用者自己做**：確認各旅遊平台的聯盟計畫與條款（旅遊分潤常經第三方聯盟網路，連結網域可能與平台官網不同，以後台實際連結為準）。
**要問**：先做哪些目的地（推薦 1–2 個跑通）；要比較哪些平台（對應 channels.json 內 `verticals` 含 travel 的通路）。
**產出**：把 `templates/travel.example.json` 複製為 `src/data/travel.json`（內容全是示範，需換成真實資料），在 `channels.json` 啟用旅遊通路，再建立 `src/pages/travel/`：`src/data/travel.json`、`src/pages/travel/index.astro`、`src/pages/travel/[slug].astro`（規格見 stages.md Step 14）。
**驗收**：`npm run build` → `verify 14`（含稽核：BreadcrumbList、FAQ 可見、無 Product/Offer、有「價格以平台頁面為準」）。
**延伸**：季節性專題頁；行程模板。

## 附錄：日常營運節奏

| 頻率 | 動作 | 指令／位置 |
|---|---|---|
| 每日（自動） | 重建站點、連結健康檢查 | GitHub Actions：`rebuild.yml`、`link-check.yml` |
| 每週 | 更新價格 → 記錄價格 → 同步轉址 → **commit & push 部署** | 更新 CSV → `npm run update-prices` → `npm run build` 自測 → commit（價格紀錄與 vercel.json 都是要 commit 的檔案） |
| 每週 | 對帳：本站點擊 vs 聯盟後台點擊 | `node scripts/reconcile.mjs --week 2026-W45 --site shopee=… --dashboard shopee=…`（累積 ≥3 週後才會判斷是否下滑） |
| 每週 | 手機抽測 3 條 `/go/` | 人工 |
| 每月 | 補助/促銷到期檢查、舊文章更新、Search Console 查詢表現 | 人工 |
| 每季 | 旅遊內容覆核（啟用旅遊後；`lastReviewed` 超過 90 天會警告） | `validate-products` |
| 備註 | 促銷到期、年份都在「建置時」判斷；每日重建之間（約 00:00–04:00）可能短暫顯示已過期促銷，屬已知限制 | — |

## Step 15 自動化資料來源（確認官方 API 後）

**前提**：Step 10 已上線；酷澎官方 API 已由使用者確認存在（蝦皮仍須確認）；你已向各聯盟平台確認「官方提供什麼資料介面、條款是否允許自動取得價格」。**本套件不內建爬蟲**：自動抓賣場頁面可能違反使用條款，也很容易因改版失效。
**目標**：把每週人工更新價格改成每日自動，並保有人工把關。
**要問**：各通路有沒有官方 API／商品資料匯出（請你到聯盟後台與官方文件確認，你不憑記憶斷言）；沒有的話維持 `manual`，或用 `feed`（你自己的合規流程寫入 `data/price-feed.json`）。
**產出**：
- **酷澎**：`scripts/providers/coupang.mjs` 已有骨架（逐筆請求、單筆失敗只略過、低頻、憑證只讀環境變數）。請使用者提供官方文件連結（不要金鑰），依文件填 `scripts/config.json` 的 `providers.coupang`（`urlTemplate`、`pricePath`、憑證標頭）；若官方是簽章式驗證，改寫 `buildHeaders()`，不要猜演算法。商品填 `channelIds.coupang`（API 的商品 ID）。`provider` 設為 `coupang`；之後若蝦皮也有 API，再把 daily 改成可合併多個 provider。測試：`COUPANG_FIXTURE=<json>` 可不連網乾跑；`daily.yml` 已預留 `COUPANG_API_TOKEN` secret。
- 若有官方 API：依官方文件新增 `scripts/providers/<名稱>.mjs`，匯出 `name` 與 `fetchObservations()`（回傳 `[{modelCode, channel, price, observedAt}]`），金鑰只放 GitHub Secrets / 本機環境變數，不寫進程式碼，也不要貼給你。
- `scripts/config.json` 的 `provider` 改為該名稱；`maxPriceChangePct`（預設 40）保護：單次變動過大不套用，列入報告待人工確認。
- `node scripts/daily.mjs --dry` 乾跑確認，再啟用 `daily.yml`。
**驗收**：`verify 15` 通過；乾跑輸出的 applied/rejected 合理；故意放一筆異常價格確認被擋下；daily workflow 手動觸發成功。
**延伸**：價格異常自動開 issue；多來源交叉驗證。

## Step 16 內容與社群半自動（人工核准）

**目標**：用 AI 加速內容與貼文產出，但**每一則發布前都經過你審核**——不是為了拖慢，而是避免低品質內容傷害站的信任與搜尋表現，也避免讓讀者反感。
**產出**：
- Astro 內容集合 `guides`（規格見 stages.md Step 16）：`src/content/guides/*.md`、`src/pages/guides/`。
- 指令 `/draft-guide <品類>`：用 products.json 的真實資料起草買前指南（`draft: true`，列出需核對的主張）。
- 指令 `/social-drafts <slug>`：起草 ≤3 則社群貼文到 `reports/`，只起草；你明確同意並有 Buffer 工具時才逐則確認後排入佇列。
**驗收**：`verify 16` 通過；至少一篇指南經你審核後發布；已發布文章都有 `sources` 與 `author`；沒有任何 `draft: true` 的文章出現在 `dist/`。
**延伸**：依價格變動自動起草「降價提醒」貼文草稿；週報附上本週可發內容建議。

## 完整度檢查：哪些能自動、哪些必須人做

| 能自動（已備） | 需要人（無法也不應自動化） |
|---|---|
| 資料驗證、轉址同步、建置稽核、CI | 申請與維護聯盟帳號、產生聯盟連結 |
| 每日重建、促銷到期、價格紀錄、bot commit 部署 | 網域購買與 DNS、Vercel 帳號操作 |
| 連結健康檢查與失敗開 issue、每週營運報告 | 規格與評價的真實性核對、實測心得 |
| 價格觀測套用（含異常保護，需有合規資料來源） | 內容與貼文的最終審核與發布決定 |
| 內容／貼文起草（含來源清單） | 聯盟條款與政策變動的因應 |
