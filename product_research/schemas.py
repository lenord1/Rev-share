"""Phase A 的資料結構（Pydantic v2）。

設計原則：
- 賣場資料（RawListing）與商品主檔候選（ProductMasterCandidate）分開。
- 原始標題與來源一律保留，不覆寫。
- 「是否需要人工確認」（ReviewStatus）與「是否已有官方資料佐證」（OfficialVerification）是兩件事。
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ListingKind(str, Enum):
    SINGLE = "single"        # 單機
    BUNDLE = "bundle"        # 組合／多入
    ACCESSORY = "accessory"  # 配件、耗材（不建立商品主檔）


class ReviewStatus(str, Enum):
    OK = "OK"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class OfficialVerification(str, Enum):
    UNVERIFIED = "UNVERIFIED"  # 尚無官方資料佐證（Phase B 之前都是這個狀態）
    VERIFIED = "VERIFIED"      # 型號已對到官方型號登記表


class ReasonCode(str, Enum):
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    MULTIPLE_MODELS = "MULTIPLE_MODELS"
    MODEL_JOINED_BY_SPACE = "MODEL_JOINED_BY_SPACE"
    MODEL_FORMAT_VARIANTS = "MODEL_FORMAT_VARIANTS"
    SIMILAR_MODEL = "SIMILAR_MODEL"
    BRAND_NOT_FOUND = "BRAND_NOT_FOUND"
    BRAND_INFERRED = "BRAND_INFERRED"
    MULTIPLE_BRANDS = "MULTIPLE_BRANDS"
    ATTRIBUTE_CONFLICT = "ATTRIBUTE_CONFLICT"
    UNSPECIFIED_VARIANT = "UNSPECIFIED_VARIANT"
    MULTIPLE_CAPACITIES = "MULTIPLE_CAPACITIES"
    CATEGORY_NOT_FOUND = "CATEGORY_NOT_FOUND"


#: 只做紀錄、不會讓狀態變成 NEEDS_REVIEW 的原因
INFO_ONLY_REASONS = {ReasonCode.BRAND_INFERRED, ReasonCode.CATEGORY_NOT_FOUND}


class ReviewReason(BaseModel):
    code: ReasonCode
    detail: str


class RawListing(BaseModel):
    """一筆賣場標題與其來源。內容原樣保存。"""

    model_config = ConfigDict(extra="allow")

    raw_title: str
    platform: str = "shopee"
    shop_id: Optional[str] = None
    item_id: Optional[str] = None
    shop_name: Optional[str] = None
    source_url: Optional[str] = None
    collected_at: Optional[str] = None  # ISO 日期
    source_note: Optional[str] = None


class BrandInfo(BaseModel):
    slug: Optional[str] = None  # 品牌表內的品牌才有 slug
    display: str
    matched_alias: str
    known: bool = True


class ModelCandidate(BaseModel):
    written: str            # 標題中的寫法（大寫化；保留連字號、括號尾碼、PLUS 等版本字）
    key: str                # 比對鍵：只留英數、轉大寫
    joined_by_space: bool = False  # 由「AD S512T」這種空白分隔寫法接起來的
    official_match: bool = False


class TitleAttributes(BaseModel):
    capacities_l: list[float] = Field(default_factory=list)       # 標題寫的容量（公升；除濕機多為日除濕量）
    tank_capacities_l: list[float] = Field(default_factory=list)  # 標明是水箱的容量
    voltage_v: Optional[int] = None
    region: Optional[str] = None      # "tw-official"（寫明公司貨）或 "import"（平行輸入等）
    region_term: Optional[str] = None
    condition: Optional[str] = None   # "non-new"：福利品、展示品、二手、整新等
    condition_term: Optional[str] = None
    seller_claims: list[str] = Field(default_factory=list)  # 賣家宣稱（保固、產地、能效），未查證


class NormalizedTitle(BaseModel):
    listing: RawListing
    cleaned_title: str
    removed_terms: list[str] = Field(default_factory=list)
    brand: Optional[BrandInfo] = None
    category: Optional[str] = None
    category_label: Optional[str] = None
    model: Optional[ModelCandidate] = None
    model_candidates: list[ModelCandidate] = Field(default_factory=list)
    ignored_models: list[str] = Field(default_factory=list)  # 「另售…」之後塞的型號，不當成本商品的型號
    attributes: TitleAttributes = Field(default_factory=TitleAttributes)
    kind: ListingKind = ListingKind.SINGLE
    kind_reason: Optional[str] = None
    status: ReviewStatus = ReviewStatus.OK
    review_reasons: list[ReviewReason] = Field(default_factory=list)


class VariantSignature(BaseModel):
    capacity_l: Optional[float] = None
    voltage_v: Optional[int] = None
    region: Optional[str] = None
    condition: Optional[str] = None


class ProductMasterCandidate(BaseModel):
    """同一原廠型號的商品主檔候選；可對應多個賣場標題。"""

    candidate_id: str
    brand: Optional[BrandInfo] = None
    model: str                      # 正式型號寫法（已驗證時取官方寫法，否則為暫定）
    model_key: str
    model_written_forms: list[str] = Field(default_factory=list)
    category: Optional[str] = None
    category_label: Optional[str] = None
    canonical_name: str             # 品牌 + 型號 + 品類
    site_model_code: Optional[str] = None  # 對齊 products.json modelCode 的建議值
    variant: VariantSignature = Field(default_factory=VariantSignature)
    kind: ListingKind = ListingKind.SINGLE
    bundle_model_keys: list[str] = Field(default_factory=list)
    verification: OfficialVerification = OfficialVerification.UNVERIFIED
    official_url: Optional[str] = None
    status: ReviewStatus = ReviewStatus.OK
    review_reasons: list[ReviewReason] = Field(default_factory=list)
    similar_candidate_ids: list[str] = Field(default_factory=list)
    listings: list[NormalizedTitle] = Field(default_factory=list)


class GroupingResult(BaseModel):
    masters: list[ProductMasterCandidate] = Field(default_factory=list)
    unresolved: list[NormalizedTitle] = Field(default_factory=list)   # 辨識不出型號，待人工
    accessories: list[NormalizedTitle] = Field(default_factory=list)  # 配件耗材，不建主檔
    generated_at: Optional[str] = None


class OfficialModel(BaseModel):
    """官方型號登記表的一筆（由 Phase B 的官方資料查證寫入）。"""

    brand: str                      # 品牌 slug
    model: str                      # 官方完整型號寫法
    aliases: list[str] = Field(default_factory=list)  # 經官方資料確認為同一型號的其他寫法
    category: Optional[str] = None
    official_url: Optional[str] = None
    verified_at: Optional[str] = None
