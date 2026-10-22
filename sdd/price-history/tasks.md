# 實作與驗收

- [x] 1. `build_site.py`：`split_catalog()` 抽出主機型錄的分類／剔除邏輯；`model_prices()`、`update_history()`（追加、同日覆蓋、連續同價合併、90 天裁切、下架移除）、`--backfill-history`；產出 `docs/history.json`（key 排序、無時間戳）。
- [x] 2. Python 測試：純函式各情境；pipeline 跑兩次內容相同、改價追加、同型號取最低、回填。
- [x] 3. `builder-ui.js`：`historyKey`、`isoOfQD`、`historyStats`、`sparkline`，附測試（視窗起點承接、新上架、沒變、超出視窗、壞日期）。
- [x] 4. `index.html`：背景載入 history.json；零件卡、選件面板、漲跌摘要加小字與迷你折線；CSS。
- [x] 5. 本機回填並提交 `docs/history.json`；CI `paths-ignore` 加該檔；`site.md`、說明區文案。
- [x] 6. 瀏覽器驗收（桌面與 390px）：零件卡、選件面板、分享單摘要、唯讀估價單不受影響；history.json 載入失敗時畫面照常。
- [x] 7. 同步模板與共用正本，Node／Python 測試全過。

## 驗收條件

- `build_site.py` 連跑兩次 `docs/history.json` 逐位元相同；價格變動後只多一筆；同一天兩次變動只留最新；90 天前的紀錄只剩走勢起點一筆；下架超過 90 天的型號消失。
- 回填後 `docs/history.json` 小於 300KB，涵蓋 2026/9/18 起的快照。
- 零件卡與選件面板：有紀錄的品項顯示「30 天最低／最高」與折線；30 天沒變或上架未滿 30 天只顯示文字；沒型號或沒資料的品項不顯示任何東西；非主機分類的其他商品（螢幕、週邊）不顯示，主機分類的其他商品（第二顆 SSD 等）會顯示。
- 條件價件（搭板／組裝價／裝機價／限搭機／限組裝）另記 key「分類|型號|條件碼」，一般件的「30 天最低」不會是搭板價（2026-10-22 審查後修正）。
- history.json 404 或格式錯時 console 無未捕捉錯誤，主畫面照常。
- 唯讀估價單（#v=1&q=）版面不變；手機寬度無水平溢出。
