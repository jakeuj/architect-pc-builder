"""python3 -m unittest discover -s .claude/skills/coolpc/tests

build 品項對不到 (下架 / 不唯一) 時, quote.py 與 build_site.py 都不能讓每小時排程失敗。
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
from coolpc_match import resolve  # noqa: E402
from fetch_coolpc import decode  # noqa: E402


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
            for asset in parser.assets:
                self.assertTrue((root / "docs" / asset).is_file(), asset)
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
