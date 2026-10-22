# 零件價格歷史與走勢：看近 30 天最低／最高與迷你折線

類型：新功能。此規格依使用者 2026-10-22 的需求整理（key 用分類＋型號、只在價格變動時追加、保留 90 天、首次由 git 歷史回填、另檔延遲載入且控管大小、選件面板與零件卡加小字與迷你折線、漲跌摘要加同一段、前後端都補測試）。

## 為什麼做

想「等降價」的人目前只能比「分享時 vs 現在」兩點，看不出一個零件最近是在漲還是在跌、現在的價格算高還是低。報價機器人每小時抓一次原價屋，git 歷史裡已經有 2026/9/18 起 40 多次快照，整理成每個型號的價格變動紀錄，網頁就能在每個品項旁邊顯示近 30 天最低／最高與走勢。

## 要改什麼

- `build_site.py` 產出 `docs/history.json`：平的物件，key = `分類 id|型號`（型號取品名 `｛…｝` 內的字，沒有型號的品項不記），value = `[[YYYY-MM-DD, price], …]`（日期取該次快照的報價日期）。只在價格跟上一筆不同時追加；同一天變動兩次只留最新。條件價件（搭板／組裝價／裝機價／限搭機／限組裝，條件碼同 coolpc-live.js `COND_RE`）另記 key「分類 id|型號|條件碼」，一般件的歷史不會混到搭板價；同一 key 內多件（代理／平輸）取最低價，網頁標「同型號最低款」（2026-10-22 審查後由「同型號全取最低」改成分開記）。保留 90 天：cutoff 之前只留最後一筆當走勢起點；已下架且最後一筆超過 90 天的 key 整個拿掉。
- 範圍只涵蓋主機型錄（`data.json` 的分類與剔除規則），不含 `data-more.json` 的其他商品：全部分類 6,600 多件 35 天就 310KB，主機型錄 2,700 個型號約 150KB，90 天估 200KB 以內（上限 300KB）。其他商品沒有資料就不顯示；日後需要可比照 data-more 另出第二個檔。
- `build_site.py --backfill-history`：從 `git log -- data/coolpc_prices.json` 依序讀每次快照回填（一次性，本機跑完提交）。`update-prices.yml` 步驟不變：`git add -A -- docs` 會帶上 history.json；內容沒變時輸出逐位元相同、不產生 diff（檔內不放時間戳，key 排序）。
- 網頁：`history.json` 在主畫面畫好後背景載入（失敗不影響使用）。零件卡的單價欄與選件面板每個品項加一行小字「30 天最低 $X／最高 $Y」與階梯式迷你折線（inline SVG，不引入套件）；30 天內沒變只寫「30 天價格沒變」不畫圖；沒資料不顯示。分享單上方的漲跌摘要每一列加同一段。品項價格跟紀錄的同型號最低價不同時標「同型號」。
- `builder-ui.js` 純函式：`historyKey`、`isoOfQD`、`historyStats(series, today, days)`、`sparkline(stats, w, h)`，附 Node 測試；`build_site.py` 的 `update_history` 為純函式，附 Python 測試（追加／去重／同日覆蓋／裁切／下架移除／同型號取最低）。
- 文案：index.html 說明區、`references/site.md` 補 history.json 格式。CI 的 `paths-ignore` 加 `docs/history.json`。

## 影響範圍

`.claude/skills/coolpc/scripts/build_site.py`、`tests/test_scripts.py`、`templates/{index.html,builder-ui.js,builder.css}` 與 `docs/` 的對應檔、`references/site.md`、`.github/workflows/test.yml`、新檔 `docs/history.json`；共用正本同步。

不改分享連結格式、`data.json`／`data-more.json` 的內容、唯讀估價單版面（它是快照，不加走勢）、即時報價流程。
