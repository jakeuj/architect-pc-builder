#!/usr/bin/env python3
"""把原價屋 evaluate.php 解析成結構化資料 (JSON / CSV / 分類 TSV)。

用法: python3 parse_coolpc.py [evaluate.php] [輸出目錄]
"""
import csv
import html
import json
import re
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "evaluate.php")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "data")
OUT.mkdir(exist_ok=True)

raw = SRC.read_text(encoding="utf-8", errors="replace")

# 報價日期
m = re.search(r"<font id=Mdy>([^<]+)", raw)
quote_date = m.group(1).strip() if m else ""

# 每個分類: <TD class=w>N<TD class=t>NAME</TD> ... <SELECT ... name=nN ...> ... </SELECT>
cat_re = re.compile(
    r"<TD class=w>(\d+)<TD class=t>([^<]*)<.*?<SELECT[^>]*name=n\1[^>]*>(.*?)</SELECT>",
    re.S,
)
opt_re = re.compile(r"<(OPTGROUP|OPTION)([^>]*)>([^<]*)", re.I)
price_re = re.compile(r",\s*\$(\d+)(?:↘\$(\d+))?\s*(.*)$")

categories = []
rows = []

for cid, cname, body in cat_re.findall(raw):
    cid = int(cid)
    cname = html.unescape(cname).strip()
    cat = {"id": cid, "name": cname, "groups": []}
    group = None
    for tag, attrs, text in opt_re.findall(body):
        text = html.unescape(text).strip()
        if tag.upper() == "OPTGROUP":
            lm = re.search(r"LABEL='([^']*)'", attrs, re.I)
            group = {"label": html.unescape(lm.group(1)) if lm else "", "items": []}
            cat["groups"].append(group)
            continue
        if "disabled" in attrs.lower():
            continue  # 說明列 / 促銷文字
        vm = re.search(r"value=(\d+)", attrs)
        vid = int(vm.group(1)) if vm else 0
        if vid == 0:
            continue  # 「共有商品 N 樣」統計列
        pm = price_re.search(text)
        if not pm:
            continue
        price = int(pm.group(1))
        sale = int(pm.group(2)) if pm.group(2) else None
        tail = pm.group(3)
        name = text[: pm.start()].strip()
        cm = re.search(r"class=(\w)", attrs)
        cls = cm.group(1) if cm else ""
        flags = []
        if cls in ("r", "b") or "熱賣" in tail:
            flags.append("熱賣")
        if cls in ("g", "b"):
            flags.append("價格異動")
        if sale is not None or "下殺" in name:
            flags.append("下殺")
        if "搭板" in name or "任搭" in name or "搭主機板" in name:
            flags.append("搭板專案")
        if "組裝價" in name:
            flags.append("組裝價")
        if "裝機價" in name:
            flags.append("裝機價")
        if "限搭機" in name:
            flags.append("限搭機")
        if "限組裝" in name:
            flags.append("限組裝")
        if "限購" in name:
            flags.append("限購")
        coin = re.search(r"酷幣(\d+)", tail)
        if coin:
            flags.append(f"酷幣{coin.group(1)}")
        bundle = re.search(r"任搭(\d+)", tail)
        if bundle:
            flags.append(f"任搭折{bundle.group(1)}")
        if "【訂】" in name or "訂購" in name:
            flags.append("訂購")
        item = {
            "id": vid,
            "name": name,
            "price": sale if sale is not None else price,
            "list_price": price if sale is not None else None,
            "flags": flags,
        }
        if group is None:
            group = {"label": "", "items": []}
            cat["groups"].append(group)
        group["items"].append(item)
        rows.append(
            {
                "cat_id": cid,
                "category": cname,
                "group": group["label"],
                "id": vid,
                "name": name,
                "price": item["price"],
                "list_price": item["list_price"] or "",
                "flags": " ".join(flags),
            }
        )
    categories.append(cat)

data = {"source": SRC.name, "quote_date": quote_date, "categories": categories}
(OUT / "coolpc_prices.json").write_text(
    json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
)

with (OUT / "coolpc_prices.csv").open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(rows)

# 分類 TSV (方便 grep / 閱讀): 每類一個檔
by_cat = OUT / "by_category"
by_cat.mkdir(exist_ok=True)
for cat in categories:
    safe = re.sub(r"[^\w]+", "_", cat["name"]).strip("_")
    lines = [f"# {cat['id']:02d} {cat['name']}  (報價日期 {quote_date})", "# price\tid\tflags\tname"]
    for g in cat["groups"]:
        if g["label"]:
            lines.append(f"\n## {g['label']}")
        for it in g["items"]:
            lp = f"(原{it['list_price']})" if it["list_price"] else ""
            lines.append(f"{it['price']}{lp}\t{it['id']}\t{' '.join(it['flags'])}\t{it['name']}")
    (by_cat / f"{cat['id']:02d}_{safe}.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")

print(f"報價日期: {quote_date}")
print(f"分類數: {len(categories)}, 商品數: {len(rows)}")
for cat in categories:
    n = sum(len(g["items"]) for g in cat["groups"])
    print(f"  {cat['id']:2d} {cat['name']:<28} {n:5d} 項, {len(cat['groups'])} 群組")
