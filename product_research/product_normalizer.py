"""商品標題清理與型號正規化（Phase A）。

用途：
- normalize_title()：把一則蝦皮賣家標題清掉促銷字，辨識品牌、型號、品類、容量、電壓、版本、單機或組合。
- group_listings()：把多個賣場的標題合併成「一個原廠型號一份」的商品主檔候選。

合併規則（保守）：
- 只有比對鍵完全相同（ABC-120TW 與 ABC120TW）才會放進同一份候選；寫法不一致且尚無官方資料時標 NEEDS_REVIEW。
- 型號相似但不相同（少了尾碼、多了 PLUS、O/0 混淆）不合併，雙方都標 NEEDS_REVIEW。
- 官方型號登記表（OfficialModelRegistry，由 Phase B 寫入）確認的別名才會跨寫法合併。
- 容量、電壓、地區版本互相衝突時拆開；組合商品與單機分開；配件耗材不建主檔。
- 原始標題與來源全部保留在輸出裡。

指令：
    python -m product_research.product_normalizer --title "【限時優惠】XX牌除濕機 ABC-120TW 公司貨 現貨免運"
    python -m product_research.product_normalizer --input titles.json [--registry official_models.json] [--out result.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Iterable, Optional, Union

from .schemas import (
    INFO_ONLY_REASONS,
    BrandInfo,
    GroupingResult,
    ListingKind,
    ModelCandidate,
    NormalizedTitle,
    OfficialModel,
    OfficialVerification,
    ProductMasterCandidate,
    RawListing,
    ReasonCode,
    ReviewReason,
    ReviewStatus,
    TitleAttributes,
    VariantSignature,
)

DATA_DIR = Path(__file__).parent / "data"

# 私用區字元：暫時標記「型號(尾碼)」的括號，避免被當成一般括號處理
_PS, _PE = "", ""
# 品牌遮罩：避免品牌字（3M、LG）被當成型號的一部分
_BRAND_MASK = "‖"

_DASHES = "‐‑‒–—―−－﹣"
_BRACKET_PAIRS = [("【", "】"), ("[", "]"), ("(", ")"), ("「", "」"), ("『", "』"), ("《", "》"), ("〔", "〕"), ("{", "}"), ("<", ">")]

_VERSION_WORDS = ("PLUS", "PRO", "MAX", "ULTRA", "MINI", "LITE")
# 不能當成型號前半段的英文短字（「AD S512T」接合規則的排除清單）
_JOIN_STOPWORDS = {
    "LED", "LCD", "DC", "AC", "AI", "UV", "UVC", "PM", "APP", "IOT", "USB", "TW", "JP", "US", "EU", "NEW", "HOT",
    "THE", "PRO", "MAX", "ECO", "NT", "TV", "PC", "X", "S", "L", "M", "XL", "NO", "VS", "OR", "AND", "FOR",
}
_UNIT_RE = re.compile(
    r"^\d+(?:L|ML|V|W|KW|HZ|CM|MM|M|KG|G|DB|MAH|AH|A|P|K|IN|D|H|HR|MIN|RPM|PA|T|X|PCS|GB|TB|MB|CC|BTU)$"
)
_SPEC_TOKEN_RE = re.compile(r"^(?:IPX?\d+|PM\d+|R\d{2,3}[A-Z]?|USB\d*|H1[0-4]|HEPA\d*|UVC?\d*|WIFI\d?|CO2|[AB]\d|\d+IN\d+|20[12]\d)$")

_MODEL_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9-])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:" + _PS + r"[A-Za-z0-9]{1,2}" + _PE + r")?(?![A-Za-z0-9-])"
)
_CAPACITY_RE = re.compile(r"(?<![A-Za-z0-9.-])(\d+(?:\.\d+)?)\s*(?:L|公升|升)(?![A-Za-z0-9])", re.IGNORECASE)
_VOLTAGE_RE = re.compile(r"(?<![A-Za-z0-9])(100|110|115|120|127|220|230|240)\s*[Vv](?![A-Za-z0-9])")
_PRICE_RE = re.compile(r"(?:NT\$?|\$)\s*[\d,]+(?:\.\d+)?\s*[Kk萬]?|[\d,]+\s*元(?:起)?")
_DATE_RANGE_RE = re.compile(r"(?<![A-Za-z0-9])\d{1,2}/\d{1,2}(?:\s*[-~～]\s*\d{1,2}/\d{1,2})?(?![A-Za-z0-9])")
_YEAR_RE = re.compile(r"(?<![A-Za-z0-9])20[12]\d\s*(?:年式|年新款|年度|年|新款|款)")
_GIFT_RE = re.compile(r"(?<![直配運寄外發贈])\+?\s*(?:加碼|再)?(?:贈送|加贈|附贈|送|贈)(?![風貨達])[^\s｜|/,，、;；+]*")
_BUNDLE_WORD_RE = re.compile(
    r"組合|套組|超值組|雙機組|[2-9二兩三四]\s*(?:入|台)|買[一1]送[一1]"
    r"|(?<![A-Za-z0-9])[xX*×]\s*[2-9](?![0-9A-Za-z])"
)
_BOGO_RE = re.compile(r"買[一1二2兩]送[一1]")
_SYMBOL_RE = re.compile(r"[™®©★☆◎●○◆◇■□▲△▼▽▶►◀♥♡❤✨🔥⚡💥🎁👉✅❗‼!！?？~～*＊·•・|｜\\^`]+")
_EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿️]")


def model_key(text: str) -> str:
    """型號比對鍵：NFKC、轉大寫、只留英數。ABC-120TW 與 abc120tw 得到同一個鍵。"""
    return re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKC", text).upper())


def _confusable_key(key: str) -> str:
    return key.replace("O", "0").replace("I", "1")


def _load_json(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


class _Rules:
    """載入品牌表與清理規則（只讀一次）。"""

    def __init__(self) -> None:
        rules = _load_json("title_rules.json")
        brands = _load_json("brands.json")["brands"]
        self.noise_terms = sorted(set(rules["noise_terms"]), key=len, reverse=True)
        self.seller_claims = sorted(set(rules["seller_claims"]), key=len, reverse=True)
        self.official_channel_terms = sorted(rules["official_channel_terms"], key=len, reverse=True)
        self.import_terms = sorted(rules["import_terms"], key=len, reverse=True)
        self.condition_terms = sorted(rules["condition_terms"], key=len, reverse=True)
        self.accessory_nouns = rules["accessory_nouns"]
        self.categories = rules["categories"]
        aliases: list[tuple[str, dict]] = []
        for b in brands:
            for a in b["aliases"]:
                aliases.append((a, b))
        self.brand_aliases = sorted(aliases, key=lambda x: len(x[0]), reverse=True)
        self.brand_words = {a.upper() for a, _ in aliases}


_RULES: Optional[_Rules] = None


def _rules() -> _Rules:
    global _RULES
    if _RULES is None:
        _RULES = _Rules()
    return _RULES


class OfficialModelRegistry:
    """官方型號登記表。Phase B 查到官方產品頁後寫入；Phase A 只負責查詢。"""

    def __init__(self, models: Iterable[OfficialModel] = ()) -> None:
        self._by_key: dict[tuple[str, str], OfficialModel] = {}
        for m in models:
            self.add(m)

    def add(self, m: OfficialModel) -> None:
        for form in [m.model, *m.aliases]:
            self._by_key[(m.brand, model_key(form))] = m

    @classmethod
    def from_file(cls, path: Union[str, Path]) -> "OfficialModelRegistry":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        items = data["models"] if isinstance(data, dict) else data
        return cls(OfficialModel.model_validate(i) for i in items)

    def lookup(self, brand_slug: Optional[str], key: str) -> Optional[OfficialModel]:
        if brand_slug:
            return self._by_key.get((brand_slug, key))
        hits = {id(m): m for (b, k), m in self._by_key.items() if k == key}
        return next(iter(hits.values())) if len(hits) == 1 else None

    def __len__(self) -> int:
        return len({id(m) for m in self._by_key.values()})


# ---------------------------------------------------------------------------
# 單一標題
# ---------------------------------------------------------------------------

def _alias_pattern(alias: str) -> re.Pattern:
    if re.fullmatch(r"[A-Za-z0-9 ]+", alias):
        return re.compile(r"(?<![A-Za-z0-9])" + re.escape(alias) + r"(?![A-Za-z0-9])", re.IGNORECASE)
    return re.compile(re.escape(alias))


def _detect_brands(text: str) -> tuple[list[BrandInfo], str]:
    """回傳偵測到的品牌（依出現位置）與把品牌字遮掉後的文字。"""
    found: dict[str, tuple[int, BrandInfo]] = {}
    masked = text
    for alias, b in _rules().brand_aliases:
        pat = _alias_pattern(alias)
        m = pat.search(masked)
        if not m:
            continue
        if b["slug"] not in found or m.start() < found[b["slug"]][0]:
            found[b["slug"]] = (m.start(), BrandInfo(slug=b["slug"], display=b["display"], matched_alias=alias))
        masked = pat.sub(lambda mm: _BRAND_MASK * len(mm.group(0)), masked)
    brands = [bi for _, bi in sorted(found.values(), key=lambda x: x[0])]
    if not brands:
        m = re.search(r"([A-Za-z一-鿿]{1,6}牌)", text)
        if m:
            name = m.group(1)
            brands = [BrandInfo(slug=None, display=name, matched_alias=name, known=False)]
            masked = masked.replace(name, _BRAND_MASK * len(name), 1)
    return brands, masked


def _is_spec_token(key: str) -> bool:
    return bool(_UNIT_RE.match(key) or _SPEC_TOKEN_RE.match(key))


def _restore_paren(written: str) -> str:
    return written.replace(_PS, "(").replace(_PE, ")")


def _extract_models(masked: str) -> list[ModelCandidate]:
    tokens = [(m.group(0), m.start(), m.end()) for m in _MODEL_TOKEN_RE.finditer(masked)]
    out: list[ModelCandidate] = []
    consumed: set[int] = set()
    for i, (tok, start, end) in enumerate(tokens):
        if i in consumed:
            continue
        plain = _restore_paren(tok)
        key = model_key(plain)
        joined = False
        # 「AD S512T」：1–3 個大寫字母 + 空白 + 含數字且沒有連字號的片段
        if tok.isalpha() and tok.isupper() and 1 <= len(tok) <= 3 and tok not in _JOIN_STOPWORDS and i + 1 < len(tokens):
            ntok, nstart, nend = tokens[i + 1]
            gap = masked[end:nstart]
            nkey = model_key(_restore_paren(ntok))
            if (
                gap.isspace() and len(gap) <= 2 and "-" not in ntok
                and any(c.isdigit() for c in ntok) and any(c.isalpha() for c in ntok)
                and not _is_spec_token(nkey)
            ):
                plain = f"{tok} {_restore_paren(ntok)}"
                key = model_key(plain)
                end = nend
                joined = True
                consumed.add(i + 1)
        has_alpha = any(c.isalpha() for c in key)
        has_digit = any(c.isdigit() for c in key)
        if not (has_alpha and has_digit) or len(key) < 4 or _is_spec_token(key):
            continue
        if key in _rules().brand_words:
            continue
        # 型號後面的版本字（FD-Y60L PLUS）是型號的一部分，不能丟
        vm = re.match(r"\s{1,2}(" + "|".join(_VERSION_WORDS) + r")(?![A-Za-z0-9-])", masked[end:], re.IGNORECASE)
        if vm:
            plain = f"{plain} {vm.group(1).upper()}"
            key = model_key(plain)
        written = plain.upper()
        if all(c.key != key for c in out):
            out.append(ModelCandidate(written=written, key=key, joined_by_space=joined))
        else:
            # 同一個鍵出現兩種寫法（F-Y22PN/FY22PN）：留有連字號的那個
            for idx, c in enumerate(out):
                if c.key == key and written.count("-") > c.written.count("-"):
                    out[idx] = ModelCandidate(written=written, key=key, joined_by_space=joined)
    return out


def _noise_only(content: str) -> bool:
    """括號內容去掉促銷字、贈品字、符號、數字後是否什麼都不剩。"""
    r = _rules()
    s = content
    s = _GIFT_RE.sub(" ", s)
    for t in r.noise_terms + r.seller_claims:
        s = s.replace(t, " ")
    s = _DATE_RANGE_RE.sub(" ", s)
    s = re.sub(r"[\W\d_]+", "", s)
    return s == ""


def _strip_noise_brackets(text: str, removed: list[str]) -> str:
    for open_, close in _BRACKET_PAIRS:
        pat = re.compile(re.escape(open_) + r"([^" + re.escape(open_ + close) + r"]*)" + re.escape(close))

        def repl(m: re.Match) -> str:
            inner = m.group(1).strip()
            if inner == "" or _noise_only(inner):
                if inner:
                    removed.append(m.group(0))
                return " "
            return f" {inner} "

        prev = None
        while prev != text:
            prev = text
            text = pat.sub(repl, text)
    return text


def _detect_categories(text: str) -> list[dict]:
    hits: list[tuple[int, dict]] = []
    for cat in _rules().categories:
        pos = [text.find(k) for k in cat["keywords"] if k in text]
        if pos:
            hits.append((min(pos), cat))
    return [c for _, c in sorted(hits, key=lambda x: x[0])]


def _extract_attributes(text: str, removed: list[str]) -> TitleAttributes:
    r = _rules()
    attrs = TitleAttributes()
    for m in _CAPACITY_RE.finditer(text):
        val = float(m.group(1))
        around = text[max(0, m.start() - 4): m.end() + 3]
        target = attrs.tank_capacities_l if "水箱" in around else attrs.capacities_l
        if val not in target:
            target.append(val)
    vm = _VOLTAGE_RE.search(text)
    if vm:
        attrs.voltage_v = int(vm.group(1))
    for t in r.import_terms:
        if t in text:
            attrs.region, attrs.region_term = "import", t
            break
    if attrs.region is None:
        for t in r.official_channel_terms:
            if t in text:
                attrs.region, attrs.region_term = "tw-official", t
                break
    for t in r.condition_terms:
        if t in text:
            attrs.condition, attrs.condition_term = "non-new", t
            break
    for t in r.seller_claims:
        if t in text and not any(t in c for c in attrs.seller_claims):
            attrs.seller_claims.append(t)
    return attrs


def _clean_text(text: str, removed: list[str]) -> str:
    r = _rules()
    text = _strip_noise_brackets(text, removed)

    def drop(pattern: re.Pattern, s: str) -> str:
        def repl(m: re.Match) -> str:
            if m.group(0).strip():
                removed.append(m.group(0).strip())
            return " "
        return pattern.sub(repl, s)

    text = drop(_PRICE_RE, text)
    text = drop(_DATE_RANGE_RE, text)
    text = drop(_YEAR_RE, text)
    text = drop(_GIFT_RE, text)
    for t in r.import_terms + r.condition_terms + r.seller_claims + r.noise_terms:
        if t in text:
            removed.append(t)
            text = text.replace(t, " ")
    text = _EMOJI_RE.sub(" ", _SYMBOL_RE.sub(" ", text))
    text = re.sub(r"\s*[-/,，、:：]\s*(?=$|\s)", " ", text)  # 懸空的分隔符號
    text = re.sub(r"(?:^|\s)[-/,，、:：]\s*", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_title(
    listing: Union[str, RawListing, dict],
    registry: Optional[OfficialModelRegistry] = None,
) -> NormalizedTitle:
    """清理一則賣家標題並辨識品牌、型號、品類與版本資訊。不修改原始標題。"""
    if isinstance(listing, str):
        listing = RawListing(raw_title=listing)
    elif isinstance(listing, dict):
        listing = RawListing.model_validate(listing)

    # ™ 要在 NFKC 之前拿掉，否則會變成「TM」黏在品牌或型號後面
    text = unicodedata.normalize("NFKC", re.sub(r"[™®©℠]", " ", listing.raw_title))
    text = text.translate({ord(c): "-" for c in _DASHES})
    # 型號(尾碼)：HDH-12DY030(N) 的 (N) 是型號的一部分，先保護起來
    text = re.sub(r"([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\d[A-Za-z0-9]*)\(([A-Za-z0-9]{1,2})\)", r"\1" + _PS + r"\2" + _PE, text)

    removed: list[str] = []
    reasons: list[ReviewReason] = []
    attrs = _extract_attributes(text, removed)
    bogo = _BOGO_RE.search(text)  # 「買一送一」是多入組合，不是贈品，要在贈品規則之前處理
    if bogo:
        text = _BOGO_RE.sub(" ", text)
        removed.append(bogo.group(0))
    bundle_word = bogo or _BUNDLE_WORD_RE.search(_GIFT_RE.sub(" ", text))
    has_plus = bool(re.search(r"\S\s*\+\s*\S", _GIFT_RE.sub(" ", text)))

    cleaned = _clean_text(text, removed)
    categories = _detect_categories(cleaned)
    brands, masked = _detect_brands(cleaned)
    models = _extract_models(masked)

    brand = brands[0] if brands else None
    if registry is not None:
        for c in models:
            if registry.lookup(brand.slug if brand else None, c.key):
                c.official_match = True

    # 配件耗材
    r = _rules()
    acc = next((n for n in r.accessory_nouns if n in cleaned), None)
    kind, kind_reason = ListingKind.SINGLE, None
    if acc and ("適用" in cleaned or "專用" + acc in cleaned or "原廠" + acc in cleaned or not categories or cleaned.rstrip().endswith(acc)):
        kind, kind_reason = ListingKind.ACCESSORY, f"標題為配件／耗材（{acc}）"
    elif bundle_word:
        kind, kind_reason = ListingKind.BUNDLE, f"標題含組合字樣「{bundle_word.group(0).strip()}」"
    elif has_plus and (len(models) >= 2 or len(categories) >= 2):
        kind, kind_reason = ListingKind.BUNDLE, "標題以「+」連接多項商品"

    # 選定主型號
    model: Optional[ModelCandidate] = None
    if models:
        official = [c for c in models if c.official_match]
        ranked = official or sorted(
            models, key=lambda c: (c.joined_by_space, -("-" in c.written), -min(len(c.key), 8))
        )
        model = ranked[0]
        distinct = {c.key for c in models}
        if len(distinct) > 1 and kind == ListingKind.SINGLE and len(official) != 1:
            reasons.append(ReviewReason(
                code=ReasonCode.MULTIPLE_MODELS,
                detail="標題出現多個型號候選：" + "、".join(c.written for c in models),
            ))
        if model.joined_by_space and not model.official_match:
            reasons.append(ReviewReason(
                code=ReasonCode.MODEL_JOINED_BY_SPACE,
                detail=f"型號由空白分隔的片段接合而成「{model.written}」，需其他來源佐證",
            ))
    elif kind != ListingKind.ACCESSORY:
        reasons.append(ReviewReason(code=ReasonCode.MODEL_NOT_FOUND, detail="標題中找不到可辨識的原廠型號"))

    if not brand:
        reasons.append(ReviewReason(code=ReasonCode.BRAND_NOT_FOUND, detail="標題中找不到已知品牌"))
    elif len({b.slug or b.display for b in brands}) > 1 and kind == ListingKind.SINGLE:
        reasons.append(ReviewReason(
            code=ReasonCode.MULTIPLE_BRANDS, detail="標題出現多個品牌：" + "、".join(b.display for b in brands)
        ))
    if not categories:
        reasons.append(ReviewReason(code=ReasonCode.CATEGORY_NOT_FOUND, detail="標題中找不到已知品類詞"))
    if len(attrs.capacities_l) > 1 and kind == ListingKind.SINGLE:
        reasons.append(ReviewReason(
            code=ReasonCode.MULTIPLE_CAPACITIES,
            detail="標題出現多個容量數字：" + "、".join(f"{v:g}L" for v in attrs.capacities_l),
        ))

    blocking = [x for x in reasons if x.code not in INFO_ONLY_REASONS]
    if kind == ListingKind.ACCESSORY:
        blocking = []
    return NormalizedTitle(
        listing=listing,
        cleaned_title=_restore_paren(cleaned),
        removed_terms=list(dict.fromkeys(_restore_paren(t) for t in removed)),
        brand=brand,
        category=categories[0]["slug"] if categories else None,
        category_label=categories[0]["label"] if categories else None,
        model=model,
        model_candidates=models,
        attributes=attrs,
        kind=kind,
        kind_reason=kind_reason,
        status=ReviewStatus.NEEDS_REVIEW if blocking else ReviewStatus.OK,
        review_reasons=reasons,
    )


# ---------------------------------------------------------------------------
# 多個賣場標題 → 商品主檔候選
# ---------------------------------------------------------------------------

def _brand_key(n: NormalizedTitle) -> Optional[str]:
    if n.brand is None:
        return None
    return n.brand.slug or f"?{n.brand.display}"


def _listing_variant(n: NormalizedTitle) -> dict[str, object]:
    caps = n.attributes.capacities_l
    return {
        "capacity_l": caps[0] if len(caps) == 1 else None,
        "voltage_v": n.attributes.voltage_v,
        "region": n.attributes.region,
        "condition": n.attributes.condition,
    }


def _split_by_variant(items: list[NormalizedTitle]) -> list[tuple[dict, list[NormalizedTitle], list[ReviewReason]]]:
    """容量／電壓／地區版本衝突時拆開。沒有衝突就維持一組。"""
    labels = {"capacity_l": "容量", "voltage_v": "電壓", "region": "地區版本", "condition": "商品狀態"}
    exclusive = {"region": "import", "condition": "non-new"}
    variants = [_listing_variant(n) for n in items]
    conflicts: dict[str, set] = {}
    for attr in labels:
        all_vals = {v[attr] for v in variants}
        stated = all_vals - {None}
        if attr in exclusive:
            # 「公司貨」與「未註明」視為相容；只要有平行輸入（或福利品、二手）字樣而其他標題不是，就算衝突
            if exclusive[attr] in stated and len(all_vals) > 1:
                conflicts[attr] = all_vals
        elif len(stated) > 1:
            conflicts[attr] = stated

    def merged_of(group_variants: list[dict]) -> dict:
        return {a: next((v[a] for v in group_variants if v[a] is not None), None) for a in labels}

    if not conflicts:
        return [(merged_of(variants), items, [])]

    buckets: dict[tuple, list[int]] = defaultdict(list)
    for idx, v in enumerate(variants):
        buckets[tuple(v[a] for a in conflicts)].append(idx)
    detail = "；".join(
        f"{labels[a]}不一致（" + "、".join(sorted("未註明" if x is None else f"{x:g}" if isinstance(x, float) else str(x) for x in vals)) + "）"
        for a, vals in conflicts.items()
    )
    out = []
    for sig, idxs in buckets.items():
        rs = [ReviewReason(code=ReasonCode.ATTRIBUTE_CONFLICT, detail=f"同型號的賣場標題{detail}，已拆開不合併")]
        if any(s is None for s in sig):
            rs.append(ReviewReason(code=ReasonCode.UNSPECIFIED_VARIANT, detail="這些標題未寫明有衝突的規格，無法判斷屬於哪一個版本"))
        merged = merged_of([variants[i] for i in idxs])
        for a, s_ in zip(conflicts, sig):
            merged[a] = s_
        out.append((merged, [items[i] for i in idxs], rs))
    return out


def _pick_display(cands: list[ModelCandidate]) -> str:
    """暫定型號寫法：不採用空白接合的寫法；其餘取最多賣場使用、連字號較完整的。"""
    counts = Counter(c.written for c in cands)
    joined = {c.written for c in cands if c.joined_by_space}
    return sorted(counts, key=lambda f: (f in joined, -counts[f], -f.count("-"), f))[0]


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def group_listings(
    listings: Iterable[Union[str, RawListing, dict, NormalizedTitle]],
    registry: Optional[OfficialModelRegistry] = None,
) -> GroupingResult:
    """把多個賣場標題合併成商品主檔候選。一個原廠型號（同版本）只會有一份。"""
    normalized = [n if isinstance(n, NormalizedTitle) else normalize_title(n, registry) for n in listings]
    result = GroupingResult(generated_at=date.today().isoformat())

    # 1) 解析每筆的（品牌鍵、型號鍵）；官方登記表可把別名導向官方型號
    resolved: list[tuple[NormalizedTitle, Optional[str], str, Optional[OfficialModel]]] = []
    for n in normalized:
        if n.kind == ListingKind.ACCESSORY:
            result.accessories.append(n)
            continue
        if n.model is None:
            result.unresolved.append(n)
            continue
        bkey = _brand_key(n)
        official = registry.lookup(n.brand.slug if n.brand else None, n.model.key) if registry else None
        key = model_key(official.model) if official else n.model.key
        if official and bkey is None:
            bkey = official.brand
        resolved.append((n, bkey, key, official))

    # 2) 沒寫品牌的標題：同一型號鍵只對到一個品牌時，推定為該品牌（記錄為推定）
    brands_by_key: dict[str, set[str]] = defaultdict(set)
    for n, bkey, key, _ in resolved:
        if bkey:
            brands_by_key[key].add(bkey)
    brand_info: dict[str, BrandInfo] = {}
    for n, bkey, _, _ in resolved:
        if bkey and n.brand and bkey not in brand_info:
            brand_info[bkey] = n.brand
    if registry:
        for alias, b in _rules().brand_aliases:
            brand_info.setdefault(b["slug"], BrandInfo(slug=b["slug"], display=b["display"], matched_alias=alias))

    buckets: dict[tuple, list[tuple[NormalizedTitle, Optional[OfficialModel]]]] = defaultdict(list)
    for n, bkey, key, official in resolved:
        if bkey is None and len(brands_by_key[key]) == 1:
            bkey = next(iter(brands_by_key[key]))
            n.review_reasons = [r for r in n.review_reasons if r.code != ReasonCode.BRAND_NOT_FOUND] + [
                ReviewReason(code=ReasonCode.BRAND_INFERRED,
                             detail=f"標題未寫品牌；同型號的其他賣場標題品牌為「{brand_info[bkey].display}」，推定相同")
            ]
        bundle_sig: tuple = ()
        if n.kind == ListingKind.BUNDLE:
            bundle_sig = (tuple(sorted(c.key for c in n.model_candidates)), n.kind_reason or "")
        buckets[(bkey, key, n.kind, bundle_sig)].append((n, official))

    # 3) 每個桶再依版本衝突拆開，建立候選
    for (bkey, key, kind, bundle_sig), members in buckets.items():
        items = [n for n, _ in members]
        official = next((o for _, o in members if o), None)
        for variant, group, variant_reasons in _split_by_variant(items):
            reasons: list[ReviewReason] = list(variant_reasons)
            forms = [n.model.written for n in group]
            distinct_forms = list(dict.fromkeys(forms))
            if official:
                display = official.model.upper()
                verification = OfficialVerification.VERIFIED
            else:
                display = _pick_display([n.model for n in group])
                verification = OfficialVerification.UNVERIFIED
                if len(distinct_forms) > 1:
                    reasons.append(ReviewReason(
                        code=ReasonCode.MODEL_FORMAT_VARIANTS,
                        detail="各賣場型號寫法不一致（" + "、".join(distinct_forms) + f"），暫定「{display}」，待官方資料確認",
                    ))
            corroborated = official is not None or any(not n.model.joined_by_space for n in group)
            for n in group:
                for r in n.review_reasons:
                    if r.code in INFO_ONLY_REASONS:
                        continue
                    if r.code == ReasonCode.MODEL_JOINED_BY_SPACE and corroborated:
                        continue
                    if r.code == ReasonCode.BRAND_NOT_FOUND and bkey:
                        continue
                    if all(x.detail != r.detail for x in reasons):
                        reasons.append(r)
            brand = brand_info.get(bkey) if bkey else None
            if brand is None:
                if all(x.code != ReasonCode.BRAND_NOT_FOUND for x in reasons):
                    reasons.append(ReviewReason(code=ReasonCode.BRAND_NOT_FOUND, detail="這個型號的所有標題都沒有可辨識的品牌"))
            cat = next((n for n in group if n.category), None)
            category = (official.category if official and official.category else None) or (cat.category if cat else None)
            label = next((c["label"] for c in _rules().categories if c["slug"] == category), cat.category_label if cat else None)
            name_parts = [brand.display if brand else None, display, label]
            cid = f"{bkey or 'unknown'}:{key}"
            suffix = []
            if kind == ListingKind.BUNDLE:
                suffix.append("bundle-" + "-".join(bundle_sig[0]) if bundle_sig and len(bundle_sig[0]) > 1 else "bundle")
            if variant_reasons:
                suffix += [f"{a}={variant[a]}" for a in ("capacity_l", "voltage_v", "region", "condition") if variant[a] is not None] or ["unspecified"]
            if suffix:
                cid += "#" + ",".join(suffix)
            result.masters.append(ProductMasterCandidate(
                candidate_id=cid,
                brand=brand,
                model=display,
                model_key=key,
                model_written_forms=distinct_forms,
                category=category,
                category_label=label,
                canonical_name=" ".join(p for p in name_parts if p) + ("（組合）" if kind == ListingKind.BUNDLE else ""),
                site_model_code=f"{brand.slug}-{_slug(display)}" if brand and brand.slug else None,
                variant=VariantSignature(**variant),
                kind=kind,
                bundle_model_keys=list(bundle_sig[0]) if bundle_sig else [],
                verification=verification,
                official_url=official.official_url if official else None,
                review_reasons=reasons,
                listings=group,
            ))

    # 4) 相似但不相同的型號：不合併，雙方都標記
    singles = [m for m in result.masters if m.kind == ListingKind.SINGLE]
    for i, a in enumerate(singles):
        for b in singles[i + 1:]:
            if a.model_key == b.model_key:
                continue
            same_brand = (a.brand and b.brand and (a.brand.slug or a.brand.display) == (b.brand.slug or b.brand.display)) or not a.brand or not b.brand
            if not same_brand:
                continue
            short, long_ = sorted((a.model_key, b.model_key), key=len)
            prefix_related = long_.startswith(short) and len(short) >= 5
            confusable = _confusable_key(a.model_key) == _confusable_key(b.model_key)
            if not (prefix_related or confusable):
                continue
            if a.verification == OfficialVerification.VERIFIED and b.verification == OfficialVerification.VERIFIED:
                continue  # 官方已確認是兩個不同型號
            why = "只差在 O/0 或 I/1" if confusable else "其中一個多了尾碼或版本字"
            for x, y in ((a, b), (b, a)):
                x.similar_candidate_ids.append(y.candidate_id)
                x.review_reasons.append(ReviewReason(
                    code=ReasonCode.SIMILAR_MODEL,
                    detail=f"型號「{x.model}」與「{y.model}」相似（{why}），證據不足，未合併",
                ))

    for m in result.masters:
        blocking = [r for r in m.review_reasons if r.code not in INFO_ONLY_REASONS]
        m.status = ReviewStatus.NEEDS_REVIEW if blocking else ReviewStatus.OK
    result.masters.sort(key=lambda m: m.candidate_id)
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="蝦皮標題清理與型號正規化")
    p.add_argument("--title", action="append", help="直接給一則標題（可重複）")
    p.add_argument("--input", help="JSON 檔：標題字串陣列，或 RawListing 物件陣列（或 {\"listings\": [...]}）")
    p.add_argument("--registry", help="官方型號登記表 JSON（Phase B 產出）")
    p.add_argument("--out", help="輸出檔；省略則印到畫面")
    p.add_argument("--single", action="store_true", help="只清理各標題，不做合併")
    args = p.parse_args(argv)

    items: list = list(args.title or [])
    if args.input:
        data = json.loads(Path(args.input).read_text(encoding="utf-8"))
        items += data["listings"] if isinstance(data, dict) else data
    if not items:
        p.error("請用 --title 或 --input 提供標題")
    registry = OfficialModelRegistry.from_file(args.registry) if args.registry else None

    if args.single:
        payload = [normalize_title(i, registry).model_dump(mode="json", exclude_none=True) for i in items]
    else:
        payload = group_listings(items, registry).model_dump(mode="json", exclude_none=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"已寫入 {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
