"""product_normalizer 單元測試 —— 全部使用「模擬標題」（自行編寫的標題格式），不連網路。

真實標題樣本的測試在 test_real_titles.py，兩者分開記錄。
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from product_research.product_normalizer import (
    OfficialModelRegistry,
    group_listings,
    model_key,
    normalize_title,
)
from product_research.schemas import (
    GroupingResult,
    ListingKind,
    OfficialModel,
    OfficialVerification,
    RawListing,
    ReasonCode,
    ReviewStatus,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

# (標題, 預期品牌 slug／顯示名, 預期型號寫法, 預期比對鍵, 預期品類)
TITLE_FORMATS = [
    # 需求文件的三個範例
    ("【限時優惠】XX牌除濕機 ABC-120TW 公司貨 現貨免運", "XX牌", "ABC-120TW", "ABC120TW", "dehumidifier"),
    ("XX牌 ABC-120TW 除濕機 原廠保固 送好禮", "XX牌", "ABC-120TW", "ABC120TW", "dehumidifier"),
    ("【商城熱賣】XX牌 ABC120TW 高效除濕機", "XX牌", "ABC120TW", "ABC120TW", "dehumidifier"),
    # 品牌中英並列、順序不同
    ("Panasonic 國際牌 11L 除濕機 F-Y22PN", "panasonic", "F-Y22PN", "FY22PN", "dehumidifier"),
    ("國際牌Panasonic F-Y22PN 11公升除濕機", "panasonic", "F-Y22PN", "FY22PN", "dehumidifier"),
    # 全形英數與全形括號
    ("【免運】ＳＡＭＰＯ聲寶　ＡＤ－Ｓ５１２Ｔ　６Ｌ除濕機（公司貨）", "sampo", "AD-S512T", "ADS512T", "dehumidifier"),
    # 小寫型號
    ("hitachi 日立 rd-14fj 7公升除濕機 現貨", "hitachi", "RD-14FJ", "RD14FJ", "dehumidifier"),
    # 型號在括號內
    ("LG 樂金 18公升變頻除濕機 (DD181MWE0) 快速出貨", "lg", "DD181MWE0", "DD181MWE0", "dehumidifier"),
    # 型號帶地區尾碼，不可刪
    ("MITSUBISHI 三菱電機 日本製 15.2L 除濕機 MJ-EV150JX-TW", "mitsubishi", "MJ-EV150JX-TW", "MJEV150JXTW", "dehumidifier"),
    # 型號帶括號尾碼，不可刪
    ("HERAN 禾聯 6L 除濕機 HDH-12DY030(N) 一級能效", "heran", "HDH-12DY030(N)", "HDH12DY030N", "dehumidifier"),
    # 型號後接版本字
    ("3M 6L 雙效空氣清淨除濕機 FD-Y60L PLUS 免運", "3m", "FD-Y60L PLUS", "FDY60LPLUS", "dehumidifier"),
    ("3M™ 淨呼吸™ 18公升雙效空氣清淨除溼機 FD-Y180L Plus", "3m", "FD-Y180L PLUS", "FDY180LPLUS", "dehumidifier"),
    # 表情符號、星號、驚嘆號
    ("🔥下殺🔥 TATUNG大同 6L除濕機 TDH-120MD ★現貨★ 快速出貨!!", "tatung", "TDH-120MD", "TDH120MD", "dehumidifier"),
    # 多層促銷括號
    ("【618限時下殺】【領券再折】SHARP 夏普 15公升除濕機 DW-T15FT", "sharp", "DW-T15FT", "DWT15FT", "dehumidifier"),
    # 贈品字串
    ("Panasonic 國際牌 除濕機 F-YV50LX 贈濾網 加贈收納袋 滿額贈", "panasonic", "F-YV50LX", "FYV50LX", "dehumidifier"),
    # 價格與日期
    ("TECO 東元 除濕機 MD1823RW NT$5,990 11/10~11/19 限時特價", "teco", "MD1823RW", "MD1823RW", "dehumidifier"),
    # 規格數字很多（坪數、伏特、瓦數、PM2.5、4K 不是型號）
    ("SAMPO 聲寶 10.5L 除濕機 AD-W520T 110V 13坪 PM2.5 205W 60Hz", "sampo", "AD-W520T", "ADW520T", "dehumidifier"),
    # 分隔線與店名
    ("Electrolux 伊萊克斯｜極適家居500 清淨除濕機 ED1251DD｜官方旗艦店", "electrolux", "ED1251DD", "ED1251DD", "dehumidifier"),
    # 型號有底線以外的破折號變體
    ("HITACHI日立 11公升除濕機 RD–22FJ 台灣公司貨", "hitachi", "RD-22FJ", "RD22FJ", "dehumidifier"),
    # 年份與新品字樣
    ("2026年新款 Kolin 歌林 除濕機 KJ-HC06 新品上市", "kolin", "KJ-HC06", "KJHC06", "dehumidifier"),
    # 其他品類
    ("Dyson 戴森 吹風機 HD15 現貨免運", "dyson", "HD15", "HD15", "hair-dryer"),
    ("【蝦皮直營】Whirlpool 惠而浦 洗衣機 WM07GN 廠商直送 含基本安裝", "whirlpool", "WM07GN", "WM07GN", "washing-machine"),
    # 同一標題同型號兩種寫法
    ("國際牌 除濕機 F-Y22PN/FY22PN 11L", "panasonic", "F-Y22PN", "FY22PN", "dehumidifier"),
]


def test_at_least_20_title_formats():
    assert len(TITLE_FORMATS) >= 20


@pytest.mark.parametrize("title,brand,written,key,category", TITLE_FORMATS)
def test_title_formats(title, brand, written, key, category):
    n = normalize_title(title)
    assert n.listing.raw_title == title, "原始標題必須原樣保留"
    assert n.brand is not None
    assert (n.brand.slug or n.brand.display) == brand
    assert n.model is not None
    assert n.model.written == written
    assert n.model.key == key
    assert n.category == category
    assert n.kind == ListingKind.SINGLE


NOISE = ["限時優惠", "下殺", "特價", "免運", "現貨", "快速出貨", "優惠券", "折扣碼", "加碼", "贈品", "滿額贈", "商城推薦", "官方嚴選", "公司貨", "原廠保固"]


@pytest.mark.parametrize("word", NOISE)
def test_noise_words_removed(word):
    n = normalize_title(f"【{word}】SAMPO 聲寶 除濕機 AD-S512T {word}")
    assert word not in n.cleaned_title
    assert "AD-S512T" in n.cleaned_title and "聲寶" in n.cleaned_title


def test_brackets_with_real_content_are_kept():
    n = normalize_title("【Panasonic 國際牌】除濕機 F-Y22PN")
    assert n.brand.slug == "panasonic" and "Panasonic" in n.cleaned_title


def test_spec_numbers_are_not_models():
    n = normalize_title("SAMPO 聲寶 12L 110V 15坪 4K PM2.5 IPX4 R290 除濕機")
    assert n.model is None
    assert ReasonCode.MODEL_NOT_FOUND in [r.code for r in n.review_reasons]
    assert n.status == ReviewStatus.NEEDS_REVIEW


def test_attributes_extracted():
    n = normalize_title("SAMPO 聲寶 10.5L 除濕機 AD-W520T 110V 水箱3.5L 平行輸入")
    assert n.attributes.capacities_l == [10.5]
    assert n.attributes.tank_capacities_l == [3.5]
    assert n.attributes.voltage_v == 110
    assert n.attributes.region == "import"


def test_gift_is_not_bundle_but_combo_is():
    gift = normalize_title("HITACHI 日立 除濕機 RD-14FJ 送好禮 贈濾網")
    assert gift.kind == ListingKind.SINGLE
    combo = normalize_title("HITACHI 日立 除濕機 RD-14FJ + 空氣清淨機 UDP-J60 超值組合")
    assert combo.kind == ListingKind.BUNDLE
    two = normalize_title("HITACHI 日立 除濕機 RD-14FJ 2入組")
    assert two.kind == ListingKind.BUNDLE


def test_accessory_listing_is_excluded():
    n = normalize_title("適用 Panasonic 國際牌 F-Y22PN 除濕機濾網 副廠")
    assert n.kind == ListingKind.ACCESSORY
    r = group_listings(["適用 Panasonic 國際牌 F-Y22PN 除濕機濾網 副廠", "Panasonic 國際牌 除濕機 F-Y22PN"])
    assert len(r.accessories) == 1 and len(r.masters) == 1 and len(r.masters[0].listings) == 1


def test_unit_with_filter_feature_is_not_accessory():
    n = normalize_title("日立江森 26公升/日 HEPA濾網 極光鈦變頻除濕機 RD-520VC")
    assert n.kind == ListingKind.SINGLE and n.model.written == "RD-520VC"


def test_model_key():
    assert model_key("abc-120tw") == model_key("ＡＢＣ120TW") == "ABC120TW"


# ---- 合併 ------------------------------------------------------------------

SPEC_TITLES = [t for t, *_ in TITLE_FORMATS[:3]]


def test_spec_example_merges_to_one_master_needs_review_without_official_data():
    r = group_listings(SPEC_TITLES)
    assert len(r.masters) == 1
    m = r.masters[0]
    assert m.canonical_name == "XX牌 ABC-120TW 除濕機"
    assert len(m.listings) == 3
    assert [x.listing.raw_title for x in m.listings] == SPEC_TITLES
    assert m.verification == OfficialVerification.UNVERIFIED
    assert m.status == ReviewStatus.NEEDS_REVIEW
    assert ReasonCode.MODEL_FORMAT_VARIANTS in [x.code for x in m.review_reasons]


def test_spec_example_verified_with_official_registry():
    reg = OfficialModelRegistry([OfficialModel(brand="xx", model="ABC-120TW", category="dehumidifier", official_url="https://example.com/abc-120tw")])
    r = group_listings(SPEC_TITLES, reg)
    assert len(r.masters) == 1
    m = r.masters[0]
    assert m.canonical_name == "XX牌 ABC-120TW 除濕機"
    assert m.verification == OfficialVerification.VERIFIED
    assert m.status == ReviewStatus.OK
    assert m.official_url == "https://example.com/abc-120tw"


def test_identical_model_writing_is_ok_but_unverified():
    r = group_listings(["Panasonic 國際牌 除濕機 F-Y22PN 免運", "【現貨】國際牌 F-Y22PN 除濕機 公司貨"])
    assert len(r.masters) == 1
    assert r.masters[0].status == ReviewStatus.OK
    assert r.masters[0].verification == OfficialVerification.UNVERIFIED
    assert r.masters[0].site_model_code == "panasonic-f-y22pn"


def test_suffix_is_never_dropped_similar_models_not_merged():
    r = group_listings(["MITSUBISHI 三菱 除濕機 MJ-EV150JX-TW", "MITSUBISHI 三菱 除濕機 MJ-EV150JX"])
    assert len(r.masters) == 2
    for m in r.masters:
        assert m.status == ReviewStatus.NEEDS_REVIEW
        assert ReasonCode.SIMILAR_MODEL in [x.code for x in m.review_reasons]
        assert len(m.similar_candidate_ids) == 1


def test_official_alias_merges_suffix_variants():
    reg = OfficialModelRegistry([OfficialModel(brand="mitsubishi", model="MJ-EV150JX-TW", aliases=["MJ-EV150JX"], category="dehumidifier")])
    r = group_listings(["MITSUBISHI 三菱 除濕機 MJ-EV150JX-TW", "MITSUBISHI 三菱 除濕機 MJ-EV150JX"], reg)
    assert len(r.masters) == 1
    assert r.masters[0].model == "MJ-EV150JX-TW"
    assert r.masters[0].status == ReviewStatus.OK


def test_plus_version_is_a_different_model():
    r = group_listings(["3M 除濕機 FD-Y60L", "3M 除濕機 FD-Y60L PLUS"])
    assert sorted(m.model for m in r.masters) == ["FD-Y60L", "FD-Y60L PLUS"]
    assert all(m.status == ReviewStatus.NEEDS_REVIEW for m in r.masters)


def test_o_zero_confusion_flagged_not_merged():
    r = group_listings(["LG 樂金 除濕機 DD181MWE0", "LG 樂金 除濕機 DD181MWEO"])
    assert len(r.masters) == 2
    assert all(ReasonCode.SIMILAR_MODEL in [x.code for x in m.review_reasons] for m in r.masters)


def test_sibling_models_are_separate_and_ok():
    r = group_listings(["HITACHI 日立 7L 除濕機 RD-14FJ", "HITACHI 日立 11L 除濕機 RD-22FJ"])
    assert len(r.masters) == 2
    assert all(m.status == ReviewStatus.OK for m in r.masters)


def test_different_capacity_not_merged():
    r = group_listings(["SAMPO 聲寶 6L 除濕機 AD-S512T", "SAMPO 聲寶 12L 除濕機 AD-S512T"])
    assert len(r.masters) == 2
    assert sorted(m.variant.capacity_l for m in r.masters) == [6.0, 12.0]
    assert all(ReasonCode.ATTRIBUTE_CONFLICT in [x.code for x in m.review_reasons] for m in r.masters)


def test_same_capacity_different_units_merged():
    r = group_listings(["SAMPO 聲寶 6L 除濕機 AD-S512T", "SAMPO 聲寶 6公升 除濕機 AD-S512T", "SAMPO 聲寶 除濕機 AD-S512T"])
    assert len(r.masters) == 1 and r.masters[0].variant.capacity_l == 6.0
    assert r.masters[0].status == ReviewStatus.OK


def test_different_voltage_not_merged():
    r = group_listings(["Dyson 吹風機 HD15 110V", "Dyson 吹風機 HD15 220V"])
    assert len(r.masters) == 2
    assert sorted(m.variant.voltage_v for m in r.masters) == [110, 220]


def test_region_import_not_merged_with_official():
    r = group_listings([
        "Panasonic 國際牌 除濕機 F-Y22PN 台灣公司貨",
        "Panasonic 除濕機 F-Y22PN 日本直送 平行輸入",
        "Panasonic 國際牌 除濕機 F-Y22PN",
    ])
    assert len(r.masters) == 3
    regions = {m.variant.region for m in r.masters}
    assert regions == {"tw-official", "import", None}
    unspecified = next(m for m in r.masters if m.variant.region is None)
    assert ReasonCode.UNSPECIFIED_VARIANT in [x.code for x in unspecified.review_reasons]


def test_official_and_unspecified_region_are_compatible():
    r = group_listings(["Panasonic 國際牌 除濕機 F-Y22PN 台灣公司貨", "Panasonic 國際牌 除濕機 F-Y22PN"])
    assert len(r.masters) == 1 and r.masters[0].status == ReviewStatus.OK


def test_bundle_and_single_are_separate():
    r = group_listings(["HITACHI 日立 除濕機 RD-14FJ", "HITACHI 日立 除濕機 RD-14FJ 2入組"])
    assert len(r.masters) == 2
    assert {m.kind for m in r.masters} == {ListingKind.SINGLE, ListingKind.BUNDLE}


def test_space_separated_model_needs_review_alone_but_corroborated_in_group():
    alone = group_listings(["【蝦皮直營】SAMPO 聲寶 6L 微電腦除濕機 AD S512T 廠商直送"])
    assert alone.masters[0].model_key == "ADS512T"
    assert alone.masters[0].status == ReviewStatus.NEEDS_REVIEW
    assert ReasonCode.MODEL_JOINED_BY_SPACE in [x.code for x in alone.masters[0].review_reasons]

    reg = OfficialModelRegistry([OfficialModel(brand="sampo", model="AD-S512T")])
    verified = group_listings(["【蝦皮直營】SAMPO 聲寶 6L 微電腦除濕機 AD S512T 廠商直送"], reg)
    assert verified.masters[0].model == "AD-S512T" and verified.masters[0].status == ReviewStatus.OK


def test_multiple_models_in_single_listing_needs_review():
    n = normalize_title("SAMPO 聲寶 除濕機 AD-S512T AD-W520T")
    assert ReasonCode.MULTIPLE_MODELS in [r.code for r in n.review_reasons]
    assert n.status == ReviewStatus.NEEDS_REVIEW


def test_brandless_listing_inherits_brand_from_same_model_group():
    r = group_listings(["Panasonic 國際牌 除濕機 F-Y22PN", "除濕機 F-Y22PN 現貨免運"])
    assert len(r.masters) == 1
    assert r.masters[0].brand.slug == "panasonic"
    assert ReasonCode.BRAND_INFERRED in [x.code for x in r.masters[0].listings[1].review_reasons]
    assert r.masters[0].status == ReviewStatus.OK


def test_no_model_goes_to_unresolved():
    r = group_listings(["【現貨免運】小型除濕機 浴室除濕器 靜音"])
    assert r.masters == [] and len(r.unresolved) == 1
    assert r.unresolved[0].status == ReviewStatus.NEEDS_REVIEW


def test_sources_are_preserved():
    listing = RawListing(raw_title="【限時優惠】SAMPO 聲寶 除濕機 AD-S512T 免運", shop_id="123", item_id="456",
                         shop_name="測試賣場", source_url="https://shopee.tw/product/123/456", collected_at="2026-11-15")
    r = group_listings([listing])
    kept = r.masters[0].listings[0].listing
    assert kept == listing
    assert "【限時優惠】" in r.masters[0].listings[0].removed_terms


def test_output_roundtrips_through_schema():
    r = group_listings(SPEC_TITLES + ["HITACHI 日立 除濕機 RD-14FJ 2入組", "適用 F-Y22PN 濾網"])
    again = GroupingResult.model_validate_json(r.model_dump_json())
    assert again == r


def test_cli(tmp_path):
    src = tmp_path / "titles.json"
    out = tmp_path / "out.json"
    src.write_text(json.dumps(SPEC_TITLES, ensure_ascii=False), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "product_research.product_normalizer", "--input", str(src), "--out", str(out)],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    data = GroupingResult.model_validate_json(out.read_text(encoding="utf-8"))
    assert data.masters[0].canonical_name == "XX牌 ABC-120TW 除濕機"


def test_buy_one_get_one_is_bundle_not_gift():
    n = normalize_title("LG 樂金 空氣清淨機 AS101DWH0 買一送一")
    assert n.kind == ListingKind.BUNDLE and n.model.written == "AS101DWH0"


def test_refurbished_not_merged_with_new():
    r = group_listings(["HITACHI 日立 除濕機 RD-200HH1 福利品", "HITACHI 日立 除濕機 RD-200HH1"])
    assert len(r.masters) == 2
    assert {m.variant.condition for m in r.masters} == {"non-new", None}
    assert all(m.status == ReviewStatus.NEEDS_REVIEW for m in r.masters)
