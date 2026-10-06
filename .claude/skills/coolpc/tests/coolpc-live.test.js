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
  { key: 'cooler', label: '散熱器', cats: [10, 11] },
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
  // 2026/10/2 的實例：裝機價結束後同型號有原價與任搭價兩件；B860M-E 從原價改成任搭優惠
  5: { id: 5, name: '主機板 MB', groups: [
    { label: 'Intel H610', items: [
      item(5, '｛華碩 PRIME H610M-K D4-CSM｝M-ATX/1A1H/LAN 1G/註四年/2DIMM/6+1+1相', 2590),
      item(6, '任搭價｛華碩 PRIME H610M-K D4-CSM｝M-ATX/1A1H/R 1G/2DIMM/6+1+1相', 2390),
    ] },
    { label: 'Intel B860', items: [item(7, '｛華碩 B860M-E-CSM｝M-ATX/2.5G/註四年/2DIMM/6+1+1+1相 *任搭優惠價', 3390)] },
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
  assert.throws(() => C.decodeQuote('1' + 'A'.repeat(40000), SLOTS));
  assert.throws(() => C.decodeQuote('', SLOTS));
  const enc = o => '1' + Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.throws(() => C.decodeQuote(enc({ d: 'x', r: [] }), SLOTS));
  assert.throws(() => C.decodeQuote(enc({ d: 'x', r: Array(61).fill(['cpu', 4, 'a', 1]) }), SLOTS));
});

test('其他商品 (multi 欄位)：可重複、分類要在清單內、10 格 + 40 件解得開', () => {
  const MORE = { key: '+', label: '其他商品', cats: [4, 12, 13, 17], multi: true };
  const enc = o => '1' + Buffer.from(JSON.stringify(o)).toString('base64url');
  const q = C.decodeQuote(enc({ d: 'x', r: [
    ['cpu', 4, 'a', 1], ['+', 13, '螢幕 A', 4990], ['+', 13, '螢幕 B', 2990, 2], ['+', 99, '不明分類', 1], ['+', 17, '椅子', 1990],
  ] }), [...SLOTS, MORE]);
  assert.equal(q.dropped, 1);
  assert.deepEqual(q.rows.map(r => [r.slot, r.cat, r.name, r.qty]), [
    ['cpu', 4, 'a', 1], ['+', 13, '螢幕 A', 1], ['+', 13, '螢幕 B', 2], ['+', 17, '椅子', 1]]);
  // 沒傳 multi 欄位 (舊版網頁) 時其他商品列整列略過，主機列照常還原
  assert.equal(C.decodeQuote(enc({ d: 'x', r: [['cpu', 4, 'a', 1], ['+', 13, '螢幕 A', 4990]] }), SLOTS).dropped, 1);
  const long = '｛某品牌 27吋 2K 180Hz IPS 電競螢幕｝' + '規'.repeat(150);
  const rows = [...SLOTS.map(x => ({ slot: x.key, cat: x.cats[0], name: long, price: 9999, qty: 2, d: 'x' })),
    ...Array.from({ length: 40 }, (_, i) => ({ slot: '+', cat: 13, name: long + i, price: 9999, qty: 2, d: 'y' + i }))];
  assert.equal(C.decodeQuote(C.encodeQuote({ rows }), [...SLOTS, MORE]).rows.length, rows.length);
});

test('select / selectRest：主機型錄剔除群組與品項，補集剛好是剩下的', () => {
  const parsed = { categories: [
    { id: 1, name: '品牌小主機', groups: [{ label: 'MINI', items: [item(1, 'mini', 1)] }] },
    { id: 4, name: '處理器 CPU', groups: [{ label: 'AM5', items: [item(2, 'R5', 1), item(3, 'R5 套裝加購', 1)] }] },
    { id: 10, name: '散熱器', groups: [{ label: '塔散', items: [item(4, 'tower', 1)] }, { label: '高效能散熱膏', items: [item(5, 'paste', 1)] }] },
  ] };
  const slots = [{ key: 'cpu', cats: [4] }, { key: 'cooler', cats: [10] }];
  const filters = { exclude_groups: { 10: '散熱膏' }, exclude_items: '套裝加購' };
  const names = cats => Object.values(cats).map(c => [c.id, c.groups.map(g => [g.label, g.items.map(i => i.name)])]);
  assert.deepEqual(names(C.select(parsed, slots, filters)), [[4, [['AM5', ['R5']]]], [10, [['塔散', ['tower']]]]]);
  assert.deepEqual(names(C.selectRest(parsed, slots, filters)),
    [[1, [['MINI', ['mini']]]], [4, [['AM5', ['R5 套裝加購']]]], [10, [['高效能散熱膏', ['paste']]]]]);
  assert.throws(() => C.select(parsed, [{ key: 'vga', cats: [12] }], filters), /缺少分類 12/);
});

test('mergeCatalog：同名群組接在後面、新分類依編號排、不改到主機型錄', () => {
  const base = { 4: { id: 4, name: 'CPU', groups: [{ label: 'AM5', items: [item(1, 'R5', 1)] }] },
                 10: { id: 10, name: '散熱器', groups: [{ label: '塔散', items: [item(2, 'tower', 1)] }] } };
  const rest = { 1: { id: 1, name: '小主機', groups: [{ label: 'MINI', items: [item(3, 'mini', 1)] }] },
                 4: { id: 4, name: 'CPU', groups: [{ label: 'AM5', items: [item(4, 'R5 套裝加購', 1)] }] },
                 10: { id: 10, name: '散熱器', groups: [{ label: '散熱膏', items: [item(5, 'paste', 1)] }] } };
  const snap = JSON.stringify(base);
  const all = C.mergeCatalog(base, rest);
  assert.equal(JSON.stringify(base), snap);
  assert.deepEqual(Object.keys(all), ['1', '4', '10']);
  assert.deepEqual(all[4].groups.map(g => [g.label, g.items.map(i => i.name)]), [['AM5', ['R5', 'R5 套裝加購']]]);
  assert.deepEqual(all[10].groups.map(g => g.label), ['塔散', '散熱膏']);
  assert.equal(all[4].groups[0].items[0], base[4].groups[0].items[0]);  // 品項物件共用
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

test('reconcile：型號對到多件 (代理 / 平輸) -> 不猜，視為下架並給候選', () => {
  const r = C.reconcile({ cat: 4, name: '｛AMD R7 9800X3D｝舊品名' }, IDX);
  assert.equal(r.item, null); assert.deepEqual(r.alts.map(x => x.id), [3, 4]);
});

test('reconcile：搭板優惠結束、同型號還有原價品項 -> variant，對到原價那件', () => {
  const old = '[搭板專案 ]｛AMD R5 7500F MPK｝(含風扇)【6核/12緒】3.7G(↑5.0G)搭主機板省300';
  const r = C.reconcile({ cat: 4, name: old }, IDX);
  assert.equal(r.how, 'variant'); assert.equal(r.item.id, 1); assert.equal(r.item.price, 4790);
  assert.equal(C.condNote(old, r.item.name), '搭板優惠已結束');
  assert.equal(C.reconcile({ cat: 5, name: '裝機價｛AMD R5 7500F MPK｝' }, IDX).item, null);  // 不跨分類
});

test('reconcile：variant 同型號多件時挑｝後規格最像的 (代理盒 -> 代理盒裝)，分不出來就不猜', () => {
  const r = C.reconcile({ cat: 4, name: '[搭板專案 ]｛AMD R7 9800X3D｝代理盒【8核/16緒】4.7G(↑5.2G)任搭主機板現省900' }, IDX);
  assert.equal(r.how, 'variant'); assert.equal(r.item.id, 3);
  const tie = C.reconcile({ cat: 4, name: '[搭板專案 ]｛AMD R7 9800X3D｝' }, IDX);
  assert.equal(tie.item, null); assert.deepEqual(tie.alts.map(x => x.id), [3, 4]);
});

test('reconcile：variant 優先對無條件的原價品項 (即使任搭價的規格文字更像)', () => {
  const old = '裝機價｛華碩 PRIME H610M-K D4-CSM｝M-ATX/1A1H/R 1G/2DIMM/6+1+1相';
  const r = C.reconcile({ cat: 5, name: old }, IDX);
  assert.equal(r.how, 'variant'); assert.equal(r.item.id, 5);
  assert.equal(C.condNote(old, r.item.name), '裝機價已結束');
});

test('reconcile：原價品項改成任搭優惠 -> variant', () => {
  const old = '｛華碩 B860M-E-CSM｝M-ATX/2.5G/註四年/2DIMM/6+1+1+1相 *活動到9/30';
  const r = C.reconcile({ cat: 5, name: old }, IDX);
  assert.equal(r.how, 'variant'); assert.equal(r.item.id, 7);
  assert.equal(C.condNote(old, r.item.name), '改為任搭優惠');
});

test('condNote：各種條件變化的說明', () => {
  assert.equal(C.condNote('裝機價｛X｝', '任搭價｛X｝'), '裝機價已結束，現為任搭優惠');
  assert.equal(C.condNote('限組裝｛X｝', '｛X｝'), '限組裝價已結束');
  assert.equal(C.condNote('限搭機｛X｝', '｛X｝'), '限搭機價已結束');
  assert.equal(C.condNote('｛X｝', '組裝價｛X｝'), '改為組裝價');
});

test('totals：報價 vs 現價、已下架以報價計入現價、任搭折只看對得到的列', () => {
  const rows = [
    { cat: 4, name: '｛AMD R7 7700｝(含風扇)【8核/16緒】', qty: 2, pin: { price: 7490, d: 'a' } },   // 現價 7990 ▲500 ×2
    { cat: 12, name: '｛技嘉 RX9060XT GAMING OC 8G｝3320MHz/28cm', qty: 1, pin: null },            // 跟著現價
    { cat: 12, name: '｛藍寶石 脈動 PULSE RX9070XT GAMING 16GB｝', qty: 1, pin: { price: 25990, d: 'a' } }, // 已下架
    { cat: 4, name: '[搭板專案 ]｛AMD R5 7500F MPK｝(含風扇)【6核/12緒】3.7G(↑5.0G)搭主機板省300', qty: 1, pin: { price: 4490, d: 'a' } }, // 搭板結束，同型號原價 4790 ▲300
  ];
  assert.deepEqual(C.totals(rows, IDX), {
    quoted: 7490 * 2 + 11490 + 25990 + 4490,
    current: 7990 * 2 + 11490 + 25990 + 4790,
    diff: 1300,
    off: 200,
    goneCount: 1,
  });
});

test('totals：可傳函式，每列各自選型錄', () => {
  const OTHER = C.indexCatalog({ 13: { id: 13, name: '螢幕', groups: [{ label: '27吋', items: [item(20, '｛螢幕 A｝', 4990, ['任搭折50'])] }] } });
  const rows = [
    { cat: 12, name: '｛技嘉 RX9060XT GAMING OC 8G｝3320MHz/28cm', qty: 1, pin: null },
    { cat: 13, name: '｛螢幕 A｝', qty: 2, pin: { price: 5290, d: 'a' }, x: true },
  ];
  assert.deepEqual(C.totals(rows, r => C.reconcile(r, r.x ? OTHER : IDX)),
    { quoted: 11490 + 5290 * 2, current: 11490 + 4990 * 2, diff: -600, off: 100, goneCount: 0 });
  assert.equal(C.totals(rows, IDX).goneCount, 1);  // 舊用法：只傳主機型錄，螢幕查不到
});

test('parseQD：日期可正確比較大小', () => {
  assert.ok(C.parseQD('2026/10/2 14:55') > C.parseQD('2026/9/21 14:51'));
  assert.ok(C.parseQD('2026/9/21 14:51') > C.parseQD('2026/9/21 9:05'));
  assert.equal(C.parseQD('亂打'), 0);
});

// 2026-10-06：活動說明、運送提醒寫成一般 OPTION 標價 $1 (分類 2 / 10 / 17 共 14 筆)，不能當商品 (散熱器欄會冒出 $1 的品項)
const NOTE_PAGE = `<font id=Mdy>2026/10/6 11:13</font><TD class=w>2<TD class=t>筆電</TD><TD><SELECT name=n2>
<OPTION value=0 selected>共有商品 2 樣</OPTION><OPTGROUP LABEL='Dell'>
<OPTION value=1>即日起～9/28 購買 Dell 指定機種線上登錄送專屬購機好禮~, $1 ◆ ★</OPTION>
<OPTION value=2>｛Dell XPS 13｝, $39900 ◆ ★</OPTION></SELECT>`;
test('parse：標價 $1 的說明列略過，同 parse_coolpc.py', () => {
  const p = C.parse(NOTE_PAGE);
  assert.deepEqual(p.categories[0].groups[0].items.map(it => [it.id, it.name, it.price]), [[2, '｛Dell XPS 13｝', 39900]]);
});

test('evaluateForm：帶單到原價屋的 iname / icnt，同品名合併數量、上限 10、略過空品名', () => {
  assert.deepEqual(C.evaluateForm([{ name: '｛A｝', qty: 1 }, { name: '｛B｝', qty: 2 }]), { iname: '<>｛A｝<>｛B｝', icnt: '<>1<>2', count: 2 });
  assert.deepEqual(C.evaluateForm([{ name: '｛A｝', qty: 9 }, { name: '', qty: 1 }, { name: '｛A｝', qty: 9 }]), { iname: '<>｛A｝', icnt: '<>10', count: 1 });
  assert.deepEqual(C.evaluateForm([]), { iname: '', icnt: '', count: 0 });
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

// 主機型錄 + 補集要剛好涵蓋原價屋每一件 (不重複、不遺漏)
const docs = path.join(root, 'docs/data.json');
test('select + selectRest 涵蓋 coolpc_prices.json 全部品項', { skip: !(fs.existsSync(json) && fs.existsSync(docs)) && '缺 data/coolpc_prices.json 或 docs/data.json' }, () => {
  const py = JSON.parse(fs.readFileSync(json, 'utf8')), D = JSON.parse(fs.readFileSync(docs, 'utf8'));
  const all = C.mergeCatalog(C.select(py, D.slots, D.filters), C.selectRest(py, D.slots, D.filters));
  const ids = cats => Object.values(cats).flatMap(c => c.groups.flatMap(g => g.items.map(i => c.id + ':' + i.id))).sort();
  assert.deepEqual(ids(all), ids(Object.fromEntries(py.categories.map(c => [c.id, c]))));
});
