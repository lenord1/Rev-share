#!/usr/bin/env node
// Claude Code PostToolUse hook：編輯 products.json 後自動驗證。
// 從 stdin 讀 hook JSON；有錯誤就寫 stderr 並 exit 2，讓 Claude 立刻看到並修正。
import { validateProducts } from './validate-products.mjs';

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let file = '';
  try { file = JSON.parse(raw)?.tool_input?.file_path ?? ''; } catch { /* 非 JSON 就略過 */ }
  if (!/(products|travel|channels|price-history)\.json$/.test(file)) process.exit(0);
  const r = validateProducts();
  if (r.errors) {
    const msg = r.items.filter((i) => i.level === 'error').map((i) => '✗ ' + i.msg).join('\n');
    console.error('products.json 驗證失敗：\n' + msg);
    process.exit(2);
  }
  process.exit(0);
});
