# 接續 prompt：原價屋估價單分享（pc.jakeuj.com）待優化項目（2026-10-22 審查後）

接續「原價屋估價單分享」的功能開發。上一輪已推上 main：改單差異比較（4b8992c）、零件價格歷史 docs/history.json 與迷你折線（4bedb4c）、分享連結 deflate 壓縮版本 2 ＋ 唯讀估價單 QR Code ＋ 最近開過（235876e）。之後用 54 個 agent 從正確性、安全、資料流、UX／列印、規格落差、效能六個視角審這三個 commit，逐條對抗驗證，確認 23 條問題。這一輪依序修下面七項，每項各自一個 commit，做完一項就 commit 並 push 再做下一項。

## 專案規則（先讀再動手）
- 先 `git pull --rebase --autostash origin main`：報價機器人每小時 commit，本機常落後。
- `docs/index.html`（主程式，inline JS 約 1400 行）、`docs/coolpc-live.js`（解析、對照、分享連結編解碼）、`docs/builder-ui.js`（純規則，可測）。`docs/` 的三個 js/css 必須與 `.claude/skills/coolpc/templates/` 同名檔完全一致（CI 會 diff）；`index.html` 兩邊只差 meta／標題，改邏輯時兩份都要改。
- 改完 `.claude/skills/coolpc/` 要 rsync 到共用正本 `~/.agents/skills/coolpc/`（另一個 git repo，最後一併 commit push）。
- 測試：`node --test '.claude/skills/coolpc/tests/*.test.js'` 與 `python3 -m unittest discover -s .claude/skills/coolpc/tests`；新規則放 builder-ui.js 或 coolpc-live.js 並補測試。
- 介面改動用 `preview_start` 的 `docs` 設定（python http.server 8765；8765 被佔時用 `docs-8766`）在瀏覽器驗收，含手機寬度與唯讀估價單（#v=1&q=）。
- `docs/graph/index.html` 與 `.graphifyignore` 是使用者自己未提交的變更，不要動、不要 commit。
- 回覆、註解、commit 訊息用繁體中文，commit 訊息結尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 分享連結格式字首 '2' 是 deflate-raw，'1' 永遠要能開（coolpc-live.js encodeQuote／decodeQuote 都是 async）。
- 技能文件（`.claude/skills/coolpc/SKILL.md`、`references/site-ui.md`、`references/site.md` 除「功能評估與待辦」外的段落）另一個 session 在改，不要動；只改 site.md 的「功能評估與待辦」段。

## 1. 價格歷史正確性（high）
情境：`build_site.py` 的 `model_prices()` 對同「分類|型號」取最低價，把搭板專案／組裝價／裝機價／任搭價等條件價件跟一般件混成一條序列。目前 113 個多件型號有 16 個「最低價是條件價件」，含預設配置的 9600X／9700X／9800X3D／7500F／7700：一般件 R7 9700X 11,550 的卡片顯示「30 天最低 $9,950」加上漲折線，其實 9,950 是搭板價那件，一般件 30 天只動 100 元；搭板件下架期間連「同型號」字樣都不出現。
- `build_site.py`：條件價件另記 key「分類|型號|條件碼」（條件碼同 coolpc-live.js `COND_RE` 的五位 0/1：搭板|任搭|搭主機板、組裝價、裝機價、限搭機、限組裝），無條件的一般件維持「分類|型號」；同一 key 內多件（代理／平輸）仍取最低。`builder-ui.js historyKey(cat, name)` 用同一組 regex 決定查哪個 key。改完 `--backfill-history` 重新回填並提交 history.json；同步改 `tests/test_scripts.py`（目前明文斷言搭板價是最低）與 builder-ui 測試。
- 「同型號」前綴改成明確句子：價格不等於紀錄值時寫「同型號最低款：30 天最低 $A／最高 $B」或「同型號最低款 30 天價格沒變（$X）」。
- 視窗內才上架的型號（目前 166 個）不要寫「30 天價格沒變」：`historyStats` 回傳涵蓋天數 `since`，`histHtml` 在 since < 30 時寫「上架 N 天，價格沒變（$X）」／「上架 N 天：最低 $A／最高 $B」；說明區同步改。
- `build_site.py` 讀上一版 history.json 時連值的形狀一起驗（每筆要是 [日期字串, 數字]），不合格走既有「重新開始記錄」分支，`update_history` 失敗也不能讓每小時排程整個失敗；補測試。
- `--backfill-history`：淺 clone（`git rev-parse --is-shallow-repository`）直接 sys.exit 提示 `git fetch --unshallow`；回填 0 次快照不覆寫既有檔；git log 與 git show 的路徑都相對 `git rev-parse --show-toplevel`，子目錄也能回填。
- `sdd/price-history/tasks.md` 驗收條件「其他商品不顯示」改成「非主機分類的其他商品不顯示；主機分類（第二顆 SSD 等）會顯示」。

## 2. QR Code 可掃性（high）
情境：`qrSvg(url, 104)` 與 builder.css 的 104px／88px／30mm 都是固定值，但實際唯讀連結是版本 21–27（109–133 單位），每格不到 1 CSS px、列印 0.23–0.28mm；用 headless Chrome 點陣化後 OpenCV 與 BarcodeDetector 在 DPR 1 全部解不出，DPR 2 的店家單也解不出。
- 尺寸隨格數：`qrSvg` 先依 byte 長度決定糾錯等級只算一次（≤ v20-M 容量 666 bytes 用 M，否則 L；M 放不下也退 L，2,332–2,953 bytes 現在會無聲消失），回傳的 svg 帶 `data-n`（含留白的單位數）且 width/height = max(104, n×2)；`renderQr` 把 n 寫進 `--qr-n`，列印 CSS 用 `calc(var(--qr-n) * 0.4mm)`（v23 約 47mm），手機整列置中、max-width 100%。
- `renderQr` 延後到估價單畫出來之後再算（setTimeout／requestAnimationFrame），回來時重新核對 mode 與 url 是否仍是目前這張。
- 連結超過 L 上限時顯示一行「連結太長，無法產生 QR Code」而不是整塊藏起來。
- 測試：2,500 bytes 非空、width ≥ 2×n、data-n；瀏覽器用 BarcodeDetector 在 DPR 1 解得出預設配置與店家單。

## 3. 分享連結與最近開過的正確性（medium）
- 最近開過只記快照：檢視模式的 `syncHash` 不要把 `#v=1&b=key` 記進去，改用 `withShareUrl(cur, true, …)` 的快照 hash，讓預覽與分享存同一筆（自然去重）。卡片日期統一斜線格式（`dateText(e.at)`），「開過」改「最近使用」；說明區改成「分享、預覽或打開過的估價單」。
- `renderPreset` 只處理有 `dataset.key` 的卡片，不要把 aria-pressed 蓋到最近開過的卡片與清除按鈕；目前開著的那張（`C.readLink(e.hash).q === cur.raw`）加 `.on` 與 `aria-current`；`.recent-clear` 手機版補 min-height 44px。
- `canZip()` 實際 `new CompressionStream('deflate-raw')` 試建一次並快取（Chromium 80–102 有類別但不支援 deflate-raw，現在會被誤報成「連結不完整」）；測試 stub 丟 TypeError 斷言 /太舊/。
- `syncHash` 在 await 前記下 `location.hash`，回來時若被外部改掉（openRecent、網址列貼連結）就放棄這次寫入，避免蓋回舊 hash 讓 hashchange 失效。
- `decodeQuote` 的 slotMap 改用 `Map`（或 `Object.hasOwn`）：slot 寫成 'constructor'／'__proto__' 現在會丟 TypeError 把整條連結弄壞；該列應算 dropped。補測試。

## 4. 改單差異文案（medium）
- `diffQuote` 多回傳 `sameModel`（`modelOf` 相同），`renderDiff` 對「同型號但品名不同」的列（改用現價後品名更新、搭板優惠結束）寫「品名更新（同型號），改用現價」／「搭板優惠結束，改用同型號現價 $X」，不用刪除線；標題「改了 N 處（含 M 處改用現價）」。
- `#diff` 與 `#chg` 兩個框樣式區分（例如 `.chg.diff` 換邊框色與圖示），兩個標題別只差一個字。

## 5. 價格歷史載入成本（low）
- 唯讀模式不載入 history.json（renderSheet 不用它），第一次進編輯畫面才載；拿掉 `?Date.now()`（GitHub Pages 的 CDN 忽略 query，只會讓瀏覽器永遠不能用快取／ETag），改成 `fetch('history.json')` 或 `?v=` + `D.generated`。
- 載完不要整個 `render()`：`histHtml` 先輸出帶 data-cat／data-name／data-price 的空 span，`fillHist(root)` 只填這些 span，零件卡、選件面板、漲跌摘要畫完各呼叫一次，載入完成只填一次，不重建 DOM、不碰焦點。

## 6. CI 的 index.html 一致性（low）
- `test.yml` 的「docs/ 與 templates/ 介面檔一致」步驟加 index.html：先用 sed 去掉站台專屬行（`<title>`、`og:`、`twitter:`、canonical、icon、apple-touch-icon、manifest、`<h1 id="title">`、`id="repo"`）再 diff，只改一邊就紅燈。

## 7. 文案（low）
- promo.md「手機可以用，也有深色模式」改成只有深色（或拿掉）；README「資料怎麼來的」第 3 步補 history.json 與 `--backfill-history`；`site.md`「功能評估與待辦」把改單差異、價格歷史、壓縮＋QR＋最近清單三項改成已完成並附實測（8 列單 1,243→1,028 字元只省 17%、加 12 件其他商品省 38%；history.json 只涵蓋主機型錄 154KB、gzip 25KB；history 只在價格變動時變且價格變時 data.json 一定也變，不會多出 commit），留下的低優先項目（淺色主題、PWA 離線、拆 index.html、OG 動態預覽）標成目前真正的待辦。

做完七項後重跑全部測試、確認 CI 綠燈、rsync 共用正本並在那邊 commit push，列出每項的 commit 與驗收方式。
