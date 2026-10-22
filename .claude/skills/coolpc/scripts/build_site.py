#!/usr/bin/env python3
"""把 data/coolpc_prices.json + builds/*.json 整理成 docs/data.json (+ docs/data-more.json), 給 GitHub Pages 靜態估價頁 (templates/index.html) 使用。

用法:
  python3 build_site.py --init            # 複製技能到目標專案 .claude/skills/coolpc/, 並建立 site.json / docs/index.html / docs/builder.css / docs/coolpc-live.js / docs/builder-ui.js / worker/ / docs/.nojekyll / workflow (已存在的不覆寫)
  python3 build_site.py [--config site.json]
  python3 build_site.py --backfill-history   # 從 git 歷史 (data/coolpc_prices.json 每次提交) 回填 docs/history.json, 一次性

site.json 欄位:
  title   網頁標題 (h1 與 <title>)
  subtitle 標題下的一句介紹 (可省略)
  repo    GitHub repo 網址 (頁尾連結)
  game    {name, url, min:{CPU,GPU,RAM,儲存,OS,API}, rec:{...}}  遊戲官方需求 (可省略; 遊戲專屬網站才填, 沒有就不顯示需求區塊)
  builds  要放上網頁的 build 檔名 (不含 .json), 依序產生配置（同用途內維持此順序）; 預設 ["low","mid","high"]
  notes   網頁「說明」區額外要加的句子 (list, 可省略)
  slots   欄位定義 (可省略, 預設見 DEFAULT_SLOTS)
  live_url 即時報價代理網址 (可省略; 見 templates/worker/), 有給的話網頁載入時與按「更新最新報價」會直接抓原價屋現價
  all_categories 網頁是否提供「全部分類」開關 (預設 true); false = 純主機估價站, 不產生 data-more.json

data.json 只保留主機相關分類, 並剔除與組機無關的群組 (筆記型記憶體、散熱膏、線材...)。
其餘分類與被剔除的群組 / 品項 (補集) 另存 data-more.json, 網頁切到「全部分類」加購其他商品時才載入。
docs/history.json 是主機型錄每個型號的價格變動紀錄 (key = "分類 id|型號" 或條件價件的 "分類 id|型號|條件碼", value = [[YYYY-MM-DD, price], ...]),
網頁顯示近 30 天最低 / 最高與走勢;
只在價格變動時追加、保留 HISTORY_DAYS 天, 內容沒變時輸出逐位元相同 (排程靠 git diff 判斷要不要提交)。
build 裡的零件對不到 (下架或命中多筆) 時, 沿用上一版 docs/data.json 對到的品名與價格並標 gone,
網頁顯示「已下架」讓訪客自行改選; 不自動換品項, 也不讓排程失敗。只有上一版也沒有 (新寫的 build 打錯) 才報錯。
"""
import argparse
import datetime
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from coolpc_match import resolve

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
    {"key": "cooler", "label": "散熱器",   "cats": [10, 11]},
    {"key": "hdd",    "label": "HDD",      "cats": [8]},
    {"key": "fan",    "label": "機殼風扇", "cats": [16]},
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
# 價格歷史保留天數 (網頁只看 30 天; 主機型錄約 2,700 個型號, 90 天估 200KB 內)
HISTORY_DAYS = 90
MODEL_RE = re.compile(r"｛([^｝]+)｝")
# 影響價格的條件 (與 coolpc-live.js 的 COND_RE / parse_coolpc.py 的標記一致): 搭板專案、組裝價、裝機價、限搭機、限組裝
# 同型號的條件價件 (搭板價、組裝價…) 跟一般件是不同的價格, 歷史要分開記, 否則一般件的「30 天最低」會是搭板價
COND_RE = [re.compile(r"搭板|任搭|搭主機板"), re.compile(r"組裝價"), re.compile(r"裝機價"), re.compile(r"限搭機"), re.compile(r"限組裝")]
NO_COND = "00000"


def cond_code(name):
    """品名 -> 五位 0/1 條件碼 (順序同 COND_RE); 沒有任何條件是 NO_COND。"""
    return "".join("1" if re.search(r, name) else "0" for r in COND_RE)


def history_key(cid, name):
    """品名 -> 歷史的 key「分類 id|型號」, 條件價件加上「|條件碼」; 沒有 ｛型號｝ 回 None。同 builder-ui.js historyKey。"""
    m = MODEL_RE.search(name)
    if not m:
        return None
    code = cond_code(name)
    return f"{cid}|{m[1].strip()}" + ("" if code == NO_COND else f"|{code}")


def split_catalog(db, slots):
    """coolpc_prices.json -> (主機型錄, 補集)。主機型錄 = slots 用到的分類, 剔除 EXCLUDE_GROUPS / EXCLUDE_ITEMS;
    補集 = 其他分類整類 + 被剔除的群組 / 品項 (收成同名群組)。兩者都是網頁用的 {"<cat_id>": {id, name, groups}}。"""
    need = sorted({cid for s in slots for cid in s["cats"]})
    categories, rest = {}, {}
    for c in db["categories"]:
        cid = c["id"]
        if cid not in need:
            rest[str(cid)] = {"id": cid, "name": c["name"], "groups": c["groups"]}
            continue
        ex = re.compile(EXCLUDE_GROUPS[cid]) if cid in EXCLUDE_GROUPS else None
        groups, hidden = [], []
        for g in c["groups"]:
            if ex and ex.search(g["label"]):
                hidden.append(g)
                continue
            items = [it for it in g["items"] if not re.search(EXCLUDE_ITEMS, it["name"])]
            if items:
                groups.append({"label": g["label"], "items": items})
            if len(items) < len(g["items"]):
                hidden.append({"label": g["label"], "items": [it for it in g["items"] if re.search(EXCLUDE_ITEMS, it["name"])]})
        categories[str(cid)] = {"id": cid, "name": c["name"], "groups": groups}
        if hidden:
            rest[str(cid)] = {"id": cid, "name": c["name"], "groups": hidden}
    return categories, rest


def iso_date(quote_date):
    """原價屋報價日期 '2026/9/18 14:19' -> '2026-09-18'; 看不懂回 None。"""
    m = re.match(r"(\d{4})/(\d{1,2})/(\d{1,2})", str(quote_date or ""))
    return f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}" if m else None


def model_prices(categories):
    """主機型錄 -> {history_key: 價格}; 沒有 ｛型號｝ 的品項不記。
    一般件與條件價件 (搭板 / 組裝價…) 各自一個 key; 同一 key 內多件 (代理 / 平輸) 取最低價 (網頁標「同型號最低款」)。"""
    low = {}
    for c in categories.values():
        for g in c["groups"]:
            for it in g["items"]:
                k = history_key(c["id"], it["name"])
                if k is None:
                    continue
                low[k] = min(low.get(k, it["price"]), it["price"])
    return low


def valid_history(hist):
    """上一版 history.json 的形狀: {key: [[日期字串, 數字], …]} 全部合格才 True (壞檔就從頭記, 不能讓排程失敗)。"""
    if not isinstance(hist, dict):
        return False
    for k, v in hist.items():
        if not isinstance(k, str) or not isinstance(v, list) or not v:
            return False
        for e in v:
            if not (isinstance(e, list) and len(e) == 2 and isinstance(e[0], str) and isinstance(e[1], (int, float)) and not isinstance(e[1], bool)):
                return False
    return True


def update_history(hist, prices, date, keep=HISTORY_DAYS):
    """純函式: 把這次快照 (prices = model_prices(), date = iso_date()) 併進 history, 回傳新的 dict (不改輸入)。
    只在價格跟上一筆不同時追加; 同一天變動兩次只留最新 (改回原價就把那筆拿掉); 比最後一筆還舊的快照 (回填順序錯) 不寫。
    裁切: date 往前 keep 天的 cutoff 之前只留最後一筆 (走勢的起點); 這次快照沒有、最後一筆又早於 cutoff 的型號 (下架超過 keep 天) 整個拿掉。"""
    out = {k: [list(e) for e in v] for k, v in hist.items()}
    for k, p in prices.items():
        s = out.setdefault(k, [])
        if s and s[-1][1] == p:
            continue
        if s and s[-1][0] > date:
            continue
        if s and s[-1][0] == date:
            s[-1][1] = p
            if len(s) > 1 and s[-2][1] == p:
                s.pop()
        else:
            s.append([date, p])
    cutoff = (datetime.date.fromisoformat(date) - datetime.timedelta(days=keep)).isoformat()
    for k in list(out):
        s = out[k]
        i = 0
        while i + 1 < len(s) and s[i + 1][0] <= cutoff:
            i += 1
        del s[:i]
        if not s or (k not in prices and s[-1][0] < cutoff):
            del out[k]
    return out


def dump_history(hist):
    return json.dumps(dict(sorted(hist.items())), ensure_ascii=False, separators=(",", ":"))


def backfill_history(root, data_rel, slots, keep=HISTORY_DAYS):
    """從 git 歷史依時間順序讀每次 data/coolpc_prices.json, 累積成 history (一次性回填, 從頭重算)。
    淺 clone 讀不到歷史、或網站在 repo 子目錄 (git show 的路徑相對 repo 根目錄) 都要處理, 不能靜默只剩一次快照。"""
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=root, capture_output=True, text=True)
    if top.returncode:
        sys.exit("不在 git repo 裡, 無法回填")
    top = Path(top.stdout.strip()).resolve()
    git = lambda *args: subprocess.run(["git", *args], cwd=top, capture_output=True, text=True)   # pathspec 一律相對 repo 根目錄
    if git("rev-parse", "--is-shallow-repository").stdout.strip() == "true":
        sys.exit("這是淺 clone, git 歷史不完整; 先 git fetch --unshallow 再回填")
    rel = (Path(root) / data_rel).resolve().relative_to(top).as_posix()
    shas = git("log", "--reverse", "--format=%H", "--", rel).stdout.split()
    if not shas:
        sys.exit(f"git 歷史裡找不到 {rel} 的提交, 沒有可回填的快照")
    hist, n = {}, 0
    for sha in shas:
        blob = git("show", f"{sha}:{rel}")
        if blob.returncode:
            continue
        try:
            db = json.loads(blob.stdout)
            date = iso_date(db["quote_date"])
        except (ValueError, KeyError, TypeError):
            continue
        if not date:
            continue
        hist = update_history(hist, model_prices(split_catalog(db, slots)[0]), date, keep)
        n += 1
    print(f"  從 git 回填 {n} 次快照")
    return hist


def init(root: Path, force: bool):
    """把技能複製到目標專案 .claude/skills/coolpc/，再從 templates/ 建立網站骨架。"""
    skill_src = HERE.parent
    skill_dst = root / ".claude" / "skills" / "coolpc"
    if skill_src.resolve() != skill_dst.resolve():
        if skill_dst.exists() and not force:
            print("  略過 (已存在) .claude/skills/coolpc/")
        else:
            if skill_dst.exists():
                shutil.rmtree(skill_dst)
            shutil.copytree(skill_src, skill_dst, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
            print("  複製技能 -> .claude/skills/coolpc/")
    targets = {
        "site.json": TEMPLATES / "site.json",
        "docs/index.html": TEMPLATES / "index.html",
        "docs/builder.css": TEMPLATES / "builder.css",
        "docs/coolpc-live.js": TEMPLATES / "coolpc-live.js",
        "docs/builder-ui.js": TEMPLATES / "builder-ui.js",
        "worker/wrangler.toml": TEMPLATES / "worker" / "wrangler.toml",
        "worker/src/index.js": TEMPLATES / "worker" / "src" / "index.js",
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
    print("即時報價 (可選): 改 worker/wrangler.toml 的網域與 ALLOW_ORIGINS, cd worker && npx wrangler deploy, 再把網址填進 site.json 的 live_url")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="site.json")
    ap.add_argument("--data", default="data/coolpc_prices.json")
    ap.add_argument("--out", default="docs/data.json")
    ap.add_argument("--init", action="store_true", help="建立 site.json / docs / workflow 骨架")
    ap.add_argument("--force", action="store_true", help="--init 時覆寫既有檔案")
    ap.add_argument("--backfill-history", action="store_true", help="從 git 歷史回填 docs/history.json 後再照常產出")
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
    more_path = out_path.with_name("data-more.json")
    hist_path = out_path.with_name("history.json")

    db = json.loads((root / a.data).read_text(encoding="utf-8"))
    cats_all = {c["id"]: c for c in db["categories"]}
    need = sorted({cid for s in slots for cid in s["cats"]})
    all_cats = cfg.get("all_categories", True)

    # categories = 主機分類 (剔除無關群組 / 品項); rest = 補集 (其他分類整類 + 被剔除的群組 / 品項)
    categories, rest = split_catalog(db, slots)
    missing = [cid for cid in need if cid not in cats_all]
    if missing:
        sys.exit(f"報價資料缺少分類 {missing}")

    # 上一版 data.json: 零件對不到時沿用上次的品名 / 價格 / 報價日期
    prev, prev_rows = None, {}
    if out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
            prev_price = {(c["id"], it["name"]): it["price"]
                          for c in prev["categories"].values() for g in c["groups"] for it in g["items"]}
            for b in prev["builds"]:
                for slot, it in b["items"].items():
                    price = it.get("price", prev_price.get((it["cat"], it["name"])))  # 舊格式沒有 price
                    if price is not None:
                        prev_rows[(b["key"], slot)] = {"cat": it["cat"], "name": it["name"], "price": price,
                                                       "d": it.get("d", prev["quote_date"])}
        except Exception as e:
            print(f"  ! 讀不到上一版 {a.out}: {e}", file=sys.stderr)

    builds = []
    for key in build_keys:
        b = json.loads((root / "builds" / f"{key}.json").read_text(encoding="utf-8"))
        items = {}
        for spec in b["items"]:
            slot = ROLE_TO_SLOT.get(spec["role"], spec["role"].lower())
            cid, match, qty = spec["cat"], spec["match"], spec.get("qty", 1)
            pr = prev_rows.get((key, slot))
            if pr and (pr["cat"] != cid or match not in pr["name"]):
                pr = None  # build 檔改過這一列, 上一版的不算數
            pool = [it for g in categories[str(cid)]["groups"] for it in g["items"]]
            it, status, cands = resolve(pool, match, pr and pr["name"])
            if it:
                # id 只為相容快取中的舊版網頁 (約 10 分鐘), 新版網頁只用 name
                items[slot] = {"cat": cid, "id": it["id"], "name": it["name"], "price": it["price"], "qty": qty}
            elif pr:
                print(f"::warning::{key}/{slot} [{cid}] '{match}' {'找不到' if status == 'missing' else f'命中 {len(cands)} 筆'}, "
                      f"沿用上一版 {pr['name']} ${pr['price']} ({pr['d']}) 並標示已下架", file=sys.stderr)
                items[slot] = {"cat": cid, "name": pr["name"], "price": pr["price"], "qty": qty, "d": pr["d"], "gone": True}
            else:
                lst = "".join(f"\n    ${c['price']} {c['name']}" for c in cands)
                sys.exit(f"{key}/{slot} [{cid}] '{match}' " + ("找不到" if status == "missing" else f"命中 {len(cands)} 筆 (需唯一):{lst}"))
        builds.append({"key": key, "name": b["name"], "note": b.get("note", ""), "items": items,
                       **{field: b[field] for field in ("purpose", "platform") if b.get(field)}})

    out = {
        "title": cfg.get("title", "PC 組裝估價"),
        "subtitle": cfg.get("subtitle", ""),
        "quote_date": db["quote_date"],
        "generated": datetime.datetime.now(TAIPEI).isoformat(timespec="minutes"),
        "source": "https://www.coolpc.com.tw/evaluate.php",
        "repo": cfg.get("repo", ""),
        "game": cfg.get("game"),
        "notes": cfg.get("notes", []),
        "slots": slots,
        "live_url": cfg.get("live_url", ""),
        "filters": {"exclude_groups": {str(k): v for k, v in EXCLUDE_GROUPS.items()}, "exclude_items": EXCLUDE_ITEMS},
        # 「全部分類」: 分類清單供分享連結驗證與選件面板使用, 品項 (補集) 在 url, 需要時才載入
        "more": {"url": more_path.name, "cats": [{"id": c["id"], "name": c["name"]} for c in db["categories"]]} if all_cats else None,
        "categories": categories,
        "builds": builds,
    }
    # 內容沒變就沿用上次的 generated, 讓排程能直接用 git diff 判斷要不要提交
    if prev and {**prev, "generated": None} == {**out, "generated": None}:
        out["generated"] = prev["generated"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(g["items"]) for c in categories.values() for g in c["groups"])
    print(f"{a.out}: 報價日期 {db['quote_date']}, {len(categories)} 分類 {n} 項, {out_path.stat().st_size/1024:.0f} KB")
    if all_cats:
        more_path.write_text(json.dumps({"quote_date": db["quote_date"], "categories": rest},
                                        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        m = sum(len(g["items"]) for c in rest.values() for g in c["groups"])
        print(f"{Path(a.out).with_name(more_path.name)}: 其他分類與剔除群組 {len(rest)} 分類 {m} 項, {more_path.stat().st_size/1024:.0f} KB")
    for b in builds:
        gone = sum(1 for it in b["items"].values() if it.get("gone"))
        print(f"  {b['key']}: {len(b['items'])} 件" + (f" ({gone} 件已下架)" if gone else ""))

    # 價格歷史: 讀上一版 (壞掉就從頭記), 併入這次快照; 內容沒變就不重寫。這段不能讓每小時排程失敗 (data.json 要照常更新)
    prev_hist = {}
    if hist_path.exists():
        try:
            prev_hist = json.loads(hist_path.read_text(encoding="utf-8"))
            if not valid_history(prev_hist):
                raise ValueError("格式不對 (應為 {key: [[日期, 價格], …]})")
        except Exception as e:
            print(f"  ! 讀不到上一版 {hist_path.name}, 重新開始記錄: {e}", file=sys.stderr)
            prev_hist = {}
    hist = prev_hist
    if a.backfill_history:
        hist = backfill_history(root, a.data, slots)
        dates = lambda h: {e[0] for v in h.values() for e in v}
        if len(dates(hist)) < len(dates(prev_hist)):
            print(f"::warning::回填只涵蓋 {len(dates(hist))} 個日期, 比既有的 {len(dates(prev_hist))} 個少 (git 歷史不完整?), 仍以回填結果覆寫", file=sys.stderr)
    date = iso_date(db["quote_date"])
    if date:
        try:
            hist = update_history(hist, model_prices(categories), date)
        except Exception as e:
            print(f"  ! 價格歷史併入失敗, 重新開始記錄: {e}", file=sys.stderr)
            hist = update_history({}, model_prices(categories), date)
        text = dump_history(hist)
        if not hist_path.exists() or hist_path.read_text(encoding="utf-8") != text:
            hist_path.write_text(text, encoding="utf-8")
        changed = sum(1 for v in hist.values() if len(v) > 1)
        print(f"{Path(a.out).with_name(hist_path.name)}: {len(hist)} 個型號, {changed} 個有變動, {hist_path.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
