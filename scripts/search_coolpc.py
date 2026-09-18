#!/usr/bin/env python3
"""在結構化報價資料中搜尋商品, 依價格排序。

用法: python3 search_coolpc.py [--data data/coolpc_prices.json] [-n 20] [-x 排除regex] CAT_ID REGEX
  CAT_ID  分類編號 (0 = 全部)
  REGEX   品名或群組名稱的 regex (不分大小寫)
範例: python3 search_coolpc.py 12 'RTX5060Ti-16GB'      # 群組名
      python3 search_coolpc.py 6 '16G.*DDR5' -x 筆記型
"""
import argparse
import json
import re
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--data", default="data/coolpc_prices.json")
ap.add_argument("-n", type=int, default=20)
ap.add_argument("-x", "--exclude", default=None)
ap.add_argument("-g", "--group-width", type=int, default=28, help="群組名顯示寬度 (0 = 不截短)")
ap.add_argument("cat", type=int)
ap.add_argument("regex")
a = ap.parse_args()

db = json.loads(Path(a.data).read_text(encoding="utf-8"))
pat = re.compile(a.regex, re.I)
exc = re.compile(a.exclude, re.I) if a.exclude else None
rows = []
for c in db["categories"]:
    if a.cat and c["id"] != a.cat:
        continue
    for g in c["groups"]:
        for it in g["items"]:
            if (pat.search(it["name"]) or pat.search(g["label"])) and not (exc and exc.search(it["name"])):
                label = g["label"] if not a.group_width else g["label"][: a.group_width]
                rows.append((it["price"], c["id"], it["id"], " ".join(it["flags"]), label, it["name"]))
rows.sort()
print(f"# 報價日期 {db['quote_date']}, 命中 {len(rows)} 筆, 顯示前 {min(a.n, len(rows))}")
print("price\tcat\tid\tflags\tgroup\tname")
for r in rows[: a.n]:
    print("\t".join(str(x) for x in r))
