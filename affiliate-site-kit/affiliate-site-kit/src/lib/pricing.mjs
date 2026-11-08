// 價格相關純函式：Astro 頁面與 scripts 共用（零相依、不碰檔案系統）。
export const DAY = 864e5;

/** 日期字串（YYYY-MM-DD）視為台灣時間當天結束。 */
export function endOfDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59+08:00`) : Date.parse(s);
}

/** 促銷（折扣與退稅/補助）是否仍有效。沒有到期日視為有效（驗證器會警告）。 */
export function promoActive(p, now = Date.now()) {
  if (!p.promoValidUntil) return true;
  return endOfDay(p.promoValidUntil) >= now;
}

/** 到手價拆解：price - discount - taxRefund（促銷過期則兩者都不計）。 */
export function priceBreakdown(p, now = Date.now()) {
  const active = promoActive(p, now);
  const discount = active ? p.discount ?? 0 : 0;
  const taxRefund = active ? p.taxRefund ?? 0 : 0;
  return { price: p.price, discount, taxRefund, final: p.price - discount - taxRefund, active };
}

/** 距離促銷結束的天數（無到期日或已過期回傳 null）。 */
export function daysLeft(p, now = Date.now()) {
  if (!p.promoValidUntil) return null;
  const d = (endOfDay(p.promoValidUntil) - now) / DAY;
  return d < 0 ? null : Math.ceil(d);
}

/**
 * 價格走勢統計。entries: [{date, price}]（單一通路）。
 * 資料不足時 enough=false，呼叫端不得顯示任何「划算/偏高」判斷。
 */
export function priceStats(entries, { windowDays = 30, minPoints = 3, minSpanDays = 14, now = Date.now() } = {}) {
  const inWin = entries
    .filter((e) => now - Date.parse(e.date) <= windowDays * DAY)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const count = inWin.length;
  const spanDays = count ? Math.round((Date.parse(inWin.at(-1).date) - Date.parse(inWin[0].date)) / DAY) : 0;
  if (count < minPoints || spanDays < minSpanDays) return { enough: false, count, spanDays };
  const prices = inWin.map((e) => e.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const current = inWin.at(-1).price;
  let verdict = 'stable';
  if (max > min) {
    const pos = (current - min) / (max - min);
    verdict = pos <= 0.05 ? 'lowest' : pos <= 0.25 ? 'low' : pos >= 0.9 ? 'high' : 'mid';
  }
  return { enough: true, count, spanDays, min, max, median, current, verdict, points: inWin };
}

export const verdictLabel = {
  lowest: '接近近期最低價',
  low: '低於近期多數時間',
  mid: '落在近期價格中段',
  high: '接近近期最高價',
  stable: '近期價格穩定',
};

/**
 * 雙通路比較（抽屜的「價格較低／較快到貨」標籤只能由這裡的結果決定）。
 * - 通路要有分潤連結與標價；價格觀測日須在 staleDays 內才算「新」。
 * - cheaper：至少 2 個通路都是新價格且標價不同，才指出較低者；否則 null。
 * - fastest：該通路在 p.delivery 有 fast:true，且附 note、source、checkedAt（未過期）；只有唯一通路符合才回傳。
 * 標價為各平台未計券與折扣的價格，抽屜文案須註明「以平台頁面為準」。
 */
export function compareChannels(p, { staleDays = 14, now = Date.now() } = {}) {
  const primary = p.primaryChannel ?? Object.keys(p.affiliate ?? {})[0];
  const fresh = (d) => !!d && now - Date.parse(d) <= staleDays * DAY;
  const options = Object.keys(p.affiliate ?? {})
    .map((channel) => {
      const price = channel === primary ? p.price : p.prices?.[channel];
      const date = channel === primary ? p.priceUpdatedAt : p.pricesUpdatedAt?.[channel];
      return { channel, price, fresh: Number.isInteger(price) && fresh(date) };
    })
    .filter((o) => Number.isInteger(o.price));
  const usable = options.filter((o) => o.fresh);
  let cheaper = null;
  if (usable.length >= 2) {
    const sorted = [...usable].sort((a, b) => a.price - b.price);
    if (sorted[0].price < sorted[1].price) cheaper = sorted[0].channel;
  }
  const fastList = Object.entries(p.delivery ?? {})
    .filter(([ch, d]) => p.affiliate?.[ch] && d?.fast === true && d.note && d.source && fresh(d.checkedAt))
    .map(([ch]) => ch);
  const fastest = fastList.length === 1 ? fastList[0] : null;
  return { options, cheaper, fastest, dual: options.length >= 2 };
}
