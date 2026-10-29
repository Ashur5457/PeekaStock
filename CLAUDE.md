# PeekaStock（偷喵看盤）：上班偷看盤，台股／美股即時報價＋各國指數（Chrome 擴充功能）

> 開發文件：需求、已決定事項、架構、踩過的坑、進度。每次開始工作前先讀完本檔。
> 個人背景、回答語言、工作與審查方式寫在 `CLAUDE.local.md`（不上傳 GitHub）。

## 1. 需求

**一句話**：在任何網頁上浮一個可拖曳、可縮放、能一鍵藏起來的小框，顯示自選的台股、美股即時報價，以及各國主要指數。只讀報價，不下單。

- 名稱：**PeekaStock**（2026-10-30 由 PeekStock 改名；唸起來是 peekaboo 躲貓貓 → Peek-a-Stock），中文名「**偷喵看盤**」；repo 名 `PeekaStock`；說明句：「PeekaStock — a hideable stock ticker for Taiwan and US markets」／「PeekaStock — 上班偷看盤：台股／美股即時報價懸浮窗」
- 本機資料夾目前還叫 `PeekStock`（Claude Code 在裡面執行，改名要使用者關掉後自己改成 `PeekaStock`）；程式內部的名稱（`PS*` 全域物件、`peek-stock` 元素、storage key）不改，使用者看不到也不影響
- 參考對象：作者自己的 FreeLiveSub（https://github.com/Ashur5457/freelivesub），本機在 `../tab-subtitle-spike`。懸浮框外殼、設定寫法、i18n 架構、開發規則都沿用它。開發前先讀它的 `CLAUDE.md` 第 4 節「已踩過的坑」
- **`../tab-subtitle-spike` 只能讀取，絕對不要修改、刪除或在裡面執行 git 指令**；要用的檔案一律複製到本專案再改

### 資料夾配置

```
chrome-ext-dev\
├── tab-subtitle-spike\   ← FreeLiveSub（只讀參考，獨立 git repo）
└── PeekStock\            ← 本專案（獨立 git repo）
```

啟動方式：在 `PeekStock` 執行 `claude --add-dir ../tab-subtitle-spike`。v0.3 把外殼檔案複製進來後，就不再需要參考它。上層 `chrome-ext-dev` 不放 `CLAUDE.md`（Claude Code 會讀上層的 CLAUDE.md，兩個專案會混在一起）。
- 要公開到 GitHub（MIT），所以介面要多語言
- **必須免費**：不用付費 API、不要求使用者申請金鑰、不架伺服器、不收集任何資料
- 不做：下單、帳號登入、持股損益（之後再說）、K 線圖（之後再說）

## 2. 已決定事項

### 2.1 股票：只支援台股和美股，代號由使用者輸入
- 台股：輸入 `2330`、`6488`，自動判斷上市（tse）或上櫃（otc），判斷結果存回自選清單，之後不再猜
- 美股：輸入 `AAPL`、`NVDA`

### 2.2 指數：預設清單，使用者可逐一開關；清單是資料表，加一行就能擴充

| 地區 | 指數 | Yahoo 代號（**v0.1 實測確認**） |
|---|---|---|
| 台灣 | 加權指數、櫃買指數 | `^TWII`、~~`^TWOII`~~ → `IX0043.TWO`（正式版兩個都改用 MIS `tse_t00`、`otc_o00`，見 7.3） |
| 美國 | 道瓊、S&P 500、那斯達克、費城半導體 | `^DJI`、`^GSPC`、`^IXIC`、`^SOX` |
| 中國大陸 | 上證指數、深證成指、滬深 300 | `000001.SS`、`399001.SZ`、`000300.SS` |
| 香港 | 恒生指數 | `^HSI` |
| 日本 | 日經 225 | `^N225` |
| 韓國 | KOSPI | `^KS11` |
| 新加坡 | 海峽時報指數 | `^STI` |
| 英國 | FTSE 100 | `^FTSE` |
| 法國 | CAC 40 | `^FCHI` |
| 德國 | DAX | `^GDAXI` |

### 2.3 延遲：15～20 分鐘不能接受，要即時
| 項目 | 來源 | 預期 |
|---|---|---|
| 台股 | 證交所 MIS「基本市況報導」介面 `mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw\|otc_6488.tw` | 約 5 秒，一次請求多檔 |
| 美股 | Yahoo Finance（非官方） | 盤中應為即時，需實測 |
| 指數 | Yahoo Finance（非官方） | 各交易所不同；有延遲的就在畫面標出資料時間 |

每一列都顯示「資料時間」，超過門檻（例如 2 分鐘）變灰，讓使用者知道哪個是舊的。

### 2.4 框出現在所有分頁（方案 a）
- `content_scripts` 比對 `<all_urls>`，所以安裝時 Chrome 會跳「讀取和變更所有網站資料」提示。README 要說明原因：只為了在網頁上畫框，不讀取網頁內容
- 已知畫不出來的頁面：`chrome://`、新分頁、Chrome 線上應用程式商店、內建 PDF 檢視器

### 2.5 隱藏（「上班」的核心）
1. **藏身鍵**：`chrome.commands`（預設建議 Alt+Shift+H，使用者可在 `chrome://extensions/shortcuts` 改）。一按，所有分頁的框同時隱藏或顯示（狀態存 `chrome.storage.session`）
2. **隱身模式**：背景透明、文字灰色、漲跌不用紅綠改 ▲▼，看起來像一般網頁文字
3. **工具列滑鼠移上才出現**：沿用 FreeLiveSub 的 `barAutoHide`
4. 候選（之後再做）：視窗失去焦點時數字自動打碼成 `…`；放開快捷鍵就隱藏

### 2.6 其他
- 介面語言：沿用 FreeLiveSub 的 `i18n.js`，六種（zh-Hant、en、zh-Hans、ja、ko、es），每個 key 一行、六欄
- 漲跌顏色：設定項，預設紅漲綠跌（台灣習慣），可改綠漲紅跌（美國習慣）
- 授權：MIT

## 3. 架構

純 vanilla JS、MV3、**沒有 build step、沒有 npm 套件**（和 FreeLiveSub 一樣）。

```
前景分頁的懸浮框（overlay.js）
  │ 分頁看得見（document.visibilityState === 'visible'）且框沒被隱藏時
  │ 每 5 秒送 { to:'sw', cmd:'tick' }
  ▼
sw.js（背景）
  │ 依「上次抓的時間」決定這次要抓哪些：台股、美股每 5 秒；指數每 30 秒
  │ 休市中的市場不抓（交易時段表，以各交易所時區判斷）
  │ fetch（host_permissions 涵蓋 MIS 與 Yahoo，背景沒有 CORS 問題）
  ▼
chrome.storage.session 的 quotes
  ▼
所有分頁的懸浮框監聽 storage.onChanged → 重畫
```

重點：
- **沒有分頁在前景、或按了藏身鍵，就完全不發請求**。開 20 個分頁也只抓一次
- 不用 offscreen document、不需要訊息轉送字幕那種中繼（和 FreeLiveSub 不同）
- 同一時間多個 tick 進來（多個視窗）要合併：sw 記住「正在抓」的 Promise，重複的 tick 直接共用
- `chrome.alarms` 最短 30 秒，不夠即時，所以不用它當主要驅動

### 3.1 資料結構（以資料消除分支）

```js
// 市場表：漲跌顏色、交易時段、時區、來源都查表，不寫 if/else
MARKETS = {
  tw: { tz: 'Asia/Taipei',      hours: [['09:00','13:30']], source: 'mis'   },
  us: { tz: 'America/New_York', hours: [['09:30','16:00']], source: 'yahoo' },
  // 指數各自帶 market，用來判斷交易時段
}

// 設定（chrome.storage.local 的 prefs，prefs.js 定義預設值，新欄位一律有預設值，舊設定讀進來不壞）
watchlist = [{ market: 'tw', code: '2330', ex: 'tse' }, { market: 'us', code: 'AAPL' }]
indices   = { '^TWII': true, '^N225': true, ... }      // 開關
upColor   = 'red' | 'green'

// 報價（chrome.storage.session 的 quotes，key 是 `${market}:${code}`）
quote = { name, price, prev, chg, pct, time, fetchedAt }
```

每個來源只是一個函式：`(symbols) => Promise<quote[]>`。來源壞了，只換這一個函式。

### 3.2 目前檔案（v0.7）

| 檔案 | 作用 |
|---|---|
| `manifest.json` | MV3 v0.7.0；`icons`／`action.default_icon`；說明、圖示提示、快捷鍵說明用 `__MSG_…__`（`default_locale: en`）；權限 `storage`、`alarms`（背景提醒）；`commands`（toggle-hide）、`action`（點圖示＝隱藏／顯示）；`host_permissions` 只有 MIS 和 `query1.finance.yahoo.com`；content script 比對 `<all_urls>`，載入順序 i18n → markets → prefs → box → blank → panel → overlay |
| `_locales/*/messages.json` | manifest 的六語文字（en、zh_TW、zh_CN、ja、ko、es）：`extDescription`、`actionTitle`、`cmdToggleHide` |
| `i18n.js` | `PSI18n`（架構沿用 FreeLiveSub）：每個 key 一行、6 欄（zh-Hant、en、zh-Hans、ja、ko、es）；`t(key, vars)`、`apply(root)`（`data-i18n`／`data-i18n-title`／`data-i18n-placeholder`）、`resolve('auto')` 依瀏覽器語言。指數名稱 `idx.＋代號`、地區 `mkt.＋市場`、錯誤 `err.＋代碼` |
| `markets.js` | `PSMarkets`：市場表（時區、交易時段）、指數表 `INDICES`（市場、抓取群組、代號、`nameKey`）、`isOpen()` |
| `prefs.js` | `PSPrefs`：預設自選（2330、6488、AAPL、NVDA）、指數開關、隱身、目前分頁 `tab`、自創分頁 `tabs`、介面語言 `uiLang`（auto）、漲跌顏色 `upColor`（red）、迷你模式 `mini`、到價提醒 `alerts`（`{ key: { above?, below? } }`）、大漲大跌 `moveAlert`（`{ on: true, pct: 3 }`）、背景提醒 `bgAlert`（false）；load／update／watch／merge；純函式：`items()`（設定 → 項目）、`sections()`（台股／美股／國際指數分段）、`labelOf()`（美股顯示代號、台股顯示名稱）、`classify()`（代號屬於哪個市場）、`addWatch`／`removeWatch`／`moveWatch`、分頁 `visibleTabs`／`currentTab`／`tabError`／`addTab`／`renameTab`／`removeTab`／`moveTab`／`setInTab`／`forgetKey`；自選上限 100、自創分頁上限 10、名稱 8 字 |
| `sources.js` | `PSSources`：`mis()`、`spark()` 與各自的解析函式；`LOOKUP`（新增自選時查代號：台股一次問 tse_／otc_）；錯誤一律帶代碼 `{ code: http／notJson／mis／timeout／other, src, detail }`，框依介面語言翻成文字 |
| `schedule.js` | `PSSchedule.due()`：純函式，決定這次 tick 要抓哪些群組、哪些項目；退避 |
| `sw.js` | 背景程式：收 tick → 排程 → 抓取 → 寫 `storage.session` 的 `quotes`／`status`／`misLag`；藏身鍵 `toggleHidden()`（`hidden`）；抓完檢查提醒 → `alertQueue`（最多 20 個）／`alertFired`（今天響過的），框顯示完送 `dismissAlert`；背景提醒打開時 `chrome.alarms` 每 1 分鐘只抓 `PSAlerts.watched()`（框藏著也抓）；`lookup` 指令（要回覆的指令放 `REPLIES`）；開放 session 給 content script 讀 |
| `alerts.js` | `PSAlerts`：提醒規則表 `RULES`（above／below／up／down）、`check()`（只看盤中，提醒 id＝`key|kind|交易所當地日期`，一天一次）、`watched()`、`prune()`；只有 sw.js 載入 |
| `blank.js` | `PSBlank`：網頁裡的藏身觸發。`isBlank()`＝空白處點兩下（沒選到字、不在輸入框／連結／影片／畫布等 `SKIP` 元素、不是網頁自己處理掉的、不在框裡；`prefs.dblHide`，預設開）；`keyFires()`／`isTyping()`／`keyLabel()`／`recorded()`＝網頁內按鍵（`prefs.hideKey`，預設 Esc 連按兩下、0.4 秒內，設定面板可錄製別的鍵；輸入框裡按的、按住不放、網頁處理掉的不算） |
| `box.js` | `PSBox`：懸浮框位置大小的純函式（搬自 FreeLiveSub，可在 Node 測） |
| `overlay.js` | 懸浮框（Shadow DOM）：拖曳、四角縮放、全螢幕、位置存 `overlayBox` 並在所有分頁同步；工具列 ⚙ 設定、◐ 隱身、👁 隱藏、↺ 重設；框上方分頁列（全部／台股／美股／國際＋自創分頁）；分頁裡有多個市場時分段加標題；分頁看得見時每 5 秒送 tick；E1 貓耳朵、貓掌提醒泡泡（一次一個，8 秒或點掉；隱身時只標亮那一列 `tr.alerted`） |
| `panel.js` | `PSPanel`：⚙ 設定面板（自選股新增／刪除／排序／🔔 到價提醒（就地展開上下限）、自創分頁新增／改名／排序／刪除／勾選內容、指數開關、提醒：大漲大跌 ±%（0.5～20）與背景提醒、顯示：介面語言與漲跌顏色），放在框的下、上、左、右第一個放得下的位置 |
| `tools/probe.mjs` | v0.1 資料來源實測；結果存 `tools/probe-results/`、原始回應存 `tools/samples/`（兩者都不上傳） |
| `tools/test.mjs` | `node tools/test.mjs`：測試 |
| `tools/fixtures/` | 測試用的真實回應（從 `tools/samples/` 縮減，只留測試用到的欄位，約 8 KB；會上傳） |
| `README*.md` | 六語 README（格式照 FreeLiveSub）：為什麼做、能做什麼、資料來源與延遲、安裝、使用、權限、已知限制、隱私、免責聲明、檔案結構、開發 |
| `LICENSE` | MIT © 2026 Ashur5457 |
| `icons/` | `icon.svg`（圖示原稿）＋ `icon16／32／48／128.png` |
| `tools/make_icons.ps1` | `powershell -ExecutionPolicy Bypass -File tools/make_icons.ps1`：從 `icon.svg` 產生 PNG（無頭 Chrome＋System.Drawing） |
| `CLAUDE.local.md` | 個人設定與工作方式（從 FreeLiveSub 複製，不上傳） |

### 3.3 要注意的坑（PeekStock 自己的）
1. **Yahoo 回應帶 `Cache-Control: public, max-age=300`，同一個網址會拿到中間快取的舊資料**（2026-10-29 v0.2 實測：AAPL、NVDA 停在同一個時間、變灰；用 Node 每 5 秒打同一個網址，`age` 到 27 秒，資料時間甚至倒退）。→ spark 網址也要加時間戳記 `&_=${Date.now()}`（MIS 本來就有），測試檢查每個請求都帶 `_`。`fetch` 的 `cache: 'no-store'` 只管瀏覽器自己的快取，管不到中間的快取伺服器
2. Yahoo 對不像瀏覽器的 User-Agent（例如 `Mozilla/5.0 Chrome/155` 這種縮寫）直接回 **429 Too Many Requests**，不是真的請求太多。擴充功能用的是 Chrome 自己的 User-Agent，不受影響；用 Node 測試時要帶完整的瀏覽器 User-Agent
3. **`chrome.storage.session` 預設只有背景程式讀得到**：content script 要讀或收到變更，sw.js 開頭要先 `chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })`（v0.2 一開始就這樣寫，框能正常更新）
4. （預先避開）**在網頁上的輸入框打字，按鍵會傳到網頁**：框在 Shadow DOM 裡，但 keydown 仍會冒泡到網頁的 document，例如在 YouTube 輸入 `AAPL` 時 L 會快轉 10 秒。→ 面板的輸入框對 keydown／keyup／keypress 呼叫 `stopPropagation()`。網頁若在 window 的捕捉階段攔按鍵就擋不住
5. **背景程式的 onMessage 不要回傳 Promise**（除非真的要回覆）：新版 Chrome 會把回傳的 Promise 當成「要非同步回覆」。所以一般指令（tick、toggleHidden）只呼叫不回傳；要回覆的（lookup）放 `REPLIES`，用 `reply()`＋`return true`

## 4. 從 FreeLiveSub 搬過來的東西

| 來源 | 用途 | 注意 |
|---|---|---|
| `overlay.js` 的外殼 | Shadow DOM、`z-index: 2147483647`、四角縮放（`CORNERS` 表）、拖曳、全螢幕時掛到 `fullscreenElement`、位置大小存 storage、框永遠限制在可見範圍內 | 字幕相關部分全部刪掉 |
| `prefs.js` 的寫法 | 預設值、load／set／watch、共用設定表單 | 語言表換成市場表、指數表 |
| `i18n.js` | 六語介面文字 | 只保留架構，文字全部重寫 |
| `icons.js` | 內嵌 SVG 圖示 | |

### 必須遵守的坑（FreeLiveSub 踩過）
1. **報價區的按鈕不能用 click，要用 `pointerdown`**：報價每幾秒重畫，按下和放開時已經是不同的元素
2. **共用 CSS 要限定元素類型**（例如 `input.toggle`），設定表單和懸浮框共用同一個 Shadow DOM，class 名稱會撞
3. **不要把區域變數取名 `t`**：`t` 是 i18n 的查表函式
4. 測試要真的跑到主要分支（用假的 fetch 回傳真實格式的資料），不能只測錯誤分支
5. 每次改完：`chrome://extensions` 按 🔄 重新載入，**網頁要重新整理**，content script 才會換新

## 5. 風險

1. **兩個來源都是非官方介面**：MIS 請求太頻繁可能擋 IP（可能也需要先取得 cookie），Yahoo 隨時可能改格式或要求 crumb。對策：來源函式化、資料時間顯示、失敗時退避（連續失敗就拉長間隔）並在框上顯示錯誤提示
2. Yahoo 的哪個端點能「一次抓多檔」需要實測（v7 quote 可能要 crumb；v8 chart 一次一檔；spark 可能可批次）
3. 國定假日沒處理：v0.x 先不管，休市日抓到的就是前一日收盤
4. **Yahoo 的非美國指數官方延遲 10～20 分鐘**（v0.1 實測 `exchangeDataDelayedBy`）：免費來源只能接受，畫面一定要標資料時間（2.3 已決定）
5. 歐洲使用者連 Yahoo 可能先被導到 GDPR 同意頁，請求會拿到 HTML 而不是 JSON。在日本測不到，公開後要留意 issue；來源函式解析失敗時要顯示錯誤，不能默默顯示舊資料

## 6. 進度與計畫

- [x] **v0.1 資料來源實測（不寫畫面）**：寫 `tools/probe.mjs`（Node 直接跑），對 MIS 和 Yahoo 各打一次，輸出：每個代號抓不抓得到、資料時間與現在的差（實際延遲）、一次請求最多幾檔、回應欄位。2.2 的指數代號全部確認。結果寫回本檔第 7 節
  - [x] 2026-10-28 第一次（美股盤中）：見 7.1、7.3
  - [x] 2026-10-28 第二次（台股盤中）：見 7.2。發現 MIS 的 `z` 常是 `-`、資料可能停住 1～2 分鐘
  - [x] 2026-10-28 10:58 陸港股盤中：見 7.2（延遲 15 分）
  - [x] 2026-10-28 23:42 歐股盤中：見 7.2b（延遲 15 分）

### 候選功能（參考富途牛牛，2026-10-28 整理，尚未排進版本）

條件：免費、不登入、只讀、兩個來源本來就有的資料。

| 功能 | 資料來源（v0.1 已確認欄位存在） | 評估 |
|---|---|---|
| 美股盤前／盤後價 | Yahoo quote `preMarketPrice`／`postMarketPrice`（要 crumb） | ⭐ 台灣上班時間正好是美股盤前盤後 |
| 市場狀態標籤（盤前／盤中／盤後／休市） | 市場表，或 Yahoo quote `marketState` | ⭐ 成本幾乎為零 |
| 漲停／跌停標示 | MIS `u`／`w` | ⭐ 台股特有 |
| 迷你走勢線 | Yahoo spark 本來就回傳當日 5 分鐘資料 | 不是 K 線圖，只是一條細線 |
| 期貨、匯率（`ES=F`、`NQ=F`、`TWD=X`） | Yahoo，指數表加一行 | 期貨延遲 10 分鐘（7.1），要標示 |
| 到價提醒 | 已有的報價 | ✅ v0.7 做了（框裡的貓掌泡泡＋可選的背景提醒，不用 `chrome.notifications`），見第 6 節 |
| 五檔買賣 | MIS `a`／`b`／`f`／`g` | 之後再說：框太小，可做成點開的細節 |
| 自選分組 | 只是設定 | v0.5 自選清單穩定後 |

不做：下單、社群、新聞（版權、放不下）、資金流向與美股 Level 2（沒有免費資料）、財報與除權息日曆（要另找來源）。
- [ ] v0.2 `sw.js` 抓報價 → `storage.session`；最陽春的懸浮框只列出文字 **（2026-10-28 已寫完；美股已實測，只剩台股盤中 MIS 延遲統計）**
  - 抓取群組表 `GROUPS`（sw.js）：`tw`＝MIS 每 5 秒（自選台股＋台灣兩個指數，一個請求）、`us`＝spark 每 5 秒、`idx`＝spark 每 30 秒；市場開著才抓，**還沒有報價的休市項目也抓一次**（晚上打開看得到前一日收盤）；連續失敗間隔加倍，最多 5 分鐘
  - MIS 價格：成交價 → 第一個大於 0 的買價 → 第一個大於 0 的賣價，`quote.from` 記來源，框上標「買」／「賣」
  - 框最下面一行是 **MIS 延遲統計**（台股盤中每筆報價的延遲分成 ≤10／30／60／120／>120 秒），用來回答 7.2 的問題
  - `tools/test.mjs`：26 個測試，用 `tools/samples/` 真實樣本跑解析、排程、背景程式 tick → storage.session 全流程（假 chrome、假 fetch）。另用暫時的測試頁確認過懸浮框畫面
  - 2026-10-29 實測：擴充功能裡 Yahoo 請求正常（沒有被拒絕）；修正 spark 拿到快取舊資料的問題（3.3 坑 1）後，美股落後約 15 秒、美國指數約 35 秒（每 30 秒抓一次）
  - 待實測：台股盤中的 MIS 延遲統計（框最下面那行）、多分頁只抓一次
  - 使用者實測時問到「分類（台股／美股／國際指數）」與「自己新增股票」→ 使用者決定照原本進度，兩者都在 v0.5 做
- [x] v0.3 搬 FreeLiveSub 的懸浮框外殼（拖曳、縮放、全螢幕、位置）**（2026-10-29 使用者實測全部正常）**
  - 幾何計算抽成純函式 `box.js`（`fitted`、`moved`、`resized`、`defaultBox`），Node 測 5 項；overlay 只把滑鼠移動距離交給它
  - 預設 300×420 右下角，最小 220×80；工具列（滑鼠移上才出現）按住拖曳＝移動，只有一個 ↺（重設＝刪掉存檔）；四個角縮放；全螢幕時把框搬進全螢幕元素
  - **所有分頁共用位置**：存 `chrome.storage.local` 的 `overlayBox`，其他分頁監聽變更跟著移（FreeLiveSub 沒有這個需求）
  - 預設位置改成「畫的時候才算」（`box = null` 代表用預設）：測試頁發現網頁剛載入時可見範圍可能是 0，先算好的預設會讓框卡在左上角
  - 測試頁（假 chrome）實際拖工具列、拉左上角、按 ↺，位置大小與存檔都正確
  - 2026-10-29 使用者實測：拖曳、四角縮放、分頁之間同步、YouTube 全螢幕、↺ 都正常
- [x] v0.4 藏身鍵＋隱身模式 **（2026-10-29 使用者實測全部正常）**
  - 藏身鍵：`storage.session` 的 `hidden`；快捷鍵（`commands` 的 `toggle-hide`，建議 Alt+Shift+H）、點工具列的 PeekStock 圖示（`action`）、框上的 👁 都呼叫 sw.js 的 `toggleHidden()`。藏起來時框不送 tick，`refresh()` 也再擋一次 → 完全不發請求；叫出來時立刻補抓
  - 隱身模式：`prefs.stealth`（預設 false），框上 ◐ 切換；`data-look="stealth"`＋CSS：背景透明、無框線陰影、全部 #888 灰字。漲跌一律用 ▲▼（兩種外觀都是）
  - 測試頁發現 v0.3 的預設寬 300 塞不下表格（361px，數字欄被擠到右邊要橫向捲動）→ 名稱欄最寬 7em 截斷（滑鼠移上看全名）、不是今天的資料只顯示「月-日」（滑鼠移上看完整時間）、預設寬改 320
  - Node 測試 35 項（新增：stealth 預設與舊設定相容、三種觸發方式切換 hidden、藏起來時不發請求）；測試頁看過白底／黑底的隱身模式與 👁
  - 2026-10-29 使用者實測：快捷鍵 Alt+Shift+H、點圖示、👁、◐ 隱身模式都正常
- [x] v0.5 自選清單管理（新增、刪除、排序、代號驗證）＋指數開關＋**分段顯示**（台股／美股／國際指數，使用者 2026-10-29 提出）＋分頁與自創分頁 **（2026-10-29 使用者實測全部正常）**
  - 工具列 ⚙ → 設定面板（`panel.js`）：輸入代號＋新增；每檔一列 ↑ ↓ ✕（pointerdown）；指數依地區分列勾選
  - 新增流程：`classify()` 判斷格式（台股 4～6 位數字可帶一個字母、美股英文代號）→ 檢查重複、上限 100 → 背景程式 `lookup`（台股一個 MIS 請求同時問 `tse_X`／`otc_X`；美股 spark）→ 存 `{ market, code, ex, name }`，之後不再猜（2.1）
  - 分三段：台股（加權、櫃買、自選台股）／美股（四個美國指數、自選美股）／國際指數；空的段不出現
  - 面板位置依序試框的下、上、左、右（測試頁發現框在右下角時面板只能蓋住框）
  - Node 測試 45 項（新增：代號格式、增刪搬移、上限、分段、lookup 上市／上櫃／美股／找不到／格式錯／網路錯）；測試頁實際新增 2603、TSLA、9999（找不到）、↑、✕、關掉加權指數都正確
  - 使用者試用後（2026-10-29）要求：① 美股名稱太長看不出是哪檔 → **美股顯示代號、台股顯示名稱**，另一個放滑鼠提示（`labelOf()` 查表）② **分頁**：框上方 `全部｜台股｜美股｜國際`，加上**自創分頁**（使用者決定：同一檔可放進多個分頁、和內建分頁一次做完）
  - 分頁的資料：`prefs.tab`（目前分頁，所有框同步）、`prefs.tabs = [{ id, name, keys }]`；內建和自創分頁都只是一個 `has(item)` 判斷；沒東西的內建分頁不顯示，自創分頁空的也顯示；選的分頁不見了就回「全部」；刪自選股時 `forgetKey` 從所有分頁拿掉；分頁裡只有一個市場時不顯示段標題
  - 設定面板新增「自創分頁」區：新增（名稱空白／超過 8 字／重名含內建名稱／超過 10 個都擋）、✎ 就地改名（Enter 或離開輸入框存、Esc 取消）、↑ ↓、✕（不刪裡面的股票）、「放進分頁」下拉＋勾選自選股與指數。面板上所有輸入框的按鍵都不傳給網頁
  - 背景照樣三個市場都抓，切分頁馬上有資料
  - Node 測試 53 項；測試頁實際操作：分頁切換、美股顯示代號、新增分頁的各種錯誤訊息、勾選、改名、刪自選股後分頁跟著拿掉都正確
- [x] v0.6 i18n 六語、漲跌顏色設定 **（2026-10-29 使用者實測全部正常）**
  - `i18n.js`（約 90 句 × 6 語）：工具列、分頁、段標題、買／賣標記與提示、錯誤列、MIS 延遲統計、設定面板全部文字、地區、16 個指數名稱。股票名稱（台積電、Apple Inc.）是資料來源給的，不翻譯
  - manifest 的說明、圖示提示、快捷鍵說明用 Chrome 的 `_locales`（和 i18n.js 是兩套）
  - 錯誤改成「代碼＋細節」（sources.js 的 `fail`），背景程式只存代碼，框依目前語言翻譯，換語言時已顯示的錯誤也跟著換；找不到翻譯的就顯示原文
  - 設定面板「顯示」區：介面語言（自動＋6 種）、漲跌顏色（紅漲綠跌／綠漲紅跌，`data-up` 標記＋CSS）
  - 自創分頁不能和內建分頁「目前語言的名稱」同名（`tabError` 的 reserved 由面板傳入，prefs.js 不碰 i18n）
  - Node 測試 62 項（新增：每個 key 6 欄、六語的 {變數} 一致、寫死的 key 和組出來的 key 都存在、**程式碼註解以外沒有中日韓文字**、語言判斷、`_locales` 的 key 齊全、新設定的預設值、逾時和連不上的錯誤代碼）；測試頁看過西班牙文（最長）與日文的框和面板，地區欄加寬到 6em
- [ ] v0.7 發布準備：圖示、README（六語，格式照 FreeLiveSub）、LICENSE、git **（2026-10-29 進行中）**
  - 使用者決定（照 Claude 建議）：① 圖示先畫 A／B／C 三個候選再選 ② MIS 延遲統計改成設定「除錯 → 顯示 MIS 延遲統計」（`prefs.showLag`，預設關），錯誤列照常顯示 ③ 測試樣本縮減成 `tools/fixtures/` 才上傳，`tools/samples/` 不上傳 ④ 版本 0.7.0，實際用一陣子、MIS 延遲確認後再升 1.0.0
  - [x] MIS 延遲統計開關、fixtures、LICENSE、`.gitignore`、`CLAUDE.local.md`、manifest 0.7.0、六語 README
  - [x] 圖示（2026-10-30 定案）：**黑貓「偷喵」躲在折線圖牆後面探頭**——紅色折線＋實心大箭頭往右上、藍色長條頂端貼著折線，兩者都在貓前面；奶油色圓角背景；有黑色卡通外框。`icons/icon.svg` 是原稿，`tools/make_icons.ps1` 用無頭 Chrome 畫成 512px 再縮成 16／32／48／128 PNG（角落透明）；manifest 加 `icons`、`action.default_icon`；測試檢查圖示檔存在
    - 討論過程（之後改圖示可參考）：PowerShell 畫的幾何圖形太死板 → 改用 SVG＋Chrome 輸出；整片青綠色沒活力；「只有頭＋爪子」不自然，要畫整隻坐著的貓、被牆擋住一半（使用者的照片：黑貓躲在牆角、貓從門縫偷看）；單根紅 K 棒像爆竹；K 棒要照規則排（時間左到右、最高的在最右邊）；看板／螢幕太呆板；參考網路股票圖示的「長條＋折線箭頭」；國際上紅綠漲跌習慣相反，但箭頭方向已表達上漲，所以紅色可以
    - 名字聯想：「偷喵」＝偷瞄的諧音；Peeky 接近 peekaboo（躲貓貓）
  - [x] 2026-10-30 README 截圖（使用者用真的 Chrome 截），放 `docs/readme/`：`box`／`alert`／`stealth`（能做什麼，三張並排）、`panel`（使用）、`step3`／`step3b`／`step4`（安裝）。選資料夾那張只留表頭＋PeekaStock-main 一列＋按鈕（路徑列有使用者名稱、其他資料夾和雲端硬碟帳號都裁掉）；釘選那張只留 PeekaStock 和拼圖按鈕
  - [x] 2026-10-30 README 安裝步驟改成 FreeLiveSub 的格式（### 小標題＋截圖）；`docs/readme/step2.png`（開發人員模式＋載入未封裝項目，通用畫面）從 FreeLiveSub 複製；FreeLiveSub 的 step3／step4 拍到它自己的資料夾和圖示，不能沿用
  - [x] 2026-10-30 `git init -b main`＋第一次提交 `ca4fe75`（身分 Ashur5457＋noreply，只設本 repo；`.gitattributes` 照 FreeLiveSub：文字檔 LF、PNG 二進位）
  - [x] 2026-10-30 使用者同意後推上 GitHub（公開 repo `Ashur5457/PeekaStock`）。CLAUDE.md 的資料夾圖拿掉含 Windows 使用者名稱的完整路徑
  - [ ] 擴充功能的漲跌顏色預設改成依介面語言（中日韓紅漲、英西綠漲）：已提議，待使用者決定
  - [x] **懸浮框加「偷喵」元素**（2026-10-30 使用者提議，A、B 都做；2026-10-30 使用者實測 OK）
    - 參考：Catppuccin（貓主題開源配色）、oneko.js（跟著滑鼠的像素貓，MIT）、Cat Ears Extension（幫 logo 加貓耳）——只借做法，不用素材
    - A1 框頂兩隻貓耳朵（CSS `clip-path` 三角形＋粉紅內耳），滑鼠移上時右耳抖一下；A2 配色和圖示一致：炭黑底 `rgba(30,28,36,.94)`＋金色 `#FFC23D` 強調色（取代原本的青綠 `#1D9E75`，面板也改）；A3 工具列「PeekStock」前的小貓頭 SVG；A4 資料變灰時時間旁 💤；A5 分頁沒東西時「🐾 偷喵還沒有東西可以看…」（`ov.empty`），錯誤列前 🙀
    - B1 四角縮放把手改金色貓掌印（CSS 背景 SVG）；B2 按 👁 時耳朵縮下去、框淡出 0.16 秒再藏（藏身鍵和點圖示維持瞬間）；B3 迷你偷看模式 `prefs.mini`（工具列 ▁）：框只剩耳朵＋一行報價，每 4 秒換下一檔，高度自動
    - **隱身模式時所有貓元素都藏起來**（耳朵、貓頭、💤、🐾、掌印），錯誤列改回 ⚠；`err.line` 的 ⚠ 從翻譯文字拿掉，改由 CSS 依外觀決定
    - 踩到的坑：迷你模式時框加了 class `mini`，而那一行報價的元素原本也叫 `div.mini` → CSS 把整個框藏起來（第 4 節坑 2 又一次）→ 改名 `div.miniline`
    - 2026-10-30 使用者回饋：耳朵太生硬、右耳被工具列蓋住 → 改 **E1 圓弧尖耳**（SVG，外側往外斜 8°），工具列只留貓頭 logo（文字放滑鼠提示）、`max-width: calc(100% - 104px)` 從耳朵右邊開始排
  - [x] **提醒**（2026-10-30；使用者實測 OK）：到價（🔔 每檔設上限／下限）、大漲大跌（預設開，±3%）、背景提醒（預設關）；提醒只用框裡的貓掌泡泡
    - 流程：sw.js 每次抓完 → `PSAlerts.check()` → 新的放進 `storage.session.alertQueue`、記進 `alertFired` → 所有框收到變更，看得見的框顯示第一個 → 8 秒或點掉送 `dismissAlert`
    - 框藏著或分頁看不見時泡泡不顯示也不計時，叫出來再補顯示；換語言時泡泡文字重寫（測試頁發現：泡泡在讀到設定前先用預設語言產生）
    - 價格不是成交價時泡泡標「買／賣」，完整說明放滑鼠提示（原本整句放泡泡裡太長會換行）
    - 實測時「點圖示沒反應」：其實是框停在藏起來的狀態，又連點好幾下（藏、叫出、藏…），看起來像沒反應；在 Service Worker 主控台監看 `hidden` 的變化確認每點一下只切換一次，不是程式問題。排查方法：`chrome.storage.onChanged` 印出 `hidden` 變化＋`chrome.action.onClicked` 記點擊
    - Node 測試 70 項（新增：上下限剛好等於、±3% 邊界、休市不響、一天一次與隔天再響、背景只抓有設的、新設定預設值、整合：放進佇列只一次＋dismissAlert、鬧鐘開關＋框藏著時只抓 AAPL）；測試頁看過泡泡、標亮、🔔 編輯（存、Enter 存、亂打當沒設、清除）、% 超過 20 改成 20、西班牙文、隱身

## 7. 實測發現

工具：`node tools/probe.mjs`（Node 24 LTS，無套件，可重複執行）。每次結果存 `tools/probe-results/日期-時間.json`；各端點原始回應存 `tools/samples/`（v0.2 假 fetch 測試用的真實格式）。延遲＝收到回應的時間 − 資料時間；**休市的市場延遲沒有意義**，只看盤中。

### 7.1 第一次：2026-10-28 03:46（日本時間；美股盤中，美東 14:46）

**端點總表**

| 端點 | 要 cookie／crumb？ | 一次幾檔 | 結果 |
|---|---|---|---|
| MIS `getStockInfo.jsp` | **都不用**（直接打就成功；首頁也不發 cookie） | 150 個代號仍正常，**175 個回傳空陣列** → 上限在 150～175 之間 | ✅ 20/20 檔 |
| MIS 指數 `tse_t00.tw`、`otc_o00.tw` | 不用 | 可和個股混在同一個請求 | ✅ 加權指數、櫃買指數都抓得到 |
| Yahoo v8 chart | 不用 | **1 檔** | ✅ 21/22（`^TWOII` 404） |
| **Yahoo v7 spark** | **不用** | **最多 20 檔**（22 檔回 400：`Number of symbols needs to be less than or equal to 20`） | ✅ 回應的 `meta` 有名稱、`regularMarketPrice`、`regularMarketTime`、`previousClose`、`currentTradingPeriod` |
| Yahoo v8 spark | 不用 | 最多 20 檔 | ⚠ 只有收盤價陣列，沒有名稱和資料時間，不適合 |
| Yahoo v7 quote | **要**：不帶 crumb 回 401；先開 `fc.yahoo.com` 拿 `A3` cookie → `/v1/test/getcrumb` 拿 crumb 後成功 | 22 檔一次 OK | ✅ 多了 `marketState`、`exchangeDataDelayedBy`（官方延遲分鐘）、`quoteSourceName`、盤前盤後價 |

**每個代號（盤中的才有延遲意義）**

| 代號 | 盤中？ | 實測延遲 | Yahoo 官方延遲／來源（quote） | 備註 |
|---|---|---|---|---|
| AAPL、NVDA | 盤中 | **2～9 秒** | 標 15 分，但 `quoteSourceName` 是 **Nasdaq Real Time Price** | ✅ 即時（Nasdaq 單一交易所價格，不是全市場合併價） |
| ^DJI、^GSPC、^IXIC、^SOX | 盤中 | **1～5 秒** | 0 分（Free Realtime Quote） | ✅ 即時 |
| ES=F、NQ=F（候選） | 盤中 | **⚠ 約 600 秒** | 10 分 | ⚠ 盤中延遲超過 1 分鐘：Yahoo 的期貨固定延遲 10 分鐘 |
| TWD=X（候選） | 盤中 | ⚠ 58～174 秒 | 0 分 | 匯價沒變動就不更新時間，不算真延遲 |
| 台股 20 檔（MIS） | 休市 | — | — | 全部抓到；`z`（成交價）沒有出現 `-`；資料時間 15:30（日本時間）＝台北 14:30 盤後定價交易結束 |
| t00、o00（MIS） | 休市 | — | — | 名稱：發行量加權股價指數、櫃買指數 |
| ^TWII、IX0043.TWO | 休市 | — | **20 分（Delayed Quote）** | → 台灣兩個指數改用 MIS |
| ^N225、^KS11 | 休市 | — | 20 分 | 第二次（亞洲盤中）實測 |
| 000001.SS、399001.SZ、000300.SS、^HSI | 休市 | — | 15 分 | 同上 |
| ^STI | 休市 | — | 10 分 | 同上 |
| ^FTSE、^FCHI、^GDAXI | 休市 | — | 15 分 | 7.2b 盤中實測約 15 分 |

**代號需要更正**
- ❌ **`^TWOII`（櫃買指數）不存在**：chart／spark 回 404，quote 回空資料。Yahoo 的正確代號是 **`IX0043.TWO`**（用 Yahoo 搜尋 `TPEx` 找到）。但 Yahoo 延遲 20 分鐘，**正式版改用 MIS `otc_o00.tw`**（加權指數也改用 `tse_t00.tw`）
- 其他 2.2 節的代號全部正確

**其他發現**
- MIS 查不到的代號（例如上市股問 `otc_`）會回一筆**沒有 `c` 欄位的空資料**，不是報錯。所以 2.1 的「自動判斷上市／上櫃」可以一次請求同時問 `tse_X` 和 `otc_X`，看哪一筆有 `c`（已實測：6488→otc、2330→tse）
- MIS 欄位：`c` 代號、`n` 名稱、`z` 成交價、`y` 昨收、`tlong` 資料時間（毫秒）、`o/h/l` 開高低、`v` 成交量、`a/b` 五檔賣／買價、`f/g` 五檔賣／買量、`u/w` 漲停／跌停價。數字都是字串（`"2400.0000"`）
- Yahoo 有些名稱中間夾一大串空白（DAX 的 `shortName` 是 `DAX                           P`）→ 畫面名稱用我們自己的指數表，不用 Yahoo 的
- Yahoo quote 的 `marketState`（REGULAR／PRE／POST／PREPRE／POSTPOST／CLOSED）可以拿來顯示「盤前／盤中／盤後」標籤
- 盤中時 quote **沒有** `preMarketPrice`／`postMarketPrice` 欄位（正常）；第二次（美股收盤後）確認盤後價有沒有出現

### 7.2 第二次：2026-10-28 10:06（日本時間；台北 09:06，台股開盤 6 分鐘）

盤中的市場：tw、jp、kr、sg（星股 10:00 才開）。**陸股、港股要日本時間 10:30 才開，這次沒量到**。

**MIS（台股）**
- 20 檔＋2 個指數全部抓到。probe 那一次延遲 **8～18 秒**
- ⚠ **20 檔裡有 17 檔 `z`（成交價）是 `-`**，`pz` 也是 `-`。只有最佳買價 `b` 第一格、最佳賣價 `a` 第一格有值 → **正式版不能只看 `z`**，`z` 是 `-` 時要退回買賣價（例如最佳買價，或買賣價中間），畫面要標示「這不是成交價」。指數（t00、o00）的 `z` 都有值
- ⚠ 之後每 5 秒連續抽樣 5 檔（10:07～10:08）：**資料時間停住將近 2 分鐘**（延遲從 52 秒一路增加到 112 秒）才跳到新的時間。所以 MIS 不一定每 5 秒更新，延遲 1～2 分鐘的情況會發生。原因不明（開盤前段量大？IP 被限流？），**v0.2 要在擴充功能裡長時間觀察**
- ⚠ 「一次 50 個代號」那個請求 **10 秒逾時**（7.1 休市時正常）。盤中大請求可能比較慢，正式版的逾時不能設太短；自選清單通常不到 50 檔，影響不大

**補跑：10:14（使用者執行）、10:15（修正後重跑）**
- 10:14：**20 檔的 `z` 全部是 `-`**；延遲 6～29 秒；50～150 個代號的請求這次都正常（沒有逾時），175 個仍回空陣列
- ⚠ **漲停時最佳買價是 `0`**：3105 穩懋漲停（540），`b` 第一格是 `0.0000`（市價買單的價格記成 0），probe 第一版因此顯示價格 0。已修正 probe：依序取「成交價 → 第一個大於 0 的買價 → 第一個大於 0 的賣價」，並多一欄「價格來源」。正式版的 MIS 來源函式也要這樣做
- ⚠ 10:15 重跑時，資料和 10:14 那次**完全一樣**，延遲變成 89～111 秒 → 第二次看到「資料停住約 1.5～2 分鐘」。兩次都發生在短時間內連續打很多請求之後，**很可能是同一個 IP 請求太密集時，MIS 會給舊的快取**（還沒證實）。v0.2 要觀察：只每 5 秒打一個小請求時，資料時間是不是穩定在 5～30 秒內

**補跑：10:31（使用者執行，距離上一次約 15 分鐘，沒有連續打）**
- MIS 延遲 **9～108 秒**，22 檔裡有 14 檔超過 1 分鐘；加權指數、櫃買指數也是 105 秒。這次前面沒有密集請求，所以「IP 打太密集才給舊資料」的猜測**站不住**：**MIS 盤中的實際延遲常常就是 1～2 分鐘**（仍遠好於 Yahoo 的 20 分鐘）。`tlong` 是那一檔最後一次更新的時間，個股之間差很多
- `z` 有值的只有 1 檔（2454 聯發科），其他 19 檔用買價。3105 漲停時買 1 仍是 `0.0000`，修正後的 probe 正確取到 540
- 陸股、港股 10:30 才開盤，Yahoo 又延遲 15 分鐘，所以這次還是昨天的資料 → **要日本時間 10:45 以後才量得到**
- Yahoo 盤中延遲（這次有今天的資料）：^TWII、IX0043.TWO **約 1200 秒（20 分）**；^N225 約 900 秒（15 分）；^KS11 約 1210 秒（20 分）；**^STI 約 900 秒（15 分，比官方標的 10 分還久）**

**補跑：10:58（使用者執行；陸港股開盤 28 分鐘）**
- MIS 延遲 **3～33 秒**（只有 3105 穩懋 62 秒，漲停沒什麼變動），兩個指數 24 秒。和 10:31 的 1～2 分鐘差很多 → **MIS 延遲會在「幾秒」和「1～2 分鐘」之間變動**，原因不明；正式版照 2.3 用資料時間＋2 分鐘變灰處理就好，不必找原因
- 20 檔裡 19 檔 `z` 是 `-`（只有 2317 鴻海有成交價）
- ✅ **陸股、港股量到了**：000001.SS、399001.SZ、000300.SS、^HSI 盤中延遲都是 **約 900 秒（15 分）**，和官方標的 15 分一致
- 其他和 10:31 一樣：^TWII／IX0043.TWO 約 20 分、^N225 約 15 分、^KS11 約 20 分、^STI 約 15 分

**Yahoo（亞洲指數，盤中）**

| 代號 | 實測延遲 | 官方延遲 | 結論 |
|---|---|---|---|
| ^N225 | **約 900 秒（15 分）** | 20 分 | ⚠ 延遲 > 1 分 |
| ^KS11 | **約 1200 秒（20 分）** | 20 分 | ⚠ 延遲 > 1 分 |
| ^STI | 還是昨天的資料 | 10 分 | 開盤才 6 分鐘，延遲 10 分鐘，所以還沒有今天的資料 |
| ^TWII、IX0043.TWO | 還是昨天的資料 | 20 分 | 開盤才 6 分鐘，延遲 20 分鐘，所以還沒有；再次確認台灣指數要用 MIS |
| ES=F、NQ=F | 約 600 秒（10 分） | 10 分 | 和 7.1 一樣 |
| TWD=X | 2～3 秒 | 0 分 | ✅ 即時（7.1 的 58～174 秒是因為匯價沒變動） |

**美股收盤後**
- ✅ quote 出現 **`postMarketPrice`**（AAPL 347.1077、NVDA 218.13），`marketState` 是 `POSTPOST` → 盤後價功能可行
- spark 在美股收盤後仍正常回傳收盤價

### 7.2b 第三次：2026-10-28 23:42（日本時間；歐股、美股盤中，使用者執行）

- ✅ **歐洲指數量到了**：^FTSE、^FCHI、^GDAXI 盤中延遲都是 **約 900 秒（15 分）**，和官方標的 15 分一致
- 美股再次確認即時：AAPL、NVDA 1～8 秒，四個美國指數 1～6 秒；quote 的 `marketState` 是 `REGULAR`
- 台股收盤後 MIS 的 `z` 全部有值（0/20 是 `-`），資料時間 15:30（日本時間）＝盤後定價交易結束。也就是 `z='-'` 只在盤中出現
- 3105 穩懋收在漲停 540（`z`＝漲停價 `u`），可以拿來測「漲停標示」候選功能

**v0.1 全部市場都量完了**。延遲總結：台股（MIS）3 秒～2 分鐘；美股與美國指數 1～9 秒；陸、港、日、星、英、法、德指數約 15 分；韓國與 Yahoo 的台灣指數約 20 分；美股期貨 10 分。

### 7.3 目前結論：正式版用哪個端點

| 項目 | 建議 | 理由 |
|---|---|---|
| 台股個股＋台灣兩個指數 | **MIS**，一次請求全部（上限約 150 檔） | 不用 cookie、批次；盤中實測 3 秒～2 分鐘，不同時間差很多（7.2）→ 2.3 的「超過 2 分鐘變灰」門檻剛好夠用，不要再調低；`z` 是 `-` 時退回第一個大於 0 的買價／賣價（漲停時買價是 0）；Yahoo 的台灣指數延遲 20 分 |
| 美股＋其他國家指數 | **Yahoo v7 spark**，每 20 檔一個請求 | 不用 crumb、批次、欄位夠用、美股實測 2～9 秒 |
| 盤前盤後價、市場狀態（候選功能） | Yahoo v7 quote（要 crumb） | 只有它有；crumb 流程較脆弱，當作加分功能，失敗就不顯示 |
| 備援 | Yahoo v8 chart（一次一檔） | spark 壞掉時的退路 |

**還沒確認**：擴充功能的 service worker 裡，Yahoo 的 cookie（A3）會不會被 Chrome 的第三方 cookie 限制擋掉。只有 quote 需要它，spark 不受影響。v0.2 時實測

## 8. 使用者的決定

- 2026-10-28：只做台股、美股個股；其他市場只顯示指數（陸／港／日／韓／星／英／法／德，加台美指數）
- 2026-10-28：框出現在所有分頁（方案 a），接受安裝時的權限提示
- 2026-10-28：15～20 分鐘延遲不能接受，台股走證交所 MIS
- 2026-10-28：要公開到 GitHub，沿用 FreeLiveSub 的 i18n 架構
- 2026-10-28：名稱定為 **PeekStock**。不選的名字：QuotePeek（已有同名擴充功能）、PeekStockTicker（太長，搜尋會被「stock ticker」淹沒）、GhostTicker（ghost stock 有負面意思）、HushTicker（和 HUSH 加密貨幣撞名）、FreeTicker（太普通）
- 2026-10-29：照原本的版本順序做（v0.3 外殼 → v0.4 藏身鍵 → v0.5 自選管理）；分段顯示和自己新增股票都留到 v0.5，不提前。在那之前可在 Service Worker 主控台用 `PSPrefs.load()`＋`chrome.storage.local.set({ prefs })` 暫時新增
- 2026-10-30：改名 **PeekaStock**（中文「偷喵看盤」）。不選：PeeCaStock（英文 pee＝尿尿）。網路上沒搜到同名擴充功能；概念相近的有 iOS 的 PeepStock（偽裝成郵件 App）
- 2026-10-30：要做提醒（到價、大漲大跌 ±3% 可調）：預設只在框看得見時檢查，另可開「背景提醒」（每 1 分鐘、只抓有設提醒的股票、只在開盤時段，預設關）；提醒方式只用**框裡的貓掌泡泡**（不用系統通知），隱身模式時只把那一列標亮
- 2026-10-30：貓耳朵太生硬（直角三角形）且會被工具列擋住 → 改圓潤耳朵，使用者選 **E1**（圓弧尖耳），工具列改成從耳朵右邊開始排
- 2026-10-28：資料夾配置：`chrome-ext-dev\tab-subtitle-spike`（FreeLiveSub）與 `chrome-ext-dev\PeekStock` 並排，各自獨立 repo
- 2026-10-30：「老闆鍵」改名「藏身鍵」（英 hide key、日 隠れキー、韓 숨기기 키、西 tecla para ocultar）、「隱身外觀」改名「隱身模式」（英 Stealth mode、日 ステルスモード）；快捷鍵說明（`_locales` 的 `cmdToggleHide`）前面加上藏身鍵
- 2026-10-30：新增「在網頁空白處點兩下＝藏身／叫出」（`blank.js`，設定「顯示 → 藏身」可關，預設開）；Alt+Shift+H 和點圖示照樣保留。測試頁實測：空白處點兩下會藏、點在文字上只選字不藏
- 2026-10-30：使用者想把 Alt+Shift+H 改成 Esc。Chrome 的擴充功能快捷鍵一定要有 Ctrl 或 Alt，不能只用 Esc → 使用者選方案 B：框自己在網頁上聽按鍵（`prefs.hideKey`，預設「Esc 連按兩下」避免和關對話框、離開全螢幕撞到），設定面板「顯示 → 按鍵」可開關、錄製別的鍵、切換連按兩下；游標在網址列時無效（Alt+Shift+H 照樣保留，到 chrome://extensions/shortcuts 可改）。測試頁實測：單按 Esc 不動、連按兩下會藏、錄製 Ctrl+Alt+K 正確
- 2026-10-30 實測 YouTube 錯誤紀錄：`overlay.js` 存框位置那行報錯（擴充功能重新載入後、網頁沒重新整理，舊的框被拖動 → 舊程式去存位置 → Extension context invalidated）。修正：`alive()`（`chrome.runtime.id` 不見了＝失效）統一檢查：框和面板的所有操作在 Shadow DOM 捕捉階段先檢查，失效就把舊框拿掉、不再呼叫 chrome；存位置、tick、點兩下、按鍵也都先檢查。測試頁模擬失效後按 ◐：框消失、沒有錯誤
- 2026-10-30：設定「按鍵」改名「藏身快捷鍵」、「錄製」改「設定」（使用者看不懂「錄製」）；長說明拿掉，改成工具列最右邊的 **?**（使用說明）：和 ⚙ 共用 panel.js 的浮動視窗（`show(view)`：settings／help／null），內容是 `HELP` 表（藏身方法、按鍵範圍、隱身模式、迷你、移動縮放、提醒、💤、買賣標記、延遲），每項一個 i18n key `help.*`
