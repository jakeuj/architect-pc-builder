#!/usr/bin/env python3
"""把 data/coolpc_prices.json + builds/*.json 整理成 docs/data.json, 給 GitHub Pages 靜態估價頁 (templates/index.html) 使用。

用法:
  python3 build_site.py --init            # 在專案內建立 site.json / docs/index.html / docs/.nojekyll / workflow (已存在的不覆寫)
  python3 build_site.py [--config site.json]

site.json 欄位:
  title   網頁標題 (h1 與 <title>)
  repo    GitHub repo 網址 (頁尾連結)
  game    {name, url, min:{CPU,GPU,RAM,儲存,OS,API}, rec:{...}}  遊戲官方需求
  builds  要放上網頁的 build 檔名 (不含 .json), 依序成為分頁; 預設 ["low","mid","high"]
  notes   網頁「說明」區額外要加的句子 (list, 可省略)
  slots   欄位定義 (可省略, 預設見 DEFAULT_SLOTS)

只保留主機相關分類, 並剔除與組機無關的群組 (筆記型記憶體、散熱膏、線材...)。
若 build 裡的零件已下架, 改選同群組最便宜的替代品並在 data.json 標 fallback (網頁會提示)。
"""
import argparse
import datetime
import json
import re
import shutil
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE.parent / "templates"
TAIPEI = ZoneInfo("Asia/Taipei")

# 估價頁欄位 -> 分類編號 (可多個, 例如散熱器同時放風冷與水冷)
DEFAULT_SLOTS = [
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
# builds/*.json 的 role -> slot key
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


def init(root: Path, force: bool):
    """從 templates/ 建立網站骨架。"""
    targets = {
        "site.json": TEMPLATES / "site.json",
        "docs/index.html": TEMPLATES / "index.html",
        ".github/workflows/update-prices.yml": TEMPLATES / "update-prices.yml",
    }
    for rel, src in targets.items():
        dst = root / rel
        if dst.exists() and not force:
            print(f"  略過 (已存在) {rel}")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        print(f"  建立 {rel}")
    (root / "docs" / ".nojekyll").touch()
    print("接著: 編輯 site.json, 準備 builds/*.json, 再跑 build_site.py")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="site.json")
    ap.add_argument("--data", default="data/coolpc_prices.json")
    ap.add_argument("--out", default="docs/data.json")
    ap.add_argument("--init", action="store_true", help="建立 site.json / docs / workflow 骨架")
    ap.add_argument("--force", action="store_true", help="--init 時覆寫既有檔案")
    a = ap.parse_args()
    root = Path.cwd()
    if a.init:
        init(root, a.force)
        return

    cfg_path = root / a.config
    if not cfg_path.exists():
        sys.exit(f"找不到 {a.config}, 先跑 build_site.py --init 建立範本")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    slots = cfg.get("slots") or DEFAULT_SLOTS
    build_keys = cfg.get("builds") or ["low", "mid", "high"]
    out_path = root / a.out

    db = json.loads((root / a.data).read_text(encoding="utf-8"))
    cats_all = {c["id"]: c for c in db["categories"]}
    need = sorted({cid for s in slots for cid in s["cats"]})

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

    # 上一版 data.json: 零件下架時用來查它原本所屬群組, 改選該群組最便宜的替代品
    prev_group = {}
    if out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
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
    for key in build_keys:
        b = json.loads((root / "builds" / f"{key}.json").read_text(encoding="utf-8"))
        items = {}
        for spec in b["items"]:
            slot = ROLE_TO_SLOT.get(spec["role"], spec["role"].lower())
            it, note = find(spec["cat"], spec["match"])
            items[slot] = {"cat": spec["cat"], "id": it["id"], "name": it["name"], "qty": spec.get("qty", 1)}
            if note:
                items[slot]["fallback"] = note
        builds.append({"key": key, "name": b["name"], "note": b.get("note", ""), "items": items})

    out = {
        "title": cfg.get("title", "PC 組裝估價"),
        "quote_date": db["quote_date"],
        "generated": datetime.datetime.now(TAIPEI).isoformat(timespec="minutes"),
        "source": "https://www.coolpc.com.tw/evaluate.php",
        "repo": cfg.get("repo", ""),
        "game": cfg.get("game"),
        "notes": cfg.get("notes", []),
        "slots": slots,
        "categories": categories,
        "builds": builds,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(g["items"]) for c in categories.values() for g in c["groups"])
    print(f"{a.out}: 報價日期 {db['quote_date']}, {len(categories)} 分類 {n} 項, {out_path.stat().st_size/1024:.0f} KB")
    for b in builds:
        print(f"  {b['key']}: {len(b['items'])} 件")


if __name__ == "__main__":
    main()
