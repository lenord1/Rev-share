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
