from product_research.product_normalizer import group_listings
from product_research.summarize import summarize
from product_research.schemas import RawListing


def test_summary_lists_masters_prices_and_counts():
    items = [RawListing(raw_title="Panasonic 國際牌 11L 除濕機 F-Y22PN 免運", item_id="1", price_twd_inferred=9500.0,
                        commission_default_pct=2.0, commission_max_pct=5.0, shopee_verified=True),
             "適用 F-Y22PN 濾網"]
    out = summarize(group_listings(items).model_dump(mode="json", exclude_none=True))
    assert "主檔 1｜配件 1｜無型號 0" in out and "9500.0" in out and "分潤 預設2.0%" in out and "商城" in out
