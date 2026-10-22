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

  // ---- 相容性：內顯、電源瓦數、快照年齡 (純規則，不確定一律回 null 不提示) ----
  const modelOf = name => { const m = String(name || '').match(/｛([^｝]+)｝/); return m ? m[1].trim() : null; };
  // CPU 有沒有內顯：先看品名「無內顯／具內顯」，再看型號 (Intel F/KF、Xeon、Threadripper 無；AMD F 無、G 有、7000 以上有、AM4 非 G 無)
  function cpuGraphics(name, group) {
    const text = String(name || '');
    if (/無內顯/.test(text)) return false;
    if (/內顯/.test(text)) return true;
    const model = modelOf(text) || text;
    if (/Xeon|Threadripper|\bTR\b/i.test(model + ' ' + (group || ''))) return false;
    if (/Intel/i.test(model)) return /\d{3,5}K?F\b/.test(model) ? false : true;
    if (/AMD|Ryzen/i.test(model)) {
      if (/\d{4}F\b/.test(model)) return false;
      if (/\d{3,4}G\b|\d{3,4}GE?\b/.test(model)) return true;
      const series = model.match(/\b([3-9])\d{3}(?:X3D|X|GT)?\b/);
      if (series) return series[1] >= '7';
    }
    return null;
  }
  // 電源瓦數：品名裡的 750W / 1000W
  function psuWatts(name) {
    const m = String(name || '').match(/(\d{3,4})\s?W\b/i);
    return m ? Number(m[1]) : null;
  }
  // 顯示卡原廠建議電源 (NVIDIA「Required System Power」/ AMD「Minimum PSU Recommendation」，2026/10 查官方產品頁)
  // 比對原價屋分類 12 的群組標籤 (例「NVIDIA RTX5060Ti-8GB(GDDR7)」「AMD Radeon RX9070GRE-12G」)；不在表內不提示
  const VGA_PSU = [
    ['RTX5080', 850], ['RTX5070Ti', 750], ['RTX5070', 650], ['RTX5060Ti', 600], ['RTX5060', 550], ['RTX5050', 550],
    ['RTX3060', 550], ['RTX3050-6GB', 300], ['RTX3050', 550],
    ['RX9070XT', 750], ['RX9070GRE', 650], ['RX9070', 650], ['RX9060XT', 450],
    ['GT1030', 300], ['GT730', 300], ['GT710', 300],
  ];
  function vgaPower(group) {
    const key = String(group || '').replace(/\s+/g, '').toUpperCase();
    const hit = VGA_PSU.find(([model]) => key.includes(model.toUpperCase()));
    return hit ? { model: hit[0].replace(/-\d+GB$/, ''), watts: hit[1] } : null;
  }
  // 快照年齡 (小時)：generated 是 ISO 字串 (含 +08:00)；讀不出來回 null
  function snapshotAgeHours(generated, now = Date.now()) {
    const t = Date.parse(String(generated || ''));
    return Number.isFinite(t) ? Math.max(0, (now - t) / 36e5) : null;
  }

  // ---- 改單差異：分享單被改過後，跟分享時的內容 (orig) 逐格比 ----
  // orig / cur = {rows: {slot: row | null}, more: [row]}；row = {cat, name, qty, pin}；find(row).item = 現行型錄品項
  // 單價同 CoolPC.totals：鎖定的報價 (pin) 優先，否則用現價；查不到 (已下架且沒鎖價) 為 null、以 0 計
  // 回傳 {changed, added, removed, total: {from, to, delta}, count}
  //   changed = [{slot, cat, same, from, to, delta}]：from / to = {name, qty, price, sub}；same = 同一件 (只改數量或改用現價)
  //   added / removed = [{slot, cat, name, qty, price, sub}]；其他商品 slot 為 '+'、用分類 + 品名配對
  function diffQuote(orig, cur, find) {
    const priceOf = r => r.pin ? r.pin.price : (find(r).item || {}).price ?? null;
    const snap = r => { const price = priceOf(r); return { name: r.name, qty: r.qty, price, sub: (price || 0) * r.qty }; };
    const key = r => r.cat + '|' + r.name;
    const changed = [], added = [], removed = [];
    let from = 0, to = 0;
    const compare = (slot, a, b) => {
      const A = a && snap(a), B = b && snap(b);
      if (A) from += A.sub;
      if (B) to += B.sub;
      if (!a && !b) return;
      if (!a) return added.push({ slot, cat: b.cat, ...B });
      if (!b) return removed.push({ slot, cat: a.cat, ...A });
      const same = key(a) === key(b);
      if (same && A.qty === B.qty && A.price === B.price) return;
      changed.push({ slot, cat: b.cat, same, from: A, to: B, delta: B.sub - A.sub });
    };
    for (const slot of new Set([...Object.keys(cur.rows), ...Object.keys(orig.rows)])) compare(slot, orig.rows[slot] || null, cur.rows[slot] || null);
    const rest = cur.more.slice();
    for (const a of orig.more) { const i = rest.findIndex(b => key(b) === key(a)); compare('+', a, i < 0 ? null : rest.splice(i, 1)[0]); }
    for (const b of rest) compare('+', null, b);
    return { changed, added, removed, total: { from, to, delta: to - from }, count: changed.length + added.length + removed.length };
  }

  // ---- 價格歷史 (docs/history.json：{"分類 id|型號": [[YYYY-MM-DD, price]…]}，只在價格變動時加一筆、同型號取最低價) ----
  const historyKey = (cat, name) => { const m = modelOf(name); return m ? cat + '|' + m : null; };
  // 原價屋報價日期 '2026/9/18 14:19' -> '2026-09-18'
  const isoOfQD = qd => { const m = String(qd || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
  const dayOf = iso => { const t = Date.parse(String(iso) + 'T00:00:00Z'); return Number.isFinite(t) ? Math.floor(t / 864e5) : NaN; };
  // 近 days 天的統計：series 依日期遞增；today = 'YYYY-MM-DD' (報價日期)。視窗起點承接之前的最後一筆 (價格一直維持到下次變動)
  // 回傳 {min, max, last, flat, changes (視窗內變動次數), days, points: [[x 0..days, price]]} 或 null (沒資料 / 全在未來)
  function historyStats(series, today, days = 30) {
    const end = dayOf(today);
    if (!Array.isArray(series) || !series.length || !Number.isFinite(end)) return null;
    const start = end - days, points = [];
    let carry = null, changes = 0;
    for (const e of series) {
      if (!Array.isArray(e)) continue;
      const x = dayOf(e[0]) - start, p = e[1];
      if (!Number.isFinite(x) || x > days || typeof p !== 'number') continue;
      if (x <= 0) { carry = p; continue; }
      if (!points.length && carry != null) points.push([0, carry]);
      points.push([x, p]); changes++;
    }
    if (!points.length) { if (carry == null) return null; points.push([0, carry]); }
    const last = points[points.length - 1][1];
    if (points[points.length - 1][0] < days) points.push([days, last]);
    const prices = points.map(pt => pt[1]), min = Math.min(...prices), max = Math.max(...prices);
    return { min, max, last, flat: min === max, changes, days, points };
  }
  // 迷你階梯折線 (inline SVG，線條用 currentColor)；沒資料或價格沒變回 ''
  function sparkline(stats, w = 64, h = 18) {
    if (!stats || stats.flat) return '';
    const sx = x => (1 + x / stats.days * (w - 2)).toFixed(1);
    const sy = p => (h - 1 - (p - stats.min) / (stats.max - stats.min) * (h - 2)).toFixed(1);
    const d = stats.points.map(([x, p], i) => !i ? `M${sx(x)},${sy(p)}` : `H${sx(x)}` + (p === stats.points[i - 1][1] ? '' : `V${sy(p)}`)).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  const api = { PURPOSES, purposeOf, purposesFor, normalize, catalogEntries, searchEntries, selectCandidate, previewCandidate,
    sameStore, storeOn, owned, issuerFor, parseMoney, storeMessage,
    cpuGraphics, psuWatts, VGA_PSU, vgaPower, snapshotAgeHours, diffQuote,
    historyKey, isoOfQD, historyStats, sparkline };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuilderUI = api;
})(globalThis);
