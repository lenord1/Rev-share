// 買前指南（Markdown，src/content/guides/*.md）的載入與草稿規則。只給 Astro 頁面用（用到 Vite 的 import.meta.glob）。
// 草稿（draft: true）只在本機開發、Vercel 預覽環境（VERCEL_ENV=preview）或 SHOW_DRAFTS=1 時輸出；正式站不輸出。

export function showDrafts() {
  const env = (globalThis.process && globalThis.process.env) || {};
  return Boolean(import.meta.env?.DEV) || env.VERCEL_ENV === 'preview' || env.SHOW_DRAFTS === '1';
}

export function loadGuides() {
  const mods = import.meta.glob('../content/guides/*.md', { eager: true });
  const withDrafts = showDrafts();
  return Object.entries(mods)
    .map(([path, m]) => {
      const fm = m.frontmatter ?? {};
      return { slug: path.split('/').pop().replace(/\.md$/, ''), fm, Content: m.Content, draft: fm.draft === true };
    })
    .filter((g) => withDrafts || !g.draft)
    .sort((a, b) => String(b.fm.updated).localeCompare(String(a.fm.updated)) || a.slug.localeCompare(b.slug));
}

// 日期顯示成 YYYY-MM-DD（YAML 日期會被解析成 Date，也可能是字串）
export const dateText = (v) => {
  const s = v && typeof v.toISOString === 'function' ? v.toISOString() : String(v ?? '');
  return s.slice(0, 10);
};
