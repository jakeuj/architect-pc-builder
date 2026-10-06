# 原價屋估價單分享

用 [原價屋線上估價](https://www.coolpc.com.tw/evaluate.php) 的含稅報價配電腦、改單、把整張估價單存成一條連結分享。
預設放了低／中／高三套主機當起點（不含作業系統、螢幕與週邊），每個零件都能換，每一格都能清空，只估幾個零件也行；價格是 GitHub Actions 定時抓的原價屋快照。
「複製分享連結」會把整張估價單（品名、當時價格、日期）存進網址，任何時候打開都看得到當初的報價；最上方會列出每個零件「分享時 → 現價」的漲跌（▲▼）、合計與已下架品項，可以改單再分享。▲▼ 是跟連結裡的當時價格比，不是原價屋自己的調價標示。

**網頁：https://blog.jakeuj.com/architect-pc-builder/**（`jakeuj.github.io/architect-pc-builder/` 會自動轉過去）

| | 低階 | 中階 | 高階 |
|---|---|---|---|
| 定位 | AM4 / DDR4，1080p 高畫質 | AM5 / DDR5，1440p 高畫質 | AM5 X3D / DDR5，1440p 極致 / 4K |
| CPU | R5 5600X | R5 7500F | R7 9800X3D |
| 顯示卡 | RX 9060XT 8G | RX 9070 GRE 12G | RX 9070XT 16G |
| 記憶體 | 16GB DDR4-3200 | 16GB DDR5-5600 | 16GB DDR5-5600 |

完整清單與價格見 [quote.md](quote.md)（每小時自動更新）。

## 資料怎麼來的

共用技能正本在 `~/.agents/skills/coolpc/`，Codex 原生掃描、Claude 透過 symlink 共用；本 repo 的 [`.claude/skills/coolpc/`](.claude/skills/coolpc/) 是供 GitHub Actions 與其他使用者執行的版控副本（`SKILL.md` 有完整說明）。

1. `fetch_coolpc.py` 下載原價屋估價頁（Big5 → UTF-8），交給 `parse_coolpc.py` 解析成 `data/`：
   - `coolpc_prices.json` — 30 個分類 → 群組 → 商品 `{id, name, price, list_price, flags}`
   - `coolpc_prices.csv` — 扁平版
   - `by_category/NN_*.tsv` — 每分類一檔，方便 grep
2. `quote.py` 依 `builds/*.json` 產出 [quote.md](quote.md)
3. `build_site.py` 讀 `site.json`（標題、遊戲需求、要放上網頁的 builds），只取主機相關分類，連同預設配置寫成 `docs/data.json`，`docs/index.html` 讀它渲染，`docs/builder.css` 提供深色科技風與響應式樣式

GitHub Actions（`.github/workflows/update-prices.yml`）每小時跑一次上述流程，報價有變才 commit；也可在 Actions 頁手動觸發。
repo 是公開的，Actions 不花額度；不過 GitHub 的排程常延後好幾個小時、偶爾整次跳過，所以 `data.json` 快照的時間不一定準，網頁上方會標出報價日期。
原價屋的零件 id 只是清單位置、每次抓價都可能變，所以估價單一律用「分類＋品名」對照，品名消失就標示「已下架」。

### 即時報價（目前停用）

原價屋沒有 CORS，網頁不能直接抓，所以 [`worker/`](worker/) 準備了一個 Cloudflare Worker 當代理：
原樣轉送 Big5 頁面、加 CORS header、邊緣快取 5 分鐘，網頁再用 [`docs/coolpc-live.js`](docs/coolpc-live.js)（`parse_coolpc.py` 的 JS 版）在瀏覽器解析。
目前沒有部署，`site.json` 的 `live_url` 是空的，網頁只用 `data.json` 快照。要開的話：

```bash
cd worker && npx wrangler deploy          # 首次先 npx wrangler login
```

確認 `curl -sI https://coolpc.jakeuj.com/evaluate.php` 有 `access-control-allow-origin`，再把網址填進 `site.json` 的 `live_url`、跑 `build_site.py`。

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
要改標題或加減分頁，改 `site.json` 的 `title` / `builds`；要做成某款遊戲專用的網站，可以再加 `game`（官方最低／建議配備，網頁會多一個需求表，格式見 `build_site.py` 開頭說明）。
若某零件下架，排程不會中斷：`quote.py` 標「已下架」不計價，網頁保留最後的品名與價格並標示「已下架」讓訪客改選；記得再找替代品更新 `builds/*.json`。

要另開一個估價網站（例如某款遊戲專用）：在新目錄跑 `python3 ~/.agents/skills/coolpc/scripts/build_site.py --init`，會複製專案執行副本及網頁骨架（HTML、CSS、JS）；未安裝共用技能的使用者可從本 repo 的腳本初始化。既有檔案預設保留，日常抓價只更新資料，不覆寫介面。

新版模板採用深色方案卡、搜尋選件面板、桌面固定估價摘要與手機底部分享列。改版與驗收方式見 [site-ui.md](.claude/skills/coolpc/references/site-ui.md)。新站需依自己的名稱與公開網址調整初始 HTML metadata。

## 標籤說明

- `搭板專案`：CPU 需與主機板同購才是此價
- `組裝價` / `裝機價` / `限搭機`：需整機組裝才適用
- `任搭折N`：任搭其他商品再折 N 元，估價頁不顯示、結帳才減（網頁會另列估計）
- `下殺`：限時價，`list_price` 為原價；`熱賣` / `價格異動`：原價屋頁面標示；品名裡的「▼下殺到 10/31 20:00」也是原價屋原文
