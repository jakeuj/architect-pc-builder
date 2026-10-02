// 原價屋估價頁 (evaluate.php) 的瀏覽器端解析器。
// 邏輯對應 .claude/skills/coolpc/scripts/parse_coolpc.py (解析) 與 build_site.py (只留主機相關分類、剔除無關群組)；
// 原價屋改版時兩邊要一起改。純函式、不碰 DOM，也能在 Node 跑 (node -e 'require("./docs/coolpc-live.js")')。
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

  root.CoolPC = { parse, select, decode };
})(typeof window !== 'undefined' ? window : globalThis);
