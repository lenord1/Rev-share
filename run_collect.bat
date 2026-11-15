@echo off
chcp 65001 >nul
rem 用法：run_collect.bat F-Y22PN [最低價，預設 3000]
rem 一次做完：更新程式 -> 抓蝦皮分潤後台 -> 清理合併標題 -> 印摘要。任何一步失敗就停下，不會讀到舊檔。
if "%~1"=="" (
  echo 用法：run_collect.bat 型號關鍵字 [最低價]
  exit /b 1
)
set KW=%~1
set MINP=%~2
if "%MINP%"=="" set MINP=3000
cd /d "%~dp0"
echo [1/4] 更新程式...
git pull || (echo 更新失敗 & exit /b 1)
if exist titles.json del titles.json
if exist result.json del result.json
echo [2/4] 抓取蝦皮分潤後台（遇到驗證頁請在視窗內自己完成，再回來按 Enter）...
py -m product_research.shopee_affiliate_collector collect --keyword "%KW%" --pages 1 --show --min-price %MINP% --out titles.json || (echo 抓取失敗或被停止，已中止 & exit /b 1)
echo [3/4] 清理並合併標題...
py -m product_research.product_normalizer --input titles.json --out result.json || (echo 合併失敗 & exit /b 1)
echo [4/4] 摘要
py -m product_research.summarize result.json
