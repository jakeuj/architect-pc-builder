const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../templates/builder-ui.js');
require('../templates/coolpc-live.js');
const C = globalThis.CoolPC;
const item = (name, price, flags = []) => ({ name, price, flags });
const cats = [{ id: 6, name: '記憶體｜RAM', groups: [
  { label: 'DDR5 雙通道', items: [item('美光 32GB 6000 黑', 100), item('A 32GB 6000 白', 100)] },
  { label: 'DDR5 單條', items: [item('B 16GB 6000', 50)] },
] }];
const entries = U.catalogEntries(cats);

test('用途只讀取 metadata，固定順序並保留未分類配置', () => {
  const builds = [{ purpose: 'high' }, { purpose: 'mainstream' }, { purpose: 'office', platform: 'intel' }, { name: 'AMD 入門', purpose: 'unknown' }];
  assert.deepEqual(U.purposesFor(builds).map(([key]) => key), ['office', 'mainstream', 'high', 'other']);
  assert.equal(U.purposeOf(builds[3]), 'other');
  assert.equal(U.purposeOf({ name: 'AMD 入門' }), 'other');
});

test('搜尋跨品名、群組與分類 AND 匹配，支援大小寫及全形空白', () => {
  const query = '記憶體　ｄｄｒ５ ３２ＧＢ ６０００';
  assert.deepEqual(U.searchEntries(entries, { query }).entries.map(x => x.item.name), ['美光 32GB 6000 黑', 'A 32GB 6000 白']);
  assert.equal(U.searchEntries(entries, { query: '32GB 6000 紅' }).count, 0);
  assert.equal(U.searchEntries(entries, { query: ' ' }).count, 3);
});

test('群組篩選、跨群組價格排序、同價穩定順序不改型錄', () => {
  assert.equal(U.searchEntries(entries, { group: '6:1' }).entries[0].item.name, 'B 16GB 6000');
  assert.deepEqual(U.searchEntries(entries, { sort: 'price-asc' }).entries.map(x => x.item.price), [50, 100, 100]);
  assert.deepEqual(U.searchEntries(entries, { sort: 'price-desc' }).entries.map(x => x.item.name), ['美光 32GB 6000 黑', 'A 32GB 6000 白', 'B 16GB 6000']);
  assert.equal(entries[0].item.name, '美光 32GB 6000 黑');
});

test('先篩選排序再截取 300 件，回傳完整符合數', () => {
  const many = Array.from({ length: 700 }, (_, i) => ({ ...entries[0], item: item('測試 ' + i, 700 - i) }));
  const result = U.searchEntries(many, { query: '測試', sort: 'price-asc', limit: 300 });
  assert.equal(result.count, 700); assert.equal(result.entries.length, 300);
  assert.equal(result.entries[0].item.price, 1); assert.equal(result.entries[299].item.price, 300);
});

const catalog = { 6: { ...cats[0], groups: [{ label: 'DDR5', items: [item('old', 100), item('new', 250, ['任搭折30'])] }] } };
const idx = C.indexCatalog(catalog), find = r => C.reconcile(r, idx);
const row = (name, qty = 1, price = null) => ({ cat: 6, name, qty, pin: price == null ? null : { price, d: '2026/9/1' } });
function state(r) { return { rows: { ram: r }, more: [], orig: { rows: { ram: r && structuredClone(r) }, more: [] } }; }

test('數量 1/2/9 的歷史報價價差等於實際選取總計，不扣任搭折且預覽不改單', () => {
  for (const qty of [1, 2, 9]) {
    const s = state(row('old', qty, 80)), before = structuredClone(s), pick = { slot: 'ram' }, candidate = { cat: 6, name: 'new' };
    const preview = U.previewCandidate(s, pick, candidate, find, C.totals);
    const applied = U.selectCandidate(s, pick, candidate).selection;
    assert.deepEqual(s, before);
    assert.deepEqual(preview.selection, applied);
    assert.equal(preview.delta, (250 - 80) * qty);
    assert.equal(C.totals(Object.values(applied.rows), find).quoted - C.totals(Object.values(s.rows), find).quoted, preview.delta);
  }
});

test('選回原件恢復歷史 pin 且保留目前數量；新增空欄使用現价', () => {
  const s = state(row('old', 1, 80)); s.rows.ram = row('new', 2);
  const result = U.previewCandidate(s, { slot: 'ram' }, { cat: 6, name: 'old' }, find, C.totals);
  assert.equal(result.delta, -340); assert.equal(result.selection.rows.ram.pin.price, 80);
  assert.equal(result.selection.rows.ram.qty, 2);
  assert.equal(U.previewCandidate(state(null), { slot: 'ram' }, { cat: 6, name: 'new' }, find, C.totals).delta, 250);
});

test('下架與同型號優惠結束以原報價為換件基準', () => {
  const missing = U.previewCandidate(state(row('已下架', 2, 90)), { slot: 'ram' }, { cat: 6, name: 'new' }, find, C.totals);
  assert.equal(missing.delta, 320);
  const variantCats = { 6: { id: 6, name: 'RAM', groups: [{ label: 'DDR5', items: [item('｛Micron ABC123｝ DDR5 6000', 250)] }] } };
  const variantFind = r => C.reconcile(r, C.indexCatalog(variantCats));
  const s = state(row('｛Micron ABC123｝ DDR5 6000~組裝價~', 1, 180));
  assert.equal(variantFind(s.rows.ram).how, 'variant');
  assert.equal(U.previewCandidate(s, { slot: 'ram' }, { cat: 6, name: '｛Micron ABC123｝ DDR5 6000' }, variantFind, C.totals).delta, 70);
});

test('其他商品新增／合併沿用 pin，替換重複拒絕，數量上限不虛增價差', () => {
  const s = state(null); s.more = [{ ...row('old', 2, 80), x: true }, { ...row('new'), x: true }]; s.orig.more = structuredClone(s.more);
  const p = U.previewCandidate(s, { index: null }, { cat: 6, name: 'old' }, find, C.totals);
  assert.equal(p.delta, 80); assert.equal(p.selection.more[0].qty, 3);
  assert.equal(p.selection.more[0].pin.price, 80);
  assert.equal(U.previewCandidate(s, { index: 1 }, { cat: 6, name: 'old' }, find, C.totals).error, '其他商品裡已經有這件了');
  s.more[0].qty = 9;
  assert.equal(U.previewCandidate(s, { index: null }, { cat: 6, name: 'old' }, find, C.totals).delta, 0);
  s.more.splice(0, 1);
  const restored = U.previewCandidate(s, { index: null }, { cat: 6, name: 'old' }, find, C.totals);
  assert.equal(restored.delta, 80); assert.equal(restored.selection.more[1].qty, 1);
});
