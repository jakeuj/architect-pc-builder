# 原價屋的其他頁面與入口

`evaluate.php` 仍是唯一的資料正本；以下是 2026-10-06 從手機版 (`/m/`) 一路追出來、實測過的其他入口。原價屋自己也用「品名去掉 `, $價格`」當商品鍵（手機查價清單、帶單 POST 都是），跟 build 的 `match` 與分享連結用品名對照是同一套做法。

## 帶單到官方估價頁 (POST evaluate.php)

把一張估價單直接開成原價屋官方估價頁，品項與數量已選好，使用者可以接著列印、加購或聯絡原價屋。`4k.php` 的購物車鈕與 `evaluate.php` 自己的 `Reload()` (`/js/e19.js`) 都走這條。

- 請求：`POST https://www.coolpc.com.tw/evaluate.php`，`application/x-www-form-urlencoded`，**Big5 (cp950) 編碼**。
  - `iname` = `<>品名1<>品名2…`，品名就是 `data/coolpc_prices.json` 的 `name`（選項文字去掉最後一個 `, $` 之後）。
  - `icnt` = `<>數量1<>數量2…`，順序對應 `iname`。
  - 不需要 cookie / PHPSESSID / Referer。
- 回應：伺服器在頁面 JS 注入 `var pAry=[0,[分類,選項value,數量,加購旗標],…]`，`init` 時照著選好。
  - 同分類多件可行：`[7,2,1,1],[7,7,1,0]` — 先列的旗標 1 進「加購」清單，最後一件放主選單。
  - 對不到的品名直接略過、不報錯，所以已下架或條件價已結束的列要在送出前先提醒。
  - 只是開估價頁，不會下單；下單要另外帶手機號碼（見下方 `my.php`），我們只送 `iname` / `icnt`。
- 網頁已實作 (2026-10-06)：摘要的「帶到原價屋估價頁」，臨時建 `<form method=post accept-charset="big5" target="_blank">` 送出，細節見 [site.md](site.md)「index.html 內部重點」。
  - 瀏覽器實測 (Chromium)：預設中階 8 件 + 記憶體 ×2，原價屋預選 8 件，含稅價 $56,139、優惠價 $55,849 與我們網頁的總計、估計實付完全相同。
  - 編碼：瀏覽器的 Big5 編碼器 (WHATWG) 跟 cp950 有少數字對應不同，2026-10-06 型錄 1,358 個非 ASCII 字逐一比對全部一致。Big5 編不出的字 (香港增補字) 瀏覽器會改送 `&#NNNN;`，那一列就對不到。
  - Claude Desktop 的內建瀏覽器面板會把 `target=_blank` 的新視窗改成同分頁 GET，POST 內容丟失、原價屋頁面不會預選；在面板驗收時把 `HTMLFormElement.prototype.submit` 包一層改 `target='_self'` 再送 (只限測試)。一般瀏覽器開新分頁照常 POST (HTML 標準行為；實機 Chrome / Safari / LINE 內建瀏覽器尚未另測)。
- 驗證（curl 等價，送一兩件就好）：

```python
import json, re, urllib.parse, urllib.request
names, cnts = ["｛UMAX S330 240GB｝/2.5吋/讀520/寫450/3D NAND Flash【三年保】"], ["1"]
body = urllib.parse.urlencode({"iname": "".join("<>" + n for n in names),
                               "icnt": "".join("<>" + c for c in cnts)}, encoding="cp950").encode()
req = urllib.request.Request("https://www.coolpc.com.tw/evaluate.php", data=body,
                             headers={"User-Agent": "Mozilla/5.0"})
html = urllib.request.urlopen(req, timeout=60).read().decode("cp950", errors="replace")
print(re.search(r"var pAry=[^\n]*", html).group(0))   # 對到的話會列出 [分類,value,數量,旗標]
```

## 手機版 `/m/`

### 首頁：便宜的更新檢查

- `https://www.coolpc.com.tw/m/` 只有 3KB（gzip 約 1KB），頁尾 `2026/10/6 11:13更新` 與 `evaluate.php` 的 `<font id=Mdy>` 同格式、同時間；regex `(\d{4}/\d{1,2}/\d{1,2} \d{1,2}:\d{2})更新`。
- 用途（尚未實作）：workflow 先抓這頁跟 `data/coolpc_prices.json` 的 `quote_date` 比，相同就跳過下載完整頁。只在單一時間點比對過；過去 12 次自動 commit 的報價日期都不同，符合「內容變、時間就變」，但仍建議每隔幾小時強制抓一次完整頁保險。
- 另一個省流量點：`fetch_coolpc.py` 沒送 `Accept-Encoding: gzip`，`evaluate.php` 原始約 1.06MB，gzip 後約 220KB（`urllib` 不會自動解壓，要自己 `gzip.decompress`）。

### 分類頁：備援資料來源

- `https://www.coolpc.com.tw/m/m-list.php?G=N`（N = 分類編號 1–30，與桌機相同；GET 或 POST `G=N` 皆可，不需 session），每頁 7–120KB。
- 結構：群組 `<th onclick=Pull(this) …><img src='p.gif'> 群組名`；商品 `<td onclick=A(this)[ class=r|g|b]><img src=img/d.gif>品名, $價格[↘$下殺價][ <i>Hot！</i>][ 任搭↓N][ 酷幣↓N]</tr>`（`r` 熱賣、`g` 價格異動、`b` 兩者）；說明列 `<td disabled class=z>`。
- 2026-10-06 對照：30 類共 6,626 件，與桌機數量、品名、價格逐字相同（只差 `～`/`∼` 一字解碼差異）；**沒有選項 value (id)**，也沒有 ◆★ 符號。
- 用途：`evaluate.php` 被擋或改版時的備援，或只想查單一分類時的輕量請求；`parse_coolpc.py` 目前不支援這個格式，要用得另寫解析。

## 不要串的頁面

- `m/my.php` 查價清單與訂購：清單只用 Email 當鑰匙、沒有密碼（`cond` 1 讀取、2 加入、3 刪除、4 清空）；訂購表單把品名清單連同手機號碼、自取門市或宅配地址送到 `evaluate.php`（`CellNo`、`take`/`tkaddr`、`delivery`/`sdaddr`、`mMail`/`Rmail`），會真的聯絡原價屋。涉及使用者個資，網站與腳本只用上面的 `iname`/`icnt` 帶單。
- `4k.php`（資料由 `4kvga.php` POST `N=id,id…&S=排序` 回傳）：原價屋自測顯卡數據（Superposition 4K/HD、Basemark、FFXIV、Furmark 溫度，加晶片/製程/TDP/CUDA/顯存規格），共 472 張卡，但 2026-10-06 最新只到 RTX 4090 / 4070 Ti SUPER，沒有 RTX 50、RX 9000，不能拿來推薦現行顯卡；之後若補上新卡再評估。
- `phpBB2/portal_pages.php?page=6` 會轉到 `https://coolpc.com.tw/tw/`（WordPress 官網），沒有可用資料。
