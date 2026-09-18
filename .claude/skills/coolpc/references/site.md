# 估價網頁 (GitHub Pages) 參考

模板：`templates/index.html`、`templates/site.json`、`templates/update-prices.yml`；產生器：`scripts/build_site.py`。
已上線範例：`jakeuj/architect-pc-builder` → https://blog.jakeuj.com/architect-pc-builder/

## 專案結構 (repo 形式)

```
README.md            給朋友 / 公開看的說明: 網址、三套摘要表、資料來源、本機指令
site.json            網頁設定 (title, repo, game{name,url,min,rec}, builds[], notes[], slots?)
builds/*.json        配置定義檔 (與 quote.py 共用)
.claude/skills/coolpc/ 技能本體 (SKILL.md, scripts/, templates/, references/, examples/) — 唯一來源
data/                parse 產出 (json / csv / by_category tsv), 進版控當快照
docs/index.html      網頁 (從模板複製, 可再客製)
docs/data.json       build_site.py 產出, 網頁唯一的資料來源
docs/.nojekyll
quote.md             quote.py --summary 產出
.github/workflows/update-prices.yml
.gitignore           evaluate*.php, .claude/launch.json, .claude/settings.local.json, __pycache__/, .DS_Store
game_requirements.md 遊戲需求 (可選)
```

## docs/data.json 格式

```
{ title, quote_date, generated (Asia/Taipei ISO), source, repo,
  game: {name, url, min:{...}, rec:{...}} | null,
  notes: [str],
  slots: [{key, label, cats:[int], optional?}],
  categories: { "<cat_id>": {id, name, groups:[{label, items:[{id, name, price, list_price, flags}]}]} },
  builds: [{key, name, note, items: {<slot>: {cat, id, name, qty, fallback?}}}] }
```

- `builds[].items` 以 `name` 為穩定鍵；`id` 每次抓價可能變，所以 build_site.py 每次都用 `builds/*.json` 的 `match` 重新解析。
- 網頁的分享連結格式 `#b=<build>&<slot>=<cat>:<id>&q_<slot>=<qty>&<slot>=0`（0 = 選配設為無）。抓價後 id 變了連結會失效回預設，可接受。

## index.html 內部重點

- `IDX["cat:id"]` 快速查件；`state[buildKey]` 保存各分頁的使用者修改；`render()` 每次整表重畫。
- 下拉用 `<optgroup>` = 原價屋群組名；多分類欄位 (散熱器 = 10+11) 群組前綴分類名。
- 篩選框重建 options，若目前選件被濾掉會插在最前面保留。
- 必填欄位 select 值為空時忽略 (避免程式化改值誤清)。
- 相容性 regex：CPU/MB 腳位取群組名 `AM4|AM5|1851|1700|…`；DDR 取群組名 `DDR[345]`；顯卡長 `/(\d+)cm`；機殼 `顯卡長?(\d+)`、`(?:CPU|U)高(\d+)`；塔散 `高(\d+)cm`（只對分類 10 檢查，水冷不查）。
- 資訊類提示 (非錯誤) 用 `ok` 樣式：文字含「OK）」或「已下架」。

## 部署與 CI 的坑

- `gh api ... /pages` 回的 `html_url` 若是自訂網域 (blog.jakeuj.com)，就用它；github.io 網址會 301。
- Pages 首次部署約 30 秒；用 `curl -s <url>/data.json | python3 -c ...` 驗證，比截圖可靠（頁面 fetch 409KB 需要一下，截太早會看到「載入中」）。
- workflow 用 `git diff --quiet -- data quote.md` 判斷是否提交；`docs/data.json` 若只有 `generated` 變化就 `git checkout` 回去。
- runner 是 UTC，時間戳一律在 build_site.py 用 `ZoneInfo("Asia/Taipei")` 產生。
- `csv.DictWriter` 要 `lineterminator="\n"`，否則 CSV 進 git 會有 CRLF 警告。
- 本機預覽可放 `.claude/launch.json`（python3 -m http.server 8765 --directory docs），已在 .gitignore。
- `build_site.py --init` 會先把技能目錄複製到目標專案 `.claude/skills/coolpc/`（已存在則略過），workflow 模板呼叫的也是這個路徑。
