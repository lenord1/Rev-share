// 顯示用格式化（建置期）。金額一律 TWD、無小數；日期用 YYYY/MM/DD。
const twd = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 });
export const money = (n) => twd.format(n);
export const ymd = (s) => (s ? String(s).slice(0, 10).replaceAll('-', '/') : '');
export const md = (s) => (s ? ymd(s).slice(5) : '');

/** 規格值轉數字（比較勝出用）；不是數字回傳 NaN。 */
export const num = (v) => parseFloat(String(v).replace(/,/g, ''));
