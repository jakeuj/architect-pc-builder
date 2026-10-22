# 實作與驗收（2026-10-22 第二輪）

- [x] 1. 價格歷史正確性 — f005f8e：條件價件另記 key、同型號最低款／上架 N 天文案、history.json 形狀驗證與 update_history 失敗不中斷排程、回填淺 clone／子目錄防呆、重新回填（2,761 key、158KB）。驗收：Python 28／Node 55 項過；瀏覽器 9700X 一般件顯示 30 天最低 $11,450／最高 $11,550，新上架顯示「上架 N 天」。
- [x] 2. QR Code 可掃性 — a6efd87：尺寸 max(104, 格數×2)、列印每格 0.4mm、糾錯依長度只算一次、M 放不下退 L、延後計算、太長顯示提示。驗收：預設配置唯讀連結（1,033 字、版本 23、234px）在 DPR 1 原尺寸用 BarcodeDetector 解回同一網址；手機不溢出；6,099 字的 v1 連結顯示「連結太長」。
- [x] 3. 分享連結與最近開過 — 8f8da1b：只記快照、預覽與分享同一筆、目前這張 aria-current、aria-pressed 不蓋到卡片、canZip 實際試建、syncHash 防外部改網址、slot 原型鍵算 dropped。驗收：測試含 deflate-raw TypeError 與 constructor slot；瀏覽器載入標記／改單取消／還原再亮。
- [x] 4. 改單差異文案 — eb8e6c2：sameModel、「搭板優惠已結束，改用同型號現價」「品名更新（同型號）」、標題含改用現價數、#diff 換框色與 ✎。
- [x] 5. 價格歷史載入成本 — 6afb2fd：唯讀不載、進編輯才抓、不加時間戳、佔位 span 只填不重畫。驗收：唯讀零請求、編輯一次 `/history.json`。
- [x] 6. CI index.html 一致性 — 3444214：正規化後 diff。
- [x] 7. 文案 — e9946ff（promo、README、workflow 註解）＋ site.md 待辦段（本 commit）。

## 未做（留給下一輪）

- 淺色主題、PWA 離線快取、拆 index.html、OG 動態預覽、價格歷史擴到其他商品、history 不記下架期間（見 site.md「低優先」）。
- 沒驗到：Safari 實機剪貼簿與注音、列印 PDF 實際掃描、下一次每小時排程的實跑。
