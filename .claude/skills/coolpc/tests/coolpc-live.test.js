// node --test .claude/skills/coolpc/tests/
// 估價單快照 (分享連結) 的對照 / 合計 / 編解碼，以及 parse() 與 parse_coolpc.py 的一致性。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../templates/coolpc-live.js');
const C = globalThis.CoolPC;

const SLOTS = [
  { key: 'cpu', label: 'CPU', cats: [4] },
  { key: 'vga', label: '顯示卡', cats: [12] },
  { key: 'cooler', label: '散熱器', cats: [10, 11], optional: true },
];
const item = (id, name, price, flags = []) => ({ id, name, price, list_price: null, flags });
const CATS = {
  4: { id: 4, name: '處理器 CPU', groups: [
    { label: 'AMD AM5 7000系列', items: [
      item(1, '｛AMD R5 7500F MPK｝(含風扇)【6核/12緒】3.7G(↑5.0G)代理商三年保', 4790),
      item(2, '｛AMD R7 7700｝(含風扇)【8核/16緒】', 7990, ['任搭折100']),
    ] },
    { label: 'AMD AM5 9000系列', items: [
      item(3, '｛AMD R7 9800X3D｝代理盒裝【8核/16緒】', 15900),
      item(4, '｛AMD R7 9800X3D｝平輸盒裝【8核/16緒】', 14900),
    ] },
  ] },
  12: { id: 12, name: '顯示卡VGA', groups: [
    { label: '特價區', items: [item(9, '｛技嘉 RX9060XT GAMING OC 8G｝3320MHz/28cm', 11490, ['熱賣'])] },
    { label: 'AMD RX9060', items: [item(10, '｛技嘉 RX9060XT GAMING OC 8G｝3320MHz/28cm', 11490)] },
    { label: 'AMD RX9070', items: [item(11, '｛藍寶石 脈動 PULSE RX9070GRE GAMING 12GB｝2790MHz/28cm/雙風/註五年', 21490)] },
  ] },
};
const IDX = C.indexCatalog(CATS);

test('分享連結編解碼來回一致 (中文品名、數量、各列日期)', () => {
  const rows = [
    { slot: 'cpu', cat: 4, name: '｛AMD R7 7700｝(含風扇)【8核/16緒】', price: 7990, qty: 1, d: '2026/9/21 14:51' },
    { slot: 'vga', cat: 12, name: '｛技嘉 RX9060XT GAMING OC 8G｝3320MHz/28cm', price: 11490, qty: 2, d: '2026/9/21 14:51' },
    { slot: 'cooler', cat: 11, name: '利民 Frozen Warframe 360 黑', price: 2990, qty: 1, d: '2026/10/2 14:55' },
  ];
  const s = C.encodeQuote({ n: '中階', b: 'mid', rows });
  assert.match(s, /^1[A-Za-z0-9_-]+$/);           // 網址安全、沒有 padding
  const q = C.decodeQuote(s, SLOTS);
  assert.equal(q.d, '2026/9/21 14:51');           // 最多列共用的日期
  assert.equal(q.n, '中階'); assert.equal(q.b, 'mid'); assert.equal(q.dropped, 0);
  assert.deepEqual(q.rows, rows);
  const o = JSON.parse(Buffer.from(s.slice(1), 'base64url').toString());
  assert.deepEqual(o.r[0], ['cpu', 4, rows[0].name, 7990]);          // qty=1、同日期 -> 尾欄省略
  assert.deepEqual(o.r[1], ['vga', 12, rows[1].name, 11490, 2]);
  assert.deepEqual(o.r[2], ['cooler', 11, rows[2].name, 2990, 1, '2026/10/2 14:55']);
});

test('壞掉的連結丟錯 (截斷、非法字元、版本、超長、空)', () => {
  const s = C.encodeQuote({ rows: [{ slot: 'cpu', cat: 4, name: 'x'.repeat(50), price: 1, qty: 1, d: 'd' }] });
  assert.throws(() => C.decodeQuote(s.slice(0, s.length - 9), SLOTS));
  assert.throws(() => C.decodeQuote(s + '%', SLOTS));
  assert.throws(() => C.decodeQuote('2' + s.slice(1), SLOTS));
  assert.throws(() => C.decodeQuote('1' + 'A'.repeat(9000), SLOTS));
  assert.throws(() => C.decodeQuote('', SLOTS));
  const enc = o => '1' + Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.throws(() => C.decodeQuote(enc({ d: 'x', r: [] }), SLOTS));
  assert.throws(() => C.decodeQuote(enc({ d: 'x', r: Array(21).fill(['cpu', 4, 'a', 1]) }), SLOTS));
});

test('解碼時逐列驗證：不明欄位 / 分類不符 / 價格與數量範圍 / 重複欄位', () => {
  const enc = o => '1' + Buffer.from(JSON.stringify(o)).toString('base64url');
  const q = C.decodeQuote(enc({ d: '2026/9/21 14:51', n: 'x'.repeat(61), r: [
    ['cpu', 4, '<img src=x onerror=alert(1)>', 100, 99],  // 品名原樣保留 (頁面負責跳脫)，qty 夾到 9
    ['cpu', 4, '第二個 cpu', 100],                          // 同欄位第二列略過
    ['gpu', 12, 'a', 100],                                 // 不明欄位
    ['vga', 4, 'a', 100],                                  // 分類不屬於該欄位
    ['vga', 12, 'a', -1],                                  // 價格範圍
    ['vga', 12, 'x'.repeat(201), 100],                     // 品名過長
    ['cooler', 10, '風扇', 590, 0, 123],                    // qty 下限 1、日期不是字串 -> 用預設日期
  ] }), SLOTS);
  assert.equal(q.n, '');
  assert.equal(q.dropped, 5);
  assert.deepEqual(q.rows.map(r => [r.slot, r.name, r.qty, r.d]), [
    ['cpu', '<img src=x onerror=alert(1)>', 9, '2026/9/21 14:51'],
    ['cooler', '風扇', 1, '2026/9/21 14:51'],
  ]);
});

test('reconcile：完全相同品名、重複上架取第一筆', () => {
  const r = C.reconcile({ cat: 12, name: '｛技嘉 RX9060XT GAMING OC 8G｝3320MHz/28cm' }, IDX);
  assert.equal(r.how, 'exact'); assert.equal(r.item.id, 9); assert.equal(r.item.group, '特價區');
});

test('reconcile：品名小改但 ｛型號｝ 唯一且條件相同 -> 視為同一件', () => {
  const r = C.reconcile({ cat: 12, name: '｛藍寶石 脈動 PULSE RX9070GRE GAMING 12GB｝2790MHz/28cm/雙風/註四年' }, IDX);
  assert.equal(r.how, 'model'); assert.equal(r.item.id, 11);
});

test('reconcile：型號對到多件 (代理 / 平輸) -> 不猜，視為下架', () => {
  assert.equal(C.reconcile({ cat: 4, name: '｛AMD R7 9800X3D｝舊品名' }, IDX).item, null);
});

test('reconcile：搭板價下架不會被換成同型號零售品 (價格條件不同)', () => {
  const r = C.reconcile({ cat: 4, name: '[搭板專案 ]｛AMD R5 7500F MPK｝(含風扇)【6核/12緒】3.7G(↑5.0G)搭主機板省300' }, IDX);
  assert.equal(r.item, null);
  assert.equal(C.reconcile({ cat: 5, name: '裝機價｛AMD R5 7500F MPK｝' }, IDX).item, null);
});

test('totals：報價 vs 現價、已下架以報價計入現價、任搭折只看對得到的列', () => {
  const rows = [
    { cat: 4, name: '｛AMD R7 7700｝(含風扇)【8核/16緒】', qty: 2, pin: { price: 7490, d: 'a' } },   // 現價 7990 ▲500 ×2
    { cat: 12, name: '｛技嘉 RX9060XT GAMING OC 8G｝3320MHz/28cm', qty: 1, pin: null },            // 跟著現價
    { cat: 12, name: '｛藍寶石 脈動 PULSE RX9070XT GAMING 16GB｝', qty: 1, pin: { price: 25990, d: 'a' } }, // 已下架
  ];
  assert.deepEqual(C.totals(rows, IDX), {
    quoted: 7490 * 2 + 11490 + 25990,
    current: 7990 * 2 + 11490 + 25990,
    diff: 1000,
    off: 200,
    goneCount: 1,
  });
});

test('parseQD：日期可正確比較大小', () => {
  assert.ok(C.parseQD('2026/10/2 14:55') > C.parseQD('2026/9/21 14:51'));
  assert.ok(C.parseQD('2026/9/21 14:51') > C.parseQD('2026/9/21 9:05'));
  assert.equal(C.parseQD('亂打'), 0);
});

// evaluate.php 與 data/coolpc_prices.json 是同一次抓取時，瀏覽器版 parse() 要與 Python 版完全一致
const root = path.resolve(__dirname, '../../../..');
const php = path.join(root, 'evaluate.php'), json = path.join(root, 'data/coolpc_prices.json');
test('parse() 與 parse_coolpc.py 結果一致', { skip: !(fs.existsSync(php) && fs.existsSync(json)) && '缺 evaluate.php 或 data/coolpc_prices.json' }, t => {
  const py = JSON.parse(fs.readFileSync(json, 'utf8'));
  const js = C.parse(fs.readFileSync(php, 'utf8'));  // fetch_coolpc.py 存成 UTF-8
  if (js.quote_date !== py.quote_date) return t.skip(`日期不同 (${js.quote_date} vs ${py.quote_date})`);
  assert.equal(JSON.stringify(js.categories), JSON.stringify(py.categories.map(({ id, name, groups }) => ({ id, name, groups }))));
});
