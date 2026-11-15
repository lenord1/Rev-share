"""真實標題樣本測試（與模擬標題測試分開）。

樣本在 fixtures/real_titles.json：專案內既有的蝦皮商品標題／品牌官網頁面名稱，
以及 2026-11-15 由網路搜尋取得的其他電商賣場標題。不連網路；不代表官方資料已查證。
"""
import json
from pathlib import Path

import pytest

from product_research.product_normalizer import group_listings
from product_research.schemas import OfficialVerification, ReasonCode, ReviewStatus

pytestmark = pytest.mark.real_titles

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "real_titles.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def result():
    return group_listings(FIXTURE["f_y22pn"] + FIXTURE["repo_titles"])


def by_id(result, cid):
    return next(m for m in result.masters if m.candidate_id == cid)


def test_f_y22pn_six_sellers_one_master(result):
    m = by_id(result, "panasonic:FY22PN")
    assert m.canonical_name == "Panasonic 國際牌 F-Y22PN 除濕機"
    assert len(m.listings) == 6
    assert m.variant.capacity_l == 11.0
    assert m.status == ReviewStatus.OK
    assert m.verification == OfficialVerification.UNVERIFIED  # 官方查證是 Phase B
    assert m.site_model_code == "panasonic-f-y22pn"            # 對得上 products.json 既有商品
    assert len({x.listing.platform for x in m.listings}) >= 3
    assert sum(1 for mm in result.masters if mm.model_key == "FY22PN") == 1


def test_price_tag_is_not_a_model(result):
    m = by_id(result, "panasonic:FY22PN")
    shop = next(x for x in m.listings if "金長美" in x.listing.raw_title)
    assert [c.key for c in shop.model_candidates] == ["FY22PN"]
    assert "$94K" in shop.removed_terms
    assert ReasonCode.BRAND_INFERRED in [r.code for r in shop.review_reasons]


def test_title_without_model_is_unresolved(result):
    titles = [u.listing.raw_title for u in result.unresolved]
    assert "國際牌 Panasonic 11L除濕機" in titles
    assert "除濕專用型RD-FJ系列除濕機｜日立冷氣" in titles
    assert any("Hysure" in t for t in titles)
    assert any("極適家居600" in t for t in titles)


def test_sampo_space_separated_model_merges_with_hyphen_form(result):
    m = by_id(result, "sampo:ADS512T")
    assert m.model == "AD-S512T" and len(m.listings) == 2
    assert m.status == ReviewStatus.NEEDS_REVIEW
    assert ReasonCode.MODEL_FORMAT_VARIANTS in [r.code for r in m.review_reasons]


def test_lg_dd181_merges_and_trademark_symbol_handled(result):
    m = by_id(result, "lg:DD181MWE0")
    assert len(m.listings) == 2 and m.variant.capacity_l == 18.0
    assert all("TM" not in x.cleaned_title for x in m.listings)


def test_3m_plus_models_kept_apart_from_base_models(result):
    ids = {m.candidate_id for m in result.masters}
    assert {"3m:FDY60L", "3m:FDY60LPLUS", "3m:FDY180L", "3m:FDY180LPLUS", "3m:FDY200L"} <= ids
    for cid in ("3m:FDY60L", "3m:FDY60LPLUS", "3m:FDY180L", "3m:FDY180LPLUS"):
        assert by_id(result, cid).status == ReviewStatus.NEEDS_REVIEW
    assert by_id(result, "3m:FDY200L").status == ReviewStatus.OK


def test_suffixes_kept(result):
    assert by_id(result, "mitsubishi:MJEV150JXTW").model == "MJ-EV150JX-TW"
    assert by_id(result, "heran:HDH12DY030N").model == "HDH-12DY030(N)"


def test_every_raw_title_is_accounted_for(result):
    total = len(FIXTURE["f_y22pn"]) + len(FIXTURE["repo_titles"])
    kept = sum(len(m.listings) for m in result.masters) + len(result.unresolved) + len(result.accessories)
    assert kept == total
