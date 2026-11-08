#!/usr/bin/env node
// 個人化排序與精靈計分的煙霧測試（純函式，不需瀏覽器）。用法：node scripts/test-rank.mjs
import assert from 'node:assert/strict';
import { readJson } from './lib.mjs';
import { slimProduct, activeCategories } from '../src/lib/catalog.mjs';
import { parseQuery, rank } from '../src/lib/rank.js';
import { questionsFor, pickProducts } from '../src/lib/finder.js';

const data = readJson('src', 'data', 'products.json');
// 排序測試用固定測試資料（3 台示範除濕機），不依賴網站上目前有哪些真實商品
const fixture = readJson('scripts', 'fixtures', 'rank-dehumidifiers.json');
const products = [...data.products.filter((p) => p.category !== 'dehumidifier'), ...fixture].map((p) => slimProduct(p));
const slugs = activeCategories({ ...data, products: [...data.products, ...fixture] }).map((c) => c.slug);
const none = { hasPet: null, hasChild: null, spaceSize: null };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('搜「除濕機 貓」：辨識品類與寵物意圖，寵物友善款排第一', () => {
  const r = rank(products, '除濕機 貓', none, slugs);
  assert.equal(r.parsed.category, 'dehumidifier');
  assert.ok(r.parsed.intents.has('pet') && r.parsed.pet === 'cat');
  assert.equal(r.items[0].p.code, 'demo-dh-c');
  assert.ok(r.items.every((x) => x.p.category === 'dehumidifier'));
});
t('「毛小孩」不會被當成有小孩', () => {
  const r = parseQuery('毛小孩', slugs);
  assert.ok(r.intents.has('pet') && !r.intents.has('child'));
});
t('「有小孩的家庭用什麼除濕機」：child 意圖、沒有安全鎖以外的殘字', () => {
  const r = parseQuery('有小孩的家庭用什麼除濕機', slugs);
  assert.ok(r.intents.has('child') && r.category === 'dehumidifier' && r.rest === '');
});
t('畫像：有小孩且沒有安全鎖的機種被扣分', () => {
  const r = rank(products, '除濕機', { ...none, hasChild: true }, slugs);
  const b = r.items.find((x) => x.p.code === 'demo-dh-b');
  assert.ok(b.score < 0);
  assert.notEqual(r.items[0].p.code, 'demo-dh-b');
});
t('畫像：大空間家庭不推小坪數機種', () => {
  const r = rank(products, '除濕機', { ...none, spaceSize: 'large' }, slugs);
  assert.equal(r.items.at(-1).p.code, 'demo-dh-b');
});
t('沒有回答（null）不扣分、同分價低者在前', () => {
  const r = rank(products, '除濕機', none, slugs);
  assert.ok(r.items.every((x) => x.score === 0));
  assert.deepEqual(r.items.map((x) => x.p.final), [...r.items.map((x) => x.p.final)].sort((a, b) => a - b));
});
t('精靈：每個有商品的品類都有題目，且 2 個以上型號可被推薦', () => {
  for (const slug of slugs) {
    const ps = products.filter((p) => p.category === slug);
    const qs = questionsFor(ps);
    assert.ok(qs.length > 0 && qs.length <= 3, `${slug} 題數 ${qs.length}`);
    const winners = new Set();
    // 窮舉所有答案組合，看有幾個不同型號能勝出
    const combos = qs.reduce((acc, q) => acc.flatMap((a) => q.options.map((o) => ({ ...a, [q.key]: o.value }))), [{}]);
    for (const c of combos) winners.add(pickProducts(ps, c)[0].p.code);
    assert.ok(winners.size >= 2, `${slug} 只有 ${winners.size} 個型號能勝出`);
  }
});
console.log(`\n-- ${n} 項通過`);
