import json
import re
import os
import time
from duckduckgo_search import DDGS

DATA_PATH = "affiliate-site-kit/affiliate-site-kit/src/data/products.json"

# 家電型號正則表達式
MODEL_REGEX = re.compile(r'([A-Z0-9]{2,8}[-_][A-Z0-9]{2,8}(?:[-_][A-Z0-9]+)?|[A-Z]{2,4}[0-9]{2,5}[A-Z]{0,4})', re.IGNORECASE)

BRAND_KEYWORDS = [
    "Panasonic", "國際牌", "日立", "HITACHI", "三菱", "MITSUBISHI",
    "LG", "聲寶", "SAMPO", "夏普", "SHARP", "禾聯", "HERAN",
    "飛利浦", "PHILIPS", "大同", "TATUNG", "富及第", "FRIGIDAIRE", "歌林", "KOLIN"
]

def extract_model(title):
    match = MODEL_REGEX.search(title)
    if match:
        return match.group(0).upper()
    return None

def extract_brand(title):
    for b in BRAND_KEYWORDS:
        if b.lower() in title.lower():
            return b
    return ""

def search_official_image(brand, model):
    query = f"{brand} {model} 官網 產品圖"
    try:
        with DDGS() as ddgs:
            results = list(ddgs.images(query, max_results=3))
            if results:
                for img in results:
                    url = img.get('image', '')
                    if "shopee" not in url and "momo" not in url:
                        return url
                return results[0].get('image')
    except Exception as e:
        print(f"  ⚠️ 搜尋圖片失敗 ({model}): {e}")
    return None

def main():
    if not os.path.exists(DATA_PATH):
        print(f"❌ 找不到資料檔: {DATA_PATH}")
        return

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    is_dict = isinstance(data, dict)
    products = data.get("products", []) if is_dict else data

    updated_count = 0
    print(f"🔍 開始掃描 {len(products)} 款商品型號與原廠官網圖片...")

    for item in products:
        title = item.get("title", "")
        if item.get("isOfficialImage"):
            continue

        model = extract_model(title)
        brand = extract_brand(title)

        if model:
            print(f"🎯 偵測到型號: 【{brand} {model}】，搜尋官網原圖中...")
            official_img = search_official_image(brand, model)
            if official_img:
                print(f"  ✔ 成功替換為官網原圖: {official_img[:60]}...")
                item["imageUrl"] = official_img
                item["isOfficialImage"] = True
                item["modelNumber"] = model
                item["brand"] = brand
                updated_count += 1
                time.sleep(1)

    if updated_count > 0:
        if is_dict:
            data["products"] = products
        else:
            data = products

        with open(DATA_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"🎉 成功替換 {updated_count} 款商品的官網高解析主圖！")
    else:
        print("💡 所有商品圖片均已為最新或無須替換。")

if __name__ == "__main__":
    main()
