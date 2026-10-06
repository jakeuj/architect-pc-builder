/* 純 UI 規則：搜尋與實際選件共用，預覽不修改估價單。 */
(function(root) {
  'use strict';
  const PURPOSES = [
    ['office', '文書'], ['entry', '入門遊戲'], ['mainstream', '主流遊戲'], ['high', '高階'], ['other', '其他配置'],
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
  const purposeOf = build => PURPOSES.some(([key]) => key !== 'other' && key === build.purpose) ? build.purpose : 'other';
  const purposesFor = builds => PURPOSES.filter(([key]) => builds.some(build => purposeOf(build) === key));

  function catalogEntries(categories) {
    return categories.flatMap(category => category.groups.flatMap((group, index) => group.items.map(item => ({
      cat: category.id, category: category.name.split('｜')[0], group: group.label,
      groupKey: category.id + ':' + index, item,
    }))));
  }

  function searchEntries(entries, { query = '', group = '', sort = 'source', limit = Infinity } = {}) {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    const matches = entries.filter(entry => (!group || entry.groupKey === group)
      && terms.every(term => normalize(entry.category + ' ' + entry.group + ' ' + entry.item.name).includes(term)));
    if (sort === 'price-asc' || sort === 'price-desc') {
      const direction = sort === 'price-asc' ? 1 : -1;
      // ECMAScript 的穩定排序保留同價商品的型錄順序。
      matches.sort((a, b) => direction * (a.item.price - b.item.price));
    }
    return { entries: matches.slice(0, limit), count: matches.length };
  }

  function chosenRow(original, cat, name, qty, extra) {
    return original && original.cat === cat && original.name === name
      ? { ...clone(original), qty }
      : { cat, name, qty, pin: null, ...(extra ? { x: true } : {}) };
  }

  function selectCandidate(state, picking, { cat, name }) {
    const selection = clone({ rows: state.rows, more: state.more });
    if (picking.slot) {
      const key = picking.slot;
      selection.rows[key] = chosenRow(state.orig.rows[key], cat, name, state.rows[key]?.qty || 1, false);
      return { selection };
    }
    const index = picking.index;
    const duplicate = state.more.findIndex((row, position) => position !== index && row.cat === cat && row.name === name);
    if (duplicate >= 0) {
      if (index != null) return { error: '其他商品裡已經有這件了' };
      const row = selection.more[duplicate];
      if (row.qty >= 9) return { selection, notice: '這件商品數量已達上限 9' };
      row.qty++;
      return { selection, notice: '已在清單中，數量 +1' };
    }
    const original = state.orig.more.find(row => row.cat === cat && row.name === name);
    const row = chosenRow(original, cat, name, index != null ? state.more[index].qty : 1, true);
    if (index != null) selection.more[index] = row;
    else selection.more.push(row);
    return { selection };
  }

  const rowsOf = state => [...Object.values(state.rows).filter(Boolean), ...state.more];
  function previewCandidate(state, picking, candidate, find, totals) {
    const result = selectCandidate(state, picking, candidate);
    if (result.error) return result;
    return { ...result, delta: totals(rowsOf(result.selection), find).quoted - totals(rowsOf(state), find).quoted };
  }

  // ---- 店家模式 ----
  // profile = 本機店家資料 {on, name, rep, tel, line, addr, tag}；tab.issuer = 分享連結帶來的店家
  // 同一家店：店名正規化後相同 (大小寫、全半形、空白不計)
  const storeKey = store => normalize(store && store.name).replace(/\s+/g, '');
  const sameStore = (a, b) => !!storeKey(a) && storeKey(a) === storeKey(b);
  const storeOn = profile => !!(profile && profile.on && storeKey(profile));
  // 自己的單：店家模式開著，而且這張單沒有店家或就是本店；別家店的單只能看，不能改成自己的報價再轉傳
  const owned = (profile, tab) => storeOn(profile) && (!tab.issuer || sameStore(tab.issuer, profile));
  const issuerFor = (profile, tab) => owned(profile, tab) ? profile : tab.issuer || null;

  // '52,900'、'$1,200'、全形數字 -> 整數；空白或看不懂回 null (負號給服務列的折抵用)
  function parseMoney(value) {
    const text = String(value ?? '').normalize('NFKC').replace(/[\s,$元]/g, '');
    if (!/^-?\d{1,9}$/.test(text)) return null;
    return Number(text) || 0;
  }

  // 複製給客戶的訊息：o = {store, biz (normBiz 後), totals (bizTotals), quoted, lines: [{label, name, qty, price}], url, until?}
  // hide (隱藏原價屋單價) 時不出現任何原價屋金額
  function storeMessage({ store, biz, totals, quoted, lines, url, until }) {
    const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('zh-Hant-TW');
    const b = biz || {}, hide = !!b.hide, out = [];
    out.push(`${b.cust ? b.cust + '您好，' : ''}這是「${store.name}」為您準備的電腦估價：`);
    for (const line of lines) out.push(`${line.label}：${line.name}${line.qty > 1 ? ' ×' + line.qty : ''}${hide ? '' : '  ' + money(line.price * line.qty)}`);
    out.push('');
    if (!hide) out.push(`原價屋合計 ${money(quoted)}`);
    if (totals.price != null) out.push(`本店價 ${money(totals.price)}` + (!hide && totals.save > 0 ? `（省 ${money(totals.save)}）` : ''));
    for (const [name, amount] of b.extras || []) out.push(`${name} ${amount ? money(amount) : '免費'}`);
    out.push(`本店合計 ${money(totals.final)}`);
    if (totals.stale) out.push('（零件或價格已變動，本店價請再與我們確認）');
    if (until) out.push(`報價有效至 ${until}`);
    out.push('', '估價單：' + url);
    const contact = [store.rep && '業務 ' + store.rep, store.tel && '電話 ' + store.tel, store.line && 'LINE ' + store.line].filter(Boolean);
    if (contact.length) out.push(contact.join('｜'));
    if (store.addr) out.push(store.name + '｜' + store.addr);
    return out.join('\n');
  }

  const api = { PURPOSES, purposeOf, purposesFor, normalize, catalogEntries, searchEntries, selectCandidate, previewCandidate,
    sameStore, storeOn, owned, issuerFor, parseMoney, storeMessage };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuilderUI = api;
})(globalThis);
