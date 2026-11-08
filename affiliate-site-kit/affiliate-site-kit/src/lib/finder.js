// SmartFinder 的題目與計分：題目選項由「該品類現有商品的 finder 欄位」長出來，沒有資料的題目不出現。
const AREA_OPTS = [
  { label: '10 坪以下', value: 7, space: 'small' },
  { label: '10–15 坪', value: 12.5, space: null },
  { label: '15 坪以上', value: 18, space: 'large' },
];
const HOUSEHOLD_OPTS = [
  { label: '1–2 人', value: 1.5 },
  { label: '3–4 人', value: 3.5 },
  { label: '5 人以上', value: 5.5 },
];
const BUDGET_OPTS = [
  { label: '愈省愈好', value: 'low' },
  { label: '中等預算', value: 'mid' },
  { label: '品質優先', value: 'high' },
];
const TIERS = ['low', 'mid', 'high'];
// finder.tags 的顯示名稱；沒有列在這裡的標籤不會變成選項
export const NEED_LABEL = { quiet: '安靜', family: '全家使用', budget: '省預算', dryer: '要烘乾', compact: '體積小' };

const rangeScore = (v, [a, b]) => (v >= a && v <= b ? 3 : Math.min(Math.abs(v - a), Math.abs(v - b)) <= 3 ? 1 : 0);

/** 回傳該品類的題目：[{ key, title, options:[{label,value,space?}] }]。 */
export function questionsFor(products) {
  const qs = [];
  const withKey = (k) => products.filter((p) => Array.isArray(p.finder?.[k]));
  if (withKey('area').length >= 2) qs.push({ key: 'area', title: '要用在多大的空間？', options: AREA_OPTS });
  else if (withKey('household').length >= 2) qs.push({ key: 'household', title: '家裡有幾個人使用？', options: HOUSEHOLD_OPTS });
  const tiers = new Set(products.map((p) => p.finder?.budget).filter(Boolean));
  if (tiers.size >= 2) qs.push({ key: 'budget', title: '預算怎麼抓？', options: BUDGET_OPTS });
  const count = {};
  products.forEach((p) => (p.finder?.tags ?? []).forEach((t) => (count[t] = (count[t] || 0) + 1)));
  const needs = Object.keys(count).filter((t) => NEED_LABEL[t] && count[t] < products.length);
  if (needs.length) qs.push({ key: 'need', title: '最在意哪一點？', options: needs.map((t) => ({ label: NEED_LABEL[t], value: t })) });
  return qs;
}

/** answers: { area?: number, household?: number, budget?: 'low'|'mid'|'high', need?: tag }；回傳排序後的 { p, score, reasons }。 */
export function pickProducts(products, answers) {
  const items = products.map((p) => {
    let score = 0;
    const reasons = [];
    if (answers.area != null && p.finder.area) {
      const s = rangeScore(answers.area, p.finder.area);
      score += s;
      if (s === 3) reasons.push(`適用 ${p.finder.area[0]}–${p.finder.area[1]} 坪`);
    }
    if (answers.household != null && p.finder.household) {
      const s = rangeScore(answers.household, p.finder.household);
      score += s;
      if (s === 3) reasons.push(`適合 ${p.finder.household[0]}–${p.finder.household[1]} 人`);
    }
    if (answers.budget && p.finder.budget) {
      const d = Math.abs(TIERS.indexOf(answers.budget) - TIERS.indexOf(p.finder.budget));
      score += d === 0 ? 3 : d === 1 ? 1 : 0;
      if (d === 0) reasons.push('符合你的預算');
    }
    if (answers.need && (p.finder.tags ?? []).includes(answers.need)) {
      score += 3;
      reasons.push(`重點：${NEED_LABEL[answers.need]}`);
    }
    return { p, score, reasons };
  });
  // 同分時官方賣場商品優先，再比到手價
  return items.sort((a, b) => b.score - a.score || Number(!!b.p.officialStore) - Number(!!a.p.officialStore) || a.p.final - b.p.final);
}
