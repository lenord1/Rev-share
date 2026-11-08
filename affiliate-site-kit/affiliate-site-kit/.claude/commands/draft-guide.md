---
description: 用 products.json 的真實資料起草買前指南（草稿，需人工審核後才發布）
argument-hint: "[品類 slug，例如 dehumidifier]"
---

為品類 `$ARGUMENTS` 起草一篇買前指南，寫入 `src/content/guides/$ARGUMENTS-buying-guide.md`，frontmatter 一律 `draft: true`。

規則（為什麼：大量未經審核的 AI 內容容易品質低、被讀者與搜尋引擎判為內容農場，也違背本站「值得信任」的定位）：
1. 只能使用 `src/data/products.json` 裡該品類的真實資料，以及我在對話中提供的來源。**不得編造規格、測試結果、使用心得或評價。**需要第一手經驗的段落，先問我有沒有真實使用/實測經驗，沒有就不要寫成有。
2. 結構：這類產品怎麼選（3–5 個判斷重點，附為什麼重要）→ 常見誤區 → 依情境推薦（連到站內商品頁，不直接放賣場連結）→ 最後一小段「什麼情況不需要買」。
3. frontmatter 需有：`title`、`description`、`category`、`updated`（今天）、`author`、`sources`（每個事實性主張對應的來源，至少 1 筆）、`draft: true`。
4. 寫完執行 `node scripts/validate-products.mjs`，並列出「需要我核對的主張」清單（每條附依據出處）。
5. **不要把 `draft` 改成 false，也不要發布。**等我逐段審核並明確說「發布」才改。
