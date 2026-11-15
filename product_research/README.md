# product_research｜商品研究與內容生成模組（蝦皮智慧選品系統 V3.0）

Python 套件，與 `affiliate-site-kit/`（Astro 網站與 Node 腳本）並列。網站建置不會讀到這裡。

## 進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| A | 商品名稱清理與型號正規化（`product_normalizer.py`） | 完成，77 項離線測試通過（2026-11-15） |
| B | 官方資料與圖片來源搜尋 | 進行中：蝦皮分潤後台收集器已寫好（尚未對真實後台測試），官方資料與圖片未開始 |
| C | 優缺點研究與證據管理 | 未開始 |
| D | 商品主檔與資料庫整合 | 未開始 |
| E | SEO 商品卡片與詳情頁輸出 | 未開始 |

## 安裝與執行（在 repo 根目錄）

```bash
pip install -r product_research/requirements.txt

# 全部測試
python -m pytest
# 只跑模擬標題／只跑真實標題樣本
python -m pytest -m "not real_titles"
python -m pytest -m real_titles

# 清理並合併標題
python -m product_research.product_normalizer \
  --title "【限時優惠】XX牌除濕機 ABC-120TW 公司貨 現貨免運" \
  --title "【商城熱賣】XX牌 ABC120TW 高效除濕機"
python -m product_research.product_normalizer --input titles.json --registry official_models.json --out result.json
python -m product_research.product_normalizer --input titles.json --single   # 只清理，不合併
```

`--input` 接受標題字串陣列，或物件陣列（`raw_title`、`shop_id`、`item_id`、`shop_name`、`source_url`、`collected_at`…，其餘欄位原樣保留）。

## 蝦皮分潤後台收集器（Phase B 前段）

沒有官方 Open API 時，用無頭瀏覽器讀你自己的分潤後台（`affiliate.shopee.tw/offer/product_offer`）。在**你的電腦**執行：

```bash
pip install -r product_research/requirements.txt
python -m playwright install chromium
python -m product_research.shopee_affiliate_collector login                    # 開視窗，手動登入一次
python -m product_research.shopee_affiliate_collector discover --keyword "F-Y22PN" --show   # 第一次：看實際收到什麼
python -m product_research.shopee_affiliate_collector collect --keyword "F-Y22PN" --out titles.json
python -m product_research.product_normalizer --input titles.json
```

登入狀態只存在 `~/.shopee_research/`；遇到登入頁或驗證碼會停止，不繞過。後台欄位名稱尚未用真實資料驗證，所以請先跑 `discover`。

## 批次抓取（品類＋型號清單）

```cmd
run_batch.bat                 :: 除濕機、最低價 3000、每輪最多搜 10 個關鍵字
run_batch.bat 2500 12         :: 最低價 2500、每輪 12 個
run_batch.bat 3000 10 reset   :: 清掉進度重來
```

先搜品類關鍵字（多捲動幾頁），再依 `data/dehumidifier_seed_models.txt` 逐個型號補搜。每完成一個關鍵字就存進度（`~/.shopee_research/batch_progress.json`），被擋或達上限後再執行同一指令會接續。結果依蝦皮後台的歷史已售數量排序。遇到驗證頁就停手，過幾小時再接續。

## Phase A：規則

- **比對鍵**：型號去掉連字號與空白、轉大寫（`ABC-120TW` = `abc120tw`）。鍵完全相同才會進同一份主檔候選。
- **不合併、標 `NEEDS_REVIEW`**：型號只差尾碼或版本字（`MJ-EV150JX` / `MJ-EV150JX-TW`、`FD-Y60L` / `FD-Y60L PLUS`）、O/0 與 I/1 混淆、同型號但容量／電壓不同、公司貨與平行輸入、新品與福利品。
- **寫法不一致**（有無連字號、`AD S512T`）：合併成一份，但在沒有官方資料前標 `NEEDS_REVIEW`，型號寫法為「暫定」。
- **官方型號登記表**（`--registry`，Phase B 產出）：對到官方型號才會變成 `VERIFIED`；登記表列為別名的寫法才會跨尾碼合併。
- **組合／多入**與單機分開；**配件耗材**（適用某型號的濾網等）不建主檔；**找不到型號**的標題放 `unresolved`。
- 促銷字、贈品、價格、日期、賣家宣稱（保固、產地、能效）會從名稱移除，記在 `removed_terms` 與 `attributes.seller_claims`（未查證）。
- 原始標題與來源欄位全部保留在輸出的 `listings[].listing`。

規則資料在 `data/title_rules.json`（促銷字、品類、配件詞）與 `data/brands.json`（品牌別名；`slug` 對齊 `products.json` 的 `modelCode` 前綴）。新增品牌或促銷字只改這兩個檔。

## 已知限制

- 少於 4 個英數字的型號（例如 Dyson `V12`）不會被辨識，會進 `unresolved`。
- 品牌表以外的品牌只認得「○○牌」這種寫法。
- `site_model_code` 是依型號產生的建議值；既有 `products.json` 有些 `modelCode` 省略了尾碼（`mitsubishi-mj-ev150jx`、`heran-hdh-12dy030`），對應留待 Phase D。

## 測試資料

- `tests/test_product_normalizer.py`：模擬標題（自行編寫的 23 種格式與各項合併規則）。
- `tests/test_real_titles.py` + `tests/fixtures/real_titles.json`：真實標題樣本（專案草稿內的蝦皮標題與官網頁面名稱、2026-11-15 搜尋到的其他電商賣場標題），每筆有來源。
- 兩者都不連網路。真實網站擷取測試從 Phase B 開始，另行記錄。
