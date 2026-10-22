---
name: coolpc
description: "抓取與解析原價屋含稅報價、搜尋零件、依需求配電腦並產出估價單；建立或維護可替換零件的 GitHub Pages 估價網站，或把估價單截圖／清單轉成保留歷史價格的分享連結。適用於原價屋查價、配單、報價更新及估價網站改版。"
---

# 原價屋報價自動更新與估價單

正本在 `~/.agents/skills/coolpc/`，Claude 透過 `~/.claude/skills/coolpc` symlink 共用。專案的 `.claude/skills/coolpc/` 是進版控的執行副本，供 GitHub Actions 與其他使用者使用；維護正本後，依需求同步受影響的腳本、模板與文件。
所有資料指令都在目標專案根目錄執行。以下 `.claude/skills/coolpc/scripts/` 指令以已初始化的專案為例；沒有執行副本時，改用目前載入技能所在目錄的 `scripts/`，輸出仍寫到工作目錄。
腳本只需 Python 3 標準函式庫。輸出寫在 repo 根目錄 (`./evaluate.php`、`./data/`、`./docs/`)，build 定義檔放 `./builds/`。

- 查件 regex 配方、品名裡可直接讀的相容性資訊、條件價規則、行情筆記：`references/recipes.md`（配單前先看）。
- 估價網頁的資料格式、分享連結、部署與已知坑：`references/site.md`；建立或改版介面時另讀 `references/site-ui.md`，模板在 `templates/`。
- 原價屋網站的其他資料與入口 — 帶單開官方估價頁 (POST `iname` / GET `iBuy`)、廣告遮罩、頁內耗電瓦數／折抵／圖片陣列、每類總覽的圖片與規格列、更新時間檢查、不要串的頁面：`references/coolpc-pages.md`。
- 可直接複製當模板的三套配置：`examples/low.json`、`mid.json`、`high.json`。
- 本 repo（已上線）：泛用的「原價屋估價單分享」網站，沒有綁遊戲；GitHub `jakeuj/architect-pc-builder`，網頁 `pc.jakeuj.com`（2026-10-06 起 `docs/CNAME`；舊的 blog.jakeuj.com/architect-pc-builder/ 會 301 過去。repo 名稱沿用早期的遊戲專案，為了舊分享連結不改）；本機在 `/Users/jakeuj/claude/evaluate`。
- 要在別的專案 / repo 用：在新專案根目錄跑 `python3 ~/.agents/skills/coolpc/scripts/build_site.py --init`，會把整個技能複製到新專案的 `.claude/skills/coolpc/` 並建骨架；專案副本供 CI 使用；一般抓價不會覆寫既有網頁，模板升級需明確同步。

## 1. 更新報價 (最常用)

```bash
python3 .claude/skills/coolpc/scripts/fetch_coolpc.py --out . --keep-old
```

- 下載 evaluate.php (伺服器回 Big5，腳本用 cp950 解碼後存成 UTF-8)，接著自動呼叫 `parse_coolpc.py` 產出 `data/`。
- `--keep-old`：既有 `evaluate.php` 先改名為 `evaluate.<舊報價日期>.php` 留底；不加則直接覆寫。
- 執行結束會印出「報價日期」與各分類商品數；報價日期在頁面 `<font id=Mdy>`，是原價屋自己的更新時間。
- 頁面偶爾混進 cp950 沒有的字（香港增補字，如 `0xFB40`；2026-10-04 曾讓排程連續失敗兩次）：`fetch_coolpc.py` 的 `decode()` 會逐字改用 big5hkscs 解（同瀏覽器 `TextDecoder('big5')`），還是不行才換成 `�`，並在 stderr 印出字數，排程不中斷。
- 若印出「下載內容不像估價頁」，代表被擋或頁面改版：請使用者用瀏覽器另存 `evaluate.php` (UTF-8) 到工作目錄，再手動跑 `parse_coolpc.py evaluate.php data`。
- 頁面每天可能更新多次；產出估價單前先跑一次更新，並在估價單標題註明報價日期。

## 2. 產出的資料

| 檔案 | 內容 |
|---|---|
| `data/coolpc_prices.json` | `{source, quote_date, categories:[{id, name, groups:[{label, items:[{id, name, price, list_price, flags}]}]}]}` |
| `data/coolpc_prices.csv` | 扁平版 (cat_id, category, group, id, name, price, list_price, flags) |
| `data/by_category/NN_*.tsv` | 每分類一檔，`price<TAB>id<TAB>flags<TAB>name`，群組以 `## ` 分隔，適合 grep / 直接閱讀 |

- `price` 為含稅實際價；有下殺時 `price` 是下殺價、`list_price` 是原價。
- `flags`：`熱賣`、`價格異動`、`下殺`、`搭板專案` (CPU 需與主機板同購)、`組裝價` / `裝機價` / `限搭機` / `限組裝` (需整機組裝或搭機才有此價)、`限購` (每台限購 N)、`任搭折N` (任搭其他商品再折 N 元，估價單**未**扣)、`酷幣N` (回饋點數；原價屋估價頁的「優惠價」會連同任搭折一起扣，我們的實付估計只扣任搭折，見 `references/coolpc-pages.md`)、`訂購` (非現貨)。
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
  "purpose": "mainstream",
  "platform": "amd",
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
- `qty` 預設 1；`role` 是估價單顯示的欄位名稱。網站可另帶 `purpose`／`platform` 分組；欄位與相容處理見 `references/site.md`。

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

給朋友看、可自己換零件重新計價的靜態頁。原生 HTML／CSS／JavaScript + `docs/data.json`，不需 build 工具。

```bash
# 新專案：在其根目錄執行，從共用正本建立 CI 執行副本與網站骨架（含 builder.css 與 builder-ui.js）
python3 ~/.agents/skills/coolpc/scripts/build_site.py --init
# 編輯 site.json (title / repo / builds 配置 / notes；遊戲專屬網站再加 game 需求)，準備 builds/*.json
python3 .claude/skills/coolpc/scripts/build_site.py             # 產出 docs/data.json、data-more.json、history.json (價格歷史會讀上一版併入)
python3 .claude/skills/coolpc/scripts/build_site.py --backfill-history   # 既有站第一次啟用價格歷史或要重算時：從 git 歷史回填 docs/history.json 後再照常產出 (一次性；還沒有 data 的 commit 會 exit 1「沒有可回填的快照」、淺 clone 會要求先 git fetch --unshallow；新站直接跑上一行就從頭記)
python3 -m http.server 8765 --directory docs                    # 本機預覽 (或用 preview_start)
```

- 新網站預設用深色科技風模板：用途分組與收合配置、完整品名零件列、多詞搜尋／群組篩選／價格排序／換件價差、桌面固定摘要與手機底部總價／分享列；既有網站依使用者選定的風格改版。配置狀態、歷史鎖價與介面驗收讀 `references/site-ui.md`。
- 網頁功能：每欄可新增、替換、移除與改數量；總計／任搭折／實付估計、相容性與條件價提示、複製清單、歷史報價分享連結 (2026-10-22 起 deflate 壓縮)、唯讀估價單檢視頁 (白色紙本單據，可列印／存成 PDF，右上角 `#sheet-qr` 帶這條連結的 QR Code：尺寸隨格數放大、列印每格 0.4mm，連結太長時改顯示提示)、改單差異比較 (分享單改過後上方 `#diff`「這張單跟分享時的內容（日期）有什麼不同」：換件、數量、改用現價 (同型號只換品名或優惠結束的也算改用現價，不當換件)、新增／移除、合計差，小字「改了 N 處（含 M 處改用現價）」；唯讀估價單不顯示)、零件價格歷史 (零件卡、選件面板、`#chg` 漲跌摘要各一行「30 天最低／最高」與階梯迷你折線，資料在 `docs/history.json`，只記主機型錄的型號；其他商品列照同一把 key 查、查得到就顯示 (第二顆 SSD 等主機型錄品項、剔除群組裡同型號的件)，螢幕／週邊等沒紀錄就不顯示；唯讀估價單不顯示)、「最近開過」(分享、預覽或打開過的估價單存這台裝置的 localStorage `coolpc.recent`，記的一律是快照連結 `#v=1&q=`，最多 30 筆，起始配置區多一個分頁，點了重新載入，附清除按鈕)、「帶到原價屋估價頁」(POST 品名清單，原價屋官方估價頁預先選好品項與數量，見 `references/coolpc-pages.md`)、店家模式 (電腦店幫客人報價：店家抬頭與撥號／LINE、整單本店價、服務加價列、客戶／有效期限／備註、可隱藏原價屋單價、店家設定連結；格式與規則見 site.md「店家模式」)。`live_url` 有設定才啟用即時抓價。
- 主機零件格只放主機相關 11 個分類 (`DEFAULT_SLOTS`)，並剔除筆記型記憶體、散熱膏、線材等群組 (`EXCLUDE_GROUPS`)；要改欄位在 `site.json` 給 `slots`。其餘分類與被剔除的群組另存 `docs/data-more.json`，網頁切到「全部分類」才載入，可在「其他商品」加任意多件 (螢幕、週邊、第二顆 SSD…)，分享連結一併保存；遊戲專屬等純主機站在 `site.json` 設 `"all_categories": false` 關掉。細節見 `references/site.md`。
- 分享按鈕給的是唯讀估價單 `#v=1&q=` (估價單樣式、可列印，右上角有這條連結的 QR Code，「編輯這張估價單」帶同一份資料回編輯模式)；「複製可編輯連結」給 `#q=`，打開直接編輯。`q` 存的是估價單快照 (每列 分類 + 品名 + 當時價格 + 日期)，字首是格式版本：`1` = base64url(JSON)，`2` = base64url(deflate-raw(JSON)) (2026-10-22 起預設；沒有 `CompressionStream` 的瀏覽器退回 `1`；兩種都能開，舊連結永遠有效；實測 8 列主機單 1,243 → 1,028 字元，中文品名難壓，其他商品多時省更多)。開啟時一定還原當初內容，並跟現行型錄 (即時或 data.json) 用品名對照；上方摘要逐列列出「分享時報價 → 現價」的 ▲▼、合計與已下架；搭板 / 裝機價等優惠結束但同型號還在賣的，標「…優惠已結束」並跟同型號原價比，不當成下架 (基準是連結裡的當時價格，跟原價屋品名裡的「▼下殺」、`價格異動` 無關，見 site.md)；可改單，沒改的列保留原報價、改過的用現價，改過後另列「這張單跟分享時的內容（日期）有什麼不同」的逐格差異與合計差，「還原分享時的內容」復原，「全部改用現價」一鍵重報。分享或預覽過的單會記進這台裝置的「最近開過」。要把現成估價單 (原價屋截圖、清單) 做成連結，照 `references/site.md`「從現成估價單產生連結」做；`encodeQuote`／`decodeQuote` 現在是 async，Node 一行指令要包在 async 函式裡 `await` (`deflate-raw` 要 Node 20.12 以上，CI 用 Node 22；更舊的 Node 編碼會退回 `1`)。
- 零件下架 (build 的 `match` 對不到或命中多筆) 時，`quote.py` 標「已下架」不計價、`build_site.py` 沿用上一版 `docs/data.json` 對到的品名與價格並標 `gone`，網頁顯示「已下架」讓人改選；都不會讓排程失敗。只有上一版也沒有 (新寫的 build 打錯) 才會報錯。下架後記得找替代品更新 `builds/*.json`。
- 部署：`gh repo create <name> --public --source . --push`，再 `gh api -X POST repos/<owner>/<name>/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/docs'`。使用者的 Pages 綁了自訂網域，實際網址預設是 `https://blog.jakeuj.com/<name>/`（`jakeuj.github.io/<name>/` 會 301 過去）；repo 有 `docs/CNAME` 時以它為準。README 要寫實際網址。push 前先 fetch (見 site.md「部署與 CI 的坑」)。
- workflow 每小時 :30 抓價、只在 `data/`、`quote.md` 或 `docs/` 資料真的變動時 commit（先 `git add -A` 再比 staged；`build_site.py` 在內容沒變時沿用上次的 `generated`，`docs/history.json` 則只在價格變動時追加、key 排序、不放時間戳，內容沒變時逐位元相同，不會多出 diff）。GitHub 的 runner 抓得到 coolpc，已驗證。public repo 不耗 Actions 額度；排程常延後數小時或跳過 (見 site.md「部署與 CI 的坑」)。
- 即時報價 (可選)：原價屋沒有 CORS，網頁要透過 `worker/` (Cloudflare Worker) 代理抓現頁；`docs/coolpc-live.js` 是 `parse_coolpc.py` 的 JS 版，在瀏覽器解析。`site.json` 的 `live_url` 留空就只用 workflow 的快照。**本 repo 目前停用** (2026-10-02 起 `live_url` = `""`)：worker 程式寫好了但沒部署，`coolpc.jakeuj.com` 沒有 DNS 紀錄；使用者目前不要即時查價，價格只靠 workflow。要開的順序是先部署、curl 驗證，再把網址填回 `live_url` 跑 `build_site.py`；別在沒部署前填網址，也別主動叫使用者部署。部署與坑見 `references/site.md`。
- `.gitignore` 排除 `evaluate*.php`（1MB+ 原始 HTML）與 `.claude/launch.json`、`.claude/settings.local.json`；`.claude/skills/` 要進版控。
- 新站設定好 title／subtitle／repo 後，同步初始 HTML 的標題與描述；公開網址確認後再填 canonical 與 `og:url`，避免沿用範例網站的網域。資料生成器只更新 `docs/data.json`、`docs/data-more.json` 與 `docs/history.json` (價格歷史，2026-10-22 起)，不改 metadata 或介面檔案。
- 知識圖 (本 repo 限定)：`docs/graph/` 是 graphify 產生的開發者關係圖 (`pc.jakeuj.com/graph/`，`noindex`，估價網站不連過去)，不跟每小時排程。重建、發布或改 `scripts/publish_graph.py` 前讀 site.md「專案知識圖」。
- 細節與坑見 `references/site.md`。

## 7. 維護

- 頁面結構假設：每分類為 `<TD class=w>N<TD class=t>名稱` 後接 `<SELECT name=nN>`，商品為 `<OPTION value=N>品名, $價格[↘$下殺價] 符號</OPTION>`，`disabled` 的 OPTION 是說明列，目前不解析（`&#x2764;` 開頭是活動與截止日，例如「買 9000X3D 送遊戲，至 10/24」；全形空白 `　` 開頭是上一個商品的續行，原價屋的快搜會接到前一件品名後面）。若解析出的商品數與頁面「共有商品 N 樣」不符，優先檢查 `parse_coolpc.py` 的 `cat_re` / `price_re`。
- 活動說明、運送提醒偶爾寫成一般 OPTION、標價 `$1`（2026-10-06 有 14 筆，在分類 2 筆電、10 散熱器的 Noctua 相容提醒、17 電競桌椅運送說明）。`parse_coolpc.py` 與 `coolpc-live.js` 都略過標價 ≤ $1 的列，`parse_coolpc.py` 會印出略過筆數；歷史資料裡沒有真的 $1 商品。
- 相容性規則（腳位、DDR、顯卡長、散熱器高、CPU 內顯、電源瓦數）：純判讀放 `templates/builder-ui.js`（`cpuGraphics`／`psuWatts`／`vgaPower`，顯卡建議瓦數表 `VGA_PSU` 取 NVIDIA「Required System Power」與 AMD「Minimum PSU Recommendation」官方值，新顯卡上市要補表），`index.html` 的 `warnings()` 只組文字；不確定一律回 null 不提示。
- 要加功能前先看 `references/site.md`「功能評估與待辦」：已評估方向的設計決定與為什麼不做 (淺色主題、PWA、拆 index.html、OG 預覽、品名判讀不出來的相容性規則)，以及已完成項目的實測結果；Worker 部署到哪一步在同檔「即時報價代理 (worker/)」。改單差異、價格歷史、連結壓縮＋QR＋最近開過三項已於 2026-10-22 做完 (commit 4b8992c、4bedb4c、235876e)，現況以 site.md「分享連結版本 2、QR Code、最近開過」「docs/history.json」兩段與「index.html 內部重點」的改單差異條為準。
- `parse_coolpc.py` 改了規則，`templates/coolpc-live.js`（與各專案 `docs/coolpc-live.js`）要一起改；驗證：`node` 載入 coolpc-live.js 解析同一份 evaluate.php，`JSON.stringify` 結果應與 `data/coolpc_prices.json` 的 `categories` 完全相同（見 site.md）。
- 價格歷史 `docs/history.json` (2026-10-22 起)：`build_site.py` 每次讀上一版、用純函式 `update_history()` 併入這次快照後寫回 (key `分類 id|型號`，型號是品名 `｛…｝` 內的字，沒型號的不記；搭板／任搭、組裝價、裝機價、限搭機、限組裝這類條件價件另加 `|條件碼` (五位 0/1，順序同 `COND_RE`，`history_key()`／`cond_code()`，前端 `U.historyKey`／`condCode` 同一套) 分開記，一般件的「30 天最低」才不會是搭板價；value `[[YYYY-MM-DD, price], …]`，日期是該次快照的報價日期)。只涵蓋主機型錄 (`split_catalog()`，跟 `data.json` 同一套 slots 與剔除規則，其他商品不記)、同一 key 內多件 (代理／平輸) 取最低價 (`model_prices()`，網頁標「同型號最低款」)、只在價格變動時追加、同日變動只留最新、比最後一筆還舊的快照不寫、保留 `HISTORY_DAYS` = 90 天 (cutoff 之前只留最後一筆當走勢起點，已下架且最後一筆早於 cutoff 的型號整個拿掉)；上一版讀不到、不是物件或形狀不對 (`valid_history()`：每個 key 的值要是非空的 `[[日期字串, 數字], …]`) 就從頭記 (stderr 提示「重新開始記錄」)，`update_history()` 併入失敗也一樣，不讓排程失敗。既有站第一次啟用或要重算時跑 `--backfill-history` 從 `git log -- data/coolpc_prices.json` 依序回填 (一次性；沒有 data 的 commit 會 exit 1「沒有可回填的快照」，新站照常跑 `build_site.py` 就從頭記；淺 clone 會要求先 `git fetch --unshallow`；網站在 repo 子目錄也能回填；本 repo 10/22 回填 42 次快照得 2,761 個 key (含 162 個條件價件)、約 158KB)。改型號或條件 regex 時 `build_site.py` 的 `MODEL_RE`／`COND_RE` (`history_key()`) 要跟 builder-ui.js 的 `modelOf`／`COND_RE` (`historyKey`) 一致，條件 regex 還要同 coolpc-live.js 的 `COND_RE` (`reconcile` 也用它)，否則前端 `U.historyKey` 對不到 key；範例專案 `test.yml` 的 `paths-ignore` 要有 `docs/history.json`。前端 `loadHistory()` 背景載入、失敗只 console.warn；統計與折線 (`historyStats`／`sparkline`) 見 site.md「docs/history.json」。
- 分享連結相容性：`encodeQuote`／`decodeQuote` 是 async (2026-10-22 起字首 `2` = deflate-raw)；`decodeQuote` 永遠要同時收 `1` 與 `2`，舊連結永遠要能開；`canZip()` 實際試建一次 `deflate-raw` 的 (De)CompressionStream (Chromium 80–102 有類別但不支援)，不行的瀏覽器編碼退回 `1`、開 `2` 報「這個瀏覽器太舊」；解開後超過 `MAX_UNPACKED` (256KB) 擋掉；`encodeStore`／`decodeStore` 維持 `1` 同步。新欄位加在 JSON 裡即可 (舊版網頁忽略不認得的鍵；測試釘住「沒有店家時解開的 JSON 跟 2026-10-06 加店家模式前的輸出相同」)，字首只代表編碼方式，不要為新欄位加版本。呼叫端都要 `await`：index.html 的 `hashFor`／`syncHash` (序號只採最後一次)、`shareUrl`；`encoded()` 以 quoteOf 的 JSON 當 key 快取壓縮結果，分享時 `shareUrlNow`／`withShareUrl` 同步拿到，拿不到才把 promise 交給 `copyText` 的 `ClipboardItem` (Safari 離開使用者手勢就不給寫剪貼簿)；site.md「從現成估價單產生連結」的 Node 指令也要 `await` (`node -e` 包 async IIFE)，不然 `decodeQuote` 會丟「不支援的連結版本」。
- 介面更新同步 `templates/index.html`、`templates/builder.css`、`templates/builder-ui.js`、`build_site.py --init` 複製清單與專案副本；在暫存專案驗證相對資源、初始化及客製檔保留。選件預覽與套用共用 BuilderUI 邏輯，避免數量／鎖價／加購合併造成價差失準；依 `references/site-ui.md` 做瀏覽器驗收。
- 測試：`node --test .claude/skills/coolpc/tests/`（builder-ui 的搜尋／排序／價差、改單差異 `diffQuote`、價格歷史 `historyKey`／`isoOfQD`／`historyStats`／`sparkline`、最近開過 `recentUpsert`／`recentClean`、QR `qrMatrix` 已知答案 (版本 5／糾錯 M／遮罩 3，與 python-qrcode 逐格相同) 與版本／遮罩自動選擇、`qrSvg` (版本 > 20 改 L)；coolpc-live 的既有報價／分享連結 (版本 1 與 2、沒有 CompressionStream 退回 1、解開超過 256KB 的壓縮炸彈擋掉)／解析／帶單，用到 `encodeQuote`／`decodeQuote` 的測試都是 async，`encodeStore`／`decodeStore` 仍同步）及 `python3 -m unittest discover -s .claude/skills/coolpc/tests`（下架、解析、配置 metadata、初始化與客製保留、價格歷史 `iso_date`／`cond_code`／`history_key`／`model_prices`／`valid_history`／`update_history`、`history.json` 條件價件另記 key、沒變時逐位元相同、壞檔 (JSON 壞掉、頂層不是物件、值形狀不對) 重新開始記不中斷排程、`--backfill-history` 從 git 回填 (淺 clone 拒絕且不覆寫既有檔、網站在 repo 子目錄也能回填)）。Node 22 (GitHub runner) 的 `--test` 不吃目錄參數，CI 用 glob `'.claude/skills/coolpc/tests/*.test.js'`；本機 Node 26 給目錄可以跑。共用正本測試可改用其 `tests/` 絕對路徑。範例專案的 `.github/workflows/test.yml` 在 push／PR 跑這兩組測試並 diff `docs/` 與 `templates/` 的 `builder-ui.js`／`coolpc-live.js`／`builder.css`，`index.html` 則先去掉站台專屬的 title／og／twitter／canonical／圖示／manifest／h1／repo 連結那些行再 diff (3444214 起；inline 主程式只改一邊會紅燈)；`paths-ignore` 含 `data/**`、`docs/data.json`、`docs/data-more.json`、`docs/history.json`、`docs/graph/**`、`quote.md`，資料 commit 不觸發。
- 驗證方式：`parse_coolpc.py` 印出的各分類數量應等於該分類第一列「共有商品 N 樣」的 N，減去該分類略過的 $1 說明列 (原價屋把它們也算進 N)。
