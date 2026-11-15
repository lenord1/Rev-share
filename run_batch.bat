@echo off
chcp 65001 >nul
rem 批次抓取：先搜品類（依銷量找出熱門），再依型號清單補搜。可重複執行，會從上次停下的地方接續。
rem 用法：run_batch.bat            （預設：除濕機、最低價 3000、每輪最多 10 個關鍵字）
rem       run_batch.bat 2500 12    （最低價 2500、每輪最多 12 個）
rem       run_batch.bat 3000 10 reset   （清掉進度重來）
set MINP=%~1
if "%MINP%"=="" set MINP=3000
set MAXS=%~2
if "%MAXS%"=="" set MAXS=10
set RESET=
if /i "%~3"=="reset" set RESET=--reset
cd /d "%~dp0"
echo [1/4] 更新程式...
git pull || (echo 更新失敗 & exit /b 1)
if exist result.json del result.json
echo [2/4] 批次抓取（遇到驗證頁請在視窗內自己完成，再回來按 Enter；被擋就停手，過幾小時再執行同一個指令即可接續）...
py -m product_research.shopee_affiliate_collector batch --category 除濕機 --category-pages 5 --models-file product_research\data\dehumidifier_seed_models.txt --min-price %MINP% --max-searches %MAXS% --out titles.json %RESET%
if not exist titles.json (echo 沒有可用的抓取結果 & exit /b 1)
echo [3/4] 清理並合併標題...
py -m product_research.product_normalizer --input titles.json --out result.json || (echo 合併失敗 & exit /b 1)
echo [4/4] 摘要（依歷史銷量由高到低）
py -m product_research.summarize result.json
