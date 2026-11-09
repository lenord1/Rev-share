// ==UserScript==
// @name         蝦皮全品類全自動拓品與 CI/CD 工作台 (Claude AI 標題清洗與深度導購版)
// @namespace    http://tampermonkey.net/
// @version      12.0
// @description  自由拖曳工作台、自動搜尋與篩選(商城/加碼/降序)、自動偵測總頁數、逐頁提領 s.shopee.tw 短網址、Claude 3.5 智慧提煉型號與優缺點、單一整合 Excel、直連 GitHub 觸發官網換圖與 Vercel 部署
// @author       lenord1
// @match        *://affiliate.shopee.tw/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        window.close
// @connect      api.github.com
// @connect      api.anthropic.com
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // 【1. 使用者憑證與核心環境配置區】
  // =========================================================================
  const USER_CONFIG = {
    GITHUB_OWNER: 'lenord1',
    GITHUB_REPO: 'Rev-share',
    // 雙層資料夾路徑
    FILE_PATH: 'affiliate-site-kit/affiliate-site-kit/src/data/products.json',
    BRANCH: 'main',
    // 請填入具備 repo 讀寫權限的 GitHub Token
    GITHUB_TOKEN: 'ghp_請替換成你的GitHub個人存取金鑰',

    // Claude API 設定 (填入 sk-ant- 開頭金鑰即自動啟用 AI 標題清洗與優缺點產製；未填則自動退回基礎模式)
    ANTHROPIC_API_KEY: 'sk-ant-請替換成你的Claude金鑰(若無可維持原樣)',
    ENABLE_CLAUDE_ENRICH: true, // 是否啟用 Claude 智慧改寫與深度導購標註

    DEFAULT_MIN_COMMISSION: 3.5, // 最低分潤門檻 (%)
    DEFAULT_MIN_PRICE: 1000,     // 最低單價 (NT$)：完整保留 5000 元小冰箱，剔除配件雜物
    MAX_PAGES_LIMIT: 10,         // 安全最大抓取上限 (頁)
    DEFAULT_PER_PAGE_LIMIT: 6,   // 每頁最多取幾款高分潤爆品
    AUTO_DOWNLOAD_EXCEL: true    // 上架完成後是否產出單一彙整 Excel
  };

  // =========================================================================
  // 【2. 41 個家電與生活子品類資料字典】
  // =========================================================================
  const TAXONOMY = {
    "空氣與清潔": [
      { id: "dehumidifier", name: "除濕機", query: "除濕機" },
      { id: "air-purifier", name: "空氣清淨機", query: "空氣清淨機" },
      { id: "air-conditioner", name: "冷氣", query: "變頻冷氣" },
      { id: "fan", name: "電風扇／循環扇", query: "循環扇" },
      { id: "robot-vacuum", name: "掃拖機器人／吸塵器", query: "掃拖機器人" },
      { id: "washer", name: "洗衣機", query: "洗衣機" },
      { id: "dryer", name: "烘衣機", query: "乾衣機" },
      { id: "cordless-vacuum", name: "無線吸塵器", query: "無線吸塵器" },
      { id: "mite-vacuum", name: "除蟎機", query: "除蟎機" },
      { id: "heater", name: "電暖器／暖風機", query: "電暖器" }
    ],
    "廚房與用水": [
      { id: "water-heater", name: "熱水器", query: "數位恆溫熱水器" },
      { id: "water-purifier", name: "淨水器／瞬熱飲水機", query: "淨水器" },
      { id: "dishwasher", name: "洗碗機", query: "洗碗機" },
      { id: "refrigerator", name: "電冰箱 (含5000小冰箱)", query: "電冰箱" },
      { id: "food-waste", name: "廚餘機", query: "廚餘機" },
      { id: "coffee-maker", name: "咖啡機", query: "咖啡機" },
      { id: "steam-oven", name: "水波爐／氣炸烤箱", query: "氣炸烤箱" },
      { id: "cooker", name: "電鍋／壓力鍋", query: "壓力鍋" },
      { id: "microwave", name: "微波爐／烤箱", query: "微波爐" },
      { id: "blender", name: "調理機／豆漿機", query: "破壁機" },
      { id: "range-hood", name: "排油煙機", query: "抽油煙機" },
      { id: "ice-maker", name: "製冰機", query: "製冰機" }
    ],
    "居家與安全": [
      { id: "smart-lock", name: "智慧電子鎖", query: "電子鎖" },
      { id: "security-cam", name: "家用監視器／攝影機", query: "監視器" },
      { id: "mattress-pillow", name: "床墊／枕頭", query: "獨立筒床墊" },
      { id: "massage-chair", name: "按摩椅", query: "按摩椅" },
      { id: "ergonomic-chair", name: "人體工學椅／升降桌", query: "人體工學椅" },
      { id: "smart-home", name: "電動窗簾／智慧家居", query: "電動窗簾" },
      { id: "safe-box", name: "保險箱", query: "保險箱" },
      { id: "furniture", name: "沙發／床架", query: "沙發" }
    ],
    "影音與個人": [
      { id: "tv-monitor", name: "電視與螢幕", query: "4K電視" },
      { id: "projector", name: "投影機", query: "微型投影機" },
      { id: "hair-dryer", name: "吹風機", query: "負離子吹風機" },
      { id: "electric-toothbrush", name: "電動牙刷", query: "電動牙刷" },
      { id: "earphones", name: "藍牙耳機", query: "降噪藍牙耳機" },
      { id: "soundbar", name: "音響／Soundbar", query: "Soundbar" },
      { id: "laptop-tablet", name: "筆電／平板", query: "筆記型電腦" },
      { id: "camera", name: "相機／運動相機", query: "運動相機" }
    ],
    "寵物育兒與運動": [
      { id: "stroller-carseat", name: "嬰兒推車／安全座椅", query: "嬰兒推車" },
      { id: "pet-feeder", name: "自動餵食器／貓砂機", query: "自動貓砂機" },
      { id: "treadmill", name: "跑步機／健身器材", query: "跑步機" },
      { id: "pet-waterer", name: "寵物飲水機", query: "寵物飲水機" },
      { id: "crib-desk", name: "成長書桌／嬰兒床", query: "兒童成長書桌" },
      { id: "massage-gun", name: "筋膜槍", query: "筋膜槍" },
      { id: "spin-bike", name: "飛輪車／啞鈴", query: "飛輪車" }
    ]
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // =========================================================================
  // 【3. Claude 3.5 Haiku API 連動：標題清洗、型號萃取與深度評測】
  // =========================================================================
  function enrichProductWithClaude(rawTitle, price) {
    return new Promise((resolve) => {
      const apiKey = USER_CONFIG.ANTHROPIC_API_KEY;
      if (!USER_CONFIG.ENABLE_CLAUDE_ENRICH || !apiKey || !apiKey.startsWith('sk-ant')) {
        resolve(null);
        return;
      }

      const prompt = `你是台灣頂級家電開箱評測專家與 SEO 架構師。請分析這款蝦皮電器資訊：
原始商品標題：${rawTitle}
商品售價：NT$ ${price}

請以繁體中文 (台灣) 嚴格輸出純 JSON 物件（切勿包含任何 markdown 標記、代碼區塊反引號或額外文字）：
{
  "cleanTitle": "品牌 + 標準型號 + 核心規格 (25字內，嚴格剔除促銷、免運、現貨、熱銷等冗餘詞)",
  "brand": "標準品牌中文或英文",
  "model": "確切英文與數字型號 (若無請輸出空字串)",
  "suitableFor": "適合坪數或族群情境 (15字內，例：適合8-12坪客廳、租屋套房推薦)",
  "pros": ["核心亮點1", "核心亮點2", "核心亮點3"],
  "cons": "1個客觀真實的產品限制或考量點 (20字內)"
}`;

      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'dangerously-allow-browser': 'true'
        },
        data: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 450,
          messages: [{ role: 'user', content: prompt }]
        }),
        timeout: 10000,
        onload: (res) => {
          try {
            const resp = JSON.parse(res.responseText);
            let text = resp.content?.[0]?.text?.trim() || '';
            text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(text);
            resolve(parsed);
          } catch (e) {
            console.warn('[Claude] JSON 解析略過，保留原始資訊:', e);
            resolve(null);
          }
        },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null)
      });
    });
  }

  // =========================================================================
  // 【4. 自動偵測蝦皮後台真實總頁數】
  // =========================================================================
  function detectTotalPages() {
    let maxPage = 1;
    const pageItems = Array.from(document.querySelectorAll('.ant-pagination-item, [class*="pagination"] li, [class*="Pagination"] button'));
    pageItems.forEach(item => {
      const num = parseInt(item.innerText.trim(), 10);
      if (!isNaN(num) && num > maxPage) maxPage = num;
    });

    if (maxPage === 1) {
      const container = document.querySelector('.ant-pagination, [class*="pagination"], [class*="Pagination"]');
      if (container) {
        const matches = container.innerText.match(/\b([1-9][0-9]?)\b/g);
        if (matches) {
          maxPage = Math.max(...matches.map(n => parseInt(n, 10)));
        }
      }
    }

    return Math.min(maxPage, USER_CONFIG.MAX_PAGES_LIMIT);
  }

  // =========================================================================
  // 【5. 自動模擬篩選：輸入、分潤加碼、蝦皮商城、價格高到低】
  // =========================================================================
  async function simulateSearchAndFilters(queryText, log) {
    log(`🔎 自動檢索關鍵字：【${queryText}】...`);

    const searchInput = document.querySelector('input[placeholder*="請輸入關鍵字"], input[type="text"]');
    if (!searchInput) throw new Error('找不到搜尋文字框');

    searchInput.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(searchInput, queryText);
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    const searchBtn = Array.from(document.querySelectorAll('button, div, span')).find(el => 
      el.children.length === 0 && (el.innerText.trim() === '搜尋' || el.innerText.trim() === '搜索')
    );
    if (searchBtn) {
      searchBtn.click();
    } else {
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    log('⏳ 等待列表載入...');
    await sleep(2400);

    // 勾選「分潤加碼」
    const boostBtn = Array.from(document.querySelectorAll('*')).find(el => 
      el.children.length === 0 && el.innerText && el.innerText.trim() === '分潤加碼'
    );
    if (boostBtn) {
      boostBtn.click();
      await sleep(1500);
    }

    // 勾選「蝦皮商城」
    const mallLabel = Array.from(document.querySelectorAll('*')).find(el => 
      el.children.length === 0 && el.innerText && el.innerText.trim() === '蝦皮商城'
    );
    if (mallLabel) {
      mallLabel.click();
      await sleep(1500);
    } else {
      const storeTypeDropdown = Array.from(document.querySelectorAll('*')).find(el => 
        el.children.length <= 1 && el.innerText && el.innerText.includes('賣場類型')
      );
      if (storeTypeDropdown) {
        storeTypeDropdown.click();
        await sleep(600);
        const subMall = Array.from(document.querySelectorAll('*')).find(el => 
          el.children.length === 0 && el.innerText && el.innerText.trim() === '蝦皮商城'
        );
        if (subMall) subMall.click();
        await sleep(1500);
      }
    }

    // 調整「價格高到低」
    const priceSortBtn = Array.from(document.querySelectorAll('*')).find(el => 
      el.children.length === 0 && el.innerText && (el.innerText.trim() === '價格' || el.innerText.includes('價格'))
    );
    if (priceSortBtn) {
      priceSortBtn.click();
      await sleep(1200);
      const highToLowOption = Array.from(document.querySelectorAll('*')).find(el => 
        el.children.length === 0 && el.innerText && el.innerText.includes('高到低')
      );
      if (highToLowOption) {
        highToLowOption.click();
        await sleep(1800);
      }
    }

    const detectedPages = detectTotalPages();
    const pageInput = document.getElementById('scrape-pages-input');
    if (pageInput) pageInput.value = detectedPages;

    log(`✨ 篩選就緒 (商城 + 加碼 + 降序)！系統自動偵測此品類共 ${detectedPages} 頁。`);
  }

  // =========================================================================
  // 【6. 彈窗自動提取 s.shopee.tw 短網址】
  // =========================================================================
  async function fetchShortLinkByClicking(btn) {
    btn.click();
    let shortUrl = '';

    for (let i = 0; i < 15; i++) {
      await sleep(200);
      const allInputs = Array.from(document.querySelectorAll('input, textarea, a, span, p'));
      for (const el of allInputs) {
        const val = el.value || el.innerText || el.href || '';
        if (val.includes('s.shopee.tw')) {
          const match = val.match(/https:\/\/s\.shopee\.tw\/[A-Za-z0-9]+/);
          if (match) {
            shortUrl = match[0];
            break;
          }
        }
      }
      if (shortUrl) break;
    }

    const closeBtn = document.querySelector('.shopee-modal__close, .ant-modal-close, [aria-label="Close"], button[class*="close"]');
    if (closeBtn) {
      closeBtn.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }
    await sleep(350);

    return shortUrl;
  }

  // =========================================================================
  // 【7. 單頁解析與 Claude 智慧增強】
  // =========================================================================
  async function extractSinglePageItems(categoryMeta, minCommission, minPrice, perPageLimit, log) {
    const allBtns = Array.from(document.querySelectorAll('*')).filter(el => {
      return el.children.length === 0 && el.innerText && el.innerText.trim() === '取得連結';
    });

    const candidateCards = [];

    allBtns.forEach((btn, index) => {
      let card = btn.parentElement;
      for (let i = 0; i < 6; i++) {
        if (card && card.innerText && card.innerText.includes('$') && card.querySelector('img')) break;
        if (card.parentElement) card = card.parentElement;
      }
      if (!card) return;

      const text = card.innerText;
      const img = card.querySelector('img')?.src || '';
      const priceMatch = text.match(/\$\s?([0-9,]+(\.[0-9]+)?)/);
      const rateMatch = text.match(/分潤(?:率|比例)?\s?([0-9.]+)%/);
      const soldMatch = text.match(/已售出\s?([0-9萬+kK,.]+)/);

      const lines = text.split('\n').map(s => s.trim()).filter(s => 
        s.length > 4 && !s.startsWith('$') && !s.includes('分潤') && !s.includes('已售出') && !s.includes('取得連結')
      );
      const title = lines[0] || `熱銷嚴選型號-${index + 1}`;

      if (priceMatch && rateMatch) {
        const rate = parseFloat(rateMatch[1]);
        const price = parseFloat(priceMatch[1].replace(/,/g, ''));

        if (rate >= minCommission && price >= minPrice) {
          candidateCards.push({
            btn: btn,
            title: title.replace(/\s+/g, ' ').trim(),
            price: price,
            rate: rate,
            img: img,
            sold: soldMatch ? soldMatch[1] : '熱銷中'
          });
        }
      }
    });

    const uniqueCandidates = Array.from(new Set(candidateCards.map(p => p.title)))
      .map(t => candidateCards.find(p => p.title === t))
      .slice(0, perPageLimit);

    const itemsOnThisPage = [];

    for (let i = 0; i < uniqueCandidates.length; i++) {
      const item = uniqueCandidates[i];
      log(` 🔗 提領短網址 (${i + 1}/${uniqueCandidates.length}): ${item.title.slice(0, 10)}...`);

      let shortLink = await fetchShortLinkByClicking(item.btn);
      if (!shortLink) shortLink = window.location.href;

      // 預設欄位
      let finalTitle = item.title;
      let brand = "";
      let modelNumber = "";
      let suitableFor = "居家常備嚴選";
      let pros = ["蝦皮商城官方認證", "高分潤熱銷品", "原廠正貨保固"];
      let cons = "庫存與贈品依賣場即時顯示為準";

      // 連動 Claude AI 進行資料清洗與導購生成
      if (USER_CONFIG.ENABLE_CLAUDE_ENRICH && USER_CONFIG.ANTHROPIC_API_KEY.startsWith('sk-ant')) {
        log(` 🤖 Claude AI 深度解析標題與優缺點中...`);
        const aiData = await enrichProductWithClaude(item.title, item.price);
        if (aiData) {
          if (aiData.cleanTitle) finalTitle = aiData.cleanTitle;
          if (aiData.brand) brand = aiData.brand;
          if (aiData.model) modelNumber = aiData.model;
          if (aiData.suitableFor) suitableFor = aiData.suitableFor;
          if (Array.isArray(aiData.pros) && aiData.pros.length > 0) pros = aiData.pros;
          if (aiData.cons) cons = aiData.cons;
          log(` ✔ Claude 精修: 【${brand} ${modelNumber}】${finalTitle.slice(0, 12)}...`);
        }
      }

      itemsOnThisPage.push({
        id: `shopee-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title: finalTitle,
        rawShopeeTitle: item.title,
        brand: brand,
        modelNumber: modelNumber,
        mainCategory: categoryMeta.mainCat || "居家生活",
        category: categoryMeta.name || "熱門商品",
        categorySlug: categoryMeta.id || "appliances",
        imageUrl: item.img,
        price: item.price,
        originalPrice: Math.round(item.price * 1.15),
        commissionRate: item.rate,
        estimatedCommission: Math.round(item.price * (item.rate / 100)),
        affiliateLink: shortLink,
        soldCount: item.sold,
        suitableFor: suitableFor,
        pros: pros,
        cons: cons,
        tags: [categoryMeta.name || "精選", "蝦皮商城", "官方加碼"],
        isActive: true
      });
    }

    return itemsOnThisPage;
  }

  async function triggerNextPage() {
    const nextBtn = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled), [class*="pagination"] [class*="next"]:not([disabled]):not([class*="disabled"])') ||
      Array.from(document.querySelectorAll('button, li, div')).find(el => {
        const txt = el.innerText ? el.innerText.trim() : '';
        const aria = el.getAttribute('aria-label') || '';
        const isNext = (txt === '>' || txt === '下一頁' || aria.includes('Next') || aria.includes('next'));
        const isDisabled = el.getAttribute('disabled') !== null || (el.className && el.className.includes('disabled'));
        return isNext && !isDisabled && el.children.length <= 1;
      });

    if (nextBtn) {
      nextBtn.click();
      return true;
    }
    return false;
  }

  async function scrapeAllPagesForCategory(categoryMeta, minCommission, minPrice, totalPages, perPageLimit, log) {
    let allCollectedItems = [];

    for (let page = 1; page <= totalPages; page++) {
      log(`📄 【第 ${page}/${totalPages} 頁】正在解析商品卡片...`);
      const pageItems = await extractSinglePageItems(categoryMeta, minCommission, minPrice, perPageLimit, log);
      log(`✔ 第 ${page} 頁成功收錄 ${pageItems.length} 款`);
      allCollectedItems.push(...pageItems);

      if (page < totalPages) {
        log(`➡️ 正在翻至第 ${page + 1} 頁...`);
        const flipped = await triggerNextPage();
        if (!flipped) {
          log('⚠️ 已達最後一頁，提前結束翻頁。');
          break;
        }
        await sleep(3000);
      }
    }

    const finalUnique = Array.from(new Set(allCollectedItems.map(p => p.title)))
      .map(t => allCollectedItems.find(p => p.title === t));
    finalUnique.sort((a, b) => (b.commissionRate || 0) - (a.commissionRate || 0));

    return finalUnique;
  }

  // =========================================================================
  // 【8. 單一 Excel 產出引擎 (UTF-8 BOM 防亂碼)】
  // =========================================================================
  function downloadAsSingleExcel(items, filename) {
    if (!items || items.length === 0) return;

    const headers = ['精修商品名稱', '品牌', '型號', '目前售價(NT$)', '分潤率(%)', '單筆預估分潤(NT$)', '適合族群/情境', '誠實缺點', '推廣短網址(s.shopee.tw)', '圖片網址'];
    const rows = items.map(i => [
      `"${(i.title || '').replace(/"/g, '""')}"`,
      `"${(i.brand || '').replace(/"/g, '""')}"`,
      `"${(i.modelNumber || '').replace(/"/g, '""')}"`,
      i.price || 0,
      `${i.commissionRate || 0}%`,
      i.estimatedCommission || Math.round((i.price || 0) * ((i.commissionRate || 0) / 100)),
      `"${(i.suitableFor || '').replace(/"/g, '""')}"`,
      `"${(i.cons || '').replace(/"/g, '""')}"`,
      `"${i.affiliateLink || ''}"`,
      `"${i.imageUrl || ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // =========================================================================
  // 【9. GitHub API 讀寫與 Commit (無 [skip ci] 確保觸發 Action 與 Vercel)】
  // =========================================================================
  function getGithubData() {
    return new Promise((resolve, reject) => {
      const url = `https://api.github.com/repos/${USER_CONFIG.GITHUB_OWNER}/${USER_CONFIG.GITHUB_REPO}/contents/${USER_CONFIG.FILE_PATH}?ref=${USER_CONFIG.BRANCH}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: {
          'Authorization': `token ${USER_CONFIG.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        onload: (res) => {
          if (res.status === 200) {
            try {
              const data = JSON.parse(res.responseText);
              const content = decodeURIComponent(escape(atob(data.content)));
              const rawJson = JSON.parse(content);

              let list = [];
              let formatType = 'array';
              let objectKey = 'products';

              if (Array.isArray(rawJson)) {
                list = rawJson;
                formatType = 'array';
              } else if (rawJson && typeof rawJson === 'object') {
                formatType = 'object';
                const foundKey = Object.keys(rawJson).find(k => Array.isArray(rawJson[k]));
                if (foundKey) {
                  objectKey = foundKey;
                  list = rawJson[foundKey];
                } else {
                  list = [];
                }
              }

              resolve({ sha: data.sha, list: list, formatType: formatType, objectKey: objectKey, rawJson: rawJson });
            } catch (e) {
              reject(`解析 JSON 失敗: ${e.message}`);
            }
          } else {
            reject(`GitHub 讀取錯誤 (HTTP ${res.status})，請確認 Token 權限。`);
          }
        },
        onerror: reject
      });
    });
  }

  function commitGithubData(payloadData, sha) {
    return new Promise((resolve, reject) => {
      const url = `https://api.github.com/repos/${USER_CONFIG.GITHUB_OWNER}/${USER_CONFIG.GITHUB_REPO}/contents/${USER_CONFIG.FILE_PATH}`;
      const jsonStr = JSON.stringify(payloadData, null, 2);
      const encoded = btoa(unescape(encodeURIComponent(jsonStr)));

      GM_xmlhttpRequest({
        method: 'PUT',
        url: url,
        headers: {
          'Authorization': `token ${USER_CONFIG.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        data: JSON.stringify({
          message: 'feat(auto-pSEO): 全自動拓品上架，觸發官網換圖與 Vercel 部署',
          content: encoded,
          sha: sha,
          branch: USER_CONFIG.BRANCH
        }),
        onload: (res) => {
          if (res.status === 200 || res.status === 201) resolve();
          else reject(`GitHub Commit 失敗 (HTTP ${res.status}): ${res.responseText}`);
        },
        onerror: reject
      });
    });
  }

  // =========================================================================
  // 【10. 前台懸浮面板 UI (任意拖曳移動＋全自動連鎖上架)】
  // =========================================================================
  function injectUI() {
    if (document.getElementById('shopee-dom-sync-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'shopee-dom-sync-panel';
    panel.style.cssText = `
      position: fixed !important;
      top: 100px !important;
      right: 30px !important;
      width: 375px !important;
      background: #ffffff !important;
      border-radius: 16px !important;
      box-shadow: 0 16px 45px rgba(0,0,0,0.35) !important;
      padding: 16px !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      border: 2px solid #ea580c !important;
      display: block !important;
      user-select: none !important;
    `;

    let subCatOptions = `<option value="">👉 選擇品類 (自動搜尋＋商城＋加碼)...</option>`;
    for (const mainCat in TAXONOMY) {
      subCatOptions += `<optgroup label="📂 ${mainCat}">`;
      TAXONOMY[mainCat].forEach(sub => {
        subCatOptions += `<option value="${sub.id}" data-query="${sub.query}" data-name="${sub.name}" data-main="${mainCat}">${sub.name}</option>`;
      });
      subCatOptions += `</optgroup>`;
    }

    panel.innerHTML = `
      <div id="drag-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; cursor:move; background:#fff7ed; padding:8px 10px; border-radius:10px; border:1px dashed #fdba74;">
        <span style="font-weight:bold; font-size:14px; color:#9a3412;">✥ 按住拖曳面板 (防遮擋)</span>
        <span style="font-size:11px; background:#ea580c; color:#ffffff; padding:2px 7px; border-radius:10px; font-weight:600;">v12.0 Claude版</span>
      </div>

      <div style="margin-bottom:8px;">
        <label style="font-size:11px; color:#475569; font-weight:600;">選擇品類：</label>
        <select id="sub-cat-select" style="width:100%; padding:7px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; margin-top:3px; font-weight:500;">
          ${subCatOptions}
        </select>
      </div>

      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <div style="flex:1;">
          <label style="font-size:11px; color:#475569; font-weight:600;">自動抓取頁數：</label>
          <input type="number" id="scrape-pages-input" value="1" min="1" max="10" style="width:100%; padding:5px 6px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; box-sizing:border-box;">
        </div>
        <div style="flex:1;">
          <label style="font-size:11px; color:#475569; font-weight:600;">每頁取款：</label>
          <input type="number" id="limit-per-page-input" value="${USER_CONFIG.DEFAULT_PER_PAGE_LIMIT}" min="1" max="20" style="width:100%; padding:5px 6px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; box-sizing:border-box;">
        </div>
        <div style="flex:1.2;">
          <label style="font-size:11px; color:#475569; font-weight:600;">底價(NT$)：</label>
          <input type="number" id="min-price-input" value="${USER_CONFIG.DEFAULT_MIN_PRICE}" step="500" style="width:100%; padding:5px 6px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; box-sizing:border-box;">
        </div>
      </div>

      <div style="margin-bottom:10px;">
        <label style="font-size:11px; color:#475569; font-weight:600;">最低分潤(%)：</label>
        <input type="number" id="min-commission-input" value="${USER_CONFIG.DEFAULT_MIN_COMMISSION}" step="0.5" style="width:100%; padding:5px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; box-sizing:border-box;">
      </div>

      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <button id="auto-search-only-btn" style="flex:1; background:#475569; color:white; border:none; padding:9px; border-radius:8px; font-weight:bold; font-size:11px; cursor:pointer;">
          🔍 僅自動篩選
        </button>
        <button id="export-excel-btn" style="flex:1.2; background:#059669; color:white; border:none; padding:9px; border-radius:8px; font-weight:bold; font-size:11px; cursor:pointer;">
          📊 產出單一 EXCEL
        </button>
        <button id="start-sync-btn" style="flex:1.4; background:linear-gradient(135deg, #ea580c, #ee4d2d); color:white; border:none; padding:9px; border-radius:8px; font-weight:bold; font-size:11px; cursor:pointer;">
          🚀 全頁上架 Vercel
        </button>
      </div>

      <div id="sync-log-box" style="font-size:11px; color:#334155; max-height:130px; overflow-y:auto; display:none; background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #e2e8f0; line-height:1.45;"></div>
    `;

    (document.body || document.documentElement).appendChild(panel);

    // 任意拖曳面板事件
    const dragHeader = document.getElementById('drag-header');
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    dragHeader.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = `${initialLeft}px`;
      panel.style.top = `${initialTop}px`;
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${initialLeft + dx}px`;
      panel.style.top = `${initialTop + dy}px`;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    const logBox = document.getElementById('sync-log-box');
    const log = (msg) => {
      logBox.style.display = 'block';
      logBox.innerHTML += `<div>${msg}</div>`;
      logBox.scrollTop = logBox.scrollHeight;
    };

    const resetButtons = () => {
      const syncBtn = document.getElementById('start-sync-btn');
      syncBtn.disabled = false;
      syncBtn.style.opacity = '1';
      syncBtn.innerText = '🚀 全頁上架 Vercel';
      syncBtn.style.background = 'linear-gradient(135deg, #ea580c, #ee4d2d)';
    };

    // 核心上架工作流
    const executeSyncWorkflow = async () => {
      const btn = document.getElementById('start-sync-btn');
      const select = document.getElementById('sub-cat-select');
      const selectedOption = select.selectedOptions[0];
      const catName = selectedOption?.dataset?.name || "熱門商品";
      const catId = selectedOption?.value || "appliances";
      const mainCat = selectedOption?.dataset?.main || "家電生活";

      const minCommission = parseFloat(document.getElementById('min-commission-input').value) || USER_CONFIG.DEFAULT_MIN_COMMISSION;
      const minPrice = parseFloat(document.getElementById('min-price-input').value) || USER_CONFIG.DEFAULT_MIN_PRICE;
      const totalPages = parseInt(document.getElementById('scrape-pages-input').value) || 1;
      const perPageLimit = parseInt(document.getElementById('limit-per-page-input').value) || USER_CONFIG.DEFAULT_PER_PAGE_LIMIT;

      btn.disabled = true;
      btn.style.opacity = '0.6';

      try {
        log('📥 連線 GitHub 檢查現有商品庫...');
        const { sha, list: currentProducts, formatType, objectKey, rawJson } = await getGithubData();
        log(`✔ 現有資料庫共 ${currentProducts.length} 款`);

        log(`🔍 開始跨 ${totalPages} 頁自動巡迴提領 s.shopee.tw 短網址 (Claude AI 連線)...`);
        const newItems = await scrapeAllPagesForCategory({ name: catName, id: catId, mainCat: mainCat }, minCommission, minPrice, totalPages, perPageLimit, log);

        log(`✔ 跨頁整合共取得 ${newItems.length} 款短網址商品！`);

        if (newItems.length === 0) {
          log('💡 沒有發現新商品，無須推送。');
          btn.disabled = false;
          btn.style.opacity = '1';
          return;
        }

        if (USER_CONFIG.AUTO_DOWNLOAD_EXCEL) {
          const filename = `蝦皮_${catName}_上架備份_${new Date().toISOString().slice(0, 10)}.csv`;
          downloadAsSingleExcel(newItems, filename);
          log(`📊 已下載單一彙整 Excel：${filename}`);
        }

        const combined = [...currentProducts, ...newItems];
        const deduplicated = Array.from(new Set(combined.map(p => p.title)))
          .map(t => combined.find(p => p.title === t));
        deduplicated.sort((a, b) => (b.commissionRate || 0) - (a.commissionRate || 0));

        let finalPayload = deduplicated;
        if (formatType === 'object') {
          finalPayload = { ...rawJson, [objectKey]: deduplicated };
        }

        log(`🚀 推送至 GitHub (累計庫存 ${deduplicated.length} 款) 觸發 Vercel 發布...`);
        await commitGithubData(finalPayload, sha);

        log(`🎉 大功告成！【${catName}】已推送 GitHub，官網換圖與 Vercel 正在自動部署！`);
        btn.innerText = '✅ 上架完成 (可直接切換下一類)';
        btn.style.background = '#10b981';
        btn.disabled = false;
        btn.style.opacity = '1';

      } catch (err) {
        log(`❌ 失敗：${err}`);
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerText = '❌ 重試上架';
      }
    };

    // 下拉選單選取時觸發全自動連鎖：搜尋 -> 篩選 -> 抓頁數 -> 自動執行上架
    document.getElementById('sub-cat-select').addEventListener('change', async (e) => {
      const selectedOption = e.target.selectedOptions[0];
      if (!selectedOption || !selectedOption.dataset.query) return;

      logBox.innerHTML = '';
      resetButtons();

      try {
        await simulateSearchAndFilters(selectedOption.dataset.query, log);
        log('⚡ 篩選完畢，2 秒後全自動啟動翻頁抓取與 Vercel 上架...');
        await sleep(2000);
        await executeSyncWorkflow();
      } catch (err) {
        log(`❌ 自動化中斷: ${err.message}`);
      }
    });

    // 「僅自動篩選」
    document.getElementById('auto-search-only-btn').addEventListener('click', async () => {
      const select = document.getElementById('sub-cat-select');
      const selectedOption = select.selectedOptions[0];
      if (!selectedOption || !selectedOption.dataset.query) {
        alert('請先在上方選單選擇一個品類！');
        return;
      }
      logBox.innerHTML = '';
      resetButtons();
      await simulateSearchAndFilters(selectedOption.dataset.query, log);
    });

    // 「產出單一 EXCEL」
    document.getElementById('export-excel-btn').addEventListener('click', async () => {
      const select = document.getElementById('sub-cat-select');
      const selectedOption = select.selectedOptions[0];
      const catName = selectedOption?.dataset?.name || "精選商品";

      const minCommission = parseFloat(document.getElementById('min-commission-input').value) || USER_CONFIG.DEFAULT_MIN_COMMISSION;
      const minPrice = parseFloat(document.getElementById('min-price-input').value) || USER_CONFIG.DEFAULT_MIN_PRICE;
      const totalPages = parseInt(document.getElementById('scrape-pages-input').value) || 1;
      const perPageLimit = parseInt(document.getElementById('limit-per-page-input').value) || USER_CONFIG.DEFAULT_PER_PAGE_LIMIT;

      log(`🔎 開始【${catName}】全 ${totalPages} 頁巡迴，結束後產出「單一彙總 EXCEL」...`);
      const items = await scrapeAllPagesForCategory({ name: catName, id: selectedOption?.value || "appliances" }, minCommission, minPrice, totalPages, perPageLimit, log);

      if (items.length === 0) {
        alert(`⚠️ 未發現符合「售價 ≥ NT$ ${minPrice} 且 分潤 ≥ ${minCommission}%」的商品`);
        return;
      }
      const filename = `蝦皮_${catName}_全頁彙整_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadAsSingleExcel(items, filename);
      log(`🎉 大功告成！已將跨頁共 ${items.length} 款【${catName}】整合至單一檔案：${filename}！`);
    });

    // 「全頁上架 Vercel」手動點擊
    document.getElementById('start-sync-btn').addEventListener('click', executeSyncWorkflow);
  }

  // 自動掛載面板
  let checkTimer = setInterval(() => {
    if (document.body || document.documentElement) {
      if (!document.getElementById('shopee-dom-sync-panel')) {
        injectUI();
      } else {
        clearInterval(checkTimer);
      }
    }
  }, 400);

})();
