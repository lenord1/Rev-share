"""蝦皮分潤後台（affiliate.shopee.tw/offer/product_offer）資料收集器。

沒有官方 Open API 時的替代做法：用 Playwright 開「無頭」瀏覽器，沿用你手動登入一次後存在本機的登入狀態，
進到分潤後台的商品頁，攔截頁面自己向蝦皮要的 JSON 回應，再整理成 RawListing（交給 product_normalizer）。

安全與守則
- 帳號密碼、cookie 只存在你電腦的 ~/.shopee_research/（不進 repo、不經過 Claude）。
- 低頻率：每次動作之間隨機等待數秒；遇到登入頁、驗證碼、異常回應就立刻停止，不重試、不繞過。
- 只讀你自己帳號後台看得到的資料；不代你下單、不改後台設定。

三個指令（在 repo 根目錄）：
    python -m product_research.shopee_affiliate_collector login
    python -m product_research.shopee_affiliate_collector discover --keyword "F-Y22PN"
    python -m product_research.shopee_affiliate_collector collect  --keyword "F-Y22PN" --out titles.json

第一次請先跑 discover：後台的接口與欄位名稱我無法在雲端驗證，discover 會把頁面實際收到的 JSON 存下來，
解析器（parse_items）再依真實欄位調整。
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional

from .schemas import RawListing

HOME_DIR = Path.home() / ".shopee_research"
STATE_FILE = HOME_DIR / "affiliate_state.json"
CAPTURE_DIR = HOME_DIR / "captures"
OFFER_URL = "https://affiliate.shopee.tw/offer/product_offer"

MIN_DELAY, MAX_DELAY = 3.0, 6.0
MAX_CAPTURES = 60

#: 出現在網址裡代表需要人工處理（登入、驗證）的字樣
BLOCK_MARKERS = ("/buyer/login", "/seller/login", "verify", "captcha", "/user/login", "anti_crawler", "anti-bot")

_ID_KEYS = {"item": ("itemid", "item_id", "itemId", "productId", "product_id"),
            "shop": ("shopid", "shop_id", "shopId", "sellerId")}
_NAME_KEYS = ("name", "title", "item_name", "itemName", "productName", "product_name")
_PRICE_KEYS = ("price", "price_min", "priceMin", "sale_price", "salePrice", "item_price")
_COMMISSION_KEYS = ("commission_rate", "commissionRate", "commission", "rate", "seller_commission_rate",
                    "default_commission_rate", "max_commission_rate", "commissionRateText")
_LINK_KEYS = ("offerLink", "offer_link", "affiliate_link", "affiliateLink", "short_link", "shortLink", "productLink", "product_link", "url", "link")
_SHOP_NAME_KEYS = ("shop_name", "shopName", "seller_name", "sellerName")
_MALL_KEYS = ("is_official_shop", "isOfficialShop", "shopee_verified", "is_shopee_mall", "isMall", "official_shop")


def _first(d: dict, keys: Iterable[str]) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def looks_like_item(d: dict) -> bool:
    name = _first(d, _NAME_KEYS)
    has_id = _first(d, _ID_KEYS["item"]) is not None
    return isinstance(name, str) and len(name) >= 6 and has_id


def walk_items(node: Any) -> list[dict]:
    """在任意 JSON 裡找出長得像「商品」的物件（有名稱與商品編號），含巢狀的 item_basic／item 包裝。"""
    found: list[dict] = []

    def visit(n: Any) -> None:
        if isinstance(n, dict):
            if looks_like_item(n):
                found.append(n)
                return
            for key in ("item_basic", "itemBasic", "item", "product", "productInfo"):
                inner = n.get(key)
                if isinstance(inner, dict) and looks_like_item(inner):
                    merged = {**n, **inner}
                    merged.pop(key, None)
                    found.append(merged)
                    return
            for v in n.values():
                visit(v)
        elif isinstance(n, list):
            for v in n:
                visit(v)

    visit(node)
    return found


def parse_items(payloads: Iterable[dict], collected_at: Optional[str] = None) -> list[RawListing]:
    """把攔截到的 JSON 回應整理成 RawListing。欄位原值照存（price_raw、commission_raw），不猜單位。

    蝦皮部分接口的價格是「實際價格 × 100000」，這個單位我無法在雲端驗證，所以不換算，
    請看 discover 的結果再決定。
    """
    collected_at = collected_at or datetime.now().date().isoformat()
    seen: set[tuple[str, str]] = set()
    out: list[RawListing] = []
    for payload in payloads:
        for it in walk_items(payload.get("json", payload)):
            item_id = str(_first(it, _ID_KEYS["item"]))
            shop_id = _first(it, _ID_KEYS["shop"])
            shop_id = str(shop_id) if shop_id is not None else None
            key = (shop_id or "", item_id)
            if key in seen:
                continue
            seen.add(key)
            link = _first(it, _LINK_KEYS)
            extra = {
                "price_raw": _first(it, _PRICE_KEYS),
                "commission_raw": _first(it, _COMMISSION_KEYS),
                "mall_flag_raw": _first(it, _MALL_KEYS),
                "affiliate_link": link if isinstance(link, str) and link.startswith("http") else None,
                "capture_url": payload.get("url"),
            }
            out.append(RawListing(
                raw_title=str(_first(it, _NAME_KEYS)),
                platform="shopee",
                shop_id=shop_id,
                item_id=item_id,
                shop_name=_first(it, _SHOP_NAME_KEYS),
                source_url=f"https://shopee.tw/product/{shop_id}/{item_id}" if shop_id else None,
                collected_at=collected_at,
                source_note="蝦皮分潤後台 product_offer 頁面攔截（欄位單位未驗證）",
                **{k: v for k, v in extra.items() if v is not None},
            ))
    return out


def is_blocked_url(url: str) -> bool:
    low = url.lower()
    return any(m in low for m in BLOCK_MARKERS)


def _sleep() -> None:
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


class _Stop(Exception):
    pass


def _require_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        sys.exit("尚未安裝 Playwright：pip install playwright && python -m playwright install chromium")
    from playwright.sync_api import sync_playwright
    return sync_playwright


BROWSER_ORDER = ("msedge", "chrome", "chromium")


def launch_browser(p, headless: bool, preferred: Optional[str] = None):
    """依序嘗試 Edge、Chrome、內建 Chromium；回傳第一個能啟動的瀏覽器。

    Windows 一定有 Edge，用系統已安裝的瀏覽器比 Playwright 下載的 Chromium 穩定。
    """
    order = [preferred] if preferred else []
    order += [b for b in BROWSER_ORDER if b not in order]
    errors: list[str] = []
    for name in order:
        try:
            if name == "chromium":
                browser = p.chromium.launch(headless=headless)
            else:
                browser = p.chromium.launch(channel=name, headless=headless)
            print(f"使用瀏覽器：{name}")
            return browser
        except Exception as e:  # noqa: BLE001 —— 要試下一個，不論原因
            errors.append(f"{name}: {str(e).splitlines()[0][:120]}")
    sys.exit("找不到可啟動的瀏覽器：\n  " + "\n  ".join(errors))


def cmd_login(args: argparse.Namespace) -> int:
    sync_playwright = _require_playwright()
    HOME_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = launch_browser(p, headless=False, preferred=args.browser)
        ctx = browser.new_context(storage_state=str(STATE_FILE)) if STATE_FILE.exists() else browser.new_context()
        page = ctx.new_page()
        page.goto(OFFER_URL)
        print("請在跳出的瀏覽器視窗手動登入蝦皮分潤後台（含簡訊／驗證）。")
        print("登入完成、看得到商品列表後，回到這裡按 Enter。")
        input()
        ctx.storage_state(path=str(STATE_FILE))
        try:
            STATE_FILE.chmod(0o600)
        except OSError:
            pass
        browser.close()
    print(f"登入狀態已存到 {STATE_FILE}（只在你的電腦上，請勿上傳或分享）。")
    return 0


def _run_capture(keyword: Optional[str], pages: int, headless: bool, browser_name: Optional[str] = None) -> list[dict]:
    if not STATE_FILE.exists():
        sys.exit("找不到登入狀態，請先執行：python -m product_research.shopee_affiliate_collector login")
    sync_playwright = _require_playwright()
    captured: list[dict] = []

    def on_response(resp) -> None:
        try:
            ctype = (resp.headers or {}).get("content-type", "")
            if "json" not in ctype or len(captured) >= MAX_CAPTURES:
                return
            captured.append({"url": resp.url, "status": resp.status, "json": resp.json()})
        except Exception:
            pass  # 非 JSON 或已被關閉的回應，略過

    with sync_playwright() as p:
        browser = launch_browser(p, headless=headless, preferred=browser_name)
        ctx = browser.new_context(storage_state=str(STATE_FILE), locale="zh-TW")
        page = ctx.new_page()
        page.on("response", on_response)
        try:
            page.goto(OFFER_URL, wait_until="networkidle", timeout=45000)
            if is_blocked_url(page.url):
                raise _Stop(f"被導向登入／驗證頁（{page.url}）。請重新執行 login，並自行完成驗證。")
            _sleep()
            if keyword:
                box = page.get_by_placeholder(re.compile("搜尋|search|關鍵字|商品", re.I)).first
                if box.count() == 0:
                    raise _Stop("找不到搜尋框。請用 discover 的結果與畫面截圖確認頁面結構（不硬猜選擇器）。")
                box.fill(keyword)
                box.press("Enter")
                page.wait_for_load_state("networkidle", timeout=30000)
                if is_blocked_url(page.url):
                    raise _Stop(f"搜尋後被導向驗證頁（{page.url}），已停止。")
            for _ in range(max(0, pages - 1)):
                _sleep()
                page.mouse.wheel(0, 2400)  # 捲動載入更多；不點任何按鈕
                page.wait_for_load_state("networkidle", timeout=30000)
                if is_blocked_url(page.url):
                    raise _Stop("捲動時被導向驗證頁，已停止。")
            if not captured:
                raise _Stop("沒有攔截到任何 JSON 回應，可能尚未登入或頁面改版。")
        finally:
            CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
            try:
                page.screenshot(path=str(CAPTURE_DIR / "last_screen.png"))
            except Exception:
                pass
            browser.close()
    return captured


def cmd_discover(args: argparse.Namespace) -> int:
    try:
        captured = _run_capture(args.keyword, args.pages, headless=not args.show, browser_name=args.browser)
    except _Stop as e:
        print(f"已停止：{e}")
        return 2
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = CAPTURE_DIR / f"capture-{datetime.now():%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps(captured, ensure_ascii=False, indent=1), encoding="utf-8")
    items = parse_items(captured)
    print(f"攔截到 {len(captured)} 筆 JSON 回應，存到 {path}")
    for c in captured:
        print(f"  {c['status']} {c['url'][:110]}")
    print(f"解析出 {len(items)} 筆商品；前 5 筆：")
    for it in items[:5]:
        print(f"  [{it.shop_id}/{it.item_id}] {it.raw_title[:50]}  price_raw={getattr(it, 'price_raw', None)} commission_raw={getattr(it, 'commission_raw', None)}")
    print("把上面這段輸出貼給 Claude（不含 cookie），就能依真實欄位調整解析器。capture 檔可能含你的帳號資訊，不要整檔上傳。")
    return 0


def cmd_collect(args: argparse.Namespace) -> int:
    try:
        captured = _run_capture(args.keyword, args.pages, headless=True, browser_name=args.browser)
    except _Stop as e:
        print(f"已停止：{e}")
        return 2
    items = parse_items(captured)
    if not items:
        print("沒有解析出商品。請先跑 discover 確認欄位。")
        return 3
    Path(args.out).write_text(json.dumps([i.model_dump(mode="json", exclude_none=True) for i in items], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已寫入 {args.out}：{len(items)} 筆。可接著執行 python -m product_research.product_normalizer --input {args.out}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="蝦皮分潤後台資料收集（無頭瀏覽器）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    browser_help = "指定瀏覽器：msedge（預設）、chrome、chromium；失敗會自動換下一個"
    lp = sub.add_parser("login", help="開瀏覽器手動登入一次，存登入狀態")
    lp.add_argument("--browser", choices=BROWSER_ORDER, default="msedge", help=browser_help)
    lp.set_defaults(fn=cmd_login)
    for name, fn in (("discover", cmd_discover), ("collect", cmd_collect)):
        sp = sub.add_parser(name)
        sp.add_argument("--browser", choices=BROWSER_ORDER, default="msedge", help=browser_help)
        sp.add_argument("--keyword", help="在後台搜尋框輸入的關鍵字（型號或品名）")
        sp.add_argument("--pages", type=int, default=1, help="捲動載入的頁數（預設 1，上限 5）")
        if name == "discover":
            sp.add_argument("--show", action="store_true", help="顯示瀏覽器視窗，方便你看它做了什麼")
        else:
            sp.add_argument("--out", default="titles.json")
        sp.set_defaults(fn=fn)
    args = ap.parse_args(argv)
    if hasattr(args, "pages"):
        args.pages = max(1, min(args.pages, 5))
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
