#!/usr/bin/env python3
"""把 data/coolpc_prices.json + builds/*.json 整理成 docs/data.json 給 GitHub Pages 靜態頁使用。

只保留主機相關分類, 並剔除與組機無關的群組 (筆記型記憶體、散熱膏、線材...)。
用法: python3 scripts/build_site.py
"""
import datetime
import json
from zoneinfo import ZoneInfo
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "coolpc_prices.json"
OUT = ROOT / "docs" / "data.json"
REPO = "https://github.com/jakeuj/architect-pc-builder"
TAIPEI = ZoneInfo("Asia/Taipei")

# 估價頁欄位 -> 分類編號 (可多個, 例如散熱器同時放風冷與水冷)
SLOTS = [
    {"key": "cpu",    "label": "CPU",      "cats": [4]},
    {"key": "mb",     "label": "主機板",   "cats": [5]},
    {"key": "ram",    "label": "記憶體",   "cats": [6]},
    {"key": "ssd",    "label": "SSD",      "cats": [7]},
    {"key": "vga",    "label": "顯示卡",   "cats": [12]},
    {"key": "psu",    "label": "電源",     "cats": [15]},
    {"key": "case",   "label": "機殼",     "cats": [14]},
    {"key": "cooler", "label": "散熱器",   "cats": [10, 11], "optional": True},
    {"key": "hdd",    "label": "HDD",      "cats": [8],      "optional": True},
    {"key": "fan",    "label": "機殼風扇", "cats": [16],     "optional": True},
]
ROLE_TO_SLOT = {"CPU": "cpu", "MB": "mb", "RAM": "ram", "SSD": "ssd", "VGA": "vga",
                "PSU": "psu", "CASE": "case", "COOLER": "cooler", "HDD": "hdd", "FAN": "fan"}

# 各分類要剔除的群組 (regex, 比對群組名稱)
EXCLUDE_GROUPS = {
    6:  r"筆記型|伺服器|DDR3",
    7:  r"2230|2242",
    10: r"散熱膏|導熱片|SSD散熱片|散熱座",
    11: r"水冷液",
    12: r"周邊配件|工作站|專業級|GeForce 210|GT710|GT730|GT1030",
    14: r"工業機架|NAS",
    16: r"線材|燈條|延長排線|轉接支架|控制器|集線器",
}
EXCLUDE_ITEMS = r"限搭NAS|限搭購QNAP|套裝加購"

GAME = {
    "name": "締造者：放逐之境",
    "url": "https://architectgb.drimage.com/zh-tw/download",
    "min": {"CPU": "Intel Core i5-10400 / AMD Ryzen 5 3600", "GPU": "NVIDIA GeForce RTX 2060 / AMD Radeon RX 5600XT",
            "RAM": "16GB", "儲存": "30GB", "OS": "Windows 10 (64bit) / Windows 11", "API": "DirectX 12"},
    "rec": {"CPU": "Intel Core i7-11700 / AMD Ryzen 5 5600", "GPU": "NVIDIA GeForce RTX 3060 / AMD Radeon RX 6600XT",
            "RAM": "16GB", "儲存": "30GB", "OS": "Windows 10 (64bit) / Windows 11", "API": "DirectX 12"},
}

db = json.loads(SRC.read_text(encoding="utf-8"))
cats_all = {c["id"]: c for c in db["categories"]}
need = sorted({cid for s in SLOTS for cid in s["cats"]})

categories = {}
for cid in need:
    c = cats_all[cid]
    ex = re.compile(EXCLUDE_GROUPS[cid]) if cid in EXCLUDE_GROUPS else None
    groups = []
    for g in c["groups"]:
        if ex and ex.search(g["label"]):
            continue
        items = [it for it in g["items"] if not re.search(EXCLUDE_ITEMS, it["name"])]
        if items:
            groups.append({"label": g["label"], "items": items})
    categories[str(cid)] = {"id": cid, "name": c["name"], "groups": groups}


# 上一版 docs/data.json: 零件下架時用來查它原本所屬群組, 改選該群組最便宜的替代品
prev_group = {}
if OUT.exists():
    try:
        prev = json.loads(OUT.read_text(encoding="utf-8"))
        for c in prev["categories"].values():
            for g in c["groups"]:
                for it in g["items"]:
                    prev_group[(c["id"], it["name"])] = g["label"]
    except Exception:
        pass


def find(cid, match):
    """回傳 (item, fallback_note)。找不到時退回同群組最便宜的商品。"""
    groups = categories[str(cid)]["groups"]
    hits = [it for g in groups for it in g["items"] if match in it["name"]]
    exact = [it for it in hits if it["name"] == match]
    if len(hits) == 1 or len(exact) == 1:
        return (exact or hits)[0], None
    if len(hits) > 1:
        sys.exit(f"[{cid}] '{match}' 命中 {len(hits)} 筆 (需唯一)")
    label = next((lbl for (c, name), lbl in prev_group.items() if c == cid and match in name), None)
    pool = [it for g in groups if label is None or g["label"] == label for it in g["items"]]
    if not pool:
        sys.exit(f"[{cid}] '{match}' 找不到, 也無同群組替代品")
    alt = min(pool, key=lambda it: it["price"])
    print(f"  ! [{cid}] 找不到 '{match}', 改用同群組最便宜: {alt['name']} ${alt['price']}", file=sys.stderr)
    return alt, f"原設定「{match}」已下架，改為同群組最便宜品項"


builds = []
for key in ("low", "mid", "high"):
    b = json.loads((ROOT / "builds" / f"{key}.json").read_text(encoding="utf-8"))
    items = {}
    for spec in b["items"]:
        slot = ROLE_TO_SLOT[spec["role"]]
        it, note = find(spec["cat"], spec["match"])
        items[slot] = {"cat": spec["cat"], "id": it["id"], "name": it["name"], "qty": spec.get("qty", 1)}
        if note:
            items[slot]["fallback"] = note
    builds.append({"key": key, "name": b["name"], "note": b.get("note", ""), "items": items})

out = {
    "quote_date": db["quote_date"],
    "generated": datetime.datetime.now(TAIPEI).isoformat(timespec="minutes"),
    "source": "https://www.coolpc.com.tw/evaluate.php",
    "repo": REPO,
    "game": GAME,
    "slots": SLOTS,
    "categories": categories,
    "builds": builds,
}
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
n = sum(len(g["items"]) for c in categories.values() for g in c["groups"])
print(f"docs/data.json: 報價日期 {db['quote_date']}, {len(categories)} 分類 {n} 項, {OUT.stat().st_size/1024:.0f} KB")
for b in builds:
    print(f"  {b['key']}: {sum(1 for _ in b['items'])} 件")
