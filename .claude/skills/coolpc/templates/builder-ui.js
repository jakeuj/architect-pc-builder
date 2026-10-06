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

  const api = { PURPOSES, purposeOf, purposesFor, normalize, catalogEntries, searchEntries, selectCandidate, previewCandidate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuilderUI = api;
})(globalThis);
