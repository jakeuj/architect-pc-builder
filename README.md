# 原價屋估價單分享

用 [原價屋線上估價](https://www.coolpc.com.tw/evaluate.php) 的含稅報價配電腦、改單、把整張估價單存成一條連結分享。
預設放了七套主機當起點，照[歐飛先生〈每月電腦組裝說明〉](https://ofeyhong.pixnet.net/blog/posts/12224315583)的建議菜單配（不含作業系統、螢幕與週邊），每個零件都能換，每一格都能清空，只估幾個零件也行；切到「全部分類」還能從原價屋全部 30 類加購其他商品（螢幕、鍵鼠、作業系統、第二顆 SSD…）。價格是 GitHub Actions 定時抓的原價屋快照。
「複製分享連結」會把整張估價單（品名、當時價格、日期）存進網址，打開是一張唯讀的估價單（白色單據樣式，可以列印或存成 PDF），任何時候打開都看得到當初的報價，並標出每個零件跟原價屋現價比的漲跌（▲▼）、合計與已下架品項（搭板、裝機價等優惠結束但同型號還在賣的，會標「優惠已結束」並跟同型號現價比）。按「編輯這張估價單」就帶著同一份資料回到編輯畫面，可以改單再分享；「複製可編輯連結」打開直接是編輯畫面。▲▼ 是跟連結裡的當時價格比，不是原價屋自己的調價標示。
配好之後按「帶到原價屋估價頁」，會在新分頁開啟原價屋官方估價頁並預先選好同樣的品項與數量（以原價屋現價計），可以接著在那邊列印或聯絡原價屋。
電腦店老闆或業務可以開「店家模式」（[pc.jakeuj.com/#store](https://pc.jakeuj.com/#store)）幫客人報價：估價單抬頭換成店名、業務、電話與 LINE（手機點了就能撥號／加好友），以原價屋報價為基準填一個本店價、加組裝費等服務、客戶稱呼、有效期限與備註，也能隱藏原價屋單價；店家資料只存在自己的瀏覽器，老闆設定一次可以用「店家設定連結」傳給同事。

**網頁：https://pc.jakeuj.com/**（舊網址 `blog.jakeuj.com/architect-pc-builder/`、`jakeuj.github.io/architect-pc-builder/` 會 301 轉過去，舊分享連結 `#` 後面的估價單照樣帶著）

| | 文書 | 入門遊戲 | 主流遊戲 | 高階 |
|---|---|---|---|---|
| 定位 | 文書、2D 遊戲、4K 影片 | 1080p 大部分 3D 遊戲 | 1080p～2K 大作 | 2K～4K 特效全開 |
| AMD | — | R5 9600X | R7 9700X | R9 9950X3D |
| Intel | U5-225 | U5-245KF | U7-265K | U9-285K |
| 顯示卡 | 內顯 | RTX5050 | RTX5060 | RTX5070Ti |
| 記憶體 | 32GB DDR5 | 32GB DDR5 | 32GB DDR5 | 64GB DDR5 |
| SSD | 1TB Gen4 ×2 | 1TB Gen4 ×2 | 1TB Gen4 ×2 | 1TB Gen4 ×2 |

菜單依 2026 年 10 月那篇；歐飛寫的 U5-235 原價屋沒賣，改用同文列為主流遊戲首選的 U5-245K 系列。主機板（有 WIFI）、電源、散熱（I7/R7 以上塔扇）、機殼（安鈦克 P10C）照同文的建議從原價屋挑。
完整清單與價格見 [quote.md](quote.md)（每小時自動更新）。

## 資料怎麼來的

共用技能正本在 `~/.agents/skills/coolpc/`，Codex 原生掃描、Claude 透過 symlink 共用；本 repo 的 [`.claude/skills/coolpc/`](.claude/skills/coolpc/) 是供 GitHub Actions 與其他使用者執行的版控副本（`SKILL.md` 有完整說明）。

1. `fetch_coolpc.py` 下載原價屋估價頁（Big5 → UTF-8），交給 `parse_coolpc.py` 解析成 `data/`：
   - `coolpc_prices.json` — 30 個分類 → 群組 → 商品 `{id, name, price, list_price, flags}`
   - `coolpc_prices.csv` — 扁平版
   - `by_category/NN_*.tsv` — 每分類一檔，方便 grep
2. `quote.py` 依 `builds/*.json` 產出 [quote.md](quote.md)
3. `build_site.py` 讀 `site.json`（標題、遊戲需求、要放上網頁的 builds），把主機相關分類連同預設配置寫成 `docs/data.json`，其餘分類與被剔除的群組另存 `docs/data-more.json`（切到「全部分類」才載入）；`docs/index.html` 讀它們渲染，`docs/builder.css` 提供深色科技風與響應式樣式

GitHub Actions（`.github/workflows/update-prices.yml`）每小時跑一次上述流程，報價有變才 commit；也可在 Actions 頁手動觸發。
repo 是公開的，Actions 不花額度；不過 GitHub 的排程常延後好幾個小時、偶爾整次跳過，所以 `data.json` 快照的時間不一定準，網頁上方會標出報價日期。
原價屋的零件 id 只是清單位置、每次抓價都可能變，所以估價單一律用「分類＋品名」對照；品名消失但同型號還在賣（只是優惠條件變了）就跟同型號現價比，真的找不到才標示「已下架」。

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
python3 .claude/skills/coolpc/scripts/quote.py --summary builds/low.json builds/mid.json  # 估價單 (含並列比較表)
python3 .claude/skills/coolpc/scripts/build_site.py                                              # 更新網頁資料
python3 -m http.server 8765 --directory docs                               # 本機預覽
```

只需 Python 3 標準函式庫。分類編號：4 CPU、5 主機板、6 記憶體、7 SSD、8 HDD、10 風冷、11 水冷、12 顯示卡、14 機殼、15 電源、16 機殼風扇。

## 改配置

編輯 `builds/*.json`（`low`／`mid`／`high` 是 AMD 三套，`*-intel` 是 Intel 三套，`office` 是文書機），`match` 是品名子字串（需唯一命中），改完跑 `quote.py` 與 `build_site.py`。
要改標題或加減分頁，改 `site.json` 的 `title` / `builds`；要做成某款遊戲專用的網站，可以再加 `game`（官方最低／建議配備，網頁會多一個需求表，格式見 `build_site.py` 開頭說明），不需要「全部分類」的話加 `"all_categories": false`。
若某零件下架，排程不會中斷：`quote.py` 標「已下架」不計價，網頁保留最後的品名與價格並標示「已下架」讓訪客改選；記得再找替代品更新 `builds/*.json`。

### 跟著歐飛的菜單更新

歐飛每月會原地改寫同一篇〈每月電腦組裝說明〉。`.github/workflows/watch-ofey.yml` 每天跑一次 `scripts/watch_ofey.py`：抓文章裡「我建議的菜單」那段，跟 [`data/ofey_menu.txt`](data/ofey_menu.txt) 比對。

- 菜單有變：更新 `data/ofey_menu.txt`，並開一張「歐飛菜單更新」Issue，附上新舊差異。
- 只有月份變：只 commit，不開 Issue。
- 預設配置有零件下架：開「預設配置有零件下架」Issue。
- 文章改版、抓不到菜單：開「抓不到歐飛菜單」Issue。

同標題的 Issue 還開著時，會改成在原 Issue 留言。收到 Issue 後，在 Claude Code 跑 `/coolpc`，請它依 `data/ofey_menu.txt` 重配 `builds/*.json`。這套流程不用 AI，也沒有額外費用。

要另開一個估價網站（例如某款遊戲專用）：在新目錄跑 `python3 ~/.agents/skills/coolpc/scripts/build_site.py --init`，會複製專案執行副本及網頁骨架（HTML、CSS、JS）；未安裝共用技能的使用者可從本 repo 的腳本初始化。既有檔案預設保留，日常抓價只更新資料，不覆寫介面。

新版模板採用深色方案卡、搜尋選件面板、桌面固定估價摘要與手機底部分享列。改版與驗收方式見 [site-ui.md](.claude/skills/coolpc/references/site-ui.md)。新站需依自己的名稱與公開網址調整初始 HTML metadata。

網站圖示位於 `docs/`：SVG、96px PNG、多尺寸 ICO、180px Apple touch icon 與 manifest 的 192/512px 圖示；分享封面是 `social-preview-v1.png`（1200 × 630），首頁已設定 Open Graph 與 Twitter Card。這些檔案直接隨 GitHub Pages 發布，不依賴報價更新流程。圖稿來源為 `scripts/generate_site_assets.py`；需要重製時安裝 Pillow，再執行 `python3 scripts/generate_site_assets.py`（macOS 預設黑體；其他系統用 `--font` 指定支援繁體中文的字型）。修改分享封面時使用新檔名，並同步首頁 metadata。

## 專案知識圖

[pc.jakeuj.com/graph/](https://pc.jakeuj.com/graph/) 是用 graphify 從本 repo 的程式、文件與驗收截圖產生的關係圖，給想看程式怎麼串起來的人參考；頁面設了 `noindex`，不會出現在搜尋結果，估價網站也沒有入口。
它不跟每小時的報價流程更新（重建要用 LLM 讀文件與截圖）。程式或文件有大改時，在 Claude Code 跑 `/graphify . --update`，再執行 `python3 scripts/publish_graph.py`：把 `graphify-out/graph.html` 補上手機版面、`noindex` 與返回連結，寫到 `docs/graph/index.html`。

## 標籤說明

- `搭板專案`：CPU 需與主機板同購才是此價
- `組裝價` / `裝機價` / `限搭機`：需整機組裝才適用
- `任搭折N`：任搭其他商品再折 N 元，估價頁不顯示、結帳才減（網頁會另列估計）
- `下殺`：限時價，`list_price` 為原價；`熱賣` / `價格異動`：原價屋頁面標示；品名裡的「▼下殺到 10/31 20:00」也是原價屋原文
