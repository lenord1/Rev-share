"""把 product_normalizer 的輸出（result.json）印成一頁摘要，不用手打長指令。

    py -m product_research.summarize result.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def summarize(data: dict) -> str:
    masters, acc, unresolved = data.get("masters", []), data.get("accessories", []), data.get("unresolved", [])
    lines = [f"主檔 {len(masters)}｜配件 {len(acc)}｜無型號 {len(unresolved)}", ""]
    def sold(m: dict) -> float:
        total = 0.0
        for n in m["listings"]:
            try:
                total += float(n.get("listing", {}).get("historical_sold") or 0)
            except (TypeError, ValueError):
                pass
        return total

    masters = sorted(masters, key=lambda m: -sold(m))  # 歷史銷量由高到低；銷量由蝦皮後台提供，不是我估的
    for m in masters:
        lines.append(f"■ {m['canonical_name']}  [{m['status']}]  賣場 {len(m['listings'])} 個  歷史已售合計 {sold(m):g}")
        for n in m["listings"]:
            raw = n.get("listing", {})  # 價格、分潤率等賣場資料在原始賣場資料（listing）裡
            price = raw.get("price_twd_inferred")
            lines.append(
                f"   NT${price if price is not None else '?':>8}  分潤 預設{raw.get('commission_default_pct', '?')}%／最高{raw.get('commission_max_pct', '?')}%  "
                f"已售{raw.get('historical_sold', '?')}  {'商城' if raw.get('shopee_verified') or raw.get('is_official_shop') else '    '}  {n['cleaned_title'][:48]}"
            )
        for r in m.get("review_reasons", []):
            lines.append(f"     ⚠ {r['detail'][:70]}")
    if unresolved:
        lines += ["", "— 辨識不出型號 —"] + [f"   {u['cleaned_title'][:60]}" for u in unresolved]
    return "\n".join(lines)


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "result.json"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(summarize(json.loads(Path(path).read_text(encoding="utf-8"))))
