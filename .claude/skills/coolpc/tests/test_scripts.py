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

    def write_data(self, date, vga):
        cats = [{"id": 4, "name": "CPU", "groups": [{"label": "AM5", "items": [it(1, "｛R5 7500F｝ 盒裝", 4790)]}]},
                {"id": 12, "name": "VGA", "groups": [{"label": "AMD", "items": vga}]}]
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

    def test_new_build_typo_still_fails(self):
        self.write_data("2026/10/2 14:55", [it(6, "｛RX9070GRE｝", 21490)])
        r = self.run_script("build_site.py")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("找不到", r.stderr)


if __name__ == "__main__":
    unittest.main()
