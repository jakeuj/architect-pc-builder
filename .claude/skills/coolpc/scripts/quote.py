#!/usr/bin/env python3
"""依 build 定義檔 (JSON) 從 data/coolpc_prices.json 撈價格，輸出 Markdown 估價單。

用法: python3 quote.py [--data data/coolpc_prices.json] builds/low.json [builds/mid.json ...]

build 檔格式:
{
  "name": "低階",
  "note": "說明 (可省略)",
  "items": [
    {"cat": 4, "match": "R5 7500F MPK｝(含風扇)【6核/12緒】3.7G(↑5.0G)搭主機板省300", "qty": 1, "role": "CPU"},
    {"cat": 6, "id": 26, "match": "UMAX 16GB(雙通8GB*2) DDR5 5600", "role": "RAM"}
  ]
}
  cat   : 分類編號 (見 data/by_category/)
  match : 品名子字串, 需唯一命中 (或與某品名完全相等); 與 id 二選一, 兩者皆給時以 match 驗證 id
  id    : option value (重新下載後可能變動, 建議搭配 match)
  qty   : 數量, 預設 1
  role  : 顯示用角色名稱 (CPU/MB/RAM/...), 可省略
"""
import argparse
import json
import re
from pathlib import Path


def load(data_path):
    db = json.loads(Path(data_path).read_text(encoding="utf-8"))
    return db, {c["id"]: c for c in db["categories"]}


def find(cats, cat_id, match=None, iid=None):
    cat = cats[cat_id]
    items = [(g["label"], it) for g in cat["groups"] for it in g["items"]]
    if iid is not None:
        hit = [(g, it) for g, it in items if it["id"] == iid]
        if hit and (match is None or match in hit[0][1]["name"]):
            return hit[0]
    if match is None:
        raise SystemExit(f"[{cat_id}] id={iid} 找不到且無 match 可用")
    hit = [(g, it) for g, it in items if match in it["name"]]
    if len(hit) == 1:
        return hit[0]
    if not hit:
        raise SystemExit(f"[{cat_id} {cat['name']}] 找不到: {match}")
    exact = [(g, it) for g, it in hit if it["name"] == match]
    if len(exact) == 1:
        return exact[0]
    msg = "\n".join(f"  id={it['id']} ${it['price']} {it['name']}" for _, it in hit)
    raise SystemExit(f"[{cat_id} {cat['name']}] '{match}' 命中 {len(hit)} 筆, 請縮小範圍:\n{msg}")


def render(cats, build):
    total = 0
    bundle_off = 0
    lines = [f"## {build['name']}"]
    if build.get("note"):
        lines.append(f"> {build['note']}")
    lines += ["", "| 項目 | 品名 | 單價 | 數量 | 小計 | 備註 |", "|---|---|---:|---:|---:|---|"]
    for spec in build["items"]:
        _, it = find(cats, spec["cat"], spec.get("match"), spec.get("id"))
        qty = spec.get("qty", 1)
        sub = it["price"] * qty
        total += sub
        note = " ".join(it["flags"])
        for f in it["flags"]:
            if f.startswith("任搭折"):
                bundle_off += int(f[3:]) * qty
        if it.get("list_price"):
            note += f" (原價{it['list_price']})"
        role = spec.get("role") or cats[spec["cat"]]["name"]
        lines.append(f"| {role} | {it['name']} | {it['price']:,} | {qty} | {sub:,} | {note.strip()} |")
    lines.append(f"| **總計** | | | | **{total:,}** | |")
    if bundle_off:
        lines.append(f"| 任搭折扣 (估價頁未扣, 結帳時再減) | | | | -{bundle_off:,} | 實付約 {total - bundle_off:,} |")
    lines.append("")
    return "\n".join(lines), total


def short_name(name):
    """品名縮寫: 優先取 ｛｝ 內的型號, 否則取前 28 字。"""
    m = re.search(r"｛([^｝]+)｝", name)
    return (m.group(1) if m else name)[:40]


def summary(cats, builds):
    """多套配置並列比較表 (列 = role, 欄 = build)。"""
    cols = []
    for b in builds:
        rows, total, off = {}, 0, 0
        for spec in b["items"]:
            _, it = find(cats, spec["cat"], spec.get("match"), spec.get("id"))
            qty = spec.get("qty", 1)
            role = spec.get("role") or cats[spec["cat"]]["name"]
            cell = f"{short_name(it['name'])} {it['price'] * qty:,}" + (f" ×{qty}" if qty > 1 else "")
            rows[role] = (rows[role] + "<br>" + cell) if role in rows else cell
            total += it["price"] * qty
            off += sum(int(f[3:]) for f in it["flags"] if f.startswith("任搭折")) * qty
        cols.append((b["name"], rows, total, off))
    roles = []
    for _, rows, _, _ in cols:
        for r in rows:
            if r not in roles:
                roles.append(r)
    head = "| | " + " | ".join(f"{n}<br>**{t - o:,}**" for n, _, t, o in cols) + " |"
    lines = [head, "|---|" + "---|" * len(cols)]
    for r in roles:
        lines.append(f"| {r} | " + " | ".join(rows.get(r, "—") for _, rows, _, _ in cols) + " |")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/coolpc_prices.json")
    ap.add_argument("--summary", action="store_true", help="先輸出多套並列比較表 (總計已扣任搭折)")
    ap.add_argument("builds", nargs="+")
    a = ap.parse_args()
    db, cats = load(a.data)
    builds = [json.loads(Path(p).read_text(encoding="utf-8")) for p in a.builds]
    print(f"# 原價屋估價單 (報價日期 {db['quote_date']})\n")
    if a.summary:
        print(summary(cats, builds))
    for b in builds:
        md, _ = render(cats, b)
        print(md)
