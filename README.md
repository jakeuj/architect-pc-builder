# 締造者：放逐之境 — PC 組裝估價

以 [原價屋線上估價](https://www.coolpc.com.tw/evaluate.php) 的含稅報價，為《締造者：放逐之境》配的低／中／高三套主機，
不含作業系統、螢幕與週邊。網頁上可以直接替換零件重新計價，並產生分享連結。

**網頁：https://blog.jakeuj.com/architect-pc-builder/**（`jakeuj.github.io/architect-pc-builder/` 會自動轉過去）

| | 低階 | 中階 | 高階 |
|---|---|---|---|
| 定位 | AM4 / DDR4，1080p 高畫質 | AM5 / DDR5，1440p 高畫質 | AM5 X3D / DDR5，1440p 極致 / 4K |
| CPU | R5 5600X | R5 7500F | R7 9800X3D |
| 顯示卡 | RX 9060XT 8G | RX 9070 GRE 12G | RX 9070XT 16G |
| 記憶體 | 16GB DDR4-3200 | 16GB DDR5-5600 | 16GB DDR5-5600 |

完整清單與價格見 [quote.md](quote.md)（每天自動更新）。遊戲官方需求見 [game_requirements.md](game_requirements.md)。

## 資料怎麼來的

整套工具是 Claude Code 專案技能，放在 [`.claude/skills/coolpc/`](.claude/skills/coolpc/)（`SKILL.md` 有完整說明）。

1. `fetch_coolpc.py` 下載原價屋估價頁（Big5 → UTF-8），交給 `parse_coolpc.py` 解析成 `data/`：
   - `coolpc_prices.json` — 30 個分類 → 群組 → 商品 `{id, name, price, list_price, flags}`
   - `coolpc_prices.csv` — 扁平版
   - `by_category/NN_*.tsv` — 每分類一檔，方便 grep
2. `quote.py` 依 `builds/*.json` 產出 [quote.md](quote.md)
3. `build_site.py` 讀 `site.json`（標題、遊戲需求、要放上網頁的 builds），只取主機相關分類，連同預設配置寫成 `docs/data.json`，`docs/index.html` 讀它渲染

GitHub Actions（`.github/workflows/update-prices.yml`）每天台灣時間 11:30 跑一次上述流程並自動 commit；也可在 Actions 頁手動觸發。

## 本機使用

```bash
python3 .claude/skills/coolpc/scripts/fetch_coolpc.py --out .                                   # 抓最新報價 + 解析
python3 .claude/skills/coolpc/scripts/search_coolpc.py 12 'RTX5060Ti-16GB'                       # 查價 (分類編號 + regex)
python3 .claude/skills/coolpc/scripts/quote.py --summary builds/low.json builds/mid.json builds/high.json  # 估價單 (含並列比較表)
python3 .claude/skills/coolpc/scripts/build_site.py                                              # 更新網頁資料
python3 -m http.server 8765 --directory docs                               # 本機預覽
```

只需 Python 3 標準函式庫。分類編號：4 CPU、5 主機板、6 記憶體、7 SSD、8 HDD、10 風冷、11 水冷、12 顯示卡、14 機殼、15 電源、16 機殼風扇。

## 改配置

編輯 `builds/low.json / mid.json / high.json`，`match` 是品名子字串（需唯一命中），改完跑 `quote.py` 與 `build_site.py`。
要換遊戲或加減分頁，改 `site.json` 的 `game` / `title` / `builds`。
若某零件下架，`build_site.py` 會自動改選同群組最便宜的替代品並在網頁上提示。

要為另一個遊戲另開 repo：在新目錄跑 `python3 <本 repo>/.claude/skills/coolpc/scripts/build_site.py --init`，技能與網頁骨架會一起複製過去。

## 標籤說明

- `搭板專案`：CPU 需與主機板同購才是此價
- `組裝價` / `裝機價` / `限搭機`：需整機組裝才適用
- `任搭折N`：任搭其他商品再折 N 元，估價頁不顯示、結帳才減（網頁會另列估計）
- `下殺`：限時價，`list_price` 為原價；`熱賣` / `價格異動`：原價屋頁面標示
