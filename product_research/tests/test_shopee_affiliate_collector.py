"""蝦皮分潤後台收集器的解析測試 —— 使用「模擬」的 JSON 回應（欄位名稱是依常見命名猜的，非真實擷取）。

真實欄位要等使用者在自己電腦跑 discover 後才能確認；那之後會另外加真實擷取的測試。
"""
from product_research.product_normalizer import group_listings
from product_research.shopee_affiliate_collector import is_blocked_url, parse_items, walk_items


MOCK_FLAT = {"url": "https://example.test/api/offer", "json": {"data": {"list": [
    {"itemid": 111, "shopid": 9, "name": "【蝦皮直營】Panasonic 國際牌 11L 除濕機 F-Y22PN 免運", "price": 899000000, "commission_rate": "0.05", "shop_name": "A店"},
    {"itemid": 222, "shopid": 8, "name": "國際牌 F-Y22PN 除濕機 原廠保固", "price": 9100},
]}}}

MOCK_NESTED = {"url": "https://example.test/api/search", "json": {"items": [
    {"item_basic": {"itemid": 333, "shopid": 7, "name": "Panasonic國際牌 11公升nanoeX清淨除濕機 F-Y22PN", "price": 9500}, "offerLink": "https://s.shopee.tw/abc"},
]}}


def test_walk_items_flat_and_nested():
    assert len(walk_items(MOCK_FLAT["json"])) == 2
    nested = walk_items(MOCK_NESTED["json"])
    assert len(nested) == 1 and nested[0]["itemid"] == 333 and nested[0]["offerLink"].startswith("https://s.shopee.tw/")


def test_parse_items_keeps_raw_values_and_source():
    items = parse_items([MOCK_FLAT, MOCK_NESTED], collected_at="2026-11-15")
    assert len(items) == 3
    first = items[0]
    assert first.raw_title.startswith("【蝦皮直營】") and first.shop_id == "9" and first.item_id == "111"
    assert first.price_raw == 899000000  # 不換算單位
    assert first.source_url == "https://shopee.tw/product/9/111"
    assert items[2].affiliate_link == "https://s.shopee.tw/abc"


def test_duplicates_removed_and_non_items_ignored():
    dup = {"json": {"list": MOCK_FLAT["json"]["data"]["list"] * 2, "meta": {"name": "x", "itemid": 1}}}
    assert len(parse_items([dup])) == 2


def test_parsed_titles_feed_normalizer():
    items = parse_items([MOCK_FLAT, MOCK_NESTED])
    r = group_listings(items)
    assert len(r.masters) == 1 and r.masters[0].model == "F-Y22PN" and len(r.masters[0].listings) == 3


def test_block_detection():
    assert is_blocked_url("https://shopee.tw/buyer/login?next=x")
    assert is_blocked_url("https://shopee.tw/verify/traffic")
    assert not is_blocked_url("https://affiliate.shopee.tw/offer/product_offer")


def test_launch_browser_falls_back_in_order(capsys):
    from product_research.shopee_affiliate_collector import launch_browser

    class FakeChromium:
        def __init__(self): self.calls = []
        def launch(self, channel=None, headless=True):
            self.calls.append(channel)
            if channel in ("msedge", "chrome"):
                raise RuntimeError("Target closed\nlog line")
            return "browser-ok"

    class FakeP:
        chromium = FakeChromium()

    assert launch_browser(FakeP(), headless=True, preferred="msedge") == "browser-ok"
    assert FakeP.chromium.calls == ["msedge", "chrome", None]


def test_launch_browser_reports_all_failures():
    import pytest
    from product_research.shopee_affiliate_collector import launch_browser

    class Boom:
        def launch(self, channel=None, headless=True): raise RuntimeError(f"fail {channel}")

    class P:
        chromium = Boom()

    with pytest.raises(SystemExit) as e:
        launch_browser(P(), headless=True)
    assert "msedge" in str(e.value) and "chromium" in str(e.value)


def test_select_payloads_keeps_only_keyword_product_list():
    from product_research.shopee_affiliate_collector import select_payloads
    a = {"url": "https://affiliate.shopee.tw/api/v3/offer/product/list?list_type=0&page_offset=0", "json": {}}
    b = {"url": "https://affiliate.shopee.tw/api/v3/offer/product/list?list_type=0&keyword=F-Y22PN&page_offset=0", "json": {}}
    c = {"url": "https://affiliate.shopee.tw/api/v3/user/profile", "json": {}}
    assert select_payloads([a, b, c], "F-Y22PN") == [b]
    assert select_payloads([a, b, c], None) == [a, b]


def test_price_inferred_only_for_product_list_api():
    from product_research.shopee_affiliate_collector import parse_items
    pl = {"url": "https://x/api/v3/offer/product/list?keyword=k", "json": {"data": {"list": [{"itemid": 1, "shopid": 2, "name": "衛生紙測試商品名稱", "price": 19900000}]}}}
    other = {"url": "https://x/api/other", "json": {"list": [{"itemid": 3, "shopid": 2, "name": "其他接口商品名稱", "price": 19900000}]}}
    got = parse_items([pl, other])
    assert got[0].price_twd_inferred == 199.0
    assert not hasattr(got[1], "price_twd_inferred")


def test_describe_masks_urls():
    from product_research.shopee_affiliate_collector import describe
    out = "\n".join(describe({"offerLink": "https://s.shopee.tw/abc?affiliate_id=999", "n": 1, "sub": {"x": "y"}}))
    assert "999" not in out and "s.shopee.tw" in out and "sub: object" in out


def test_string_prices_and_shop_flags_from_real_shape():
    """欄位形狀取自使用者 inspect 輸出（price 為字串、無分潤欄位）；數值是模擬。"""
    from product_research.shopee_affiliate_collector import parse_items
    item = {"itemid": "52561360941", "shopid": "9675593", "name": "國際牌除濕機濾網 F-Y16EN/F-Y22EN/F-Y22PN",
            "price": "20000000", "price_min": "20000000", "price_max": "25000000", "sold": 18, "historical_sold": 33,
            "shop_name": "TOP生活家電", "is_official_shop": False, "shopee_verified": False, "item_status": "normal"}
    pl = {"url": "https://affiliate.shopee.tw/api/v3/offer/product/list?keyword=F-Y22PN", "json": {"code": 0, "data": {"list": [item]}}}
    got = parse_items([pl])[0]
    assert got.price_twd_inferred == 200.0 and got.price_max_twd_inferred == 250.0
    assert got.is_official_shop is False and got.shopee_verified is False and got.shop_name == "TOP生活家電"


def test_find_item_path_reports_wrapper_fields():
    from product_research.shopee_affiliate_collector import find_item_path
    data = {"data": {"total": 1, "list": [{"commission_rate": 5, "item": {"itemid": 1, "name": "測試商品名稱啊啊"}}]}}
    path, chain = find_item_path(data)
    assert path == ("data", "list", 0, "item")
    assert any(isinstance(o, dict) and "commission_rate" in o for _, o in chain)


def test_inspect_match_mode(tmp_path, monkeypatch, capsys):
    import json
    import product_research.shopee_affiliate_collector as c
    monkeypatch.setattr(c, "CAPTURE_DIR", tmp_path)
    cap = [{"url": "https://affiliate.shopee.tw/api/v3/gql?q=productOfferLinks", "status": 200,
            "request_body": '{"query":"query productOfferLinks","variables":{"ids":[1]}}',
            "json": {"data": {"productOfferLinks": [{"itemId": "1", "shortLink": "https://s.shopee.tw/secret123", "commissionRate": "5%"}]}}}]
    (tmp_path / "capture-20261115-000000.json").write_text(json.dumps(cap), encoding="utf-8")
    args = type("A", (), {"match": "productOfferLinks", "keyword": None})()
    assert c.cmd_inspect(args) == 0
    out = capsys.readouterr().out
    assert "variables" in out and "commissionRate" in out and "secret123" not in out


def test_real_wrapper_shape_commission_and_item():
    """外層與商品欄位結構取自使用者的 inspect 輸出（真實結構）；欄位值是模擬。"""
    from product_research.shopee_affiliate_collector import parse_items
    entry = {
        "item_id": "52561360941", "long_link": "https://shopee.tw/x?aff=SECRET", "product_link": "https://shopee.tw/y?aff=SECRET",
        "max_commission_rate": "6.5%", "seller_commission_rate": "3%", "default_commission_rate": "1%",
        "batch_item_for_item_card_full": {"itemid": "52561360941", "shopid": "9675593", "name": "國際牌除濕機濾網 F-Y16EN/F-Y22PN",
                                          "price": "20000000", "shop_name": "TOP生活家電", "is_official_shop": False, "shopee_verified": False},
    }
    pl = {"url": "https://affiliate.shopee.tw/api/v3/offer/product/list?keyword=F-Y22PN",
          "json": {"code": 0, "msg": "success", "data": {"list": [entry], "total_count": 64}}}
    got = parse_items([pl])
    assert len(got) == 1
    g = got[0]
    assert (g.commission_default_pct, g.commission_seller_pct, g.commission_max_pct) == (1.0, 3.0, 6.5)
    assert g.price_twd_inferred == 200.0 and g.item_id == "52561360941"
    assert g.source_url == "https://shopee.tw/product/9675593/52561360941"


def test_pct_parsing():
    from product_research.shopee_affiliate_collector import _pct
    assert _pct("0%") == 0.0 and _pct("12.5 %") == 12.5 and _pct("abc") is None and _pct(None) is None


def test_check_block_headless_stops_and_headed_waits(monkeypatch):
    import pytest
    import product_research.shopee_affiliate_collector as c

    class Page:
        def __init__(self, url): self.url = url
        def wait_for_timeout(self, ms): pass

    blocked = Page("https://shopee.tw/verify/traffic/error?x=1")
    with pytest.raises(c._Stop):
        c._check_block(blocked, headless=True, where="測試")
    c._check_block(Page("https://affiliate.shopee.tw/offer/product_offer"), headless=True, where="測試")

    asked = []
    monkeypatch.setattr("builtins.input", lambda *a: asked.append(1) or "")
    ok = Page("https://shopee.tw/verify/traffic/error")

    def solve(ms): ok.url = "https://affiliate.shopee.tw/offer/product_offer"
    ok.wait_for_timeout = solve
    c._check_block(ok, headless=False, where="測試")
    assert asked == [1]
    still = Page("https://shopee.tw/verify/traffic/error")
    with pytest.raises(c._Stop):
        c._check_block(still, headless=False, where="測試")


def test_filter_by_price():
    from product_research.shopee_affiliate_collector import filter_by_price
    from product_research.schemas import RawListing

    def mk(price, **kw):
        return RawListing(raw_title="測試商品名稱啊啊", item_id=str(price), price_twd_inferred=price, **kw)

    items = [mk(200.0), mk(1999.0), mk(2000.0), mk(8900.0), RawListing(raw_title="價格不明商品名稱", item_id="x")]
    keep, drop = filter_by_price(items, 2000)
    assert [i.item_id for i in keep] == ["2000.0", "8900.0"]
    assert len(drop) == 3
    assert filter_by_price(items, 0) == (items, [])
    only_min = RawListing(raw_title="只有最低價商品", item_id="m", price_min_twd_inferred=3500.0)
    assert filter_by_price([only_min], 2000)[0] == [only_min]


def test_is_keyword_list_url():
    from product_research.shopee_affiliate_collector import is_keyword_list_url
    base = "https://affiliate.shopee.tw/api/v3/offer/product/list"
    assert is_keyword_list_url(base + "?list_type=0&keyword=F-Y22PN&page_offset=0", "F-Y22PN")
    assert not is_keyword_list_url(base + "?list_type=0&page_offset=0", "F-Y22PN")
    assert not is_keyword_list_url("https://affiliate.shopee.tw/api/v3/user/profile?keyword=F-Y22PN", "F-Y22PN")


def test_check_block_returns_true_only_after_user_solved(monkeypatch):
    import product_research.shopee_affiliate_collector as c

    class Page:
        def __init__(self, url): self.url = url
        def wait_for_timeout(self, ms): pass

    assert c._check_block(Page("https://affiliate.shopee.tw/offer/product_offer"), True, "x") is False
    page = Page("https://shopee.tw/verify/traffic/error")
    page.wait_for_timeout = lambda ms: setattr(page, "url", "https://affiliate.shopee.tw/offer/product_offer")
    monkeypatch.setattr("builtins.input", lambda *a: "")
    assert c._check_block(page, False, "x") is True


def test_should_capture_only_affiliate_api():
    from product_research.shopee_affiliate_collector import should_capture
    assert should_capture("https://affiliate.shopee.tw/api/v3/offer/product/list?keyword=x")
    assert should_capture("https://affiliate.shopee.tw/api/v3/gql?q=productOfferLinks")
    assert not should_capture("https://monitor-report.affiliate.shopee.tw/api/reportLogs")
    assert not should_capture("https://deo.shopeemobile.com/shopee/mkt-web-sdk/translate/1539/en.json")
    assert not should_capture("https://dem.shopee.com/dem/entrance/v1/apps/website/tags/config-monitor/event/json")
