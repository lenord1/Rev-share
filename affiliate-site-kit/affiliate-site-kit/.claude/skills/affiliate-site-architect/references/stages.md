# 各階段詳細規格（Astro + Tailwind + Vercel）

## 目錄
- 通用規則
- Step 2：規格資料庫
- Step 3：轉址、Layout、防掉單、SEO 基礎
- Step 4：首頁與 SmartFinder
- Step 5：pSEO 動態母版（含轉換元件）
- Step 14：旅遊模組
- Step 16：內容集合（買前指南）

---

## 通用規則

- **UI 一律對齊 `docs/ui-spec.md` 與 `design/` 參考稿**（token、元件規則、文案規則、視覺 QA）。元件實作時先看參考稿，不要自行發明樣式。

- 本檔是「寫什麼」的規格；「怎麼驗」由 `scripts/` 負責（validate-products、gen-redirects、audit-dist、verify）。程式碼要寫到能通過這些檢查。

- 語系 `zh-Hant-TW`；`<html lang="zh-Hant-TW">`；金額用 `Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 })`。
- 日期顯示用 `價格更新：YYYY/MM/DD`。
- 品類固定五類作為預設：除濕機 `dehumidifier`、洗衣機 `washer`、熱水器 `water-heater`、冷氣 `air-conditioner`、掃地機 `robot-vacuum`；使用者可增刪。
- 示範資料一律標註「示範資料，請以真實型號與價格取代」，不把虛構規格偽裝成真實產品。

---

## Step 2：規格資料庫

### `src/data/products.json`
頂層 `{ "categories": [...], "products": [...] }`，示範至少 2 個品類、每品類 2–3 個型號。商品欄位：

| 欄位 | 說明 |
|---|---|
| `category`、`slug`、`modelCode` | 品類 slug、商品 slug、`/go/` 用的型號代碼 |
| `titleTemplate` | 標題模板，年份用 `{year}` 佔位，建置時以當年取代，不寫死 |
| `affiliate` | `{ "通路id": "網址" }`，通路必須在 `channels.json` 啟用；只供產生 `vercel.json`，HTML 不出現 |
| `primaryChannel` | 主要 CTA 的通路（預設第一個有連結的通路） |
| `prices` | 選配，`{ "通路id": 標價 }` 供多通路並列；每個價格通路都必須有對應 `affiliate` |
| `price`、`priceUpdatedAt` | 參考價（TWD 整數）與更新日期（ISO）。靜態站的價格不是即時價，不要稱「即時」 |
| `discount` | 現折金額，可為 0 |
| `taxRefund`、`subsidyNote`、`promoValidUntil` | 退稅或補助金額、資格說明、促銷到期日。`promoValidUntil` 同時管 `discount` 與 `taxRefund`：過了到期日（台灣時間當天結束），兩者都不計入到手價、不顯示紅字促銷 |
| `promoBadge` | 促銷標籤 |
| `featured` | 是否為首頁九宮格主力商品（布林），另有 `featuredOrder` |
| `tldr` | 結論一句話＋適合誰 |
| `flaw` | 一個具體缺點，必填且要具體，不接受空泛話 |
| `specs` | `[{ "key", "value", "unit", "score", "higherIsBetter" }]`，供動態表格與勝出高亮 |
| `finder` | SmartFinder 用的標籤與權重（適用坪數、預算級距、需求標籤） |
| `faq` | `[{ "q", "a" }]` |
| `notFor` | `["不適合你的情況", …]`，至少 1 條，頁面必須顯示 |
| `policy` | `{ "seller": "official｜mall｜third-party", "warranty": "…", "returns": "…" }`，頁面必須顯示 |
| `extraCosts` | `[{ "label", "amount" 或 "note" }]` 運費、安裝費、舊機回收、爬樓梯加價等；洗衣機／熱水器／冷氣必填（沒有額外費用就填 `[]`） |
| `alternative` | `{ "modelCode", "when" }`：「如果是 X 情況，改選另一台」 |
| `lastChecked` | 資料最後人工核對日期 |
| `image` | `{ "file": "檔名.jpg", "alt": "描述" }`，圖檔放 `src/assets/products/`，頁面用 Astro `<Image>`；只用官方素材或自有授權圖片 |

到手價 = `price - discount - taxRefund`（促銷過期則 discount、taxRefund 都為 0），一律用 `src/lib/pricing.mjs` 的 `priceBreakdown()` 計算並顯示算式，不存死值、不在元件內重寫一份邏輯。

### 價格紀錄
`src/data/price-history.json`：`{ "<modelCode>": [{ "date", "channel", "price" }] }`，由 `scripts/record-price.mjs` 追加（同日同通路覆蓋）。記錄標價而非到手價；示範資料不記錄。前台只有在 `priceStats()` 回報 `enough: true`（≥3 筆且跨 ≥14 天）時才顯示走勢與判斷，否則顯示「價格資料累積中」。標示「本站記錄」，不暗示是全網最低價。

### `scripts/csv-to-products.mjs`
讀 `data/products.csv`（欄位對應上表，`specs`、`faq` 用 JSON 字串欄位或另檔）轉成 `products.json`，並做基本驗證（缺 `flaw`、`price`、`affiliate` 即報錯）。目的是讓使用者用試算表維護，不必手寫 JSON。

驗收：`node scripts/csv-to-products.mjs` 成功產生合法 JSON；缺 `flaw` 時報錯並指出哪個型號。

---

## Step 3：轉址、Layout、防掉單、SEO 基礎

### `vercel.json`
- `redirects`：`{ "source": "/go/shopee-型號代碼", "destination": "https://…", "statusCode": 302 }`，示範 2–3 條。
- `headers`：對 `/go/(.*)` 加 `X-Robots-Tag: noindex, nofollow` 與 `Cache-Control: no-store`。
- 說明：redirects 是靜態設定，換連結＝改資料＋重新部署（Git push 自動部署）。

### `scripts/gen-redirects.mjs`
讀資料產生 `vercel.json` 的 redirects 與 headers（`npm run sync`），**產生後必須 commit**。`--check` 只比對、不寫檔；建置時由 `integrations/validate-data.mjs` 自動檢查，不同步就中止建置。不要把它掛在 `prebuild` 去改寫檔案（Vercel 很可能不會套用建置中才產生的轉址設定，需實測）。

### 需實測的項目（驗收時用 `curl -I` 確認，不要當成已知）
- 目的網址已含聯盟參數時，Vercel 是否會再附加原請求的 query string。
- `/go/` 的 headers 是否確實出現在 redirect 回應上。
- 換賣場後重新部署的實際耗時。

### `public/robots.txt`
`User-agent: *`、`Allow: /`、`Disallow: /go/`、`Sitemap: https://網域/sitemap-index.xml`。Disallow 讓守規矩的爬蟲不去抓 `/go/`（也是你原始規格要求的）；`X-Robots-Tag` 是對未被擋住的請求的補強。注意兩者有交集時的限制：被 robots.txt 擋掉的爬蟲看不到 header。實務上 `/go/` 連結都是 nofollow/sponsored 的 302，風險低；若日後在 Search Console 看到 `/go/` 被索引，再改為移除 Disallow、僅靠 noindex header，並以實測為準。

### `src/layouts/Layout.astro`
- 載入 `src/lib/track.js` 並呼叫 `initTrack({ endpoint })`（endpoint 依使用者在 Step 3 的選擇，沒有就省略）。所有 `/go/` 連結必須帶 `data-track="go" data-channel="…" data-code="…" data-slot="tldr|table|sticky|finder|grid"`。
- props：`title`、`description`、`canonical`、`ogImage`；`<html lang="zh-Hant-TW">`。
- Tailwind 深色模式（跟隨系統，`dark:` 變體）、基本 meta、Open Graph、canonical。
- 引入 `InAppWarning`，頁尾放低調的分潤揭露一行：「本站部分連結為分潤連結，您購買時不會多花費用，我們可能因此獲得佣金。價格與優惠以賣場頁面為準。」
- 說明 `astro.config.mjs` 需設定 `site`（sitemap 與 canonical 需要），並註冊建置前檢查：
  ```js
  import validateData from './integrations/validate-data.mjs';
  export default defineConfig({ site: '…', integrations: [validateData(), sitemap(), tailwind()] });
  ```
  （Tailwind 的接法依 `npx astro add tailwind` 當時的官方做法為準。）

### `src/components/InAppWarning.astro`
- Tailwind 固定頂部提示條（`fixed inset-x-0 top-0 z-50`），支援深色模式，有關閉鈕；以 `transform` 滑入、尊重 `prefers-reduced-motion`，不造成版面位移。
- 元件內 `<script>` 以 `navigator.userAgent` 偵測：LINE（`Line/`）、Instagram（`Instagram`）、Facebook（`FBAN|FBAV`）、Threads。Threads 的 UA 字串不確定，標示需用真機確認，規則寫成容易增補的陣列。
- 依偵測到的 App 顯示不同操作文案（各 App 的選單按鈕位置不同），通用文案作為備援，例如「請改用 Safari / Chrome 開啟，才能順利喚醒購物 App」。不承諾未提供的優惠券。
- `sessionStorage` 記住已關閉狀態（包 try/catch）。

驗收：`curl -I https://網域/go/shopee-xxx` 見 302、Location、X-Robots-Tag；DevTools 改 UA 可觸發提示條，一般瀏覽器不顯示。

---

## Step 4：首頁與 SmartFinder

**版面定義**：首頁「九宮格」是 9 個主力商品（`featured: true` 依 `featuredOrder` 取前 9，跨品類精選）。五個品類是 SmartFinder 的品類按鈕，兩者分開。

### `src/pages/index.astro`
- 使用 `Layout`；建置時（frontmatter）讀 `products.json`，把精簡資料以 `<script type="application/json">` 傳給 SmartFinder，client 端不另行 fetch。
- 區塊順序：一句話價值主張 → SmartFinder → 主力商品九宮格 → 品類入口。
- 九宮格 3×3，手機為 2 欄（單一 RWD 版本）；每格含圖（Astro `<Image>`，自動寬高、lazy）、型號、到手價、`promoBadge`，連結走 `/go/`。傳給 SmartFinder 的資料只帶它需要的欄位（型號、品類、`finder`、價格計算所需欄位、名稱、`image`），避免商品變多時首頁 HTML 過大。

### 情境落地頁（Step 5）
`src/pages/[category]/for/[intent].astro`：`getStaticPaths()` 用 `buildableIntents(products, intents, { minProducts })` 產生（`src/lib/intents.mjs`，與驗證器、稽核共用同一規則）。版面：H1（`title`）→ 分潤揭露 → 專屬導言（`intro`）→ 2–4 台比較卡（到手價算式、缺點、連到自己的評測頁 `/{品類}/{slug}/`、CTA 走 `/go/`）→ FAQ（可見才輸出 FAQPage）。JSON-LD：BreadcrumbList（可加 ItemList）；不輸出 Product 的 aggregateRating/review。canonical 指向自己。細節與限制見 `docs/personalization-spec.md`「情境落地頁」。

### 個人化層
完整規格見 `docs/personalization-spec.md`（參考稿 `design/personalize.html`）：`src/lib/profile.js`（共享 userProfile，含 subscribe 與 localStorage）、`src/lib/rank.js`（語意解析＋動態加權，寵物權重最高）、`QuizDialog.astro`、`SmartSearch.astro`、`ProfileBar.astro`、`IntentDrawer.astro`（掛在商品頁 Layout：缺點區／規格區 ≥50% 在畫面內累計 5 秒觸發；文案依畫像與價格紀錄的真實狀態產生；雙通路 CTA 的副標由 `compareChannels` 決定）。價格判斷沿用 `pricing.mjs`，於建置時算好再內嵌；client 不 fetch。

### `src/components/SmartFinder.astro`
- 五個品類按鈕 → 同頁局部切換 2–3 題大按鈕問答（坪數、預算、重點需求），無重整；vanilla JS，無框架。
- 依 `finder` 欄位加權計分，輸出最適合型號的 CTA 卡片：型號、到手價（含算式）、紅字促銷（僅未過期者）、一行「注意：{flaw}」、按鈕連 `/go/shopee-型號代碼`。
- 無障礙：`<button>`、可見焦點、結果區 `aria-live="polite"`、`prefers-reduced-motion`。

驗收：3 次點擊內出結果；每個品類至少 2 個型號可被推薦；無外部函式庫；補助過期的商品不顯示紅字促銷。

---

## Step 5：pSEO 動態母版

### `src/pages/[category]/[slug].astro`
- `getStaticPaths()` 讀 `products.json`，每個商品產生一頁（`params: { category, slug }`，`props: { product }`）。
- **建置期驗證**：缺 `flaw`、`price`、`affiliate`、`specs` 任一項就 `throw new Error` 並指出型號。
- 標題由 `titleTemplate` 的 `{year}` 取代為建置年份；`<title>`、description、canonical、Open Graph 齊備。
- 版面順序：H1 → 一句分潤揭露 → **30 秒 TL;DR 決策框**（結論、適合誰、缺點、到手價算式、主 CTA）→ **規格比對表** → FAQ。
- **規格比對表**：外層 `overflow-x-auto`；表頭 `sticky top-0`；**首欄 `sticky left-0`**，加背景色與右側陰影；依 `higherIsBetter` 找出勝出參數，以高亮底色加「勝出」文字標記（不只靠顏色，兼顧色盲）。
- **JSON-LD**（`<script type="application/ld+json" set:html={JSON.stringify(...)} />`）：
  - `BreadcrumbList`：首頁 → 品類 → 商品。
  - `Product`：name、description、`offers`（price、priceCurrency=TWD、availability）；沒有真實評價資料就不輸出 `aggregateRating` 或 `review`。
  - `FAQPage`：內容與頁面上可見的 FAQ 一致。
- 頁尾沿用 `Layout` 的分潤揭露。

### 轉換元件（都在 `src/components/`，資料皆來自 products.json 與 pricing.mjs）
- `TotalCost.astro`：到手價拆解（標價 − 折扣 − 退稅，促銷過期自動不計）＋ `extraCosts` 逐項＋ `policy`（賣家類型、保固、退貨）。回答「真正要花多少、出事怎麼辦」。
- `PriceHistory.astro`：建置期用內嵌 SVG 畫近 30 天走勢，零 JS。`enough: false` 時只顯示「價格資料累積中（目前 N 筆）」，不下任何划算/偏高判斷。判斷文字用 `verdictLabel`，並標示資料來源為「本站記錄」。
- `StickyCta.astro`：手機底部固定列（`fixed inset-x-0 bottom-0`）：型號、到手價、主要 CTA；TL;DR 區的 CTA 在視窗內時可隱藏（IntersectionObserver，小段 script）；加 `pb-` 避免遮住頁尾內容。
- 「不適合你的情況」：顯示 `notFor`，放在 TL;DR 之後、比對表之前。
- 「如果只能選一台」：TL;DR 給明確推薦，並以 `alternative.when` 說明何時改選另一台，連到該商品頁。
- 多通路並列：`prices` 有 ≥2 個通路時，並列各通路標價，誠實標出較低者與價差；各自的 CTA 走各自的 `/go/`。
- 促銷期限：`promoValidUntil` 剩餘 ≤14 天才顯示「優惠至 YYYY/MM/DD」（可加倒數）；沒有真實到期日一律不得出現倒數。
- 所有 CTA 帶 `data-track`，`data-slot` 標示位置。

### 維運：定時重新部署
價格與年份只在建置時更新，所以建議用 Vercel Deploy Hook 加排程（例如 GitHub Actions 每日 `curl -X POST` hook）讓站點每日重建。給出最小可用的 workflow 範例。

驗收：`npm run build` 為每個商品產出一頁；缺資料時建置報錯；Rich Results Test 無錯誤；360px 寬度表格可橫滑、首欄固定。

---

## Step 14：旅遊模組

旅遊價格與庫存變動快：**不存、不顯示精確價格**，用「平台比較＋目的地攻略」取代規格比對。

### `src/data/travel.json`
`{ "guides": [...] }`，每個 guide：

| 欄位 | 說明 |
|---|---|
| `slug`、`destination` | 路徑與目的地名稱 |
| `titleTemplate` | 含 `{year}`，不寫死年份 |
| `summary` | 一段話結論（怎麼選平台） |
| `lastReviewed` | 內容最後覆核日期；超過 90 天驗證器警告 |
| `priceNote` | 預設「價格變動快，請以平台頁面為準」 |
| `offers` | `[{ "kind": "hotel｜tour｜ticket｜sim｜insurance｜transport｜other", "channel", "code", "label", "note", "affiliate" }]`；**不得有 price 欄位** |
| `faq` | `[{ "q", "a" }]`，須顯示在頁面上 |
| `demo` | 示範資料旗標 |

`code` 與商品的 `modelCode` 共用 `/go/{通路}-{代碼}` 命名空間，全站必須唯一；通路的 `verticals` 必須包含 `travel`。

### `src/pages/travel/index.astro`、`src/pages/travel/[slug].astro`
- `getStaticPaths()` 讀 travel.json；缺必填欄位建置報錯。
- 版面：H1 → 分潤揭露 → 結論（`summary`）→ 平台比較（各 offer 的用途、適合誰、`note`，CTA 走 `/go/` 且帶 `data-track`）→ FAQ →「價格以平台頁面為準」聲明＋ `lastReviewed`。
- JSON-LD：`BreadcrumbList`（首頁 → 旅遊 → 目的地）、`FAQPage`（與可見 FAQ 一致）。**不輸出 `Product`/`Offer`**。
- 內容誠實：只寫查得到、能核實的資訊；不寫未經查證的「最低價」「獨家折扣」。

---

## Step 16：內容集合（買前指南）

以 Astro 內容集合管理 Markdown 指南（API 與設定檔位置依當前 Astro 版本官方文件為準，例如 `src/content.config.ts`）。
- schema（用 zod）：`title`、`description`、`category`（須存在於 categories）、`updated`（日期）、`author`、`sources`（陣列，每項 `{ title, url }`，**至少 1 筆**）、`draft`（布林，預設 true）。
- 頁面：`src/pages/guides/index.astro`、`src/pages/guides/[slug].astro`；建置時過濾 `draft: true`，不輸出到 `dist/`。
- 版面沿用 `Layout` 與 `docs/ui-spec.md`；文末顯示作者、更新日期、資料來源；頁首一句分潤揭露；內文連到站內商品頁而非賣場。
- JSON-LD：`BreadcrumbList`、`Article`（headline、dateModified、author）。不輸出沒有依據的 `Review`／`aggregateRating`。
- 品質閘門：沒有 `sources` 或 `author` 建置報錯；`draft: true` 的文章不得出現在 sitemap。
