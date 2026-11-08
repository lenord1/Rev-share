// client 端共用小工具（精靈、搜尋、抽屜）。資料都在建置期內嵌，這裡不 fetch。
export const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 讀取建置期內嵌的 <script type="application/json" id="catalog">。 */
export function readCatalog() {
  try {
    return JSON.parse(document.getElementById('catalog')?.textContent || '{}');
  } catch {
    return {};
  }
}
