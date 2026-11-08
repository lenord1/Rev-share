// 隱私友善的出站點擊追蹤：只記通路、代碼、頁面、位置，不含任何個人資料。
// 用法（Layout 內）：import { initTrack } from '../lib/track.js'; initTrack({ endpoint: '/api/click' /* 選配 */ });
// 所有 /go/ 連結需帶 data-track="go" data-channel="shopee" data-code="型號代碼" data-slot="tldr|table|sticky|finder|grid|drawer-shopee|drawer-coupang"。
export function initTrack({ endpoint } = {}) {
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target?.closest?.('a[data-track="go"]');
      if (!a) return;
      const d = { channel: a.dataset.channel, code: a.dataset.code, page: location.pathname, slot: a.dataset.slot || '' };
      try {
        if (window.umami?.track) window.umami.track('go', d);
        else if (typeof window.plausible === 'function') window.plausible('go', { props: d });
        else if (endpoint && navigator.sendBeacon) navigator.sendBeacon(endpoint, JSON.stringify(d));
      } catch { /* 追蹤失敗不能影響跳轉 */ }
    },
    { capture: true },
  );
}

/** 事件紀錄（如抽屜 intent-shown / intent-closed）：只送商品代碼與區塊名稱，不含畫像或任何個人資料。 */
export function trackEvent(name, data = {}) {
  try {
    if (window.umami?.track) window.umami.track(name, data);
    else if (typeof window.plausible === 'function') window.plausible(name, { props: data });
  } catch { /* 追蹤失敗不能影響使用者 */ }
}
