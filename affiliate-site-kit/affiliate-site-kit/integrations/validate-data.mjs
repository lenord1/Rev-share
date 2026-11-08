// Astro integration：建置開始時驗證資料並確認 vercel.json 已與資料同步，不通過就中止建置。
// 為什麼要放在 Astro 內而不是只靠 npm prebuild：部署平台可能直接執行 `astro build`，
// 繞過 package.json 的 prebuild；integration 是跟著 Astro 走的，不會被繞過。
// 為什麼只「檢查」vercel.json 而不在建置時改寫：Vercel 的 redirects/headers 通常在建置前
// 就由 repo 內的 vercel.json 決定，建置中才寫出的檔案很可能不會套用到這次部署（需實測）。
// 所以 vercel.json 必須先在本機 `npm run sync` 產生並 commit。
import { validateProducts } from '../scripts/validate-products.mjs';
import { buildVercelConfig } from '../scripts/gen-redirects.mjs';
import { exists, readText } from '../scripts/lib.mjs';

export function checkData({ strict = false } = {}) {
  const r = validateProducts({ strict });
  const problems = [];
  if (r.errors) problems.push(...r.items.filter((i) => i.level === 'error').map((i) => i.msg));
  const want = JSON.stringify(buildVercelConfig(), null, 2) + '\n';
  const cur = exists('vercel.json') ? readText('vercel.json') : '';
  if (cur !== want) problems.push('vercel.json 與資料不同步：請在本機執行 npm run sync，並將 vercel.json 一併 commit 後再部署');
  return problems;
}

export default function validateData(opts = {}) {
  return {
    name: 'validate-data',
    hooks: {
      'astro:build:start': () => {
        const problems = checkData(opts);
        if (problems.length) throw new Error('資料檢查失敗，已中止建置：\n- ' + problems.join('\n- '));
      },
    },
  };
}
