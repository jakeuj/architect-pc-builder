// 原價屋估價頁 (evaluate.php) 的瀏覽器端解析器。
// 邏輯對應 .claude/skills/coolpc/scripts/parse_coolpc.py (解析) 與 build_site.py (只留主機相關分類、剔除無關群組)；
// 原價屋改版時兩邊要一起改。後半段是估價單快照 (分享連結) 的品名對照與編解碼。
// 純函式、不碰 DOM，也能在 Node 跑 (node -e 'require("./docs/coolpc-live.js")'；測試見 tests/)。
(function (root) {
  const CAT_RE = /<TD class=w>(\d+)<TD class=t>([^<]*)<[\s\S]*?<SELECT[^>]*name=n\1[^>]*>([\s\S]*?)<\/SELECT>/g;
  const OPT_RE = /<(OPTGROUP|OPTION)([^>]*)>([^<]*)/gi;
  const PRICE_RE = /,\s*\$(\d+)(?:↘\$(\d+))?\s*([\s\S]*)$/;
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©' };

  function unescape(s) {
    return s.replace(/&(#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, _, hex, dec, name) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      const v = NAMED[name.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  // 解析整頁 -> { quote_date, categories: [{id, name, groups:[{label, items:[{id,name,price,list_price,flags}]}]}] }
  function parse(html) {
    const md = html.match(/<font id=Mdy>([^<]+)/);
    const quote_date = md ? md[1].trim() : '';
    const categories = [];
    CAT_RE.lastIndex = 0;
    let cm;
    while ((cm = CAT_RE.exec(html))) {
      const cat = { id: parseInt(cm[1], 10), name: unescape(cm[2]).trim(), groups: [] };
      let group = null;
      OPT_RE.lastIndex = 0;
      let om;
      while ((om = OPT_RE.exec(cm[3]))) {
        const tag = om[1].toUpperCase(), attrs = om[2], text = unescape(om[3]).trim();
        if (tag === 'OPTGROUP') {
          const lm = attrs.match(/LABEL='([^']*)'/i);
          group = { label: lm ? unescape(lm[1]) : '', items: [] };
          cat.groups.push(group);
          continue;
        }
        if (/disabled/i.test(attrs)) continue;             // 說明列 / 促銷文字
        const vm = attrs.match(/value=(\d+)/);
        const vid = vm ? parseInt(vm[1], 10) : 0;
        if (!vid) continue;                                 // 「共有商品 N 樣」統計列
        const pm = text.match(PRICE_RE);
        if (!pm) continue;
        const price = parseInt(pm[1], 10);
        const sale = pm[2] ? parseInt(pm[2], 10) : null;
        const tail = pm[3];
        const name = text.slice(0, pm.index).trim();
        const clm = attrs.match(/class=(\w)/);
        const cls = clm ? clm[1] : '';
        const flags = [];
        if (cls === 'r' || cls === 'b' || tail.includes('熱賣')) flags.push('熱賣');
        if (cls === 'g' || cls === 'b') flags.push('價格異動');
        if (sale !== null || name.includes('下殺')) flags.push('下殺');
        if (name.includes('搭板') || name.includes('任搭') || name.includes('搭主機板')) flags.push('搭板專案');
        if (name.includes('組裝價')) flags.push('組裝價');
        if (name.includes('裝機價')) flags.push('裝機價');
        if (name.includes('限搭機')) flags.push('限搭機');
        if (name.includes('限組裝')) flags.push('限組裝');
        if (name.includes('限購')) flags.push('限購');
        const coin = tail.match(/酷幣(\d+)/); if (coin) flags.push('酷幣' + coin[1]);
        const bundle = tail.match(/任搭(\d+)/); if (bundle) flags.push('任搭折' + bundle[1]);
        if (name.includes('【訂】') || name.includes('訂購')) flags.push('訂購');
        if (!group) { group = { label: '', items: [] }; cat.groups.push(group); }
        group.items.push({ id: vid, name, price: sale !== null ? sale : price, list_price: sale !== null ? price : null, flags });
      }
      categories.push(cat);
    }
    return { quote_date, categories };
  }

  // 依 data.json 的 slots / filters 整理成網頁用的 categories 物件 { "<cat_id>": {id, name, groups} }
  function select(parsed, slots, filters) {
    const need = [...new Set(slots.flatMap(s => s.cats))].sort((a, b) => a - b);
    const exg = (filters && filters.exclude_groups) || {};
    const exi = filters && filters.exclude_items ? new RegExp(filters.exclude_items) : null;
    const all = Object.fromEntries(parsed.categories.map(c => [c.id, c]));
    const out = {};
    for (const cid of need) {
      const c = all[cid];
      if (!c) throw new Error('即時資料缺少分類 ' + cid);
      const ex = exg[cid] ? new RegExp(exg[cid]) : null;
      const groups = [];
      for (const g of c.groups) {
        if (ex && ex.test(g.label)) continue;
        const items = exi ? g.items.filter(it => !exi.test(it.name)) : g.items;
        if (items.length) groups.push({ label: g.label, items });
      }
      out[String(cid)] = { id: cid, name: c.name, groups };
    }
    return out;
  }

  // 用 Big5 位元組解成字串 (瀏覽器的 TextDecoder 支援 big5；Response.text() 永遠當 UTF-8，不能用)
  function decode(buf) {
    return new TextDecoder('big5').decode(buf);
  }

  // ---- 估價單快照：品名對照、合計、分享連結編解碼 ----
  // option value 只是清單位置、每次抓價都會變，所以一律用「分類 + 品名」當鍵。
  const key = (cat, name) => cat + '|' + name;
  const modelOf = name => { const m = name.match(/｛([^｝]+)｝/); return m ? m[1].trim() : null; };
  // 影響價格條件的標記 (與 parse() 的判讀一致)；型號相同但條件不同 (搭板價 vs 零售) 不算同一件
  const COND_RE = [/搭板|任搭|搭主機板/, /組裝價/, /裝機價/, /限搭機/, /限組裝/];
  const cond = name => COND_RE.map(re => re.test(name) ? 1 : 0).join('');
  const NO_COND = '00000';
  const COND_LABEL = [m => m === '任搭' ? '任搭優惠' : '搭板優惠', () => '組裝價', () => '裝機價', () => '限搭機價', () => '限組裝價'];
  const condLabels = name => COND_RE.map((re, i) => { const m = name.match(re); return m ? COND_LABEL[i](m[0]) : null; }).filter(Boolean);

  // 同型號換了價格條件時的說明：「搭板優惠已結束」「改為任搭優惠」「裝機價已結束，現為任搭優惠」
  function condNote(oldName, newName) {
    const a = condLabels(oldName), b = condLabels(newName);
    const ended = a.filter(x => !b.includes(x)), added = b.filter(x => !a.includes(x));
    if (ended.length && added.length) return `${ended.join('、')}已結束，現為${added.join('、')}`;
    if (ended.length) return `${ended.join('、')}已結束`;
    if (added.length) return `改為${added.join('、')}`;
    return '價格條件有變';
  }

  // 型錄索引：byKey 同品名重複上架 (特價區 + 品牌群組) 取第一筆；byModel = 分類|｛型號｝ -> 各品名 (不分價格條件)，供品名小改或條件變了時退而求其次
  function indexCatalog(cats) {
    const byKey = new Map(), byModel = new Map();
    for (const c of Object.values(cats)) for (const g of c.groups) for (const it of g.items) {
      it.cat = c.id; it.group = g.label;
      const k = key(c.id, it.name);
      if (byKey.has(k)) continue;
      byKey.set(k, it);
      const m = modelOf(it.name); if (!m) continue;
      const mk = c.id + '|' + m;
      if (!byModel.has(mk)) byModel.set(mk, []);
      byModel.get(mk).push(it);
    }
    return { byKey, byModel };
  }

  // ｝後面的規格文字 (去空白)，同型號多件時用最長共同前綴挑最像的 (「代理盒」對到代理盒裝、不對到平輸盒裝)
  const specOf = name => { const i = name.indexOf('｝'); return i < 0 ? '' : name.slice(i + 1).replace(/\s/g, ''); };
  const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

  // 快照列 {cat, name} 對到現行型錄 -> {item, how, alts?}
  //   exact   品名完全相同
  //   model   品名小改：同｛型號｝、同價格條件且只有一件
  //   variant 同型號還在賣，但價格條件變了 (搭板優惠結束只剩原價、原價改成任搭優惠…)：優先對無條件的原價品項，多件時挑規格最像的
  //   null    下架；同型號有貨但挑不出唯一一件時另給 alts (候選)，讓介面提示去挑，不猜
  function reconcile(row, idx) {
    const hit = idx.byKey.get(key(row.cat, row.name));
    if (hit) return { item: hit, how: 'exact' };
    const m = modelOf(row.name);
    const all = m && idx.byModel.get(row.cat + '|' + m);
    if (!all) return { item: null, how: null };
    const cd = cond(row.name), same = all.filter(it => cond(it.name) === cd);
    if (same.length === 1) return { item: same[0], how: 'model' };
    if (same.length) return { item: null, how: null, alts: same };   // 同條件多件 (代理 / 平輸) 不猜
    const plain = all.filter(it => cond(it.name) === NO_COND), pool = plain.length ? plain : all;
    const spec = specOf(row.name), score = pool.map(it => lcp(spec, specOf(it.name))), best = Math.max(...score);
    const top = pool.filter((_, i) => score[i] === best);
    return top.length === 1 ? { item: top[0], how: 'variant' } : { item: null, how: null, alts: pool };
  }

  // rows: [{cat, name, qty, pin: null | {price, d}}]；pin = 鎖定的報價，null = 跟著現行型錄
  // quoted 估價單總計；current 以現價計 (已下架的查不到現價，仍以報價計)；diff = current - quoted，即對得到的列的漲跌
  function totals(rows, idx) {
    let quoted = 0, current = 0, off = 0, goneCount = 0;
    for (const r of rows) {
      const it = reconcile(r, idx).item;
      const q = r.pin ? r.pin.price : it ? it.price : 0;
      quoted += q * r.qty;
      if (!it) { goneCount++; current += q * r.qty; continue; }
      current += it.price * r.qty;
      for (const f of it.flags) if (f.startsWith('任搭折')) off += parseInt(f.slice(3), 10) * r.qty;
    }
    return { quoted, current, diff: current - quoted, off, goneCount };
  }

  // "2026/9/18 14:19" -> 可比較大小的數字 (字串直接比會把 9/18 排在 10/2 後面)
  function parseQD(s) {
    const m = String(s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    return m ? +m[1] * 1e8 + +m[2] * 1e6 + +m[3] * 1e4 + (+m[4] || 0) * 100 + (+m[5] || 0) : 0;
  }

  // 分享連結：'1' + base64url(UTF-8 JSON)。'1' 是格式版本 (日後要壓縮可用別的字首)
  // JSON = {d, n?, b?, r: [[slot, cat, name, price, qty?, d?]]}；d 取最多列共用的報價日期，同 d / qty=1 的尾欄省略
  function b64urlEncode(str) {
    let bin = ''; for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('連結含有非法字元');
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  // q = {n?, b?, rows: [{slot, cat, name, price, qty, d}]}
  function encodeQuote(q) {
    const cnt = {}; for (const r of q.rows) cnt[r.d] = (cnt[r.d] || 0) + 1;
    const d = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
    const o = { d };
    if (q.n) o.n = q.n;
    if (q.b) o.b = q.b;
    o.r = q.rows.map(r => {
      const a = [r.slot, r.cat, r.name, r.price, r.qty, r.d];
      if (a[5] === d) a.pop(); else return a;
      if (a[4] === 1) a.pop();
      return a;
    });
    return '1' + b64urlEncode(JSON.stringify(o));
  }

  // 解析分享連結；格式或內容不對就丟錯 (呼叫端退回預設配置)。slots 用來驗證欄位與分類。
  // 回傳 {d, n, b, rows: [{slot, cat, name, price, qty, d}], dropped}
  function decodeQuote(s, slots) {
    if (!s || s.length > 8000) throw new Error('連結長度不對');
    if (s[0] !== '1') throw new Error('不支援的連結版本');
    let o;
    try { o = JSON.parse(b64urlDecode(s.slice(1))); } catch (e) { throw new Error('連結不完整，可能在複製時被截斷'); }
    if (!o || !Array.isArray(o.r) || !o.r.length || o.r.length > 20) throw new Error('連結內容不完整');
    const str = (v, max) => typeof v === 'string' && v.length <= max ? v : '';
    const d = str(o.d, 32);
    const slotMap = Object.fromEntries(slots.map(x => [x.key, x]));
    const rows = [], seen = new Set();
    let dropped = 0;
    for (const a of o.r) {
      const ok = Array.isArray(a) && slotMap[a[0]] && !seen.has(a[0])
        && Number.isInteger(a[1]) && slotMap[a[0]].cats.includes(a[1])
        && typeof a[2] === 'string' && a[2].length > 0 && a[2].length <= 200
        && Number.isInteger(a[3]) && a[3] >= 0 && a[3] <= 1e7;
      if (!ok) { dropped++; continue; }
      seen.add(a[0]);
      const qty = Number.isInteger(a[4]) ? Math.max(1, Math.min(9, a[4])) : 1;
      rows.push({ slot: a[0], cat: a[1], name: a[2], price: a[3], qty, d: str(a[5], 32) || d });
    }
    if (!rows.length) throw new Error('連結裡沒有可用的品項');
    return { d, n: str(o.n, 60), b: str(o.b, 32), rows, dropped };
  }

  root.CoolPC = { parse, select, decode, key, modelOf, indexCatalog, reconcile, condNote, totals, parseQD, encodeQuote, decodeQuote };
})(typeof window !== 'undefined' ? window : globalThis);
