import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import validateData from './integrations/validate-data.mjs';
import { readFileSync } from 'node:fs';
import { noindexPaths } from './src/lib/indexing.mjs';

// sitemap 不列 noindex 頁（示範商品、全是示範的品類與情境頁、404），規則與頁面的 <meta robots> 共用 src/lib/indexing.mjs
const readJson = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const products = readJson('./src/data/products.json').products;
const intents = readJson('./src/data/intents.json').intents;
const { minIntentProducts = 2 } = readJson('./scripts/config.json');
const hidden = noindexPaths(products, intents, { minProducts: minIntentProducts });

// site 先用佔位網址，拿到 Vercel 預覽網址後改，Step 9 換正式網域（robots.txt 的 Sitemap 行要一併改）
export default defineConfig({
  site: 'https://example.vercel.app',
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  vite: { plugins: [tailwindcss()] },
  integrations: [validateData(), sitemap({ filter: (page) => !hidden.has(new URL(page).pathname) })],
});
