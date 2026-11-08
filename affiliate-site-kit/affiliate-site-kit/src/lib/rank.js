// 語意解析與動態加權排序：純函式、純前端詞庫比對（不用 AI、不呼叫後端）。
// 規則與 design/personalize.html 一致（docs/personalization-spec.md 模組二）。
import { petLabel } from './profile.js';

// 詞：說法 → 意圖。長詞優先、命中後從字串移除（避免「毛小孩」被拆成「小孩」誤判成有孩子）。
const INTENT_WORDS = [
  { intent: 'pet', pet: 'cat', words: ['養貓', '貓咪', '貓'] },
  { intent: 'pet', pet: 'dog', words: ['養狗', '狗狗', '狗'] },
  { intent: 'pet', pet: 'other', words: ['毛小孩', '毛孩', '寵物', '掉毛', '毛髮'] },
  { intent: 'child', words: ['小孩', '孩子', '兒童', '寶寶', '嬰兒', '幼兒', '小朋友', '有小孩'] },
  { intent: 'quiet', words: ['靜音', '安靜', '好睡', '睡覺', '不吵', '低噪'] },
  { intent: 'large', words: ['大坪數', '大空間', '客廳', '大房間', '大間'] },
  { intent: 'small', words: ['小坪數', '小空間', '套房', '雅房', '臥室', '小房間', '小間'] },
  { intent: 'budget', words: ['便宜', '預算', '平價', '省錢', '入門'] },
];
// 品類詞（硬篩選）：key 是品類 slug，只有實際有商品的品類才會被辨識
const CATEGORY_WORDS = {
  dehumidifier: ['除濕機', '除濕', '抽濕', '潮濕'],
  washer: ['洗衣機', '洗衣', '烘衣'],
  'water-heater': ['熱水器', '熱水'],
  'air-conditioner': ['冷氣', '空調'],
  'robot-vacuum': ['掃地機', '掃地', '吸塵'],
};
// 意圖 → 對應商品標籤（標籤限用 scripts/config.json 的 tagVocabulary）
export const INTENT_TAGS = { pet: ['寵物友善', '除臭'], child: ['安全鎖'], quiet: ['靜音'], large: ['大坪數'], small: ['小坪數'], budget: ['預算友善'] };
export const INTENT_LABEL = { pet: '寵物', child: '有小孩', quiet: '靜音', large: '大空間', small: '小空間', budget: '預算' };
// 權重：寵物最高（需求最硬：毛髮、氣味、誤食），其次小孩（安全）
export const W = {
  query: { pet: 60, child: 45, quiet: 35, large: 35, small: 35, budget: 30 },
  profile: { pet: 50, child: 40, large: 30, small: 30 },
};

export function parseQuery(q, categorySlugs = Object.keys(CATEGORY_WORDS)) {
  const out = { intents: new Set(), pet: null, category: null, rest: '' };
  let s = (q || '').toLowerCase();
  const entries = [
    ...INTENT_WORDS.flatMap((e) => e.words.map((w) => [w, e])),
    ...categorySlugs.flatMap((slug) => (CATEGORY_WORDS[slug] ?? []).map((w) => [w, { category: slug }])),
  ].sort((a, b) => b[0].length - a[0].length);
  for (const [w, e] of entries) {
    if (!s.includes(w)) continue;
    if (e.intent) {
      out.intents.add(e.intent);
      if (e.pet) out.pet = out.pet === 'cat' || out.pet === 'dog' ? out.pet : e.pet;
    }
    if (e.category) out.category = e.category;
    s = s.split(w).join(' ');
  }
  out.rest = s.replace(/[的用什麼哪個有沒有家庭推薦嗎呢，。？?\s]+/g, ' ').trim();
  return out;
}

/** 畫像推導出的意圖。 */
export function profileIntents(pr) {
  const set = new Set();
  if (pr.hasPet) set.add('pet');
  if (pr.hasChild === true) set.add('child');
  if (pr.spaceSize === 'large') set.add('large');
  if (pr.spaceSize === 'small') set.add('small');
  return set;
}

/** products 為 catalog.mjs 的 slimProduct；回傳依分數排序的 { p, score, reasons }，同分價低者在前（用到手價）。 */
export function rank(products, query, pr, categorySlugs) {
  const parsed = parseQuery(query, categorySlugs);
  const fromProfile = profileIntents(pr);
  const items = products
    .filter((p) => !parsed.category || p.category === parsed.category)
    .map((p) => {
      let score = 0;
      const reasons = [];
      for (const it of new Set([...parsed.intents, ...fromProfile])) {
        const hit = INTENT_TAGS[it].some((t) => p.tags.includes(t));
        const q = parsed.intents.has(it);
        const m = fromProfile.has(it);
        const base = Math.max(q ? W.query[it] : 0, m ? W.profile[it] || 0 : 0);
        if (hit) {
          score += base + (q && m ? 10 : 0); // 搜尋與記憶一致 → 雙重命中加成
          const who = it === 'pet' ? petLabel(parsed.pet || pr.hasPet) || '寵物' : INTENT_LABEL[it];
          reasons.push(it === 'pet' ? `符合${who}需求` : it === 'child' ? '有安全鎖，適合有小孩' : `符合：${INTENT_LABEL[it]}`);
        } else if (m && it === 'child') score -= 20; // 家裡有小孩卻沒有安全鎖 → 扣分
      }
      // 空間不合：大空間家庭不推小坪數機種；小空間家庭輕扣大機種
      if (pr.spaceSize === 'large' && p.tags.includes('小坪數')) score -= 25;
      if (pr.spaceSize === 'small' && p.tags.includes('大坪數')) score -= 15;
      if (parsed.rest)
        for (const t of parsed.rest.split(' ')) {
          if (t && (p.name.toLowerCase().includes(t) || p.code.includes(t))) {
            score += 15;
            reasons.push(`名稱符合「${t}」`);
          }
        }
      return { p, score, reasons };
    });
  items.sort((a, b) => b.score - a.score || a.p.final - b.p.final);
  return { items, parsed };
}
