# 個人化意圖推薦（Step 4 的一部分）

可執行參考稿：`design/personalize.html`（單檔原生 JS，瀏覽器直接開；含完整中文註解）。
Astro 版要把同一套邏輯拆成模組與元件，**行為、門檻、文案規則與參考稿一致**，視覺依 `docs/ui-spec.md`。

## 目的
讓差一步就下單的人，用「我家有貓、有小孩、空間大」這種自己的話，30 秒內看到排序過的結果，並在他認真看某一台時，用真實的價格資料告訴他現在值不值得下手。

## 架構：三個模組只認識一個共享物件

```
 問卷 QuizDialog ──寫入──▶ ┌────────────┐ ◀──讀取── 搜尋 SmartSearch（rank）
                           │ userProfile │
 行為偵測 IntentDrawer ─讀取▶ └────────────┘ ──通知──▶ 重排、畫像列、Toast 文案
                                 │
                           localStorage（只在使用者瀏覽器）
```
模組之間不互相呼叫；`Profile.set()` 一改，訂閱者自動更新。SmartFinder（品類 3 題精靈）答案也寫入同一個 Profile，不另建第二套狀態。

## 檔案切分（Astro）
| 檔案 | 內容 | 備註 |
|---|---|---|
| `src/lib/profile.js` | `Profile`（get / set / reset / subscribe）、localStorage 讀寫 | 讀寫一律 try/catch；隱私模式讀不到就用預設 |
| `src/lib/rank.js` | `parseQuery`、`rank`、詞庫 `LEXICON`、權重 `W` | 純函式，可在 Node 直接測 |
| `src/components/QuizDialog.astro` | 3 題問卷（原生 `<dialog>`） | |
| `src/components/SmartSearch.astro` | 搜尋框、「我的理解」解析 chips、結果列表 | |
| `src/components/ProfileBar.astro` | 畫像列：顯示系統記住什麼、修改、清除 | 透明 = 信任 |
| `src/components/IntentDrawer.astro` | 缺點區／規格區可見時間偵測與購買意圖抽屜（含雙通路 CTA） | 掛在商品頁 Layout |
| `src/lib/pricing.mjs` | 沿用 `priceStats`，並用 `compareChannels` 決定「標價較低／較快到貨」標籤，不另寫判斷 | |

## 資料
- `products.json` 每個商品加 `tags`：只能用 `scripts/config.json` 的 `tagVocabulary`（寵物友善、除臭、安全鎖、靜音、大坪數、小坪數、預算友善、節能…）。標籤要有依據（規格或官方說明），不能為了排序好看亂貼；驗證器會擋不在詞庫內的標籤。
- 價格走勢**建置時**算好再內嵌（例如 `data-low30="14500"`、`data-lowest="true"`），client 端不 fetch、不重算歷史；判斷規則同 `priceStats`（≥3 筆且跨度 ≥14 天，否則 `ok:false`）。

## 模組一：問卷
- 題目：寵物（有貓／有狗／其他／沒有）、小孩（有／沒有）、空間（小／大）。選項是大按鈕（≥48px），3 格進度條。
- `userProfile`：`{ hasPet: null|false|'cat'|'dog'|'other', hasChild: null|true|false, spaceSize: null|'small'|'large', answered }`。`null`＝沒回答，和 `false`＝確定沒有不同（排序不會因沒回答而扣分）。
- 完成後 `Profile.set()` 並存 localStorage。
- 第一次來自動跳出一次；「先跳過」後不再自動打擾（記 `skipped`）；畫像列永遠有「修改」與「清除資料」。
- 用原生 `<dialog>`（焦點陷阱、Esc 關閉）。

## 模組二：語意解析與動態加權排序
- 詞庫把說法對應成意圖：貓／狗／毛小孩→`pet`、小孩／寶寶→`child`、安靜／睡覺→`quiet`、客廳／大空間→`large`、套房／臥室→`small`、便宜／入門→`budget`；另有品類詞（除濕機、清淨機）做硬篩選。
- 解析規則：**長詞優先、命中後從字串移除**（否則「毛小孩」會被拆成「小孩」誤判成有孩子）。
- 分數：搜尋意圖與畫像意圖取較大者；兩邊一致再 +10（雙重命中）。權重 **寵物最高**（query 60／profile 50），小孩次之（45／40），其餘 30–35。空間不合：大空間家庭遇「小坪數」−25；有小孩卻沒有「安全鎖」−20。同分時價低者在前。
- 搜尋字詞提到但畫像沒記住的需求（例如搜「貓」），只顯示「記住『有貓』」按鈕，**不擅自寫入畫像**。
- 結果顯示「我的理解：…」chips 與每台的命中理由，使用者能看到系統怎麼想，理解錯了也能發現。
- 純前端詞庫比對，不用 AI、不呼叫後端。

## 模組三：購買意圖抽屜（區塊可見時間）
- 偵測對象：商品頁的「缺點區」`data-intent-zone="flaw"` 與「規格區」`data-intent-zone="spec"`。使用 `IntersectionObserver`，區塊有 **≥ 50% 在畫面內**才算「正在看」，**累計 ≥ 5 秒**（任一區塊在看就計時；分頁在背景不計；門檻放 `CONFIG`）。快速滑過的人不會觸發。
- 假設而非事實：「停在缺點區 5 秒＝猶豫中」只是行為假設。用事件紀錄驗證（見下），數字不好就調門檻或關掉，不要當成真理。
- 每個商品每個工作階段最多一次（sessionStorage），同時只顯示一個；有「關閉」；不搶焦點；瀏覽器不支援 `IntersectionObserver` 就不觸發。
- 版型：手機＝底部抽屜（出現時 StickyCta 讓位／隱藏）；桌機＝右下角卡片。只用 `transform`/`opacity` 過渡，`role="status"`，`prefers-reduced-motion` 時不做動畫。
- 內容 = 「為什麼適合你」＋「價格事實」＋「兩個互斥 CTA」：
  - 適合你：標籤與畫像真的相符才說（寵物友善＋有貓、安全鎖＋有小孩、大／小坪數＋空間）；不相符就省略。
  - 價格事實三種誠實狀態：目前就是 30 天最低→「目前正處於 30 天內歷史最低價！」；高於最低→「目前比 30 天最低價高 NT$ X」；紀錄不足→「價格紀錄還在累積中，暫時無法判斷是否划算」。
  - 雙 CTA：商品有兩個通路連結時並列「到蝦皮看最新價格」「到酷澎看最新價格」（`data-slot="drawer-shopee|drawer-coupang"`）；只有一個通路就只顯示一顆。副標只由 `compareChannels(product)` 決定：
    - 「標價較低」：兩個通路的標價都在 `priceStaleDays`（14 天）內觀測、且價格不同，才標在較低的那個。
    - 「較快到貨」：該通路的 `delivery.<通路>` 有 `fast: true`、`note`、`source`、`checkedAt`（未過期），且只有一個通路符合。
    - 資料不足就不標，只寫通路名。底部固定註明「價格以各平台頁面為準，實際金額含券與運費請在結帳頁確認」。
- **不得**在沒有價格資料時說「歷史最低／次低」，不得寫沒有來源的「明天到貨」「現省 $X」，不得做假倒數、假庫存、「N 人正在看」。
- 事件：`track('intent-shown', { code, zone })`、`track('intent-closed')`；點擊走既有的 `data-track="go"`。分析工具裡用「出現次數 / 抽屜點擊」與「無抽屜的一般點擊」比較，才知道抽屜有沒有幫助。事件不含畫像內容。

## 自適應篩選
- 篩選選項（品類、標籤）在**建置時**由資料長出來：沒有商品的品類不顯示；某品類內每台都有的標籤沒有篩選意義，不顯示；切換品類後標籤選項重新計算。點了不會出現空結果。
- 篩選只影響顯示，不寫入畫像。

## 情境落地頁（SEO，對應「家有嬰兒 除濕機」這類高購買意圖搜尋）
- 路徑 `/{品類}/for/{情境}`（例如 `/dehumidifier/for/baby`），資料在 `src/data/intents.json`（品類、`slug`、`title`、`tag`、`intro`、`introApproved`、`faq`）。商品 `slug` 不可為 `for`。
- 產生條件（`src/lib/intents.mjs` 的 `buildableIntents`，驗證器、頁面、稽核共用）：同品類且含該標籤的商品 ≥ `minIntentProducts`（預設 2，建議 3–4）、`introApproved: true`。不符合就不產生頁面，避免薄內容。
- `intro` 必須是這個情境專屬、真實的文字（≥40 字），由你審核；不得套模板量產。
- 頁面：H1、分潤揭露、導言、2–4 台比較（每台列缺點、到手價、連到自己的評測頁）、FAQ（可見才輸出 FAQPage）、BreadcrumbList（可加 ItemList）；不輸出 aggregateRating/review；canonical 指向自己。排序用同一套 `rank.js`（畫像加權在 client 端套用，HTML 預設依價格）。
- 單品頁的 FAQ 可吸收「耗電嗎」「噪音大嗎」這類買家疑慮；少量買前指南（Step 16）可作為情境頁的內部連結來源。

## 隱私與信任
- 偏好只存使用者瀏覽器的 localStorage，不上傳、不放進 URL、不接任何追蹤；頁面上註明這點。
- 畫像列隨時可修改、可清除。
- 站內若已有分析工具（umami/plausible），抽屜的點擊走既有的 `data-track="go"`、顯示事件只送商品代碼與區塊名稱，不送畫像內容。
- 這些偏好在法規上可能屬於個人資料，若日後要伺服器端儲存或與帳號綁定，要先補隱私權政策與同意流程（需另評估）。

## 效能與無障礙
- 全部原生 JS，併入現有 JS 預算（全站 ≤ 60 KB）；不引入框架或套件。
- 問卷用 `<dialog>`；結果與抽屜用 `aria-live="polite"`；所有按鈕 ≥ 44px；焦點外框可見。
- 個人化只影響「排序與提示」，不改變頁面可被搜尋引擎索引的內容；商品頁 HTML 在無 JS 時仍完整可用。

## 驗收
1. `node scripts/verify.mjs 4` 通過（檢查檔案、5 秒與 50% 門檻、IntersectionObserver、localStorage 容錯、無 client fetch、`role="status"`、reduced-motion、無假催促字樣）。
2. 用瀏覽器依序測：①問卷選「有貓／有小孩／大空間」→重新整理仍記得；②搜「除濕機 貓」→寵物友善款排第一，且「我的理解」正確；③搜「毛小孩」不會被當成有小孩；④進商品頁但缺點區與規格區都不在畫面內 → 不出現抽屜；缺點區在畫面內累計 5 秒 → 出現，同一商品不再出現；⑤三種價格狀態文案各看過一次（最低價／高於低點／紀錄不足）；⑥雙通路：價格都新且不同 → 有「標價較低」；有附來源的快速到貨 → 有「較快到貨」；價格太舊或同價 → 沒有副標；只有一個通路 → 只有一顆按鈕；⑦清除資料後回到預設排序，篩選選項不會出現空結果；⑧手機 390px 無橫向捲動、抽屜與 StickyCta 不重疊；⑨深色模式。
3. 與 `design/personalize.html` 並排比對行為與文案。
