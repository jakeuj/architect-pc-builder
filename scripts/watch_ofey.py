#!/usr/bin/env python3
"""監看歐飛先生〈每月電腦組裝說明〉的「我建議的菜單」段落, 跟 data/ofey_menu.txt 比對; 順便列出預設配置的下架零件。

用法: python3 scripts/watch_ofey.py [--root DIR] [--html FILE] [--out-dir DIR]
  --root DIR     repo 根目錄 (預設: 本檔上一層); 讀寫 DIR/data/ofey_menu.txt, 讀 DIR/docs/data.json
  --html FILE    不連網, 改讀存好的文章 HTML (測試用)
  --out-dir DIR  Issue 內文 (ofey-issue.md / gone-issue.md) 寫到哪 (預設: $RUNNER_TEMP 或系統暫存目錄)

文章是同一篇每月原地改寫, 網址從部落格首頁側欄「每月組裝說明」的連結找, 找不到才用 FALLBACK_URL。
結果印到 stdout, 並寫進 $GITHUB_OUTPUT 給 watch-ofey.yml 用:
  changed    none | init | month (只有月份變) | menu (菜單變了) | error (抓不到或擷取失敗)
  month      文章標題裡的「YYYY年MM月」
  ofey_body  changed 為 menu / error 時的 Issue 內文檔
  gone       預設配置的下架零件數; gone_body 為其 Issue 內文檔
抓不到也以結束碼 0 結束, 交給 workflow 開 Issue, 不讓排程紅燈。只用標準函式庫。
"""
import argparse
import difflib
import html
import json
import os
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

HOME_URL = "https://ofeyhong.pixnet.net/blog"
FALLBACK_URL = "https://ofeyhong.pixnet.net/blog/posts/12224315583"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
START, END = "我建議的菜單", "記憶體配置"   # 「二、我建議的菜單」到「三、記憶體配置」之間
ROOT = Path(__file__).resolve().parents[1]


def get(url: str) -> tuple[str, str]:
    """回傳 (最後網址, 內文); pixnet 會把 /blog/post/N 轉到 /blog/posts/N。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


def find_article_url() -> str:
    try:
        _, src = get(HOME_URL)
    except OSError as e:
        print(f"::warning::部落格首頁抓取失敗 ({e}), 改用固定網址")
        return FALLBACK_URL
    m = re.search(r'href="([^"]+)"[^>]*>\s*(?:<span>\d+</span>)?\s*每月組裝說明', src)
    return html.unescape(m.group(1)) if m else FALLBACK_URL


def page_text(src: str) -> str:
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", src)
    return html.unescape(re.sub(r"<[^>]+>", "\n", s))


def extract_menu(src: str) -> str:
    """菜單段落整理成一行一項; 找不到標記回傳空字串。"""
    t = page_text(src)
    i = t.find(START)
    j = t.find(END, i + 1) if i >= 0 else -1
    if i < 0 or j < 0:
        return ""
    s = re.sub(r"\s+", " ", t[i:j])
    s = re.sub(r"[\s-]*[一二三四五六七八九十]+\s*、\s*$", "", s)          # 下一節的「---- 三、」
    s = re.sub(r"\s*(．|說明：|參考如下：|(?<!\d)\d{1,2}\.\s)", r"\n\1", s)  # 「．U5文書機」、「1. I5 遊戲機」各自一行
    return "\n".join(x.strip() for x in s.splitlines() if x.strip())


def extract_month(src: str) -> str:
    m = re.search(r"<title>[^<]*?(\d{4})年\s*(\d{1,2})月", src)
    return f"{m.group(1)}年{int(m.group(2))}月" if m else ""


def read_snapshot(path: Path) -> tuple[str, str]:
    """回傳 (月份, 菜單); 沒有快照回傳 ("", "")。"""
    if not path.exists():
        return "", ""
    month, body = "", []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# 月份: "):
            month = line[len("# 月份: "):].strip()
        elif not line.startswith("# "):
            body.append(line)
    return month, "\n".join(body).strip()


def write_snapshot(path: Path, url: str, month: str, menu: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("# 歐飛先生〈每月電腦組裝說明〉「我建議的菜單」段落, 由 scripts/watch_ofey.py 每日比對更新\n"
                    f"# 來源: {url}\n# 月份: {month}\n{menu}\n", encoding="utf-8")


def gone_parts(data_json: Path) -> list[dict]:
    if not data_json.exists():
        return []
    d = json.loads(data_json.read_text(encoding="utf-8"))
    labels = {s["key"]: s["label"] for s in d.get("slots", [])}
    return [{"build": b["name"].split(" — ")[0], "key": b["key"], "slot": labels.get(k, k),
             "name": it["name"], "price": it["price"], "d": it.get("d", "")}
            for b in d.get("builds", []) for k, it in b["items"].items() if it.get("gone")]


def menu_issue(url: str, month: str, old: str, new: str) -> str:
    diff = "\n".join(difflib.unified_diff(old.splitlines(), new.splitlines(), "上次快照", month or "最新", lineterm=""))
    return (f"歐飛先生〈每月電腦組裝說明〉的「我建議的菜單」改了（{month or '月份未知'}）。\n\n來源：{url}\n\n"
            f"```diff\n{diff}\n```\n\n"
            "## 處理方式\n\n在 Claude Code 執行 `/coolpc`，請它依 `data/ofey_menu.txt` 重配 `builds/*.json`"
            "（`low`／`mid`／`high` 是 AMD、`*-intel` 是 Intel、`office` 是文書機），"
            "跑 `quote.py` 與 `build_site.py` 後提交，再關閉這張 Issue。\n\n"
            f"<details><summary>新菜單全文</summary>\n\n```\n{new}\n```\n</details>\n")


def error_issue(url: str, why: str) -> str:
    return (f"每日監看抓不到歐飛先生〈每月電腦組裝說明〉的菜單段落：{why}\n\n來源：{url}\n\n"
            f"可能是文章改版，或「{START}」「{END}」這兩個標記字串改了。"
            "請打開文章確認，再調整 `scripts/watch_ofey.py` 的 `START`／`END`／`FALLBACK_URL`。\n")


def gone_issue(parts: list[dict]) -> str:
    rows = "\n".join(f"| {p['build']} (`{p['key']}`) | {p['slot']} | {p['name']} | {p['price']:,} | {p['d']} |" for p in parts)
    return ("預設配置裡有零件已經從原價屋下架，網頁目前保留最後的品名與價格並標「已下架」：\n\n"
            "| 配置 | 欄位 | 品名 | 最後價格 | 最後報價日 |\n|---|---|---|---:|---|\n"
            f"{rows}\n\n在 Claude Code 執行 `/coolpc`，請它替這些零件找替代品、更新 `builds/*.json`。"
            "全部換掉後，下次監看會自動關閉這張 Issue。\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--html", type=Path)
    ap.add_argument("--out-dir", type=Path, default=Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()))
    a = ap.parse_args()
    snap = a.root / "data" / "ofey_menu.txt"
    out = {}

    url, src, why = FALLBACK_URL, "", ""
    try:
        if a.html:
            src = a.html.read_text(encoding="utf-8")
        else:
            url, src = get(find_article_url())
    except OSError as e:
        why = f"文章抓取失敗（{e}）"
    menu = extract_menu(src) if src else ""
    month = extract_month(src) if src else ""
    if src and not menu:
        why = f"找不到「{START}」到「{END}」之間的段落"

    old_month, old_menu = read_snapshot(snap)
    if why:
        changed = "error"
    elif not old_menu:
        changed = "init"
    elif menu != old_menu:
        changed = "menu"
    elif month != old_month:
        changed = "month"
    else:
        changed = "none"
    if changed in ("init", "menu", "month"):
        write_snapshot(snap, url, month, menu)
    out.update(changed=changed, month=month, url=url)
    if changed in ("menu", "error"):
        body = a.out_dir / "ofey-issue.md"
        body.write_text(menu_issue(url, month, old_menu, menu) if changed == "menu" else error_issue(url, why), encoding="utf-8")
        out["ofey_body"] = str(body)
    print(f"歐飛菜單: {changed} ({month or '月份未知'}) {url}" + (f" — {why}" if why else ""))

    parts = gone_parts(a.root / "docs" / "data.json")
    out["gone"] = str(len(parts))
    if parts:
        body = a.out_dir / "gone-issue.md"
        body.write_text(gone_issue(parts), encoding="utf-8")
        out["gone_body"] = str(body)
    print(f"預設配置下架零件: {len(parts)} 件")
    for p in parts:
        print(f"  {p['key']} {p['slot']}: {p['name']}")

    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.writelines(f"{k}={v}\n" for k, v in out.items())


if __name__ == "__main__":
    sys.exit(main())
