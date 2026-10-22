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

  // ---- 價格歷史 (docs/history.json：{key: [[YYYY-MM-DD, price]…]}，只在價格變動時加一筆) ----
  // key = 「分類 id|型號」，條件價件 (搭板 / 組裝價 / 裝機價 / 限搭機 / 限組裝，同 coolpc-live.js COND_RE) 加「|條件碼」另記，
  // 一般件的歷史才不會是搭板價；同一 key 內多件 (代理 / 平輸) 取最低價，網頁標「同型號最低款」。同 build_site.py history_key
  const COND_RE = [/搭板|任搭|搭主機板/, /組裝價/, /裝機價/, /限搭機/, /限組裝/];
  const condCode = name => COND_RE.map(re => re.test(String(name || '')) ? 1 : 0).join('');
  const historyKey = (cat, name) => { const m = modelOf(name); if (!m) return null; const c = condCode(name); return cat + '|' + m + (c === '00000' ? '' : '|' + c); };
  // 原價屋報價日期 '2026/9/18 14:19' -> '2026-09-18'
  const isoOfQD = qd => { const m = String(qd || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
  const dayOf = iso => { const t = Date.parse(String(iso) + 'T00:00:00Z'); return Number.isFinite(t) ? Math.floor(t / 864e5) : NaN; };
  // 近 days 天的統計：series 依日期遞增；today = 'YYYY-MM-DD' (報價日期)。視窗起點承接之前的最後一筆 (價格一直維持到下次變動)
  // 回傳 {min, max, last, flat, changes (視窗內變動次數), days, since (紀錄涵蓋的天數：視窗內才上架的型號 < days), points: [[x 0..days, price]]}
  // 或 null (沒資料 / 全在未來)
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
    return { min, max, last, flat: min === max, changes, days, since: days - points[0][0], points };
  }
  // 迷你階梯折線 (inline SVG，線條用 currentColor)；沒資料或價格沒變回 ''
  function sparkline(stats, w = 64, h = 18) {
    if (!stats || stats.flat) return '';
    const sx = x => (1 + x / stats.days * (w - 2)).toFixed(1);
    const sy = p => (h - 1 - (p - stats.min) / (stats.max - stats.min) * (h - 2)).toFixed(1);
    const d = stats.points.map(([x, p], i) => !i ? `M${sx(x)},${sy(p)}` : `H${sx(x)}` + (p === stats.points[i - 1][1] ? '' : `V${sy(p)}`)).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  // ---- 最近開過的估價單 (localStorage)：list = [{n 名稱, d 報價日期, total 合計, hash '#v=1&q=…', at 'YYYY-MM-DD'}]，新的在前、同 hash 只留一筆 ----
  function recentUpsert(list, entry, max = 30) {
    const rest = (Array.isArray(list) ? list : []).filter(e => e && e.hash !== entry.hash);
    return [entry, ...rest].slice(0, max);
  }
  // 讀回來的資料逐筆驗證 (localStorage 可能被改過)，不合格的丟掉
  const recentClean = list => (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object' && typeof e.hash === 'string' && e.hash[0] === '#' && e.hash.length <= 40000
    && typeof e.n === 'string' && Number.isFinite(e.total)).map(e => ({ n: e.n.slice(0, 80), d: String(e.d || '').slice(0, 32), total: e.total, hash: e.hash, at: String(e.at || '').slice(0, 10) })).slice(0, 30);

  // ---- QR Code：byte 模式、版本 1–40、糾錯 L / M (ISO/IEC 18004；流程與表格同 Nayuki 的 QR Code generator) ----
  // 給唯讀估價單右上角 (店家給客人掃)，不引入套件。qrMatrix(text, {ecl, version?, mask?}) -> {size, modules (Uint8Array, 1 = 黑), version, mask}；放不下丟錯
  const QR_EC = {
    L: { bits: 1, ecc: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25] },
    M: { bits: 0, ecc: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
      blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49] },
  };
  const qrRawModules = v => { let n = (16 * v + 128) * v + 64; if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; } return n; };
  const qrDataCodewords = (v, ec) => Math.floor(qrRawModules(v) / 8) - ec.ecc[v - 1] * ec.blocks[v - 1];
  const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  function rsDivisor(deg) {
    const r = Array(deg).fill(0); r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gfMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = gfMul(root, 2); }
    return r;
  }
  function rsRemainder(data, div) {
    const r = Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }
  function qrAlignPos(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, size = v * 4 + 17, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    return pos;
  }
  const QR_MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
  // 懲罰分：同色連續 ≥5、2×2 同色、1:1:3:1:1 找尋圖形、黑白比例偏離 50%
  function qrPenalty(m, size) {
    let score = 0, dark = 0;
    const line = cells => {
      let s = 0, run = 0, prev = -1, str = '';
      for (const c of cells) { if (c === prev) run++; else { if (run >= 5) s += run - 2; run = 1; prev = c; } str += c; }
      if (run >= 5) s += run - 2;
      const pat = str.match(/10111010000|00001011101/g);
      return s + (pat ? pat.length * 40 : 0);
    };
    for (let y = 0; y < size; y++) {
      const row = [], col = [];
      for (let x = 0; x < size; x++) { row.push(m[y * size + x]); col.push(m[x * size + y]); dark += m[y * size + x]; }
      score += line(row) + line(col);
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y * size + x];
      if (c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) score += 3;
    }
    const total = size * size;
    return score + Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  }
  // byte 模式 n 個位元組在糾錯等級 ec 下最小的版本 (1–40)；放不下回 0
  const qrNeed = (v, n) => 4 + (v < 10 ? 8 : 16) + n * 8;
  function qrVersionFor(n, ec) {
    let v = 1;
    while (v <= 40 && qrNeed(v, n) > qrDataCodewords(v, ec) * 8) v++;
    return v <= 40 ? v : 0;
  }
  function qrMatrix(text, { ecl = 'M', version = 0, mask = null } = {}) {
    const bytes = new TextEncoder().encode(String(text)), ec = QR_EC[ecl] || QR_EC.M;
    const need = v => qrNeed(v, bytes.length);
    const v = version || qrVersionFor(bytes.length, ec);
    const cap = v ? qrDataCodewords(v, ec) * 8 : 0;
    if (!v || need(v) > cap) throw new Error('內容太長，QR Code 放不下');
    const size = v * 4 + 17;
    // 位元流：模式 0100、長度、資料、終止符、補到整 byte、交替填 0xEC / 0x11
    const bits = [], push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, v < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);
    push(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
    // 分塊、RS 糾錯、交錯
    const nb = ec.blocks[v - 1], el = ec.ecc[v - 1], raw = Math.floor(qrRawModules(v) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const n = shortLen - el + (i < nShort ? 0 : 1), dat = data.slice(k, k + n); k += n;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const cw = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) cw.push(b[i]); });
    // 功能圖形 (fn 標記不能放資料的格子)：定位、校正、對齊、格式與版本資訊
    const m = new Uint8Array(size * size), fn = new Uint8Array(size * size);
    const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { m[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; } };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (x, y) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x + dx, y + dy, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = qrAlignPos(v), last = ap.length - 1;
    ap.forEach((ay, i) => ap.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const format = mk => {
      const d = (ec.bits << 3) | mk; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => (b >>> i) & 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, 1);
    };
    format(0);
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const bit = (b >>> i) & 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
    }
    // 資料位元之字形填入 (從右下往上、兩欄一組，跳過第 6 欄的對齊線)
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y * size + x] && i < cw.length * 8) { m[y * size + x] = (cw[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
      }
    }
    // 遮罩：8 種都試，取懲罰分最低 (指定 mask 時直接用，測試對照用)
    const apply = mk => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && QR_MASKS[mk](x, y)) m[y * size + x] ^= 1; };
    let best = mask;
    if (best == null) {
      let bestScore = Infinity;
      for (let mk = 0; mk < 8; mk++) { apply(mk); format(mk); const sc = qrPenalty(m, size); if (sc < bestScore) { bestScore = sc; best = mk; } apply(mk); }
    }
    apply(best); format(best);
    return { size, modules: m, version: v, mask: best };
  }
  // 唯讀估價單用的 SVG 字串 (外圍留 4 格空白)。糾錯等級依長度決定、只算一次：放得進版本 20 的用 M，否則用 L (格子少一點、好掃，最多 2,953 bytes)；放不下回 ''
  // 實際分享連結多半是版本 21–27 (109–133 格含留白)，顯示尺寸要跟著格數放大：width/height = max(px, 格數×2) 讓每格至少 2 CSS px；
  // data-n = 含留白的格數，列印由 CSS 以每格 0.4mm 算 (固定 104px / 30mm 時每格不到 1px / 0.3mm，相機掃不到)
  function qrSvg(text, px = 104) {
    const len = new TextEncoder().encode(String(text)).length, vM = qrVersionFor(len, QR_EC.M);
    let q;
    try { q = qrMatrix(text, { ecl: vM && vM <= 20 ? 'M' : 'L' }); } catch (e) { return ''; }
    const n = q.size + 8, side = Math.max(px, n * 2);
    let d = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
      if (!q.modules[y * q.size + x]) continue;
      let w = 1; while (x + w < q.size && q.modules[y * q.size + x + w]) w++;
      d += `M${x + 4} ${y + 4}h${w}v1h-${w}z`; x += w - 1;
    }
    return `<svg viewBox="0 0 ${n} ${n}" width="${side}" height="${side}" data-n="${n}" role="img" aria-label="這張估價單連結的 QR Code" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const api = { PURPOSES, purposeOf, purposesFor, normalize, catalogEntries, searchEntries, selectCandidate, previewCandidate,
    sameStore, storeOn, owned, issuerFor, parseMoney, storeMessage,
    cpuGraphics, psuWatts, VGA_PSU, vgaPower, snapshotAgeHours, diffQuote,
    historyKey, isoOfQD, historyStats, sparkline, recentUpsert, recentClean, qrMatrix, qrVersionFor, qrSvg };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuilderUI = api;
})(globalThis);
