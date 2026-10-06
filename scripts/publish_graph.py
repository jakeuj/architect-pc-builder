#!/usr/bin/env python3
"""把 graphify 產生的 graphify-out/graph.html 發布成網站的開發者參考頁 docs/graph/index.html。

用法: python3 scripts/publish_graph.py [--src FILE] [--out FILE]
  --src FILE  graphify 輸出 (預設: graphify-out/graph.html; 先在 Claude Code 跑 /graphify . --update)
  --out FILE  發布位置 (預設: docs/graph/index.html, 即 https://pc.jakeuj.com/graph/)

graphify 的頁面是給本機看的: 沒有 viewport、標題是檔案路徑。這裡補上手機版面、繁中標題、
返回估價網站的連結, 並加 noindex —— 這頁是給開發者看的, 不該出現在買電腦的人的搜尋結果裡。
不接每小時的報價流程: 重建圖要跑 LLM 抽文件與截圖, 程式或文件有大改時再手動更新。只用標準函式庫。
"""
import argparse
import datetime
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_URL = "https://github.com/jakeuj/architect-pc-builder"

HEAD = """<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>專案知識圖｜原價屋估價單分享</title>
<meta name="description" content="原價屋估價單分享的程式、文件與驗收截圖關係圖，由 graphify 產生，給開發者參考。">
<meta name="theme-color" content="#0b0f14">
<link rel="icon" href="../favicon.ico" sizes="16x16 32x32 48x48 96x96">
<link rel="icon" href="../favicon.svg" type="image/svg+xml" sizes="any">"""

CSS = """  #site-note { padding: 10px 12px; border-bottom: 1px solid #2a2a4e; font-size: 12px; color: #aaa; line-height: 1.6; }
  #site-note a { color: #66dded; text-decoration: none; }
  #site-note a:hover { text-decoration: underline; }
  @media (max-width: 768px) {
    body { flex-direction: column; height: 100dvh; }
    #graph { flex: 1 1 auto; min-height: 0; }
    #sidebar { width: 100%; height: 45dvh; flex: none; border-left: none; border-top: 1px solid #2a2a4e; overflow-y: auto; }
    #sidebar > * { flex-shrink: 0; }
    #info-panel { min-height: 0; }
    #legend-wrap { flex: none; overflow: visible; }
    #search { font-size: 16px; }
  }
"""

NOTE = """<div id="site-note"><a href="../">← 回到估價網站</a><br>
由 graphify 從 <a href="{repo}">本專案 repo</a> 的程式、文件與驗收截圖產生（{date}）。點節點看它連到哪些檔案與概念；Communities 可依群組篩選。</div>"""


def replace_once(text, pattern, repl, what):
    out, n = re.subn(pattern, lambda _: repl, text, count=1)
    if n != 1:
        raise SystemExit(f"publish_graph: 找不到 {what}, graphify 的輸出格式可能改了")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, default=ROOT / "graphify-out" / "graph.html")
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "graph" / "index.html")
    args = ap.parse_args()

    page = args.src.read_text(encoding="utf-8")
    built = datetime.date.fromtimestamp(args.src.stat().st_mtime).isoformat()
    page = replace_once(page, r'<html lang="[^"]*">', '<html lang="zh-Hant">', "<html lang>")
    page = replace_once(page, r"<title>.*?</title>", HEAD, "<title>")
    page = replace_once(page, r"</style>", CSS + "</style>", "</style>")
    page = replace_once(page, r'<div id="sidebar">', '<div id="sidebar">\n' + NOTE.format(repo=REPO_URL, date=built),
                        '<div id="sidebar">')

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(page, encoding="utf-8")
    print(f"{args.out}: {len(page.encode()):,} bytes (graph built {built})")


if __name__ == "__main__":
    main()
