#!/usr/bin/env python3
"""下載原價屋線上估價頁 (Big5) 轉成 UTF-8 存檔, 並呼叫 parse_coolpc.py 產出結構化資料。

用法: python3 fetch_coolpc.py [--out DIR] [--no-parse] [--keep-old]
  --out DIR   輸出根目錄 (預設: 目前工作目錄); 會寫入 DIR/evaluate.php 與 DIR/data/
  --no-parse  只下載不解析
  --keep-old  若已有 evaluate.php 先備份成 evaluate.<舊報價日期>.php
"""
import argparse
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

URL = "https://www.coolpc.com.tw/evaluate.php"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
HERE = Path(__file__).resolve().parent


def fetch() -> str:
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        ctype = r.headers.get("Content-Type", "")
    m = re.search(r"charset=([\w-]+)", ctype, re.I)
    enc = (m.group(1) if m else "big5").lower()
    if enc in ("big5", "big-5", "big5-hkscs"):
        enc = "cp950"  # 台灣 Big5 實務上用 cp950 解, 含微軟擴充字
    try:
        return raw.decode(enc)
    except UnicodeDecodeError:
        return raw.decode("utf-8")


def quote_date(txt: str) -> str:
    m = re.search(r"<font id=Mdy>([^<]+)", txt)
    return m.group(1).strip() if m else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--no-parse", action="store_true")
    ap.add_argument("--keep-old", action="store_true")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    dst = out / "evaluate.php"

    txt = fetch()
    qd = quote_date(txt)
    if "共有商品" not in txt or not qd:
        sys.exit("下載內容不像估價頁 (找不到報價日期/商品清單), 請改用瀏覽器手動下載")

    if dst.exists():
        old_qd = quote_date(dst.read_text(encoding="utf-8", errors="replace"))
        if a.keep_old and old_qd:
            bak = out / f"evaluate.{re.sub(r'[^0-9]+', '-', old_qd).strip('-')}.php"
            dst.rename(bak)
            print(f"舊檔備份: {bak.name}")
        elif old_qd == qd:
            print(f"報價日期未變 ({qd}), 仍覆寫檔案")
    dst.write_text(txt, encoding="utf-8")
    print(f"已下載 {dst} ({len(txt):,} 字元), 報價日期 {qd}")

    if not a.no_parse:
        subprocess.run([sys.executable, str(HERE / "parse_coolpc.py"), str(dst), str(out / "data")], check=True)


if __name__ == "__main__":
    main()
