# 估價網頁 (GitHub Pages) 參考

模板：`templates/index.html`、`templates/builder.css`、`templates/builder-ui.js`、`templates/coolpc-live.js`、`templates/site.json`、`templates/update-prices.yml`、`templates/worker/`；產生器：`scripts/build_site.py`。
已上線範例：`jakeuj/architect-pc-builder` → `pc.jakeuj.com`（2026-10-06 起 `docs/CNAME`；舊網址 301 過去）（泛用的「原價屋估價單分享」，沒有 `game`；repo 名稱是早期為單一遊戲建的，為了不讓舊分享連結失效而保留）

## 專案結構 (repo 形式)

```
README.md            給朋友 / 公開看的說明: 網址、三套摘要表、資料來源、本機指令
site.json            網頁設定 (title, subtitle?, repo, game?{name,url,min,rec}, builds[], notes[], slots?, live_url?, all_categories?)；game 只有遊戲專屬網站才填；all_categories: false = 純主機站
builds/*.json        配置定義檔 (與 quote.py 共用)
~/.agents/skills/coolpc/ 共用技能正本（本機維護來源）
.claude/skills/coolpc/ 專案執行副本（進版控，供 CI 使用）
data/                parse 產出 (json / csv / by_category tsv), 進版控當快照
docs/index.html      網頁介面與事件 (從模板複製, 可再客製)
docs/builder.css     深色科技風與響應式樣式
docs/builder-ui.js   用途分類、搜尋／排序與選件預覽／套用的純 UI 邏輯
docs/coolpc-live.js  瀏覽器端解析器 (parse_coolpc.py + build_site.py 剔除規則的 JS 版)
docs/data.json       build_site.py 產出, 網頁的快照資料 (有 live_url 時載入後會被即時資料換掉)
docs/data-more.json  build_site.py 產出, 補集 (其他分類 + 被剔除的群組 / 品項), 網頁切到「全部分類」才載入
worker/              Cloudflare Worker 代理 (wrangler.toml + src/index.js), 可選; 本 repo 未部署
docs/graph/index.html 開發者知識圖 (本 repo 限定; scripts/publish_graph.py 從 graphify-out/graph.html 產生)
graphify-out/        graphify 本機輸出 (graph.json / graph.html / manifest / cache); --update 靠它找變動檔
docs/.nojekyll
quote.md             quote.py --summary 產出
.github/workflows/update-prices.yml
.gitignore           evaluate*.php, .claude/launch.json, .claude/settings.local.json, __pycache__/, .DS_Store
game_requirements.md 遊戲需求原文 (可選，遊戲專屬網站才需要)
```

## docs/data.json 格式

```
{ title, subtitle, quote_date, generated (Asia/Taipei ISO), source, repo,
  game: {name, url, min:{...}, rec:{...}} | null,
  notes: [str],
  slots: [{key, label, cats:[int]}],   # 每一格都可空著
  live_url: str ("" = 不用即時),
  filters: {exclude_groups: {"<cat_id>": regex}, exclude_items: regex},   # 給 coolpc-live.js 套同一套剔除規則
  more: {url: "data-more.json", cats: [{id, name}]} | null,   # 全部分類；cats = 原價屋全部分類 (驗證分享連結、選件面板下拉)
  categories: { "<cat_id>": {id, name, groups:[{label, items:[{id, name, price, list_price, flags}]}]} },
  builds: [{key, name, note, purpose?, platform?, items: {<slot>: {cat, id?, name, price, qty, d?, gone?}}}] }
```

- build 定義可帶 `purpose`（`office`／`entry`／`mainstream`／`high`）和 `platform`（`amd`／`intel`），生成器傳到 builds，品項與 quote.py 計價不受影響。模板按 purpose 分組，缺少或不支援的值列「其他配置」；不從名稱猜用途或平台。新建菜單明確填分類，舊菜單可以不填。

- 原價屋的 option value (`id`) 只是清單位置，相隔幾小時就有一半會變；**分類 + 品名是唯一穩定鍵**。build_site.py 每次用 `builds/*.json` 的 `match` 重新解析 (`scripts/coolpc_match.py`，quote.py 共用)。
- 對不到 (下架) 或命中多個不同品名時，沿用上一版 data.json 同 build / 同欄位的品名、價格，`d` = 當時的報價日期，標 `gone: true`；上一版是舊格式 (沒有 price) 就從舊 `categories` 查價。沒有上一版才 exit (新 build 打錯)。
- `id` 只為相容 Pages 快取中的舊版網頁，新版網頁不用；之後可拿掉。
- 內容沒變時沿用上次的 `generated`，workflow 才能用 git diff 判斷要不要提交。

## docs/data-more.json (全部分類，2026-10-06 起)

```
{ quote_date, categories: { "<cat_id>": {id, name, groups:[...]} } }   # 同 data.json categories 的格式, 沒有 generated
```

- 補集 = 不在 slots 裡的分類整類 + 主機分類中符合 `EXCLUDE_GROUPS` 的群組 + 其他群組裡符合 `EXCLUDE_ITEMS` 的品項 (收成同名群組)。`data.json` + `data-more.json` 剛好是 `coolpc_prices.json` 每一件 (測試有驗)。
- 網頁用 `CoolPC.mergeCatalog(CAT, rest)` 併成完整型錄 `ALL`：分類依編號排，同名群組把品項接在後面，其餘群組放最後；只複製陣列、不改到主機型錄，品項物件共用。即時模式用 `CoolPC.selectRest(parsed, slots, filters)` 從現頁算補集 (同 Python)。
- 為什麼分檔：主檔 405 KB / gzip 58 KB，補集 603 KB / gzip 100 KB；預設訪客只要主機零件，不該多載一倍以上。

## 分享連結 (估價單快照)

- `#q=1<base64url(UTF-8 JSON)>`，`1` 是格式版本 (日後要壓縮可用別的字首；實測 deflate 只省約 20%，中文品名壓不太動)。一套 8 件約 1.1–1.3K 字元。
- JSON = `{d, n?, b?, r: [[slot, cat, name, price, qty?, d?]]}`：`d` 是最多列共用的報價日期，列的日期與 `d` 相同就省略；qty = 1 且後面沒欄位就省略；`n` 標籤、`b` 來源 build。
- 解碼 (`CoolPC.decodeQuote`) 逐列驗證：最多 60 列 / 40000 字元、slot 要在 `D.slots`、cat 要屬於該 slot、品名 ≤ 200 字、價格 0–10⁷ 整數、qty 夾 1–9、同 slot 取第一列。整個壞掉 (截斷) 就 toast 後回預設。
- 其他商品 (全部分類) 存成 slot `'+'` 的列，可重複；網頁解碼時多傳 `{key: '+', cats: D.more.cats 的 id, multi: true}`。上限要涵蓋 UI 能產生的最大單 (10 格 + 其他商品 40 件)，改 UI 上限時一起改。舊版網頁不認得 `'+'`，會略過這些列並 toast「N 個品項格式不符」，主機格照常還原。
- 連結內容任何人都能捏造：品名、標籤、日期一律 `textContent` 或 `esc()` 後才放進 DOM (估價單檢視頁、`document.title` 也一樣)。
- 唯讀估價單 (檢視模式，2026-10-06 起)：`#v=1&q=…` (沒動過的預設配置是 `#v=1&b=mid`)。`v=1` 一律放最前、`q` 優先於 `b`，網址由 `CoolPC.readLink(hash)` / `CoolPC.linkHash({view, q, b})` 讀寫 (有測試)。舊版網頁有 `q` 時只讀 `q`、忽略 `v`，所以新連結在快取的舊頁照樣開編輯模式。檢視模式只給解得開的 `q` 或對得到的 `b`；壞連結、`#v=1&b=不存在` 都退回編輯模式，不把預設配置當成別人的估價單顯示。
- 舊格式 `#b=mid&cpu=4:22` 只採用 `b`，其餘參數忽略並 toast (舊 id 可能指到別的商品)；`readLink().legacy` = 有 `q`/`b`/`v`/`s`/`store` 以外的鍵。

### 店家模式 (2026-10-06 起)

給電腦店老闆／業務幫客人報價：估價單抬頭換成店家、整單本店價、服務加價列、客戶稱呼、有效期限、備註、可隱藏原價屋單價。UI 見 site-ui.md「店家模式」。

- 本機店家資料 localStorage `coolpc.store` = `{on, name, rep, tel, line, addr, tag}` (try/catch；存不了只在本次有效)。每個分頁另有 `issuer` (連結帶來的店家) 與 `biz` (店家報價)，`orig` 也存這兩個，重設會一起還原。
- 連結在版本 `1` 加選用欄位 (舊版網頁 `decodeQuote` 忽略不認得的鍵；沒有店家時 `encodeQuote` 輸出跟以前逐字相同，有測試釘住)：`s` = `[店名, 業務, 電話, LINE, 地址, 標語]` (尾端空字串省略)、`p` = `[本店價, 填價時的原價屋合計]`、`x` = `[[服務名稱, 金額]]` (≤ 8 列，±10⁶，0 = 免費，負數 = 折抵)、`c` 客戶稱呼 ≤ 20、`u` 有效期限 `YYYY-MM-DD`、`m` 備註 ≤ 200 (可換行)、`h: 1` 隱藏原價屋單價。沒有 `s` (或店名不合格) 時不編碼也不還原其餘店家欄位。一般店家單約 2–2.5K 字元。
- 驗證 (`cleanStore` / `normBiz`，連結與設定表單共用)：先清控制、零寬、bidi 字元；店名必填 ≤ 30 且不可含「原價屋」/coolpc；電話只收數字、空白、`+-()#` 且至少 6 碼；LINE ID `^@?[a-z0-9._-]{3,20}$` (轉小寫)；長度超過就丟該欄 (不截斷)，壞欄位只丟該欄、品項照常還原。文字欄照收但畫面一律 `textContent`/`esc()`；`tel:`／LINE 連結只由 `CoolPC.telHref` / `lineHref` 產生 (個人 ID → `https://line.me/ti/p/~id`，`@` 官方帳號 → `https://line.me/R/ti/p/%40id`)，備註與地址不轉成連結。
- 本店價失效：`p[1]` 是填價當下的 `totals().quoted`；之後只要原價屋合計不同 (換件、改數量、全部改用現價、清空、即時報價更新了跟著型錄的列) 就 `stale`，編輯區提示「保留本店價」，估價單標「本店價（需向店家確認）」。`bizTotals(quoted, biz)` 算本店合計 = (本店價，沒填用原價屋合計) + 服務列。
- 歸屬 (`BuilderUI.owned` / `issuerFor`)：店家模式開著且已填店名，這張單沒有店家或店名正規化後相同 → 自己的單，可填店家報價，分享時抬頭用本機資料；別家店的單唯讀，「改用本店報價」清掉對方的 `issuer`/`biz`。沒動過的分享單只有在店家也沒換時才沿用原連結 (`pristine`)，所以店家打開客人的單直接轉傳，也會帶上自己的店家資訊。
- 店家設定連結：`?openExternalBrowser=1#s=1<base64url(JSON 店家陣列)>` (`encodeStore`/`decodeStore`)，不帶業務姓名；`openExternalBrowser` 讓 LINE 改用外部瀏覽器開 (內建瀏覽器的 localStorage 是分開的)。打開時一律開設定對話框讓人確認、標出會取代的欄位，按儲存才寫入；`#store` 直接開設定 (推廣連結 `pc.jakeuj.com/#store`)。兩者都在同一頁處理，不重新載入。分享出去的網址用 `location.href.split(/[?#]/)[0]`，不把 query 帶給客人。
- 舊版網頁 (Pages 快取約 10 分鐘) 打開店家單：照一般分享單顯示原價屋價格與 ▲▼、沒有店家抬頭，不報錯 (已用 HEAD 版 docs 實測)；打開 `#s=`/`#store` 會出現「舊版連結」toast。
- 任何人都能捏造店家連結：估價單店家版頁尾固定寫「店家資訊與價格由製作者自行填寫，本網站未經查核」，並保留「由 <網域> 免費估價工具產生」。
- 對照 (`CoolPC.reconcile`)，回傳 `{item, how, alts?}`：
  1. 完全相同的 `分類|品名` → `exact`。
  2. 同分類同 ｛型號｝、價格條件標記 (搭板 / 任搭 / 組裝價 / 裝機價 / 限搭機 / 限組裝) 也相同且只有一件 → `model`「同型號・品名有變」；同條件多件 (例如代理 / 平輸都叫 ｛AMD R7 9800X3D｝) 不猜 → `item: null` + `alts`。
  3. 同型號還在賣、但條件全都不同 → `variant` (2026-10-06 起)：搭板 / 裝機價 / 限搭機 / 限組裝優惠結束只剩原價，或原價品項改成任搭優惠。候選先取無條件的原價品項，沒有才用全部；多件時用 ｝ 後規格文字的最長共同前綴挑最像的 (「代理盒」→ 代理盒裝，不是平輸盒裝)，同分不猜 → `alts`。`CoolPC.condNote(舊品名, 新品名)` 產生「搭板優惠已結束」「裝機價已結束」「改為任搭優惠」等說明。
  4. 都不行 → 已下架。
  - 實測：9/18–10/4 的 11 份快照之間有 28 件「品名消失但同型號換了條件」，以前全被當成下架；現在全部是 `variant`、各挑到唯一一件，沒有同分。驗證法：把各版 `data/coolpc_prices.json` (`git show <rev>:...`) 依序丟進 `indexCatalog` / `reconcile` 回放。
  - `variant` 有 item，所以 `totals()` 的現價用同型號現價、不算 `goneCount`；鎖價列 (分享單、預設配置的 gone 列) 的報價不變。
- 漲跌基準是連結每列的 `price` (分享當時的價格) 對現行型錄價，呈現見「index.html 內部重點」的 `cmp`。驗證：拿 build 品項做連結、把 RAM 的 price 減 500 → 該列「現價 X（比 M/D ▲500）」、摘要合計 ▲500；反向拿原價屋標 `價格異動` / `下殺` 的品項以現價做連結 → 摘要「價格都一樣」、單價欄沒有 ▲▼。原價屋把「▼下殺到 10/31 20:00」直接寫在品名裡 (2026-10 約 43 件)，選件面板看得到，那是原價屋原文。

### 從現成估價單 (截圖 / 清單) 產生連結

1. 對品名：原價屋估價單截圖的「產品名稱」是 option 原文 `品名, $15000 ◆ ★ 熱賣`，連結要的品名是 `, $` 前那段；「備註」欄是群組名，可用來定位。在 `docs/data.json` 的 `categories` 找完全相同的品名 (或 `search_coolpc.py 0 '<型號>'`)。
2. 定價與日期：價格用截圖上的 (當時報價)，`d` 用截圖日期 `YYYY/M/D`。型錄已沒有的品項 (例如過期的搭板價) 照截圖原文放：同型號還在賣就顯示「搭板優惠已結束」並跟同型號現價比，真的沒了才顯示「已下架」；都仍以截圖價計入總計。
3. 用網站自己的編碼器產生，並回解驗證列數、`dropped` = 0、總計：

   ```bash
   node -e '
   require("./docs/coolpc-live.js"); const C = globalThis.CoolPC, D = require("./docs/data.json");
   const d = "2026/10/1";                       // 截圖上的報價日期
   const q = { n: "R7 9800X3D 自組", rows: [    // n = 分頁標籤；slot / cat 要符合 D.slots，不符的列會被丟掉
     { slot: "cpu", cat: 4, name: "[搭板專案 ]｛AMD R7 9800X3D｝代理盒【8核/16緒】4.7G(↑5.2G)任搭主機板現省900", price: 15000, qty: 1, d },
     { slot: "mb",  cat: 5, name: "｛技嘉 B850 EAGLE WIFI6E｝/ATX/1G+無線/註四年/8+2+2相", price: 6490, qty: 1, d },
   ]};
   const s = C.encodeQuote(q), back = C.decodeQuote(s, D.slots);
   console.log("rows", back.rows.length, "dropped", back.dropped, "total", back.rows.reduce((a, r) => a + r.price * r.qty, 0));
   console.log("估價單：<網頁網址>" + C.linkHash({ view: true, q: s }));   // 給人看 (唯讀、可列印)
   console.log("可編輯：<網頁網址>" + C.linkHash({ q: s }));'
   ```

4. 開連結確認總計 = 截圖的含稅現金價，回覆時一併說明：
   - 截圖的「優惠省 N / 現金優惠價」是原價屋的任搭折，連結不存；網頁依現行型錄的 `任搭折N` 重算，實付可能和截圖不同。
   - 只放部分欄位沒關係：其他格顯示新增入口，相容性提示只看有放的零件 (搭板 CPU 沒放主機板會提醒)。
   - 截圖比網站快照舊、品項已從型錄消失時，該列顯示「已下架」或「…優惠已結束」是正常的 (本 repo 沒開即時報價，型錄就是 workflow 最後一次的快照)。

## index.html 內部重點

- `IDX = CoolPC.indexCatalog(CAT)` (`byKey` 分類|品名、`byModel` 分類|型號 → 各品名)；`find(row)` = 主機格 `CoolPC.reconcile(row, IDX)`、其他商品 (`row.x`) 對完整型錄 `IDXA`。主機格不跟 `ALL` 比，免得加回的剔除群組讓型號對照多出候選。`render()` 每次重畫零件列與摘要 (`partCard()` 主機格與其他商品共用)，選件面板獨立維護。
- 分頁 `tabs[] = {kind: 'preset'|'shared', key, label, sub, note, purpose?, platform?, d?, base?, raw?, rows, more, orig: {rows, more}}`；`rows[slot] = {cat, name, qty, pin}`，`more = [{cat, name, qty, pin, x: true}]`。`pin = {price, d}` 是鎖定的報價 (分享連結的每列、已下架的預設品項)，`null` 跟著現行型錄。`allRows(t 或 t.orig)` 取全部列、`entries(t)` 取 `{slot, label, r}` (主機格依欄位順序再接其他商品)，合計、提示、複製清單、分享都走這兩個。
- 全部分類：`#scope` 開關存 localStorage `coolpc.allCategories` (每位訪客記住，讀寫包 try/catch)，只管能不能新增 (`#more-add`)；已選的其他商品有算進總計，關著也照樣列出。`ensureMore()` 只載一次 `data-more.json` (失敗清掉 promise，下次切開關重試)；分享單有其他商品時先 `await` 再畫，載入失敗則以連結報價計並標「其他分類的報價載入失敗」，不誤標已下架。同一件再加一次改成數量 +1，最多 40 件 (`MAX_MORE`)。
- 改選品項 → 該列 `pin = null` (分享時才以現價定價)；改回原品項還原 `orig` 的 pin；只改數量保留 pin。「全部改用現價」把對得到的列 unpin。
- 網址：沒動過的分享單保留原 `raw` 不重新編碼、沒動過的預設配置 `#b=key`、全部清空的單不帶 `#` (`decodeQuote` 不收空單；複製清單 / 分享按鈕改 toast 提示)、其餘 `#q=`；檢視模式前面加 `v=1&` (`hashFor` 看 `mode`)；`hashchange` (貼上別的連結) 會重新載入，regex `/[#&][qb]=/` 也比得到 `&q=`。分享按鈕 (摘要、手機底部列、估價單的「複製估價單連結」、複製清單最後一行) 一律產生 `#v=1&q=`，「複製可編輯連結」產生 `#q=` (`shareUrl(t, view)`)。剪貼簿被擋 (App 內建瀏覽器) 時退回 `prompt()` 讓人手動複製。
- 檢視模式 (`mode` = `'view'` / `'edit'`)：網址有 `v=1` 且 `viewable` 時一開始就是 view，要在第一次 `select(cur)` 前決定 (不然第一次 `syncHash` 會洗掉 `v=1`)。`applyMode()` 只切顯示 (`body.view-mode` 藏 hero / `#meta` / 說明，`#builder`、`#mobile-bar` 與 `#sheet` 互斥)；`setMode(m)` 切換後 `render()`，網址用 `replaceState` 不留歷史；空單不能預覽 (toast)。進檢視捲到頂並聚焦 `#sheet-title`；回編輯回到按「預覽」前的捲動位置與按鈕，直接開檢視連結的回頁首 `#preset-title`。
- `renderSheet()` 由 `render()` 結尾在檢視模式呼叫 (即時報價、全部分類載入、切分頁都會走到)，只重填 `#sheet-*` 內層，動作列與標題是靜態的，重畫時焦點不會掉。單價與合計照估價單報價 (`pin`)；品名下小字：已下架 (`goneText`)、`variant` 的 `note` + 同型號現價、漲跌「現價 $X ▲N」、與抬頭不同的報價日期、條件標記 (只列搭板 / 組裝價 / 裝機價 / 限搭機 / 限組裝 / 任搭折 / 限購 / 訂購)。合計區：合計 (含稅) → 有漲跌或查無時「以現價計」與「N 項查無現價，以報價計」→ 有任搭折時任搭折扣與估計實付。備註用 `warnings(true)`：不列下架 (各列已標)、不寫「按更換」「切換全部分類」這類編輯指示。抬頭報價日期 `quoteDate()`：沒動過的分享單用連結的 `d`，其餘用 `CoolPC.commonDate(quoteOf(t).rows)` (同分享連結會帶的 `d`)。
- 資源版本：`index.html` 引用 builder.css、builder-ui.js 與 coolpc-live.js，各帶版本 query。改動相依 CSS／JS 時更新版本（同日可加修訂後綴）；同步模板引用，避免新 HTML 配到快取的舊介面或缺少匯出函式。
- 合計 (`CoolPC.totals`)：估價單總計 = 報價；以現價計 = 對得到的用現價 (`variant` 用同型號現價)、已下架以報價計，所以差額只反映漲跌；任搭折只看對得到的列。
- 漲跌一律用 `cmp(r)` (`dv = 現價 − pin.price`，即分享連結裡的當時價格)，單價欄「現價 X（比 9/21 ▲N）」、分享單上方摘要 `#chg` (`changes()`：鎖價列逐列 + 合計，全沒變顯示「價格都一樣」，預設配置不顯示)與複製清單都用它。原價屋自己的近期調價標示 (品名裡的「▼下殺到…」、`價格異動` / `下殺` 旗標、原價) 跟這個無關，頁面上有寫明，別混用。
- `variant` 的顯示 (`cmp(r)` 另帶 `how`、`alts`、`note`)：品名仍顯示原本報價那件 (`r.name`)，下面小字「同型號現行品項：…」；單價欄 `.d.renamed` 標 `note`，再接「同型號現價 X（比 10/1 ▲N）」；摘要一定列出 (價格沒變也列「價格沒變」)；算可重報 (「全部改用現價」換成同型號那件)；選件面板不把同型號那件標「目前選擇」，改標「同型號現行品項」；複製清單尾巴寫 note 與同型號現價。`alts` (挑不出唯一) 時仍是已下架，另提示「同型號還有 N 件」，開選件面板先用型號篩選。
- 「帶到原價屋估價頁」(`#coolpc`，摘要按鈕區整列寬 `.b.wide`；估價單動作列的 `#sheet-coolpc` 共用同一個處理器，`action` 取 `e.currentTarget.href`)：本身是 `href=evaluate.php` 的連結，空單不攔截 = 開空白估價頁；有東西時 `CoolPC.evaluateForm()` 組 `iname` / `icnt` (同品名合併、數量上限 10)，臨時建 `<form method=post accept-charset=big5 target=_blank rel=noopener>` 送出，原價屋預先選好品項與數量 (協定見 [coolpc-pages.md](coolpc-pages.md))。每列送 `find(r).item` 的現行品名 (`variant` 是同型號現行那件、`model` 是改名後的)，查不到的照送 `r.name` (原價屋對不到會略過) 並 toast「N 項目前查不到」。原價屋那邊一律現價，鎖價列的舊報價帶不過去。
- 介面用方案卡、零件列、原生 dialog 選件面板與響應式摘要；布局、搜尋、焦點及驗收見 [site-ui.md](site-ui.md)。
- 配置：`buildTabs()` 只畫目前用途的預設配置，選中以 key 對應；`renderPreset()` 畫目前總計／修改狀態和收合摘要。用途篩選不呼叫 `select()` 或 syncHash；點配置才 select，保留 tabs 內各方案草稿。分享單有獨立返回入口。起始／收合和焦點規則見 [site-ui.md](site-ui.md)。
- `openPicker(slot)`／`openMorePicker(index)` 共用 dialog；`preparePickerGroups()` 建立當前分類的型錄條目與規格群組。每次開啟重設群組與排序，搜尋範例依欄位變動；下架但有同型號候選時保留型號預填。
- `renderPicker()` 呼叫 `BuilderUI.searchEntries()`：NFKC／小寫／空白分詞 AND，比對品名、群組和分類；原順序分組，價格排序跨群組且同價穩定。其他商品未選分類、群組或關鍵字時顯示入口；跨分類先篩選排序再截取 300 件，回報完整符合數。
- `applyCandidate()` 與價差預覽分別使用 `BuilderUI.selectCandidate()`／`previewCandidate()`，後者共用前者且不改 cur。價差為套用後 quoted − 目前 quoted，保留數量、原 pin 與加購合併規則，不扣任搭折；替換為已在其他商品清單的品項時回傳錯誤並保留面板，不顯示數字價差。移除主機欄位把 row 設為 null，支援部分零件估價單。
- 相容性 regex：CPU/MB 腳位取群組名 `AM4|AM5|1851|1700|…`；DDR 取群組名 `DDR[345]`；顯卡長 `/(\d+)cm`；機殼 `顯卡長?(\d+)`、`(?:CPU|U)高(\d+)`；塔散 `高(\d+)cm`（只對分類 10 檢查，水冷不查）。
- 資訊類提示 (非錯誤) 用 `ok` 樣式：文字含「OK）」。已下架是要處理的警告 (紅色)。
- 搭板 CPU：單上有主機板 → ok 樣式；沒有 → 紅色警告 (單買不是這個價)。已下架的 CPU 查不到 flags，改用品名 `/搭板|任搭|搭主機板/` 判斷 (同 `parse()`)。CPU 無風扇提示寫成「沒有沿用舊散熱器的話，請選一顆」，因為只換零件的單常常不含散熱器 (估價單檢視頁改成「需沿用舊的或另購」)。
- 即時報價：`CAT` 是 `let`，`index()` 重建 `IDX`；`refreshLive()` 抓 `live_url` → `CoolPC.decode` (TextDecoder big5) → `CoolPC.parse` → `CoolPC.select(parsed, D.slots, D.filters)` → `applyLive()` 整份換掉 (完整型錄已載入時，補集也用 `selectRest` 從現頁重算；之後才開全部分類就用最後一次的現頁，不再抓 data-more.json)。因為估價單都用分類 + 品名對照，換型錄只要重畫；換之前把「跟著型錄」但新型錄找不到、或只剩條件不同的同型號 (`variant`) 的列用舊型錄價格 pin 住 (之後顯示已下架 / 優惠已結束)，不會默默從搭板價換成原價。`SRC` 記目前來源 (快照 / 即時 + 時間)，`meta()` 顯示。載入時自動抓一次，按鈕再抓；失敗只在 meta 下方加一行，不影響使用。`live_url` 空字串時完全不抓、按鈕隱藏。

## 即時報價代理 (worker/)

- **本 repo 狀態**：程式在 `worker/`，但從沒部署 (`coolpc.jakeuj.com` 沒有 DNS 紀錄)。10/2 曾先把網址填進 `live_url`，結果網頁每次載入都「即時報價暫時抓不到（Failed to fetch）」再退回快照，還多一個沒作用的按鈕；同日改回空字串。使用者目前不要即時查價，價格只靠 workflow。
- 看到 Failed to fetch 先 `dig +short coolpc.<domain>`：沒結果就是沒部署 (或自訂網域沒建好)，不是程式壞了。
- 原價屋回應沒有 `Access-Control-Allow-Origin`，Pages 上的 JS 不能直接 fetch，一定要代理。Worker 只做三件事：抓 evaluate.php 原始 Big5 位元組、加 CORS、`caches.default` 快取 `CACHE_TTL` 秒 (預設 300)。不解碼、不解析，內容檢查只看 `id=Mdy` 與 Big5 的「共有商品」位元組。
- **Cache API 只在自訂網域上有效，`*.workers.dev` 不會快取**，所以 wrangler.toml 用 `routes = [{ pattern = "coolpc.<domain>", custom_domain = true }]`；該 zone 的 DNS 必須在 Cloudflare，部署時會自動建 DNS 紀錄。
- 回給瀏覽器的 `Cache-Control` 改成 `no-store`（快取只在邊緣），另帶 `X-Fetched-At` (實際抓取時間) 與 `X-Cache` HIT/MISS，並用 `Access-Control-Expose-Headers` 露出。前端 `?t=` 防瀏覽器快取，但 Worker 的 cache key 固定，不會打穿邊緣快取。
- `ALLOW_ORIGINS` 逗號分隔白名單，Origin 不在名單就回第一個 (等於擋掉其他站的瀏覽器)；curl 當然擋不住，只是避免被當免費鏡像。
- 瀏覽器端：`Response.text()` 永遠當 UTF-8，要 `arrayBuffer()` 再 `new TextDecoder('big5')`；三大瀏覽器都支援 big5。1MB 頁面經 Cloudflare 壓縮後約 200KB，解析 < 10ms。
- 部署：`cd worker && npx wrangler login`（OAuth，一次）→ `npx wrangler deploy`。Keychain 裡 `cloudflare-api-token-jakeuj-com` 那把 token 只有 DNS 權限，不能部署 Worker；要用 token 的話另建 `Workers Scripts:Edit` + `Zone:Read` + `DNS:Edit` 的 token 放 `CLOUDFLARE_API_TOKEN`。
- 驗證 (要先過這關才填 `live_url`)：`curl -sI https://coolpc.<domain>/evaluate.php` 看 `access-control-allow-origin`、`x-cache`、`x-fetched-at`；連打兩次第二次應 HIT。JS 解析器要跟 Python 對齊：`node -e 'require("./docs/coolpc-live.js"); ...'` 對同一份 evaluate.php 解析，`JSON.stringify(parse(html).categories)` 應等於 `data/coolpc_prices.json` 的 `categories`，`select()` 結果應等於 `docs/data.json` 的 `categories`。
- 本機測試不必真的部署：寫個小 http.server 同時提供 docs/ 與 `/evaluate.php`（把 UTF-8 的 evaluate.php 用 cp950 編回 Big5 + CORS header），並在回 data.json 時把 `live_url` 改指本機。

## 部署與 CI 的坑

- `gh api repos/<owner>/<name>/pages` 回的 `html_url` / `cname` 就是實際網址：預設是使用者 Pages 的自訂網域路徑 (blog.jakeuj.com/<name>/)，repo 有 `docs/CNAME` 就是那個子網域 (本 repo 是 pc.jakeuj.com)，舊路徑與 github.io 都會 301 過去。換網域後 README、`promo.md`、`docs/index.html` 的 canonical / `og:url`、`worker/wrangler.toml` 的 `ALLOW_ORIGINS` 要跟著改 (改之前先問使用者)；舊網址 301 時瀏覽器會帶著 `#q=` 片段，舊分享連結不會壞。剛綁的子網域要等 GitHub 簽好憑證 (`https_certificate.state` 為 `approved`) 才有 https，並非網站壞了。
- push 前先 `git fetch` 比對遠端：使用者網頁修改與報價 workflow 都可能推 commit。落後時保留本機未提交內容再整合；報價檔衝突以較新快照重跑 build_site.py。只提交本次範圍；技能正本 .agents 與網站是不同 repo，更新／同步技能本身不代表兩邊都要推送。
- 推送後等待 Pages build／workflow 的 commit 等於本次 head 且成功，避免把前次 success 當成本次完成。再抓正式 HTML、其引用的 CSS／JS 與 data.json，確認 HTTP 成功、版本引用、canonical 與配置分類；瀏覽器等報價載完再確認 UI 和 console。部署可能需要數十秒或更久，區分推送、部署與正式載入三個結果。
- workflow 每小時 :30 跑，`git add -A -- data docs quote.md` 後 `git diff --cached --quiet` 有變才提交 (`build_site.py` 內容沒變時沿用 `generated`)。別改回 `git diff --quiet -- <檔案>`：它看不到還沒追蹤的新檔 (例如第一次產生的 `data-more.json`)；`-A` 加目錄則容許 `all_categories: false` 時沒有這個檔。
- 額度：repo 是 public，Actions 標準 runner 免費且不限分鐘，每次約 10–25 秒；使用者確認過維持每小時，不必為了額度降頻。private repo 才吃免費方案每月 2,000 分鐘 (每次至少算 1 分鐘，每小時 ≈ 720 分鐘/月)。Worker 免費方案每天 10 萬次請求，網頁每開一次抓一次，朋友用綽綽有餘。
- 排程不準時：schedule 只是排進佇列，run 被派發時才建立。2026-09 每天 03:30 UTC 的排程實際在 08:11–10:01 UTC 才開跑 (晚 4.7–6.5 小時)，10/1 整次被跳過。「每小時」實際是一天幾次，快照可能比排程時間舊；有開即時報價的網頁不受影響，本 repo 沒開，網頁價格就是這份快照。跟使用者描述更新時間用「大約、可能延後數小時」。
- runner 是 UTC，時間戳一律在 build_site.py 用 `ZoneInfo("Asia/Taipei")` 產生。
- 本機重跑 workflow 的步驟時，`quote.py` 直接列檔名：`quote.py --summary builds/low.json builds/mid.json builds/high.json > quote.md`。workflow 裡 `BUILDS=$(...)` 再 `$BUILDS` 的寫法靠 bash 拆字，在 zsh 會變成一個檔名而失敗，而且 `> quote.md` 已先把檔案清空。
- `csv.DictWriter` 要 `lineterminator="\n"`，否則 CSV 進 git 會有 CRLF 警告。
- 本機預覽可放 `.claude/launch.json`（python3 -m http.server 8765 --directory docs），已在 .gitignore。
- `build_site.py --init` 從載入的技能目錄建立目標專案 `.claude/skills/coolpc/` 執行副本（已存在則略過），workflow 呼叫這個可攜路徑；另建立 HTML、builder.css、JS 等資源。維護共用正本後，僅同步受影響檔案到指定專案，保留既有客製與設定。

## 專案知識圖 (docs/graph/，本 repo 限定)

graphify 從程式、文件與驗收截圖建的關係圖，給想看程式怎麼串起來的開發者，發布在 `pc.jakeuj.com/graph/`。頁面 `noindex`、估價網站沒有入口：買電腦的人用不到，也不該從搜尋進來。

程式結構、文件或 SDD 驗收截圖有大改時才手動重建，不接每小時 workflow：重建要 LLM 讀文件與截圖 (2026-10-06 完整建一次約 74 萬 token，`--update` 只重抽變動檔)。

1. Claude Code 跑 `/graphify . --update`；沒有 `graphify-out/` (新 clone 或刪掉過) 就跑完整 `/graphify .`。
2. 合併語意抽取前，把 subagent 節點 ID 對齊 AST：`.claude/skills/coolpc/…` 的 AST ID 是 `claude_skills_coolpc_…`，subagent 照 spec 字面會寫成 `_claude_skills_coolpc_…`，文件連到程式的邊因此全部懸空。去掉語意 ID 開頭的 `_` 後再查懸空邊，直到只剩這些 AST 已知項：連到標準庫 (pathlib、json、re…) 的 import、scripts 之間的相對 import (`coolpc_match`、`fetch_coolpc`)，以及 Worker 的 `fetch` 呼叫全域 `fetch()` 被當成的 self-loop。
3. `python3 scripts/publish_graph.py` 產生 `docs/graph/index.html` (補手機版面、繁中標題、noindex 與返回連結)。它用 regex 改 graphify 的 HTML，graphify 改版後找不到錨點會停下並印「找不到 …」：改 script 的 pattern 再重跑。
4. 手機寬度與桌面都預覽一次 `docs/graph/`：圖可拖動縮放、側欄可捲動、「回到估價網站」連回首頁，再提交 `docs/graph/index.html`。
