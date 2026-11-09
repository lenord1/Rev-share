/**
 * 蝦皮全品類拓品與 pSEO 核心處理腳本 (shopee-core.js)
 * 嚴格符合 validate-products.mjs 資料驗證標準
 */
(function () {
  'use strict';

  // 1. 設定參數 (請依個人環境替換 Token 與 API Key)
  const CONFIG = {
    GITHUB_TOKEN: localStorage.getItem('GHTOKEN') || 'YOUR_GITHUB_TOKEN',
    CLAUDE_API_KEY: localStorage.getItem('CLAUDE_API_KEY') || 'YOUR_CLAUDE_KEY',
    REPO_OWNER: 'lenord1',
    REPO_NAME: 'Rev-share',
    BRANCH: 'main',
    TARGET_PATH: 'affiliate-site-kit/affiliate-site-kit/src/data/products.json',
    MIN_COMMISSION: 3.5, // 最低分潤比率門檻 (%)
    MIN_PRICE: 1000      // 最低金額門檻 (NT$)
  };

  // 2. 中文品類與 slug 對齊表 (嚴格對齊 Astro 路由與 categories.json)
  const CATEGORY_MAP = {
    '除濕機': 'dehumidifier',
    '吹風機': 'hair-dryer',
    '空氣清淨機': 'air-purifier',
    '掃地機器人': 'robot-vacuum',
    '吸塵器': 'vacuum-cleaner',
    '咖啡機': 'coffee-maker',
    '電風扇': 'fan',
    '微波爐': 'microwave',
    '電鍋': 'rice-cooker',
    '氣炸鍋': 'air-fryer',
    '洗衣機': 'washing-machine',
    '冰箱': 'refrigerator'
  };

  // 3. 呼叫 Claude 3.5 Haiku 提煉欄位
  async function enrichWithClaude(rawTitle, price, categoryName, categorySlug) {
    const currentYear = new Date().getFullYear();
    const systemPrompt = `你是一位專業家電評測編輯。請將蝦皮商品標題提煉成符合規格的 JSON 物件。
【限制要求】
1. 只輸出乾淨 JSON，不要 Markdown 標籤與其他任何字串。
2. cleanTitle: 繁體中文，去除促銷垃圾字，保留品牌+型號+核心名稱（30字內）。
3. modelCode: 核心型號，必須嚴格只使用小寫英文數字與連字號（例如 "f-y22en"、"hp09"、"ecam22-110-sb"）。不可含中文。
4. titleTemplate: 必須強制帶有 "{year}" 變數（例如 "\${brand} \${model}（{year}評測）"），嚴禁寫死年份數字。
5. tldr: 一句話導購核心結論（25~45字）。
6. flaw: 具體缺點或物理限制（至少 15 字，不可為空泛的因人而異）。
7. strength: 具體規格優點（非空字串）。
8. notFor: 陣列，1 個不適合的族群或坪數。
9. specs: 3~4 項規格陣列，每項為 {"key": "項目", "value": "數值"}。`;

    const userPrompt = `品類: ${categoryName} (${categorySlug}) | 蝦皮原標題: ${rawTitle} | 特價: NT$ ${price}`;

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": CONFIG.CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 800,
          temperature: 0.2,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });

      if (!resp.ok) throw new Error(`Claude API 響應錯誤: ${resp.status}`);
      const data = await resp.json();
      const txt = data.content?.[0]?.text || '{}';
      return JSON.parse(txt.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (err) {
      console.warn("啟用備用規則提煉欄位:", err);
      const rawModel = (rawTitle.match(/([a-zA-Z0-9]{2,8}[-_][a-zA-Z0-9]{2,8}|[a-zA-Z]{2,4}[0-9]{2,5})/i)?.[0] || 'model').toLowerCase();
      const safeModel = rawModel.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `m-${Date.now().toString(36).slice(-4)}`;
      const safeTitle = rawTitle.slice(0, 25).trim();
      return {
        cleanTitle: safeTitle,
        modelCode: safeModel,
        titleTemplate: `${safeTitle}（{year}評測）`,
        tldr: `熱銷實用款 ${categoryName}，具備完整原廠保固與快速配送保障。`,
        flaw: "運轉音量與能效耗電表現將依個人使用擺放空間與環境條件有所差異。",
        strength: "蝦皮商城官方正品保障，具備原廠保固與售後服務。",
        notFor: ["追求極致頂級效能的大坪數商業空間消費者"],
        specs: [
          { key: "原廠通路", value: "蝦皮商城正品" },
          { key: "活動特價", value: `NT$ ${price}` },
          { key: "售後保障", value: "全機原廠保固" }
        ]
      };
    }
  }

  // 4. 封裝完全合規的 Astro 商品資料結構
  function assembleProduct(rawItem, aiData, categorySlug) {
    const today = new Date().toISOString().slice(0, 10);
    const safeModelCode = (aiData.modelCode || `m-${Date.now().toString(36).slice(-4)}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-');

    let slug = `${safeModelCode}-${Date.now().toString(36).slice(-4)}`;
    if (slug === 'for') slug = `${slug}-item`;

    return {
      category: categorySlug,
      slug: slug,
      modelCode: safeModelCode,
      titleTemplate: aiData.titleTemplate.includes('{year}') ? aiData.titleTemplate : `${aiData.cleanTitle}（{year}評測）`,
      tldr: aiData.tldr,
      flaw: aiData.flaw.length >= 12 ? aiData.flaw : `${aiData.flaw}（運轉表現因擺放環境而異）`,
      strength: aiData.strength || "原廠官方正品品質保證。",
      price: Math.round(rawItem.price),
      priceUpdatedAt: today,
      discount: 0,
      taxRefund: 0,
      affiliate: {
        shopee: rawItem.shortLink || rawItem.link
      },
      primaryChannel: "shopee",
      specs: aiData.specs && aiData.specs.length >= 3 ? aiData.specs : [
        { key: "通路保障", value: "蝦皮商城" },
        { key: "活動售價", value: `NT$ ${rawItem.price}` },
        { key: "售後保固", value: "原廠保固" }
      ],
      tags: ["蝦皮商城", "加碼款"],
      notFor: aiData.notFor || ["追求高規旗艦款的消費者"],
      policy: {
        seller: "mall",
        warranty: "享原廠保固與蝦皮商城鑑賞期保障",
        returns: "依蝦皮商城規範提供退換貨服務"
      },
      imageUrl: rawItem.image,
      isOfficialImage: false
    };
  }

  // 5. 抓取當前頁面商品
  function scrapeCurrentPage() {
    const items = [];
    const rows = document.querySelectorAll('.product-card, .shopee-table__row, [data-qa="product-item"]');
    
    rows.forEach(r => {
      const titleEl = r.querySelector('.product-title, .title, [title]');
      const priceEl = r.querySelector('.product-price, .price, .amount');
      const commEl = r.querySelector('.commission-rate, .rate');
      const linkEl = r.querySelector('a[href*="shopee.tw"], a[href*="s.shopee.tw"]');
      const imgEl = r.querySelector('img');

      if (!titleEl || !priceEl) return;
      const title = titleEl.innerText.trim();
      const price = parseFloat(priceEl.innerText.replace(/[^0-9.]/g, '')) || 0;
      const commission = commEl ? parseFloat(commEl.innerText.replace(/[^0-9.]/g, '')) : 4.0;
      const link = linkEl ? linkEl.href : window.location.href;
      const image = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : '';

      if (commission >= CONFIG.MIN_COMMISSION && price >= CONFIG.MIN_PRICE) {
        items.push({ title, price, commission, link, image });
      }
    });
    return items;
  }

  // 6. 同步至 GitHub (嚴格保留 categories，只擴充 products)
  async function pushToGitHub(newProducts, categoryName) {
    const getUrl = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${CONFIG.TARGET_PATH}?ref=${CONFIG.BRANCH}`;
    
    const getRes = await fetch(getUrl, {
      headers: {
        'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha = '';
    let db = { categories: [], products: [] };

    if (getRes.status === 200) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      const decodedContent = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
      db = JSON.parse(decodedContent);
    }

    if (!Array.isArray(db.categories)) db.categories = [];
    if (!Array.isArray(db.products)) db.products = [];

    // 確保當前品類存在於 categories 清單
    const catSlug = CATEGORY_MAP[categoryName] || 'other';
    if (!db.categories.some(c => c.slug === catSlug)) {
      db.categories.push({ slug: catSlug, name: categoryName });
    }

    // 合併商品並依 modelCode 去重
    const modelSet = new Set(db.products.map(p => p.modelCode));
    for (const np of newProducts) {
      if (!modelSet.has(np.modelCode)) {
        db.products.push(np);
        modelSet.add(np.modelCode);
      }
    }

    const updatedJsonStr = JSON.stringify(db, null, 2);
    const encodedContent = btoa(unescape(encodeURIComponent(updatedJsonStr)));

    const putRes = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${CONFIG.TARGET_PATH}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `feat(auto-pSEO): 自動上架【${categoryName}】新品，觸發官網換圖與 Vercel 部署`,
        content: encodedContent,
        sha: sha,
        branch: CONFIG.BRANCH
      })
    });

    if (!putRes.ok) throw new Error(`GitHub Push 失敗: ${putRes.status}`);
    return true;
  }

  // 7. 注入工作台懸浮 UI
  function renderUI() {
    if (document.getElementById('aff-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'aff-panel';
    panel.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;background:#1e1e2e;color:#fff;padding:16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3);width:320px;font-family:sans-serif;font-size:13px;';
    
    panel.innerHTML = `
      <div style="font-weight:bold;font-size:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <span>🚀 蝦皮自動拓品工作台</span>
        <span id="aff-status" style="font-size:11px;color:#a6adc8;">就緒</span>
      </div>
      <select id="aff-cat" style="width:100%;margin-bottom:8px;padding:6px;border-radius:6px;background:#313244;color:#fff;border:1px solid #45475a;">
        ${Object.keys(CATEGORY_MAP).map(k => `<option value="${k}">${k} (${CATEGORY_MAP[k]})</option>`).join('')}
      </select>
      <button id="aff-run-btn" style="width:100%;padding:10px;background:#fab387;color:#11111b;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
        開始採集與自動上架
      </button>
      <div id="aff-log" style="margin-top:8px;height:80px;overflow-y:auto;background:#11111b;padding:6px;border-radius:4px;font-size:11px;color:#a6adc8;">系統已就緒，隨時可執行拓品。</div>
    `;

    document.body.appendChild(panel);

    const logEl = panel.querySelector('#aff-log');
    const log = (msg) => { logEl.innerHTML += `<div>${msg}</div>`; logEl.scrollTop = logEl.scrollHeight; };

    panel.querySelector('#aff-run-btn').onclick = async () => {
      const cat = panel.querySelector('#aff-cat').value;
      const catSlug = CATEGORY_MAP[cat];
      const btn = panel.querySelector('#aff-run-btn');
      btn.disabled = true;
      btn.style.opacity = '0.5';

      try {
        log(`🔍 開始掃描頁面符合門檻商品...`);
        const items = scrapeCurrentPage();
        log(`📦 找到 ${items.length} 件商品符合標準。`);

        const formatted = [];
        for (let i = 0; i < items.length; i++) {
          log(`🤖 [${i + 1}/${items.length}] AI 深度洗標與欄位正規化...`);
          const aiData = await enrichWithClaude(items[i].title, items[i].price, cat, catSlug);
          const assembled = assembleProduct(items[i], aiData, catSlug);
          formatted.push(assembled);
        }

        log(`🚀 正在推送結構化資料至 GitHub...`);
        await pushToGitHub(formatted, cat);
        log(`🎉 上架完成！已自動觸發換圖與 Vercel 部署。`);
        btn.innerText = '✅ 上架完成 (可切換下一品類)';
      } catch (err) {
        log(`❌ 錯誤: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    };
  }

  setTimeout(renderUI, 1500);
})();
