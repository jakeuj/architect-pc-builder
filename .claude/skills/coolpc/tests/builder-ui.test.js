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

test('選回原件恢復歷史 pin 且保留目前數量；新增空欄使用現價', () => {
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

// ---- 店家模式 ----
test('店家歸屬：本機店家只能編輯自己的單，別家店的單維持原店家', () => {
  const mine = { on: true, name: '吳記 電腦' }, off = { ...mine, on: false };
  const plain = { issuer: null }, same = { issuer: { name: '吳記電腦' } }, other = { issuer: { name: '別家店' } };
  assert.equal(U.sameStore({ name: 'ＡＢＣ 電腦' }, { name: 'abc電腦' }), true);
  assert.equal(U.sameStore({ name: '' }, { name: '' }), false);
  assert.equal(U.storeOn({ on: true, name: '  ' }), false);
  const cases = [  // [profile, tab, owned, issuerFor]
    [mine, plain, true, mine], [mine, same, true, mine], [mine, other, false, other.issuer],
    [off, plain, false, null], [off, same, false, same.issuer], [off, other, false, other.issuer],
    [null, plain, false, null], [null, other, false, other.issuer],
  ];
  for (const [profile, tab, own, issuer] of cases) {
    assert.equal(U.owned(profile, tab), own);
    assert.equal(U.issuerFor(profile, tab), issuer);
  }
});

test('金額輸入：千分位、全形、錢字號、負數，看不懂回 null', () => {
  assert.equal(U.parseMoney('52,900'), 52900);
  assert.equal(U.parseMoney('５２９００'), 52900);
  assert.equal(U.parseMoney(' $1,200 元'), 1200);
  assert.equal(U.parseMoney('-2000'), -2000);
  assert.equal(U.parseMoney('0'), 0);
  assert.equal(U.parseMoney('-0'), 0);
  for (const v of ['', '  ', '-', '1.5', 'abc', '1e5', null, undefined, '1234567890']) assert.equal(U.parseMoney(v), null, String(v));
});

test('複製給客戶的訊息：店家資訊、本店價、服務列；隱藏模式不出現原價屋金額', () => {
  const store = { name: '吳記電腦', rep: '吳英豪', tel: '0985-378-701', line: 'fatgo99', addr: '台北市市民大道三段8號2樓' };
  const lines = [{ label: 'CPU', name: 'AMD R7 7700', qty: 1, price: 7990 }, { label: '顯示卡', name: '技嘉 RX9060XT', qty: 2, price: 11490 }];
  const biz = { price: 30000, ref: 30970, extras: [['組裝費', 0], ['灌 Windows', 500]], cust: '王先生' };
  const totals = C.bizTotals(30970, biz);
  const text = U.storeMessage({ store, biz, totals, quoted: 30970, lines, url: 'https://example.test/#v=1&q=1abc', until: '10/13' });
  const out = text.split('\n');
  assert.equal(out[0], '王先生您好，這是「吳記電腦」為您準備的電腦估價：');
  assert.ok(out.includes('顯示卡：技嘉 RX9060XT ×2  $22,980'));
  assert.ok(out.includes('原價屋合計 $30,970'));
  assert.ok(out.includes('本店價 $30,000（省 $970）'));
  assert.ok(out.includes('組裝費 免費'));
  assert.ok(out.includes('本店合計 $30,500'));
  assert.ok(out.includes('報價有效至 10/13'));
  assert.ok(out.includes('估價單：https://example.test/#v=1&q=1abc'));
  assert.equal(out.at(-2), '業務 吳英豪｜電話 0985-378-701｜LINE fatgo99');
  assert.equal(out.at(-1), '吳記電腦｜台北市市民大道三段8號2樓');
  // 隱藏原價屋單價：只剩本店價、服務列與本店合計
  const hidden = U.storeMessage({ store: { name: '小店' }, biz: { ...biz, hide: true }, totals, quoted: 30970, lines, url: 'u' });
  for (const n of ['7,990', '22,980', '30,970', '970）']) assert.ok(!hidden.includes(n), n);
  assert.ok(hidden.includes('顯示卡：技嘉 RX9060XT ×2\n'));
  assert.ok(!hidden.includes('業務'));
  // 本店價需重新確認、沒有本店價時本店合計 = 原價屋合計 + 服務列
  assert.match(U.storeMessage({ store, biz, totals: C.bizTotals(31000, biz), quoted: 31000, lines, url: 'u' }), /本店價請再與我們確認/);
  const noPrice = U.storeMessage({ store, biz: { extras: [['運費', 300]] }, totals: C.bizTotals(30970, { extras: [['運費', 300]] }), quoted: 30970, lines, url: 'u' });
  assert.ok(!noPrice.includes('本店價 ')); assert.match(noPrice, /本店合計 \$31,270/);
  assert.match(noPrice, /^這是「吳記電腦」/);
});

// ---- 相容性規則：內顯、電源瓦數、快照年齡 ----
test('cpuGraphics 先看品名「無內顯／具內顯」，再看型號', () => {
  assert.equal(U.cpuGraphics('｛Intel Core Ultra 5 225F｝【10核】3.3G /無內顯【代理盒裝】'), false);
  assert.equal(U.cpuGraphics('｛AMD R7 7700 MPK｝(代理含風扇)【8核/16緒】65W /具內顯'), true);
  for (const m of ['Intel Core Ultra 5 225F', 'Intel Core Ultra 5 245KF', 'Intel Core Ultra 5 250KF Plus', 'Intel i5-12400F', 'Intel i5-14400F',
    'AMD R5 7500F MPK', 'AMD R5 8400F盒', 'Intel Xeon W7-3465X']) assert.equal(U.cpuGraphics(`｛${m}｝【規格】`), false, m);
  assert.equal(U.cpuGraphics('｛AMD Ryzen TR 9960X盒｝', 'AMD Ryzen Threadripper TRX50系列'), false);
  assert.equal(U.cpuGraphics('｛AMD R5 5600X MPK｝', 'AMD AM4 腳位'), false);
  assert.equal(U.cpuGraphics('｛AMD R7 5800X3D｝', 'AMD AM4 腳位'), false);
  for (const m of ['Intel Core Ultra 5 225', 'Intel Core Ultra 7 265K', 'Intel i3-14100', 'Intel i5-14400',
    'AMD R5 9600X', 'AMD R7 9700X', 'AMD R7 9800X3D', 'AMD R5 8500G盒', 'AMD R5 3400G']) assert.equal(U.cpuGraphics(`｛${m}｝【規格】`), true, m);
  assert.equal(U.cpuGraphics('｛某牌 處理器｝'), null);
  assert.equal(U.cpuGraphics(''), null);
});

test('psuWatts 讀品名的瓦數，不被「原價$3190」誤導', () => {
  assert.equal(U.psuWatts('｛XPG CORE REACTOR II VE 750W｝雙8/金牌/全模/ATX3.1 原價$3190'), 750);
  assert.equal(U.psuWatts('｛COUGAR ATLAS 1000W｝雙8/銅牌'), 1000);
  assert.equal(U.psuWatts('｛某牌 電源｝金牌'), null);
  assert.equal(U.psuWatts(''), null);
});

test('vgaPower 依群組標籤對原廠建議電源，不在表內不提示', () => {
  assert.deepEqual(U.vgaPower('NVIDIA RTX5060Ti-8GB(GDDR7)'), { model: 'RTX5060Ti', watts: 600 });
  assert.deepEqual(U.vgaPower('NVIDIA RTX5060-8GB(GDDR7)'), { model: 'RTX5060', watts: 550 });
  assert.deepEqual(U.vgaPower('NVIDIA RTX5080-16GB(GDDR7)'), { model: 'RTX5080', watts: 850 });
  assert.deepEqual(U.vgaPower('NVIDIA RTX3050-6GB'), { model: 'RTX3050', watts: 300 });
  assert.deepEqual(U.vgaPower('NVIDIA RTX3050-8GB'), { model: 'RTX3050', watts: 550 });
  assert.deepEqual(U.vgaPower('AMD Radeon RX9070GRE-12G'), { model: 'RX9070GRE', watts: 650 });
  assert.deepEqual(U.vgaPower('AMD Radeon RX9070XT-16G'), { model: 'RX9070XT', watts: 750 });
  assert.equal(U.vgaPower('NVIDIA RTX6000 Ada 48GB 工作站'), null);
  assert.equal(U.vgaPower('AMD Radeon RX7650GRE-8G'), null);
  assert.equal(U.vgaPower(''), null);
  for (const [model, watts] of U.VGA_PSU) assert.ok(/^(RTX|RX|GT)\d{3,4}/.test(model) && watts >= 300 && watts <= 1000, model);
});

test('snapshotAgeHours 讀 generated 的 ISO 時間 (含 +08:00)', () => {
  const now = Date.parse('2026-10-07T16:11+08:00');
  assert.equal(U.snapshotAgeHours('2026-10-06T16:11+08:00', now), 24);
  assert.equal(U.snapshotAgeHours('2026-10-07T20:11+08:00', now), 0);   // 未來時間 (時鐘不準) 不當過期
  assert.equal(U.snapshotAgeHours('不是時間', now), null);
  assert.equal(U.snapshotAgeHours(undefined, now), null);
});

// ---- 改單差異 ----
test('diffQuote：換件、數量、改用現價、新增與移除 (含其他商品)，合計差', () => {
  const orig = { rows: { cpu: row('old', 1, 80), ram: row('old', 2, 80), ssd: row('new', 1), hdd: null },
    more: [{ ...row('old', 1, 80), x: true }, { ...row('new', 2), x: true }] };
  const cur = { rows: { cpu: row('new', 1), ram: row('old', 3, 80), ssd: null, hdd: row('old') },
    more: [{ ...row('new', 1), x: true }, { ...row('已下架', 1, 60), x: true }] };
  const before = structuredClone([orig, cur]);
  const d = U.diffQuote(orig, cur, find);
  assert.deepEqual(d.changed.map(x => [x.slot, x.same, x.from.sub, x.to.sub, x.delta]),
    [['cpu', false, 80, 250, 170], ['ram', true, 160, 240, 80], ['+', true, 500, 250, -250]]);
  assert.deepEqual(d.changed[0].from, { name: 'old', qty: 1, price: 80, sub: 80 });
  assert.deepEqual(d.changed[0].to, { name: 'new', qty: 1, price: 250, sub: 250 });
  assert.deepEqual(d.added.map(x => [x.slot, x.name, x.sub]), [['hdd', 'old', 100], ['+', '已下架', 60]]);
  assert.deepEqual(d.removed.map(x => [x.slot, x.name, x.sub]), [['ssd', 'new', 250], ['+', 'old', 80]]);
  assert.equal(d.count, 7);
  // 合計 = 兩邊各自的 totals().quoted
  const T = s => C.totals([...Object.values(s.rows).filter(Boolean), ...s.more], find).quoted;
  assert.deepEqual(d.total, { from: T(orig), to: T(cur), delta: T(cur) - T(orig) });
  assert.deepEqual([orig, cur], before);   // 不改到輸入
  // 沒改 -> 全空
  const none = U.diffQuote(orig, structuredClone(orig), find);
  assert.equal(none.count, 0); assert.deepEqual(none.total, { from: T(orig), to: T(orig), delta: 0 });
  // 改用現價 (同品名、同數量、pin 拿掉) 也算一處
  const requoted = U.diffQuote({ rows: { cpu: row('old', 1, 80) }, more: [] }, { rows: { cpu: row('old', 1) }, more: [] }, find);
  assert.deepEqual(requoted.changed.map(x => [x.same, x.from.price, x.to.price, x.delta]), [[true, 80, 100, 20]]);
  // 已下架且沒鎖價：單價 null、以 0 計；兩邊都空格不列
  const gone = U.diffQuote({ rows: { cpu: null, ram: null }, more: [] }, { rows: { cpu: row('已下架'), ram: null }, more: [] }, find);
  assert.deepEqual(gone.added.map(x => [x.price, x.sub]), [[null, 0]]);
  assert.equal(gone.count, 1); assert.equal(gone.total.delta, 0);
  // 其他商品同品名重複出現時逐件配對，不重複計
  const dup = U.diffQuote({ rows: {}, more: [{ ...row('old', 1, 80), x: true }, { ...row('old', 1, 70), x: true }] },
    { rows: {}, more: [{ ...row('old', 1, 80), x: true }] }, find);
  assert.equal(dup.count, 1); assert.equal(dup.removed[0].price, 70); assert.equal(dup.total.delta, -70);
});

// ---- 價格歷史 ----
test('historyKey / isoOfQD：分類|型號、報價日期轉 ISO', () => {
  assert.equal(U.historyKey(4, '｛AMD R7 9700X｝代理盒裝'), '4|AMD R7 9700X');
  assert.equal(U.historyKey(4, '搭板價｛ R5 9600X ｝'), '4|R5 9600X');
  assert.equal(U.historyKey(10, '利民 Frozen Warframe 360 黑'), null);
  assert.equal(U.isoOfQD('2026/9/18 14:19'), '2026-09-18');
  assert.equal(U.isoOfQD('2026/10/22'), '2026-10-22');
  assert.equal(U.isoOfQD('不是日期'), null);
});

test('historyStats：視窗起點承接之前的價格、視窗內的變動、尾端延伸到今天', () => {
  const series = [['2026-08-01', 100], ['2026-09-25', 90], ['2026-10-10', 120], ['2026-10-20', 110]];
  const s = U.historyStats(series, '2026-10-22', 30);   // 視窗 9/22 ~ 10/22
  assert.deepEqual(s.points, [[0, 100], [3, 90], [18, 120], [28, 110], [30, 110]]);
  assert.deepEqual([s.min, s.max, s.last, s.flat, s.changes, s.days], [90, 120, 110, false, 3, 30]);
  // 30 天內沒變：只有起點承接的價格 -> flat
  const flat = U.historyStats([['2026-08-01', 100], ['2026-09-01', 95]], '2026-10-22');
  assert.deepEqual(flat.points, [[0, 95], [30, 95]]); assert.equal(flat.flat, true); assert.equal(flat.changes, 0);
  // 視窗內剛上架：從第一筆開始，不補起點
  const fresh = U.historyStats([['2026-10-15', 300]], '2026-10-22');
  assert.deepEqual(fresh.points, [[23, 300], [30, 300]]); assert.equal(fresh.flat, true);
  // 剛好在今天變動：尾端不再延伸
  assert.deepEqual(U.historyStats([['2026-10-01', 1], ['2026-10-22', 2]], '2026-10-22').points, [[9, 1], [30, 2]]);
  // 沒資料 / 全在未來 / 壞日期 / 壞值 -> null 或略過
  assert.equal(U.historyStats([], '2026-10-22'), null);
  assert.equal(U.historyStats(null, '2026-10-22'), null);
  assert.equal(U.historyStats([['2026-11-01', 1]], '2026-10-22'), null);
  assert.equal(U.historyStats([['2026-10-01', 1]], null), null);
  assert.deepEqual(U.historyStats([['壞', 1], ['2026-10-01', 'x'], ['2026-10-02', 5], 7], '2026-10-22').points, [[10, 5], [30, 5]]);
});

test('sparkline：階梯路徑落在 w×h 內，沒變或沒資料回空字串', () => {
  const s = U.historyStats([['2026-09-01', 100], ['2026-10-02', 80], ['2026-10-12', 120]], '2026-10-22');
  const svg = U.sparkline(s, 64, 18);
  assert.match(svg, /^<svg class="spark" viewBox="0 0 64 18" width="64" height="18" aria-hidden="true"><path d="M1\.0,9\.0H21\.7V17\.0H42\.3V1\.0H63\.0" /);
  const nums = [...svg.matchAll(/[MHV]([\d.]+)(?:,([\d.]+))?/g)].flatMap(m => [m[1], m[2]]).filter(Boolean).map(Number);
  assert.ok(nums.every(n => n >= 0 && n <= 64));
  assert.equal(U.sparkline(U.historyStats([['2026-09-01', 100]], '2026-10-22')), '');
  assert.equal(U.sparkline(null), '');
});

// ---- 最近開過的估價單 ----
test('recentUpsert / recentClean：新的在前、同 hash 只留一筆、最多 30 筆、壞資料丟掉', () => {
  const e = (i, hash = '#v=1&q=' + i) => ({ n: '單 ' + i, d: '2026/10/22', total: i * 100, hash, at: '2026-10-22' });
  let list = [];
  for (let i = 1; i <= 35; i++) list = U.recentUpsert(list, e(i));
  assert.equal(list.length, 30); assert.equal(list[0].n, '單 35'); assert.equal(list[29].n, '單 6');
  const again = U.recentUpsert(list, { ...e(10), at: '2026-10-23' });
  assert.equal(again.length, 30); assert.equal(again[0].at, '2026-10-23'); assert.equal(again.filter(x => x.hash === e(10).hash).length, 1);
  assert.deepEqual(U.recentUpsert(null, e(1)), [e(1)]);
  assert.deepEqual(U.recentClean([e(1), null, 'x', { n: 'no hash' }, { ...e(2), hash: 'v=1&q=2' }, { ...e(3), total: 'x' }, { ...e(4), n: 5 }, { n: '長', total: 1, hash: '#b=mid' }]),
    [e(1), { n: '長', d: '', total: 1, hash: '#b=mid', at: '' }]);
  assert.equal(U.recentClean('nope').length, 0);
});

// ---- QR Code ----
const qrRows = q => Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => q.modules[y * q.size + x]).join(''));
test('qrMatrix：已知答案 (版本 5、糾錯 M、遮罩 3，與 python-qrcode 逐格相同)', () => {
  const q = U.qrMatrix('https://pc.jakeuj.com/#v=1&q=2eJyLjgQAAXwA-Q7yK9vsU3ZJ9mmz0f_f2XlvBj8nz00UYsEkIj9m', { ecl: 'M', mask: 3 });
  assert.equal(q.version, 5); assert.equal(q.size, 37);
  const bits = Array.from(q.modules).join('');
  const hex = 'fedbe923fc156718106e81c05ebb758380d5dba01463aec104df2107faaaaaafe01ccd1500b73f6e2258421bf2608ed4a05b7891652380c5f935847b960e4a5fe73d794a82989992b0b302ac7791f14f60dda0daad12bee6699bc355a1a013539a8af665e42f69a91f3c0db5177d5ed7484bf7b180b215eddff40481f552d70d6283b75ec5ff007d26a457fba781aab0580b3710ba1cdf8fc5d5d493f7eebfb2d3b104f562e7cfeca08f0b8';
  const expect = [...hex].map(h => parseInt(h, 16).toString(2).padStart(4, '0')).join('').slice(0, bits.length);
  assert.equal(bits, expect);
});

test('qrMatrix：版本依長度自動選最小、定位與對齊圖形、遮罩自動選 0–7、放不下丟錯', () => {
  assert.equal(U.qrMatrix('a', { ecl: 'M' }).version, 1);
  assert.equal(U.qrMatrix('a'.repeat(14), { ecl: 'M' }).version, 1);    // v1-M 容量 14 bytes
  assert.equal(U.qrMatrix('a'.repeat(15), { ecl: 'M' }).version, 2);
  assert.equal(U.qrMatrix('a'.repeat(17), { ecl: 'L' }).version, 1);    // v1-L 容量 17 bytes
  assert.equal(U.qrMatrix('a'.repeat(2953), { ecl: 'L' }).version, 40);
  assert.throws(() => U.qrMatrix('a'.repeat(2954), { ecl: 'L' }), /放不下/);
  for (const [text, ecl] of [['原價屋', 'M'], ['x'.repeat(500), 'L'], ['y'.repeat(1300), 'L']]) {
    const q = U.qrMatrix(text, { ecl }), rows = qrRows(q);
    assert.ok(q.mask >= 0 && q.mask <= 7);
    assert.equal(q.size, q.version * 4 + 17);
    // 三個定位圖形 7×7 + 分隔白邊；第 6 行 / 列是黑白相間的校正線
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    for (const [ox, oy] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) for (let i = 0; i < 7; i++) assert.equal(rows[oy + i].slice(ox, ox + 7), finder[i]);
    assert.equal(rows[7].slice(0, 8), '00000000');
    for (let i = 8; i < q.size - 8; i++) { assert.equal(rows[6][i], String((i + 1) % 2)); assert.equal(rows[i][6], String((i + 1) % 2)); }
    assert.equal(rows[q.size - 8][8], '1');   // 固定黑點
    const dark = Array.from(q.modules).reduce((a, b) => a + b, 0) / (q.size * q.size);
    assert.ok(dark > 0.35 && dark < 0.65, '黑白比例 ' + dark);
  }
  // 同內容同結果 (確定性)
  assert.deepEqual(qrRows(U.qrMatrix('abc', { ecl: 'M' })), qrRows(U.qrMatrix('abc', { ecl: 'M' })));
});

test('qrSvg：短網址用 M、長網址改 L (版本 > 20)、放不下回空字串', () => {
  const short = U.qrSvg('https://pc.jakeuj.com/#b=mid', 80);
  assert.match(short, /^<svg viewBox="0 0 (\d+) \1" width="80" height="80" role="img"/);
  assert.equal(+short.match(/viewBox="0 0 (\d+)/)[1], U.qrMatrix('https://pc.jakeuj.com/#b=mid', { ecl: 'M' }).size + 8);   // 4 格空白 ×2
  const long = U.qrSvg('https://pc.jakeuj.com/#v=1&q=2' + 'A'.repeat(1300));
  assert.equal(+long.match(/viewBox="0 0 (\d+)/)[1], U.qrMatrix('https://pc.jakeuj.com/#v=1&q=2' + 'A'.repeat(1300), { ecl: 'L' }).size + 8);
  assert.equal(U.qrSvg('A'.repeat(3000)), '');
  assert.ok(!/[<>&"]/.test(short.replace(/<[^>]+>/g, '').replace(/"/g, '')), 'path 只有數字與指令');
});
