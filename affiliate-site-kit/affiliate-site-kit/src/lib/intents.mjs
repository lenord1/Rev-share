// 情境頁（/{品類}/for/{情境}）的共用邏輯：Astro 頁面、驗證器、稽核都用這一份，避免規則不一致。
/** 符合情境標籤的商品（同品類且 tags 含該標籤）。 */
export function matchIntentProducts(products, intent) {
  return products.filter((x) => x.category === intent.category && (x.tags ?? []).includes(intent.tag));
}
/**
 * 會被建置的情境頁：商品數達門檻 且 導言已審核。不符合的不產生頁面（避免薄內容）。
 * 回傳 [{ ...intent, products }]，商品依價格由低到高（頁面內可再套用畫像排序）。
 */
export function buildableIntents(products, intents, { minProducts = 2 } = {}) {
  return (intents ?? [])
    .map((n) => ({ ...n, products: matchIntentProducts(products, n).sort((a, b) => a.price - b.price) }))
    .filter((n) => n.introApproved === true && n.products.length >= minProducts);
}
