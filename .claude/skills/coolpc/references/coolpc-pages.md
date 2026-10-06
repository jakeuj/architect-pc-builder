# 原價屋的其他頁面與入口

`evaluate.php` 的選項文字仍是資料正本 (`parse_coolpc.py`)；以下是 2026-10-06 從手機版 (`/m/`)、桌機版頁面與 `/js/e19.js` 追出來並實測過的其他資料與入口。原價屋自己也用「品名去掉 `, $價格`」當商品鍵（手機查價清單、帶單、每類總覽的 Buy 都是），跟 build 的 `match` 與分享連結用品名對照是同一套做法。

## 帶單到官方估價頁

把一張估價單直接開成原價屋官方估價頁，品項與數量已選好，使用者可以接著列印、加購或聯絡原價屋。有 POST 與 GET 兩種送法，伺服器都在頁面 JS 注入 `var pAry=[0,[分類,選項value,數量,加購旗標],…]`，`init` 時照著選好：

- 同分類多件可行：`[7,2,1,1],[7,7,1,0]` — 先列的旗標 1 進「加購」清單，最後一件放主選單。
- 對不到的品名直接略過、不報錯，所以已下架或條件價已結束的列要在送出前先提醒。
- 同分類偶有同品名的兩個選項（同一件同時列在「特價 or 活動專區」與品牌群組，價格相同；2026-10-06 機殼 26 組、電源 23 組），原價屋選後面那個 value，不影響價格。
- 帶品項的請求不會出現廣告遮罩（見下節）。
- 只是開估價頁，不會下單；下單要另外帶手機號碼（見「不要串的頁面」），我們只送品名與數量。

### POST `iname` / `icnt`（網站目前用這個）

`4k.php` 的購物車鈕與 `evaluate.php` 自己的 `Reload()` 都走這條。

- 請求：`POST https://www.coolpc.com.tw/evaluate.php`，`application/x-www-form-urlencoded`，**Big5 (cp950) 編碼**。
  - `iname` = `<>品名1<>品名2…`，品名就是 `data/coolpc_prices.json` 的 `name`（選項文字去掉最後一個 `, $` 之後）。
  - `icnt` = `<>數量1<>數量2…`，順序對應 `iname`。
  - 不需要 cookie / PHPSESSID / Referer。
- 網頁已實作 (2026-10-06)：摘要的「帶到原價屋估價頁」，臨時建 `<form method=post accept-charset="big5" target="_blank">` 送出，細節見 [site.md](site.md)「index.html 內部重點」。
  - 瀏覽器實測 (Chromium)：預設中階 8 件 + 記憶體 ×2，原價屋預選 8 件，含稅價 $56,139、優惠價 $55,849 與我們網頁的總計、估計實付完全相同（這張單沒有酷幣商品，見下方「酷幣也算折抵」）。
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

### GET `?iBuy=`（可複製的連結，網站尚未使用）

原價屋「每類總覽」(`eachview.php`) 的 Buy 鈕用這個，還會跳 prompt 讓人複製網址。

- `https://www.coolpc.com.tw/evaluate.php?iBuy=<base64(Big5 品名，多件用 <> 串)>`；base64 的 `+ / =` 要再 URL encode。
- 沒有數量參數（`icnt`、`iCnt` 都不吃）：同品名重複 N 次 = N 件（前面的進加購、最後一個在主選單，各 1 件）。
- 開頭不能加 `<>`（跟 `iname` 不同）：會注入 `[00]` 這種壞掉的 JS，整頁都不預選。
- 瀏覽器實測 (2026-10-06，內建瀏覽器面板直接開網址)：Ultra 5 225F + UMAX S330 ×2 → 預選正確、總計 $7,678、沒有遮罩。
- 跟 POST 比：資料在網址裡，可分享、也沒有面板開新視窗丟 POST 內容的問題；但瀏覽器 JS 沒有 Big5 編碼器 (`TextEncoder` 只有 UTF-8)，要在 `build_site.py` 用 cp950 預先算好每件的 base64，或前端用 `TextDecoder('big5')` 掃過所有雙位元組建反查表。

## 廣告遮罩

- 一般開啟 `evaluate.php`（GET、空 POST、隨便加 `?x=1` 都一樣）頁尾會執行 `Gauze(6)`：用 iframe (`id=mycookie`) 載入 `eval-mesg.php` 蓋住整頁，內容是「酷！PC」套裝主機型錄（官網商品快照 + 品牌篩選）與防詐騙提醒。沒有 cookie 可跳過，每次都出現。
- 關閉：點中間內容以外的黑色區域（`body onclick="parent.Gauze(2)"`），或 30 分鐘後 `SkipMsg()` 自動關；瀏覽器自動化可直接執行 `Gauze(2)`。
- 帶品項的請求（POST `iname`、GET `iBuy`）回應裡沒有 `Gauze(6)`，不會出現遮罩；瀏覽器驗收時直接開帶品項的網址就不會被擋。

## 桌機版頁內資料 (evaluate.php 的 JS 陣列)

`<head>` 的 `<script>` 每個分類 N 有四個陣列，索引 = 選項 `value` (= `data/` 的 `id`)。`parse_coolpc.py` 只讀選項文字，這些都還沒解析；要用得改 `parse_coolpc.py` 並同步 `coolpc-live.js`。

| 陣列 | 內容 |
|---|---|
| `cN` | 單價（含稅，下殺時是下殺價），與選項文字相同 |
| `dN` | 每件折抵 = 任搭折 + 酷幣（2026-10-06 全部 6,612 件與 `flags` 吻合） |
| `wN` | TDP 耗電瓦數；頁底「耗電 N 瓦」= Σ w × 數量 |
| `gN` | 圖片 / 開箱討論的 key |

另有 `Header=[…,[共有,熱賣,圖片,討論,價格異動,限時下殺],…]` 每類統計（同選項第一列「共有商品 N 樣…」），以及 `ftime=<Unix 秒>` 報價更新時間（= `Mdy`，如 `1791256391` = 2026/10/6 11:13:11）。

### 酷幣也算折抵

- 官方「優惠價 / 省」= 總計 − Σ(d × 數量)，**酷幣也當現金折抵**。只有「整張單只有一件，而且是主機板 (5) 或顯卡 (12)」時不折（任搭要搭別的東西）；兩件以上、或唯一一件是其他分類都折。分期金額也改用優惠價算。
- 我們的 `quote.py` 與網站「估計實付」只扣 `任搭折N`：單上有 `酷幣N` 商品時，會比官方優惠價高出酷幣總額。要不要改成跟官方一致，先問使用者。

### 耗電瓦數 `wN`

- 例：R7 9800X3D 120、R5 7500F 65、RTX 5070 250、RX 9070 XT 304、B850 主機板 125、DDR5 單條 2、SSD 3、塔散 5、水冷 10、風扇 2、電源 0。
- 不完整：6,612 件只有 1,648 件非 0（例如 Core Ultra 5 225F 是 0），只能當估算下限；選電源仍照 `recipes.md`「顯卡 TBP + CPU + 150W」核對。

### 圖片與開箱討論 `gN`

- 選項文字尾端 ◆ = 開箱討論、★ = 參考圖片。`G` 為整數 → 只有圖；帶小數（`.5`）→ 兩者都有；`0 < G < 1` → 只有討論；0 → 都沒有。
- 圖片：`POST eva-img.php`，`G=<G>&D=1` → HTML 片段：`<img src='/eval/<分類>/<檔名>.jpg' width=250 height=450>`（同系列常共用一張）+ 規格列 + 含稅價。
- 討論：`POST eva-link.php`，`G=<G 的整數部分>`（`G < 1` 時送 G 本身）→ JS `window.open('<網址>')`；CPU 指向 Intel 官方規格頁，其他分類未逐一確認。
- G 值隨頁面重排而變，只能跟同一次抓的頁面一起用；要批次拿圖片、連結與規格，改用下方的每類總覽。

### 分期付款

`Count()`：每期 = round(round(總額 ÷ r) ÷ 期數)，r：3 期 0.97、6 期 0.96、12 期 0.935、24 期 0.89；有折抵時總額用優惠價。

## 每類總覽 `eachview.php?IGrp=N`

- 估價頁分類名稱旁的「一頁看完」圖示；GET、不需 session、Big5，大小約 24KB（CPU）到 560KB（機殼）。
- 每件一段：`<div class=w>base64(Big5 品名)</div><span onclick='Show(this)'><img src='/eval/N/x.jpg'><div class=t>品名</div>[規格列]<div class=x>含稅：NT價格 ◆<a href='連結'>開箱討論</a> Buy</div></span>`；那段 base64 就是 `iBuy` 的值。
- 規格列是品名裡沒有的結構化資訊，可補強目前靠品名 regex 的相容性檢查：
  - 主機板：`CPU：LGA 1700  尺寸：M-ATX (DDR5)  顯示：…  儲存：2*M.2 / 4*SATA3  內建：…  網路：…  保固：…`
  - 機殼：`尺寸：48*24*48  支援水冷：360/240/120  硬碟空間：…  內附風扇：…  風扇支援：12*3(上)/…  前I/O：…`
  - 電源：`電源長度：14+2  符合：ATX 3.1規範  原生：12V-2x6(12+4)接頭`
  - 顯卡、散熱器只有零星幾項（燈效接頭、內附風扇與保固之類）。
- 2026-10-06 對照 `data/`：CPU、主機板、顯卡、機殼、電源的件數與品名逐件相同（含重複品名）；散熱器多 2 件，是 `data/` 略過的 $1 說明列。每件都有圖；有開箱討論連結的：CPU 37/43、主機板 315/353、機殼 730/737、電源 328/328。

## 更新檢查（尚未實作）

workflow 每小時都下載完整 `evaluate.php`。先問「報價時間變了沒」，沒變就跳過：

- **`mailOK.php`（優先）**：`POST`、不帶參數，回應約 576 bytes，含 `ModifyData('1791256391')` — 就是 `ftime`（Unix 秒，= `Mdy`）。原價屋估價頁自己每 3 分鐘輪詢它來顯示「資料已更新」。同一回應帶著最近聯絡店家客人的遮罩姓名跑馬燈：只用 regex 取數字，回應不要存檔或印出。
- **手機版首頁 `/m/`（備援）**：3KB（gzip 約 1KB），頁尾 `2026/10/6 11:13更新` 與 `Mdy` 同格式；regex `(\d{4}/\d{1,2}/\d{1,2} \d{1,2}:\d{2})更新`。
- 只在單一時間點比對過；過去 12 次自動 commit 的報價日期都不同，符合「內容變、時間就變」，但仍建議每隔幾小時強制抓一次完整頁保險。
- 另一個省流量點（2026-10-06 已做）：`fetch_coolpc.py` 送 `Accept-Encoding: gzip`，`evaluate.php` 傳輸從約 1.06MB 降到約 220KB；`urllib` 不會自動解壓，由 `gunzip()` 看 `Content-Encoding` 解。實測 gzip 與未壓縮兩次抓到的 7,617 個選項逐字相同。

## 手機版分類頁：備援資料來源

- `https://www.coolpc.com.tw/m/m-list.php?G=N`（N = 分類編號 1–30，與桌機相同；GET 或 POST `G=N` 皆可，不需 session），每頁 7–120KB。
- 結構：群組 `<th onclick=Pull(this) …><img src='p.gif'> 群組名`；商品 `<td onclick=A(this)[ class=r|g|b]><img src=img/d.gif>品名, $價格[↘$下殺價][ <i>Hot！</i>][ 任搭↓N][ 酷幣↓N]</tr>`（`r` 熱賣、`g` 價格異動、`b` 兩者）；說明列 `<td disabled class=z>`。
- 2026-10-06 對照：30 類共 6,626 件，與桌機數量、品名、價格逐字相同（只差 `～`/`∼` 一字解碼差異）；**沒有選項 value (id)**，也沒有 ◆★ 符號。
- 用途：`evaluate.php` 被擋或改版時的備援，或只想查單一分類時的輕量請求；`parse_coolpc.py` 目前不支援這個格式，要用得另寫解析。

## 不要串的頁面

- 會送出個資或真的聯絡店家：
  - `m/my.php` 查價清單與訂購：清單只用 Email 當鑰匙、沒有密碼（`cond` 1 讀取、2 加入、3 刪除、4 清空）；訂購表單把品名清單連同手機號碼、自取門市或宅配地址送到 `evaluate.php`（`CellNo`、`take`/`tkaddr`、`delivery`/`sdaddr`、`mMail`/`Rmail`）。
  - 桌機 `eva-mail.php`（Email 估價單給原價屋）、`/book/eva-call.php`（聯絡我們）。
  - 網站與腳本只用上面的 `iname`/`icnt` 或 `iBuy` 帶單。
- `eval-save.php`（「產生擷取檔」）：在原價屋伺服器建一份估價網頁 / 圖檔；我們已有自己的分享連結，沒測。
- `eval-ajax.php` 含稅 / 未稅切換：`Duty=0` 與 `Duty=1` 回傳的價格一模一樣，只換標題與背景，不能拿來算未稅。
- `eva-excel.php`、`eva-html.php`、`eva-print.php`（F9）：估價結果匯出 / 列印，用不到。
- `4k.php`（資料由 `4kvga.php` POST `N=id,id…&S=排序` 回傳）：原價屋自測顯卡數據（Superposition 4K/HD、Basemark、FFXIV、Furmark 溫度，加晶片/製程/TDP/CUDA/顯存規格），共 472 張卡，但 2026-10-06 最新只到 RTX 4090 / 4070 Ti SUPER，沒有 RTX 50、RX 9000，不能拿來推薦現行顯卡；之後若補上新卡再評估。
- `phpBB2/portal_pages.php?page=6` 會轉到 `https://coolpc.com.tw/tw/`（WordPress 官網），沒有可用資料。
