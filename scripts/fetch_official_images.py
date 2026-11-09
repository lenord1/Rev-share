import os
import json
import re
from duckduckgo_search import DDGS

# 定義雙層子目錄下的 targets 路徑
DATA_PATH = "affiliate-site-kit/affiliate-site-kit/src/data/products.json"

def clean_model_name(title):
    match = re.search(r'([A-Za-z0-9]{2,8}[-_][A-Za-z0-9]{2,8}|[A-Za-z]{2,4}[0-9]{2,5})', title)
    return match.group(0) if match else title.split()[0]

def search_official_image(keyword):
    try:
        with DDGS() as ddgs:
            results = list(ddgs.images(
                keywords=f"{keyword} 官方 規格",
                region="wt-wt",
                safesearch="moderate",
                max_results=3
            ))
            for res in results:
                url = res.get("image", "")
                # 排除蝦皮本身的縮圖網域
                if url.startswith("https://") and "shopee" not in url:
                    return url
    except Exception as e:
        print(f"  ⚠️ 搜尋圖片發生異常 [{keyword}]: {e}")
    return None

def main():
    if not os.path.exists(DATA_PATH):
        print(f"❌ 找不到資料檔: {DATA_PATH}")
        return

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    products = data.get("products", [])
    updated_count = 0

    print(f"🔍 開始檢驗 {len(products)} 款商品的官方圖片...")

    for item in products:
        # 若已有官方圖片則跳過
        if item.get("isOfficialImage") is True:
            continue

        model = item.get("modelCode") or clean_model_name(item.get("titleTemplate", ""))
        print(f"🎯 正在為型號 [{model}] 搜尋原廠高清圖...")
        
        official_url = search_official_image(model)
        if official_url:
            item["imageUrl"] = official_url
            item["isOfficialImage"] = True
            updated_count += 1
            print(f"  ✔ 成功替換官方圖片: {official_url}")

    if updated_count > 0:
        with open(DATA_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"🎉 成功更新 {updated_count} 款商品的官方圖片！")
    else:
        print("💡 所有商品圖片均已是官方圖或無須更新。")

if __name__ == "__main__":
    main()
