"""python3 -m unittest discover -s .claude/skills/coolpc/tests

build 品項對不到 (下架 / 不唯一) 時, quote.py 與 build_site.py 都不能讓每小時排程失敗。
"""
import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
from coolpc_match import resolve  # noqa: E402
from fetch_coolpc import decode, gunzip  # noqa: E402
from build_site import cond_code, history_key, iso_date, model_prices, update_history, valid_history  # noqa: E402


def it(i, name, price):
    return {"id": i, "name": name, "price": price, "list_price": None, "flags": []}


class ResolveTest(unittest.TestCase):
    ITEMS = [it(1, "｛A｝ 特價", 100), it(2, "｛A｝ 一般", 120), it(3, "｛B｝ 8G", 200), it(9, "｛B｝ 8G", 200)]

    def test_unique(self):
        self.assertEqual(resolve(self.ITEMS, "一般")[:2], (self.ITEMS[1], "ok"))

    def test_duplicate_listing_is_one_item(self):
        x, status, cands = resolve(self.ITEMS, "｛B｝")
        self.assertEqual((x["id"], status, len(cands)), (3, "ok", 1))

    def test_ambiguous_uses_previous_name(self):
        self.assertEqual(resolve(self.ITEMS, "｛A｝")[1], "ambiguous")
        self.assertEqual(resolve(self.ITEMS, "｛A｝", "｛A｝ 一般")[0]["id"], 2)
        self.assertEqual(resolve(self.ITEMS, "｛A｝", "｛A｝ 已不存在")[1], "ambiguous")

    def test_exact_name_wins(self):
        items = self.ITEMS + [it(4, "｛A｝ 特價 + 加購", 150)]
        self.assertEqual(resolve(items, "｛A｝ 特價")[0]["id"], 1)

    def test_missing(self):
        self.assertEqual(resolve(self.ITEMS, "｛C｝"), (None, "missing", []))



class DecodeTest(unittest.TestCase):
    """原價屋頁面混進 cp950 沒有的字時, 抓價不能失敗 (2026-10-04 兩次排程因 0xFB 失敗)。"""
    CT = "text/html; charset=big5"

    def test_cp950(self):
        self.assertEqual(decode("共有商品 ｛R5 7500F｝".encode("cp950"), self.CT), "共有商品 ｛R5 7500F｝")

    def test_hkscs_char_like_browser(self):
        raw = "品名".encode("cp950") + b"\xfb\x40" + "價".encode("cp950")
        self.assertEqual(decode(raw, self.CT), "品名\U000289BC價")  # 𨦼, 同 TextDecoder('big5')

    def test_undecodable_byte_replaced(self):
        raw = "品名".encode("cp950") + b"\xff" + "價 $100".encode("cp950")
        self.assertEqual(decode(raw, self.CT), "品名\ufffd價 $100")

    def test_utf8_page(self):
        self.assertEqual(decode("共有商品".encode("utf-8"), "text/html"), "共有商品")


class GunzipTest(unittest.TestCase):
    """抓價要求 gzip; urllib 不會自動解壓, 有壓才解、沒壓原樣交給 decode。"""
    RAW = "共有商品 ｛R5 7500F｝".encode("cp950")

    def test_gzip_body(self):
        self.assertEqual(gunzip(gzip.compress(self.RAW), "gzip"), self.RAW)

    def test_plain_body(self):
        self.assertEqual(gunzip(self.RAW, ""), self.RAW)


class ParseTest(unittest.TestCase):
    """活動說明、運送提醒寫成一般 OPTION 標價 $1 (2026-10-06 共 14 筆) 時不能當商品; JS 版見 coolpc-live.test.js。"""
    PAGE = ("<font id=Mdy>2026/10/6 11:13</font><TD class=w>2<TD class=t>筆電</TD><TD><SELECT name=n2>\n"
            "<OPTION value=0 selected>共有商品 2 樣</OPTION><OPTGROUP LABEL='Dell'>\n"
            "<OPTION value=1>即日起～9/28 購買 Dell 指定機種線上登錄送專屬購機好禮~, $1 ◆ ★</OPTION>\n"
            "<OPTION value=2>｛Dell XPS 13｝, $39900 ◆ ★</OPTION></SELECT>")

    def test_dollar_one_note_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / "evaluate.php", Path(tmp) / "data"
            src.write_text(self.PAGE, encoding="utf-8")
            r = subprocess.run([sys.executable, str(SCRIPTS / "parse_coolpc.py"), str(src), str(out)],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("略過 1 筆", r.stdout)
            data = json.loads((out / "coolpc_prices.json").read_text(encoding="utf-8"))
            items = [(i["id"], i["name"], i["price"]) for g in data["categories"][0]["groups"] for i in g["items"]]
            self.assertEqual(items, [(2, "｛Dell XPS 13｝", 39900)])


class HistoryTest(unittest.TestCase):
    """價格歷史的純函式: 只在變動時追加、同日覆蓋、裁切、下架移除、同型號取最低。"""

    def test_iso_date(self):
        self.assertEqual(iso_date("2026/9/18 14:19"), "2026-09-18")
        self.assertEqual(iso_date("2026/10/2"), "2026-10-02")
        self.assertIsNone(iso_date("今天"))
        self.assertIsNone(iso_date(None))

    def test_history_key_separates_conditional_prices(self):
        """條件價件 (搭板 / 組裝價 / 裝機價 / 限搭機 / 限組裝) 另記 key, 條件碼同 coolpc-live.js 的 COND_RE。"""
        self.assertEqual(cond_code("｛AMD R7 9700X｝代理盒裝"), "00000")
        self.assertEqual(cond_code("[搭板專案]｛AMD R7 9700X｝任搭主機板現省"), "10000")
        self.assertEqual(cond_code("｛華碩 B860M-E｝ *任搭優惠價"), "10000")
        self.assertEqual(cond_code("｛美光 32GB｝~組裝價~"), "01000")
        self.assertEqual(cond_code("｛某 SSD｝裝機價 限搭機"), "00110")
        self.assertEqual(cond_code("｛某機殼｝限組裝"), "00001")
        self.assertEqual(history_key(4, "｛AMD R7 9700X｝代理盒裝"), "4|AMD R7 9700X")
        self.assertEqual(history_key(4, "[搭板專案]｛ AMD R7 9700X ｝任搭主機板現省"), "4|AMD R7 9700X|10000")
        self.assertIsNone(history_key(10, "利民 Frozen Warframe 360 黑"))

    def test_model_prices_lowest_within_key_and_skips_no_model(self):
        cats = {"4": {"id": 4, "name": "CPU", "groups": [
            {"label": "a", "items": [it(1, "｛R7 9800X3D｝代理盒裝", 15900), it(2, "｛R7 9800X3D｝平輸盒裝", 14900)]},
            {"label": "b", "items": [it(3, "沒有型號的品項", 100), it(4, "搭板價｛ R5 9600X ｝", 6000), it(6, "｛R5 9600X｝盒裝", 6500)]}]},
            "12": {"id": 12, "name": "VGA", "groups": [{"label": "c", "items": [it(5, "｛R5 9600X｝", 7000)]}]}}
        # 代理 / 平輸取最低; 搭板價跟一般件分開, 一般件的歷史不會是搭板價
        self.assertEqual(model_prices(cats), {"4|R7 9800X3D": 14900, "4|R5 9600X|10000": 6000, "4|R5 9600X": 6500, "12|R5 9600X": 7000})

    def test_valid_history_shape(self):
        self.assertTrue(valid_history({"4|A": [["2026-09-18", 100], ["2026-10-01", 90.5]]}))
        self.assertTrue(valid_history({}))
        for bad in [[], {"4|A": 123}, {"4|A": None}, {"4|A": []}, {"4|A": [["2026-09-18"]]}, {"4|A": "2026"}, {"4|A": [["2026-09-18", "100"]]},
                    {"4|A": [["2026-09-18", True]]}, {"4|A": [[20260918, 100]]}, {"4|A": [["2026-09-18", 100], "x"]}]:
            self.assertFalse(valid_history(bad), repr(bad))

    def test_append_only_on_change_and_same_day_keeps_latest(self):
        h = update_history({}, {"4|A": 100, "4|B": 50}, "2026-09-18")
        self.assertEqual(h, {"4|A": [["2026-09-18", 100]], "4|B": [["2026-09-18", 50]]})
        h2 = update_history(h, {"4|A": 100, "4|B": 50}, "2026-09-19")      # 沒變不追加
        self.assertEqual(h2, h)
        h3 = update_history(h2, {"4|A": 90, "4|B": 50}, "2026-09-20")
        self.assertEqual(h3["4|A"], [["2026-09-18", 100], ["2026-09-20", 90]])
        h4 = update_history(h3, {"4|A": 80, "4|B": 50}, "2026-09-20")      # 同一天再變: 覆蓋
        self.assertEqual(h4["4|A"], [["2026-09-18", 100], ["2026-09-20", 80]])
        h5 = update_history(h4, {"4|A": 100, "4|B": 50}, "2026-09-20")     # 同一天改回原價: 那筆拿掉
        self.assertEqual(h5["4|A"], [["2026-09-18", 100]])
        h6 = update_history(h5, {"4|A": 70}, "2026-09-10")                 # 比最後一筆舊的快照不寫
        self.assertEqual(h6["4|A"], [["2026-09-18", 100]])
        self.assertEqual(h, {"4|A": [["2026-09-18", 100]], "4|B": [["2026-09-18", 50]]})   # 不改輸入

    def test_trim_keeps_one_entry_before_cutoff_and_drops_long_gone(self):
        series = [["2026-01-01", 100], ["2026-02-01", 90], ["2026-03-01", 80], ["2026-04-01", 70]]
        h = {"4|A": [list(e) for e in series], "4|gone": [["2026-01-01", 10]], "4|recent": [["2026-05-20", 5]]}
        out = update_history(h, {"4|A": 70}, "2026-06-01", keep=90)       # cutoff = 2026-03-03
        self.assertEqual(out["4|A"], [["2026-03-01", 80], ["2026-04-01", 70]])
        self.assertNotIn("4|gone", out)          # 這次沒有、最後一筆早於 cutoff
        self.assertEqual(out["4|recent"], [["2026-05-20", 5]])   # 這次沒有但還在 90 天內, 保留
        # 還在賣的型號即使很久沒變也留一筆
        still = update_history({"4|A": [["2025-01-01", 100]]}, {"4|A": 100}, "2026-06-01")
        self.assertEqual(still["4|A"], [["2025-01-01", 100]])


class PipelineTest(unittest.TestCase):
    """在暫存專案裡跑 quote.py / build_site.py, 模擬品項下架。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "builds").mkdir()
        (self.root / "data").mkdir()
        slots = [{"key": "cpu", "label": "CPU", "cats": [4]}, {"key": "vga", "label": "顯示卡", "cats": [12]}]
        (self.root / "site.json").write_text(json.dumps({"title": "t", "builds": ["mid"], "slots": slots}), encoding="utf-8")
        (self.root / "builds" / "mid.json").write_text(json.dumps({"name": "中階", "items": [
            {"cat": 4, "role": "CPU", "match": "｛R5 7500F｝"},
            {"cat": 12, "role": "VGA", "match": "｛RX9070XT｝", "qty": 2},
        ]}, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def write_data(self, date, vga, vga_groups=(), other=()):
        cats = [{"id": 4, "name": "CPU", "groups": [{"label": "AM5", "items": [it(1, "｛R5 7500F｝ 盒裝", 4790)]}]},
                {"id": 12, "name": "VGA", "groups": [{"label": "AMD", "items": vga}, *vga_groups]}, *other]
        (self.root / "data" / "coolpc_prices.json").write_text(
            json.dumps({"quote_date": date, "categories": cats}, ensure_ascii=False), encoding="utf-8")

    def run_script(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / args[0]), *args[1:]], cwd=self.root,
                              capture_output=True, text=True)

    def out(self):
        return json.loads((self.root / "docs" / "data.json").read_text(encoding="utf-8"))

    def test_build_purpose_platform_are_optional_and_preserved(self):
        self.write_data("2026/10/6", [it(5, "｛RX9070XT｝", 25990)])
        self.assertEqual(self.run_script("build_site.py").returncode, 0)
        self.assertNotIn("purpose", self.out()["builds"][0])
        build_path = self.root / "builds/mid.json"
        build = json.loads(build_path.read_text(encoding="utf-8"))
        build.update(purpose="mainstream", platform="amd")
        build_path.write_text(json.dumps(build), encoding="utf-8")
        self.assertEqual(self.run_script("build_site.py").returncode, 0)
        result = self.out()["builds"][0]
        self.assertEqual((result["purpose"], result["platform"]), ("mainstream", "amd"))

    def test_delisted_item_keeps_last_known(self):
        self.write_data("2026/9/21 14:51", [it(5, "｛RX9070XT｝ 三風", 25990)])
        self.assertEqual(self.run_script("build_site.py").returncode, 0)
        first = self.out()
        self.assertEqual(first["builds"][0]["items"]["vga"]["price"], 25990)

        self.write_data("2026/10/2 14:55", [it(6, "｛RX9070GRE｝", 21490)])  # 9070XT 下架
        q = self.run_script("quote.py", "builds/mid.json")
        self.assertEqual(q.returncode, 0, q.stderr)
        self.assertIn("（已下架）｛RX9070XT｝", q.stdout)
        self.assertIn("**4,790**", q.stdout)  # 下架的不算入總計

        r = self.run_script("build_site.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("::warning::", r.stderr)
        vga = self.out()["builds"][0]["items"]["vga"]
        self.assertEqual(vga, {"cat": 12, "name": "｛RX9070XT｝ 三風", "price": 25990, "qty": 2,
                               "d": "2026/9/21 14:51", "gone": True})

        # 再跑一次 (仍下架): 日期維持第一次看到的, 內容沒變所以 generated 也不變
        gen = self.out()["generated"]
        self.assertEqual(self.run_script("build_site.py").returncode, 0)
        self.assertEqual(self.out()["builds"][0]["items"]["vga"]["d"], "2026/9/21 14:51")
        self.assertEqual(self.out()["generated"], gen)

    def test_old_format_previous_file(self):
        """上一版 data.json 是舊格式 (只有 id/name, 沒有 price) 時, 價格從舊型錄查。"""
        self.write_data("2026/9/21 14:51", [it(5, "｛RX9070XT｝ 三風", 25990)])
        self.run_script("build_site.py")
        prev = self.out()
        for b in prev["builds"]:
            for row in b["items"].values():
                row.pop("price")
        (self.root / "docs" / "data.json").write_text(json.dumps(prev, ensure_ascii=False), encoding="utf-8")
        self.write_data("2026/10/2 14:55", [])
        self.assertEqual(self.run_script("build_site.py").returncode, 0)
        self.assertEqual(self.out()["builds"][0]["items"]["vga"]["price"], 25990)

    def test_rest_catalog_written(self):
        """其他分類與被剔除的群組 / 品項另存 data-more.json, 跟 data.json 合起來剛好是全部。"""
        self.write_data("2026/10/6 11:13", [it(5, "｛RX9070XT｝ 三風", 25990), it(7, "｛RX9060XT｝ 套裝加購", 9990)],
                        vga_groups=[{"label": "NVIDIA 專業工作站繪圖卡", "items": [it(8, "｛RTX A2000｝", 19990)]}],
                        other=[{"id": 13, "name": "螢幕｜投影機｜壁掛", "groups": [{"label": "27吋", "items": [it(9, "｛27吋螢幕｝", 4990)]}]}])
        r = self.run_script("build_site.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = self.out()
        more = json.loads((self.root / "docs" / "data-more.json").read_text(encoding="utf-8"))
        self.assertEqual(out["more"], {"url": "data-more.json", "cats": [
            {"id": 4, "name": "CPU"}, {"id": 12, "name": "VGA"}, {"id": 13, "name": "螢幕｜投影機｜壁掛"}]})
        self.assertEqual(more["quote_date"], "2026/10/6 11:13")

        def names(cats):
            return {k: [(g["label"], [i["name"] for i in g["items"]]) for g in c["groups"]] for k, c in cats.items()}
        self.assertEqual(names(out["categories"]), {"4": [("AM5", ["｛R5 7500F｝ 盒裝"])], "12": [("AMD", ["｛RX9070XT｝ 三風"])]})
        self.assertEqual(names(more["categories"]), {
            "12": [("AMD", ["｛RX9060XT｝ 套裝加購"]), ("NVIDIA 專業工作站繪圖卡", ["｛RTX A2000｝"])],
            "13": [("27吋", ["｛27吋螢幕｝"])],
        })

    def test_all_categories_off(self):
        """site.json all_categories: false = 純主機估價站, 不產生 data-more.json。"""
        site = json.loads((self.root / "site.json").read_text(encoding="utf-8"))
        (self.root / "site.json").write_text(json.dumps({**site, "all_categories": False}), encoding="utf-8")
        self.write_data("2026/10/6 11:13", [it(5, "｛RX9070XT｝ 三風", 25990)])
        r = self.run_script("build_site.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIsNone(self.out()["more"])
        self.assertFalse((self.root / "docs" / "data-more.json").exists())

    def test_history_json_appends_on_change_and_is_byte_stable(self):
        """docs/history.json: 只記主機型錄、條件價件另記 key、沒變時內容逐位元相同、改價追加一筆、壞檔不中斷。"""
        build_path = self.root / "builds/mid.json"
        build = json.loads(build_path.read_text(encoding="utf-8"))
        build["items"][1]["match"] = "｛RX9070XT｝ 三風"      # 同型號兩件時 build 要指明
        build_path.write_text(json.dumps(build, ensure_ascii=False), encoding="utf-8")
        self.write_data("2026/9/21 14:51", [it(5, "｛RX9070XT｝ 三風", 25990), it(6, "｛RX9070XT｝ 搭板價", 24990)],
                        vga_groups=[{"label": "NVIDIA 專業工作站繪圖卡", "items": [it(8, "｛RTX A2000｝", 19990)]}],
                        other=[{"id": 13, "name": "螢幕", "groups": [{"label": "27吋", "items": [it(9, "｛27吋螢幕｝", 4990)]}]}])
        r = self.run_script("build_site.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        hist_path = self.root / "docs" / "history.json"
        first = hist_path.read_text(encoding="utf-8")
        self.assertEqual(json.loads(first), {"4|R5 7500F": [["2026-09-21", 4790]], "12|RX9070XT": [["2026-09-21", 25990]],
                                             "12|RX9070XT|10000": [["2026-09-21", 24990]]})   # 搭板價另記
        self.assertEqual(self.run_script("build_site.py").returncode, 0)
        self.assertEqual(hist_path.read_text(encoding="utf-8"), first)     # 沒變: 逐位元相同
        self.write_data("2026/10/2 14:55", [it(5, "｛RX9070XT｝ 三風", 23990)])
        self.assertEqual(self.run_script("build_site.py").returncode, 0)
        self.assertEqual(json.loads(hist_path.read_text(encoding="utf-8"))["12|RX9070XT"], [["2026-09-21", 25990], ["2026-10-02", 23990]])
        self.assertEqual(json.loads(hist_path.read_text(encoding="utf-8"))["12|RX9070XT|10000"], [["2026-09-21", 24990]])   # 搭板件下架但還在 90 天內, 保留
        # 壞掉的 history.json 不讓排程失敗, 重新開始記: JSON 壞掉、頂層不是物件、值的形狀不對都算
        for bad in ["[1,2", "[]", json.dumps({"12|RX9070XT": 123}), json.dumps({"12|RX9070XT": [["2026-09-21"]]}), json.dumps({"x": None})]:
            hist_path.write_text(bad, encoding="utf-8")
            r = self.run_script("build_site.py")
            self.assertEqual(r.returncode, 0, bad + "\n" + r.stderr)
            self.assertIn("重新開始記錄", r.stderr)
            self.assertEqual(json.loads(hist_path.read_text(encoding="utf-8"))["12|RX9070XT"], [["2026-10-02", 23990]], bad)
            self.assertEqual(self.out()["quote_date"], "2026/10/2 14:55")   # data.json 照常更新

    def test_backfill_history_from_git(self):
        git = lambda *args: subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, check=True)
        git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t")
        for date, price in [("2026/9/18 11:28", 25990), ("2026/9/25 9:00", 25990), ("2026/10/2 14:55", 23990)]:
            self.write_data(date, [it(5, "｛RX9070XT｝ 三風", price)])
            git("add", "-A"); git("commit", "-q", "-m", date)
        self.write_data("2026/10/6 11:13", [it(5, "｛RX9070XT｝ 三風", 22990)])   # 工作區最新一次 (還沒提交)
        r = self.run_script("build_site.py", "--backfill-history")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("回填 3 次快照", r.stdout)
        hist = json.loads((self.root / "docs" / "history.json").read_text(encoding="utf-8"))
        self.assertEqual(hist["12|RX9070XT"], [["2026-09-18", 25990], ["2026-10-02", 23990], ["2026-10-06", 22990]])
        # 淺 clone 讀不到歷史: 直接失敗提示, 不覆寫既有 history.json; 子目錄也能回填 (路徑相對 repo 根目錄)
        shallow = Path(self.tmp.name) / "shallow"
        subprocess.run(["git", "clone", "-q", "--depth", "1", f"file://{self.root}", str(shallow)], check=True, capture_output=True)
        r = subprocess.run([sys.executable, str(SCRIPTS / "build_site.py"), "--backfill-history"], cwd=shallow, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("淺 clone", r.stderr)
        self.assertFalse((shallow / "docs" / "history.json").exists())
        sub = self.root / "site"
        sub.mkdir()
        for name in ["builds", "data", "site.json"]:
            (self.root / name).rename(sub / name)
        git("add", "-A"); git("commit", "-q", "-m", "移到子目錄")
        r = subprocess.run([sys.executable, str(SCRIPTS / "build_site.py"), "--backfill-history"], cwd=sub, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("回填 1 次快照", r.stdout)   # 搬進子目錄後的那一次提交 (路徑變了, git log 只看得到它)
        self.assertEqual(json.loads((sub / "docs" / "history.json").read_text(encoding="utf-8"))["12|RX9070XT"], [["2026-10-06", 22990]])

    def test_new_build_typo_still_fails(self):
        self.write_data("2026/10/2 14:55", [it(6, "｛RX9070GRE｝", 21490)])
        r = self.run_script("build_site.py")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("找不到", r.stderr)


class InitTest(unittest.TestCase):
    def init_project(self, root):
        return subprocess.run([sys.executable, str(SCRIPTS / "build_site.py"), "--init"],
                              cwd=root, capture_output=True, text=True)

    def test_init_assets_and_portable_runtime(self):
        from html.parser import HTMLParser

        class AssetParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.assets = []
                self.site_urls = []

            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == "script" and "src" in attrs:
                    self.assets.append(attrs["src"])
                if tag == "link" and attrs.get("rel") == "stylesheet":
                    self.assets.append(attrs["href"])
                if tag == "link" and attrs.get("rel") == "canonical":
                    self.site_urls.append(attrs["href"])
                if tag == "meta" and attrs.get("property") == "og:url":
                    self.site_urls.append(attrs["content"])

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = self.init_project(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            parser = AssetParser()
            parser.feed((root / "docs/index.html").read_text(encoding="utf-8"))
            self.assertTrue(parser.assets)
            # 三個介面資源都要帶 ?v= 快取版本號 (版本字串會隨改版變, 不寫死)
            self.assertEqual(sorted(a.split("?")[0] for a in parser.assets), ["builder-ui.js", "builder.css", "coolpc-live.js"])
            self.assertTrue(all("?v=" in a for a in parser.assets), parser.assets)
            for asset in parser.assets:  # ?v= 是快取版本號，檔名在 ? 前面
                self.assertTrue((root / "docs" / asset.split("?")[0]).is_file(), asset)
            self.assertEqual(parser.site_urls, [])  # 新站尚未決定 URL，不能繼承範例站身分。

            (root / "site.json").write_text(json.dumps({"title": "初始化驗收", "builds": ["mid"],
                "slots": [{"key": "cpu", "label": "CPU", "cats": [4]}]}), encoding="utf-8")
            (root / "builds").mkdir()
            (root / "builds/mid.json").write_text(json.dumps({"name": "中階", "items": [
                {"cat": 4, "role": "CPU", "match": "測試 CPU"}]}), encoding="utf-8")
            (root / "data").mkdir()
            (root / "data/coolpc_prices.json").write_text(json.dumps({"quote_date": "2026/10/6", "categories": [
                {"id": 4, "name": "CPU", "groups": [{"label": "AM5", "items": [it(1, "測試 CPU", 4790)]}]}]}), encoding="utf-8")
            # CI 執行專案副本，不依賴共用正本的絕對路徑。
            generated = subprocess.run([sys.executable, str(root / ".claude/skills/coolpc/scripts/build_site.py")],
                                       cwd=root, capture_output=True, text=True)
            self.assertEqual(generated.returncode, 0, generated.stderr)
            data = json.loads((root / "docs/data.json").read_text(encoding="utf-8"))
            self.assertEqual(data["title"], "初始化驗收")
            self.assertEqual(data["builds"][0]["items"]["cpu"]["price"], 4790)

    def test_init_preserves_existing_customizations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {"site.json": "custom config", "docs/index.html": "custom HTML",
                     "docs/builder.css": "custom CSS", "worker/src/index.js": "custom worker"}
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            result = self.init_project(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            for name, content in files.items():
                self.assertEqual((root / name).read_text(encoding="utf-8"), content)
            self.assertTrue((root / "docs/coolpc-live.js").is_file())


if __name__ == "__main__":
    unittest.main()
