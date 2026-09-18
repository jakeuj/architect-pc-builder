---
name: coolpc
description: "從原價屋線上估價頁 https://www.coolpc.com.tw/evaluate.php 自動下載最新含稅報價 (Big5 轉 UTF-8)，解析成結構化資料 (JSON / CSV / 分類 TSV)，並依 build 定義檔產出 Markdown 估價單、搜尋零件價格；也能用內建模板產出可替換零件的 GitHub Pages 估價網頁 (site.json + docs/ + 每日自動更新 workflow)。遇到「更新原價屋報價」、「抓最新原價屋價格」、「原價屋估價單」、「幫我配一台電腦 / 低中高配置」、「查某零件在原價屋多少錢」、「重新產出估價單」、「做一個估價網頁給朋友」、「為某遊戲配電腦並做成網頁」這類需求時使用。Trigger: /coolpc"
---

# 原價屋報價自動更新與估價單

這個技能住在 repo 內 `.claude/skills/coolpc/`（專案技能，唯一來源，沒有 `~/.claude` 副本）；所有指令都在 repo 根目錄執行。
腳本只需 Python 3 標準函式庫。輸出寫在 repo 根目錄 (`./evaluate.php`、`./data/`、`./docs/`)，build 定義檔放 `./builds/`。

- 查件 regex 配方、品名裡可直接讀的相容性資訊、條件價規則、行情筆記：`references/recipes.md`（配單前先看）。
- 估價網頁 (GitHub Pages) 的做法、資料格式、部署與已知坑：`references/site.md`；模板在 `templates/`。
- 可直接複製當模板的三套配置：`examples/low.json`、`mid.json`、`high.json`。
- 本 repo（已上線）：GitHub `jakeuj/architect-pc-builder`，網頁 https://blog.jakeuj.com/architect-pc-builder/ ；本機在 `/Users/jakeuj/claude/evaluate`。
- 要在別的專案 / repo 用：在新專案根目錄跑 `python3 /Users/jakeuj/claude/evaluate/.claude/skills/coolpc/scripts/build_site.py --init`，會把整個技能複製到新專案的 `.claude/skills/coolpc/` 並建骨架；之後兩邊各自獨立，改了要自己同步。

## 1. 更新報價 (最常用)

```bash
python3 .claude/skills/coolpc/scripts/fetch_coolpc.py --out . --keep-old
```

- 下載 evaluate.php (伺服器回 Big5，腳本用 cp950 解碼後存成 UTF-8)，接著自動呼叫 `parse_coolpc.py` 產出 `data/`。
- `--keep-old`：既有 `evaluate.php` 先改名為 `evaluate.<舊報價日期>.php` 留底；不加則直接覆寫。
- 執行結束會印出「報價日期」與各分類商品數；報價日期在頁面 `<font id=Mdy>`，是原價屋自己的更新時間。
- 若印出「下載內容不像估價頁」，代表被擋或頁面改版：請使用者用瀏覽器另存 `evaluate.php` (UTF-8) 到工作目錄，再手動跑 `parse_coolpc.py evaluate.php data`。
- 頁面每天可能更新多次；產出估價單前先跑一次更新，並在估價單標題註明報價日期。

## 2. 產出的資料

| 檔案 | 內容 |
|---|---|
| `data/coolpc_prices.json` | `{source, quote_date, categories:[{id, name, groups:[{label, items:[{id, name, price, list_price, flags}]}]}]}` |
| `data/coolpc_prices.csv` | 扁平版 (cat_id, category, group, id, name, price, list_price, flags) |
| `data/by_category/NN_*.tsv` | 每分類一檔，`price<TAB>id<TAB>flags<TAB>name`，群組以 `## ` 分隔，適合 grep / 直接閱讀 |

- `price` 為含稅實際價；有下殺時 `price` 是下殺價、`list_price` 是原價。
- `flags`：`熱賣`、`價格異動`、`下殺`、`搭板專案` (CPU 需與主機板同購)、`組裝價` / `裝機價` / `限搭機` / `限組裝` (需整機組裝或搭機才有此價)、`限購` (每台限購 N)、`任搭折N` (任搭其他商品再折 N 元，估價單**未**扣)、`酷幣N` (回饋點數)、`訂購` (非現貨)。
- 配單時要留意條件價：`搭板專案` 的 CPU 一定要配主機板；`組裝價` / `裝機價` / `限搭機` 商品只適用整機組裝 (配整機時可以用，單買零件不行)。

主機相關分類編號：4 CPU、5 MB、6 RAM、7 SSD、8 HDD、10 風冷散熱器、11 水冷、12 VGA、14 機殼、15 電源、16 機殼風扇。
其他：13 螢幕、17 鍵鼠、29 OS/軟體、3 原價屋套裝主機。

## 3. 查價

```bash
python3 .claude/skills/coolpc/scripts/search_coolpc.py 12 'RTX5060Ti-16GB'          # 依群組名 (顯卡型號)
python3 .claude/skills/coolpc/scripts/search_coolpc.py 6 '32G.*DDR5' -x 筆記型 -n 10  # regex + 排除
python3 .claude/skills/coolpc/scripts/search_coolpc.py 0 '9800X3D'                  # 0 = 全部分類
```

結果依價格由低到高，顯示 cat / id / flags / 群組 / 品名；群組名預設截到 28 字（`-g 0` 不截）。顯示卡的群組名就是晶片型號 (如 `NVIDIA RTX5070-12GB(GDDR7)`、`AMD Radeon RX9060XT-16G`)，主機板群組名是晶片組 + 腳位 + DDR 世代，記憶體群組區分 單條/雙通道/筆記型。

## 4. 估價單

build 定義檔 (`builds/<name>.json`)：

```json
{
  "name": "中階",
  "note": "目標: 1440p 高畫質",
  "items": [
    {"cat": 4,  "match": "R5 7500F MPK｝(含風扇)【6核/12緒】3.7G(↑5.0G)搭主機板省300", "role": "CPU"},
    {"cat": 5,  "match": "裝機價｛華碩 PRIME B650M-F-CSM｝", "role": "MB"},
    {"cat": 6,  "match": "UMAX 16GB(雙通8GB*2) DDR5 5600", "role": "RAM"},
    {"cat": 12, "match": "技嘉 RTX5060 WINDFORCE OC 8G", "role": "VGA"},
    {"cat": 16, "match": "...", "qty": 2, "role": "機殼風扇"}
  ]
}
```

- `match` 是品名子字串，必須**唯一命中** (或與某品名完全相同)；命中多筆時腳本會列出候選並停止，縮小字串再跑。
- 可另給 `id` (option value) 加速，但 id 會隨頁面更新變動，`match` 才是穩定鍵。
- `qty` 預設 1；`role` 是估價單顯示的欄位名稱。

```bash
python3 .claude/skills/coolpc/scripts/quote.py --summary builds/low.json builds/mid.json builds/high.json > quote.md
```

`--summary` 會在各張估價單前先輸出「列 = 角色、欄 = 配置」的並列比較表（總計已扣任搭折），多套配置給使用者看時用這個。

輸出 Markdown：標題含報價日期，每個 build 一張表 (項目 / 品名 / 單價 / 數量 / 小計 / 備註)，備註帶 flags 與原價；若有 `任搭折N` 商品，總計下方會多一列「任搭折扣」與實付估計。

## 5. 配單流程建議

1. 先跑「更新報價」拿到當日資料。
2. 依需求 (遊戲/工作、預算、解析度) 決定平台，用 `search_coolpc.py` 逐類挑件（配方見 `references/recipes.md`）；同價位比較群組內最低價與熱賣款，並注意保固年數 (品名內 `註四年`/`五年保`)。
3. 檢查相容性：CPU 腳位 ↔ 主機板腳位、主機板 DDR 世代 ↔ 記憶體、機殼支援的主機板尺寸與顯卡長度、電源瓦數 (顯卡建議值 + 餘裕) 與 ATX 3.x / 12V-2x6 接頭、散熱器高度 ↔ 機殼。
4. 寫成 `builds/*.json`（可從 `examples/` 複製改），跑 `quote.py --summary`，回覆時附並列表、選件理由、可替換選項的價差（記憶體加倍、換 NVIDIA/AMD、CPU 升降級），以及條件價 (搭板 / 組裝價 / 任搭折) 的說明。
5. 不含 OS / 螢幕 / 週邊時，明確在 note 註明；需要時另外加 29 (OS)、13 (螢幕) 分類的項目。

## 6. 估價網頁 (GitHub Pages)

給朋友看、可自己換零件重新計價的靜態頁。純 HTML + `docs/data.json`，不需 build 工具。

```bash
# 新專案：在其根目錄執行 (路徑指向本 repo 的技能)，會複製技能到新專案 .claude/skills/coolpc/ 並建 site.json / docs/index.html / docs/.nojekyll / workflow
python3 /Users/jakeuj/claude/evaluate/.claude/skills/coolpc/scripts/build_site.py --init
# 編輯 site.json (title / repo / game 需求 / builds 分頁 / notes)，準備 builds/*.json
python3 .claude/skills/coolpc/scripts/build_site.py             # 產出 docs/data.json
python3 -m http.server 8765 --directory docs                    # 本機預覽 (或用 preview_start)
```

- 網頁功能：分頁 = builds、每欄位下拉替換 (含關鍵字篩選、數量)、總計 / 任搭折 / 實付估計、相容性提示 (腳位、DDR、顯卡長 vs 機殼、塔散高 vs 機殼、CPU 無風扇、條件價)、複製清單、分享連結 (選件編進 URL hash)、手機版、深色模式。
- 只放主機相關 11 個分類 (`DEFAULT_SLOTS`)，並剔除筆記型記憶體、散熱膏、線材等群組 (`EXCLUDE_GROUPS`)；要改欄位在 `site.json` 給 `slots`。
- 零件下架時 `build_site.py` 自動改選同群組最便宜品並在頁面提示，不會讓 CI 掛掉。
- 部署：`gh repo create <name> --public --source . --push`，再 `gh api -X POST repos/<owner>/<name>/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/docs'`。使用者的 Pages 綁了自訂網域，實際網址是 `https://blog.jakeuj.com/<name>/`（`jakeuj.github.io/<name>/` 會 301 過去），README 要寫這個。
- workflow 每天台灣 11:30 抓價、只在 `data/` 或 `quote.md` 真的變動時 commit（`docs/data.json` 的 `generated` 時間戳每次都變，不能拿來判斷）。GitHub 的 runner 抓得到 coolpc，已驗證。
- `.gitignore` 排除 `evaluate*.php`（1MB+ 原始 HTML）與 `.claude/launch.json`、`.claude/settings.local.json`；`.claude/skills/` 要進版控。
- 細節與坑見 `references/site.md`。

## 7. 維護

- 頁面結構假設：每分類為 `<TD class=w>N<TD class=t>名稱` 後接 `<SELECT name=nN>`，商品為 `<OPTION value=N>品名, $價格[↘$下殺價] 符號</OPTION>`，`disabled` 的 OPTION 是說明列。若解析出的商品數與頁面「共有商品 N 樣」不符，優先檢查 `parse_coolpc.py` 的 `cat_re` / `price_re`。
- 驗證方式：`parse_coolpc.py` 印出的各分類數量應等於該分類第一列「共有商品 N 樣」的 N。
