# 導購站 Claude Code 套件

互動式帶你從零到上線的 Astro + Tailwind + Vercel 分潤導購站（蝦皮、酷澎、旅遊，一套架構）。內容 = 流程（skill）+ 專案規則（CLAUDE.md）+ 自動檢查與營運工具（scripts）+ 上線審查（子代理）。

## 最快上手
把整包放進空資料夾 → 在該資料夾啟動 Claude Code → 貼上 `START_PROMPT.md` 內的提示詞。

## 安裝
1. 建一個專案資料夾並進入（或用既有的 Astro 專案根目錄）。
2. 把本套件內容複製到專案根目錄（保留 `.claude/`、`scripts/`、`integrations/`、`src/`、`templates/`、`docs/`、`CLAUDE.md`、`BUILD_LOG.md`、`START_PROMPT.md`）。需要 Node 18+，腳本不需安裝任何套件。
3. 在該資料夾啟動 Claude Code，輸入 `/affiliate-site-architect`。

## 用法
- `/affiliate-site-architect`：從目前進度繼續（讀 `BUILD_LOG.md`）
- `/affiliate-site-architect status`：檢查所有步驟的真實狀態，不動手
- `/affiliate-site-architect 3`：做 Step 3
- `/affiliate-site-architect links`：只做連結健康檢查，並提醒本週營運動作
- 隨時手動檢查：`node scripts/verify.mjs <0-16|all>`

## 套件內容
| 路徑 | 作用 |
|---|---|
| `.claude/skills/affiliate-site-architect/` | 流程 skill：SKILL.md（互動協議）、references/roadmap.md（Step 0–12）、references/stages.md（程式碼規格） |
| `START_PROMPT.md` | 貼進 Claude Code 的啟動提示詞 |
| `integrations/validate-data.mjs` | Astro integration：每次 `astro build` 前驗證資料並檢查 vercel.json 同步 |
| `docs/ARCHITECTURE_REVIEW.md` | 架構審查：已修正的問題、已知限制、需實測項目 |
| `.claude/agents/launch-reviewer.md` | Step 10 的獨立唯讀審查員 |
| `.claude/settings.json` | 預先允許安全指令；編輯 products.json 後自動驗證的 hook |
| `CLAUDE.md` | 專案常駐規則（不可違反事項） |
| `BUILD_LOG.md` | 決策與進度的唯一狀態來源 |
| `scripts/validate-products.mjs` | 商品資料驗證（`--strict` 為上線標準） |
| `scripts/gen-redirects.mjs` | 由資料產生 `vercel.json`（302 + noindex headers） |
| `scripts/csv-to-products.mjs` | 試算表 CSV → products.json |
| `scripts/check-links.mjs` | 連結健康檢查：靜態／線上轉址／追蹤落點（低頻、只看狀態碼），報告寫入 `reports/` |
| `scripts/record-price.mjs` | 價格紀錄（累積走勢；示範資料不記錄） |
| `scripts/reconcile.mjs` | 每週點擊對帳，偵測比率突然下滑 |
| `src/lib/pricing.mjs` | 到手價、促銷有效性、價格走勢統計（頁面與腳本共用） |
| `src/lib/track.js` | 隱私友善的出站點擊追蹤 |
| `src/data/channels.json` | 通路註冊表：網域白名單、聯盟參數、啟用狀態 |
| `templates/travel.example.json` | 旅遊內容範本（Step 14 才使用） |
| `scripts/daily.mjs`、`scripts/providers/` | 每日管線與價格資料來源介面（manual／feed；日後可加官方 API），含異常保護與失敗還原 |
| `scripts/weekly-report.mjs` | 每週營運報告 |
| `scripts/screenshot.mjs` | 視覺 QA 截圖（手機/桌機×淺色/深色，需 playwright） |
| `design/`、`docs/ui-spec.md` | UI 參考稿（可直接開啟）與規範 |
| `design/personalize.html`、`docs/personalization-spec.md` | 個人化意圖推薦與情境頁：可執行參考稿（問卷＋語意搜尋＋缺點區可見 5 秒的購買意圖抽屜＋雙通路 CTA＋自適應篩選）與 Astro 實作規格 |
| `.claude/commands/` | `/draft-guide`、`/social-drafts`：內容與貼文起草（需人工核准） |
| `scripts/audit-dist.mjs` | 建置後稽核：JSON-LD、FAQ 可見、無寫死賣場網址、rel、揭露、sitemap、robots |
| `scripts/verify.mjs` | 各步驟閘門 + 人工驗收清單 |
| `scripts/config.json` | 白名單網域、門檻（請依你的聯盟後台實際網域確認） |
| `src/data/products.json` | 示範資料（`demo: true`，Step 10 strict 檢查會要求移除） |
| `templates/` | package.json scripts 片段；GitHub Actions：ci、daily、weekly、link-check；旅遊範本 |

## 注意
- `src/data/channels.json` 的 `hosts` 是依常見網域預設的，`requiredParams` 預設為空，且全部 `confirmed: false`。請對照聯盟後台實際產生的連結修改後再改為 true（Step 7 會引導）。旅遊平台的分潤連結常經第三方聯盟網路，網域可能不同。
- 連結檢查腳本刻意低頻且只看狀態碼：賣場對機器人限流（403/429）時只會回報「無法判斷」。請勿改成大量爬取。
- hook 與 skill 的 frontmatter 欄位（如 `argument-hint`）依 Claude Code 當前版本而定；若你的版本不認得，功能會降級但流程仍可用（可直接說「進行到 Step N」）。
- 腳本已在本套件內以假資料與本機模擬伺服器測試過（含失效、限流、缺參數、App 協定等情境）；Astro 頁面本身（Layout、SmartFinder 等）由 Claude 在你的專案內依 stages.md 產生，建置稽核會把關。
