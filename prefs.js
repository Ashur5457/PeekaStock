// 設定：唯一的資料來源是 chrome.storage.local 的 prefs（寫法沿用 FreeLiveSub）。
// 自選清單與分頁的操作（判斷代號、新增、刪除、搬移、分段、分頁、顯示名稱）都是純函式：
// 收設定或清單、回傳新的，不碰 chrome，可以在 Node 測。
// 新欄位一律要有預設值，舊設定讀進來不會壞。markets.js 要比這個檔案先載入。
globalThis.PSPrefs ??= (() => {
  const KEY = 'prefs';
  const WATCH_MAX = 100;   // MIS 一次查 150 個代號以上會回空資料（CLAUDE.md 7.1），留安全空間
  const DEFAULT = {
    // 自選股：{ market, code, ex?（台股 tse／otc）, name?（新增時查到的名稱） }
    watchlist: [
      { market: 'tw', code: '2330', ex: 'tse' }, { market: 'tw', code: '6488', ex: 'otc' },
      { market: 'us', code: 'AAPL' }, { market: 'us', code: 'NVDA' },
    ],
    indices: Object.fromEntries(PSMarkets.INDICES.map((i) => [i.symbol, true])),   // 指數開關，預設全開
    stealth: false,   // 隱身模式：背景透明、文字灰色、漲跌不分顏色（CLAUDE.md 2.5）
    tab: 'all',       // 框上目前選的分頁（內建分頁的 id 或自創分頁的 id）
    tabs: [],         // 自創分頁：{ id, name, keys: [項目 key…] }；同一檔可以放進多個分頁
    uiLang: 'auto',   // 介面語言：auto（跟瀏覽器）或 i18n.js 的 UI_LANGS
    upColor: 'red',   // 漲跌顏色：red＝紅漲綠跌（台灣習慣）、green＝綠漲紅跌（美國習慣）
    showLag: false,   // 框底部顯示 MIS 延遲統計（開發觀察用，一般使用者不需要）
    mini: false,      // 迷你偷看模式：框只剩貓耳朵＋一行報價（每 4 秒換一檔）
    line: true,       // 每一列背景畫當天的迷你走勢線（隱身模式不畫）
    chgMode: 'pct',   // 漲跌欄顯示 pct＝漲跌幅％、chg＝漲跌點數（點一下漲跌欄切換）
    sort: 'manual',   // 段內自選股的順序：manual＝自選順序、up＝漲幅大到小、down＝跌幅大到小（分頁列的 ⇅）
    alerts: {},       // 到價提醒：{ [項目 key]: { above?, below? } }（見 alerts.js）
    moveAlert: { on: true, pct: 3 },   // 大漲大跌提醒：漲跌幅 ≥ ±pct% 就提醒
    bgAlert: false,   // 背景提醒：Chrome 被蓋住時也每 1 分鐘檢查有設提醒的股票（chrome.alarms，只在開盤時段）
    dblHide: true,    // 在網頁空白處點兩下＝藏身／叫出（見 blank.js）
    hideKey: { on: true, key: 'Escape', double: true },   // 網頁內按鍵藏身：預設 Esc 連按兩下，使用者可在設定面板錄製別的鍵
  };

  // 讀進來的設定和預設值合併；indices 要再合併一層，新加的指數才會出現
  const merge = (saved = {}) => ({ ...DEFAULT, ...saved, indices: { ...DEFAULT.indices, ...saved.indices } });

  async function load() {
    const r = await chrome.storage.local.get(KEY);
    return merge(r[KEY]);
  }

  async function update(patch) {
    const p = await load();
    await chrome.storage.local.set({ [KEY]: { ...p, ...patch } });
  }

  function watch(cb) {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch[KEY]) cb(merge(ch[KEY].newValue));
    });
  }

  // ---------- 自選清單 ----------

  // 使用者輸入的代號屬於哪個市場：台股 4～6 位數字，ETF 可帶一個英文字母（00878、00631L）；美股英文代號（BRK-B、BRK.B）；
  // 其他國家照 Yahoo 的代號帶交易所後綴（7203.T、0700.HK），先查後綴表（markets.js 的 SUFFIX）
  const CODE_RULES = [[/^\d{4,6}[A-Z]?$/, 'tw'], [/^[A-Z][A-Z.-]{0,9}$/, 'us']];
  // 台股也可以照 Yahoo 打 2330.TW、6488.TWO：去掉後綴
  const normalize = (raw) => String(raw ?? '').trim().toUpperCase().replace(/^(\d{4,6}[A-Z]?)\.TWO?$/, '$1');
  const classify = (code) => PSMarkets.suffixOf(code)?.market ?? CODE_RULES.find(([re]) => re.test(code))?.[1] ?? null;

  const keyOf = (w) => `${w.market}:${w.code}`;
  const has = (list, w) => list.some((x) => keyOf(x) === keyOf(w));
  const isFull = (list) => list.length >= WATCH_MAX;

  // 新增：已經有的不重複加、滿了不加（介面會先用 has／isFull 告訴使用者原因）
  const addWatch = (list, w) => (has(list, w) || isFull(list) ? list : [...list, w]);
  const removeWatch = (list, key) => list.filter((w) => keyOf(w) !== key);

  // 搬移第 i 個：dir＝-1 往上、+1 往下；到頂、到底或找不到就不動（自選股和自創分頁共用）
  function moveAt(list, i, dir) {
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
  const moveWatch = (list, key, dir) => moveAt(list, list.findIndex((w) => keyOf(w) === key), dir);

  // ---------- 自創分頁 ----------

  const TAB_MAX = 10, TAB_NAME_MAX = 8;   // 分頁列才放得下

  // 名稱能不能用：回傳錯誤代碼（介面用 i18n 的 msg.＋代碼顯示），可以用就回傳 null。
  // 改名時 selfId 是自己，不算重複；reserved＝內建分頁目前語言的名稱（這裡不碰 i18n，由介面傳進來）
  function tabError(tabs, name, selfId = null, reserved = []) {
    if (!name) return 'tabEmpty';
    if (name.length > TAB_NAME_MAX) return 'tabLong';
    if (reserved.includes(name) || tabs.some((x) => x.name === name && x.id !== selfId)) return 'tabDup';
    if (!selfId && tabs.length >= TAB_MAX) return 'tabFull';
    return null;
  }

  // 新分頁的 id：t1、t2…（取目前最大的號碼＋1，刪掉再加不會撞到）
  const nextTabId = (tabs) => `t${Math.max(0, ...tabs.map((x) => Number(x.id.slice(1)) || 0)) + 1}`;
  const addTab = (tabs, name, reserved = []) => (tabError(tabs, name, null, reserved) ? tabs
    : [...tabs, { id: nextTabId(tabs), name, keys: [] }]);
  const renameTab = (tabs, id, name, reserved = []) => (tabError(tabs, name, id, reserved) ? tabs
    : tabs.map((x) => (x.id === id ? { ...x, name } : x)));
  const removeTab = (tabs, id) => tabs.filter((x) => x.id !== id);
  const moveTab = (tabs, id, dir) => moveAt(tabs, tabs.findIndex((x) => x.id === id), dir);

  // 把某個項目放進／拿出某個分頁
  const setInTab = (tabs, id, key, on) => tabs.map((x) => (x.id !== id ? x
    : { ...x, keys: on ? [...new Set([...x.keys, key])] : x.keys.filter((k) => k !== key) }));
  // 自選股刪掉時，所有分頁都拿掉它（不然重新加入時會莫名其妙回到舊分頁）
  const forgetKey = (tabs, key) => tabs.map((x) => ({ ...x, keys: x.keys.filter((k) => k !== key) }));

  // ---------- 設定 → 畫面上的列 ----------

  // 自選股 → 要抓的項目。每個市場怎麼組代號、歸哪個抓取群組，查表決定；表裡沒有的市場都是其他國家個股（gl）
  const WATCH = {
    tw: (w) => ({ symbol: `${w.ex}_${w.code}`, group: 'tw' }),
    us: (w) => ({ symbol: w.code, group: 'us' }),
    gl: (w) => ({ symbol: w.code, group: 'gl', delay: PSMarkets.suffixOf(w.code)?.delay ?? 0 }),
  };
  const isGlobal = (i) => i.group === 'gl';

  // 要抓的項目＝自選股＋開著的指數。
  // item = { key, market, group, symbol, nameKey?（指數，i18n key）, code?、label?（自選股：代號、新增時查到的名稱） }
  function items(p) {
    const stocks = p.watchlist.map((w) => ({ key: keyOf(w), market: w.market, code: w.code, label: w.name, ...(WATCH[w.market] ?? WATCH.gl)(w) }));
    return [...stocks, ...PSMarkets.INDICES.filter((i) => p.indices[i.symbol])];
  }

  // 列上顯示什麼、滑鼠提示顯示什麼：美股記代號（名稱太長），台股記名稱（中文名稱短）；指數用我們的名稱。
  // tr：查翻譯的函式（介面傳 PSI18n.t 進來；這裡不碰 i18n，測試可以傳別的）
  // 其他國家個股和美股一樣顯示代號，提示是「全名 · 地區 · 幣別」；單位是「分」的幣別（GBp 便士等）另外翻譯
  const MINOR_CUR = ['GBp', 'ZAc', 'ILA'];
  const curLabel = (cur, tr) => (MINOR_CUR.includes(cur) ? tr(`cur.${cur}`) : cur);
  const LABELS = {
    us: (item, quote) => [item.code, quote?.name ?? item.label ?? ''],
    tw: (item, quote) => [quote?.name ?? item.label ?? item.code, item.code],
    gl: (item, quote, tr) => [item.code,
      [quote?.name ?? item.label, tr(`mkt.${item.market}`), curLabel(quote?.cur, tr)].filter(Boolean).join(' · ')],
  };
  const labelOf = (item, quote, tr = (k) => k) =>
    (item.code ? (LABELS[item.market] ?? LABELS.gl)(item, quote, tr) : [tr(item.nameKey), '']);

  // ---------- 分頁 ----------

  const ALT = ['crypto', 'fut'];   // 加密貨幣、期貨：自己一個分頁，不算國際指數
  const isAlt = (i) => ALT.includes(i.market);
  const TW = ['tw', 'txf'];   // 台指期跟著台股（台股分頁、台股段），不放「加密／期貨」
  const isTw = (i) => TW.includes(i.market);

  // 內建分頁照市場自動分；自創分頁照 keys。每個分頁都只是「這個項目要不要放進來」。
  // 內建分頁的名稱是 i18n key（nameKey），自創分頁是使用者取的名稱（name）
  const BUILTIN_TABS = [
    { id: 'all', nameKey: 'tab.all', has: () => true },
    { id: 'tw', nameKey: 'tab.tw', has: isTw },
    { id: 'us', nameKey: 'tab.us', has: (i) => i.market === 'us' },
    // 國際＝各國指數；其他國家個股只在「全部」（和自創分頁）出現
    { id: 'world', nameKey: 'tab.world', has: (i) => ![...TW, 'us', ...ALT].includes(i.market) && !isGlobal(i) },
    { id: 'alt', nameKey: 'tab.alt', has: isAlt },
  ];
  const customTab = (x) => ({ id: x.id, name: x.name, custom: true, has: (i) => x.keys.includes(i.key) });

  // 框上顯示的分頁：沒有東西的內建分頁不顯示（「全部」除外）；自創分頁就算是空的也顯示，使用者才找得到
  const visibleTabs = (p, list) => [...BUILTIN_TABS, ...p.tabs.map(customTab)]
    .filter((x) => x.id === 'all' || x.custom || list.some(x.has));
  // 目前的分頁；選的分頁被刪掉或變空了，就回到「全部」
  const currentTab = (p, list) => {
    const tabs = visibleTabs(p, list);
    return tabs.find((x) => x.id === p.tab) ?? tabs[0];
  };

  // 分段：每個項目放進第一個符合的段；段內指數在前、自選股在後；空的段不出現。
  // 其他國家個股（gl）接在美股後面，每個國家一段（港股、日股…，i18n 的 stk.＋市場），照自選清單裡第一次出現的順序
  // market：段標題旁要標哪個市場的狀態（盤中、休市…）；國際指數是好幾個國家、加密貨幣 24 小時，不標
  const SECTIONS = [
    { id: 'tw', titleKey: 'sec.tw', market: 'tw', has: isTw },
    { id: 'us', titleKey: 'sec.us', market: 'us', has: (i) => i.market === 'us' },
    { id: 'gl', has: isGlobal },
    { id: 'world', titleKey: 'sec.world', has: (i) => !isAlt(i) },
    { id: 'alt', titleKey: 'sec.alt', has: isAlt },
  ];
  const isIndex = (i) => i.key.startsWith('idx:');
  const byCountry = (items) => [...new Set(items.map((i) => i.market))]
    .map((m) => ({ id: `gl.${m}`, titleKey: `stk.${m}`, market: m, items: items.filter((i) => i.market === m) }));

  // 排序：指數固定在上面（當大盤參考），只排自選股；還沒有漲跌的排最後
  const SORTS = { manual: null, up: (a, b) => b - a, down: (a, b) => a - b };
  const SORT_ORDER = Object.keys(SORTS);
  const nextSort = (mode) => SORT_ORDER[(SORT_ORDER.indexOf(mode) + 1) % SORT_ORDER.length];
  function sortStocks(items, quotes, mode) {
    const cmp = SORTS[mode];
    if (!cmp) return items;
    const pct = (i) => quotes[i.key]?.pct;
    return [...items].sort((a, b) => (pct(a) == null) - (pct(b) == null) || cmp(pct(a) ?? 0, pct(b) ?? 0));
  }

  // quotes、sort 只有排序時用得到（不傳＝自選順序）
  function sections(list, quotes = {}, sort = 'manual') {
    const groups = SECTIONS.map((s) => ({ id: s.id, titleKey: s.titleKey, market: s.market, items: [] }));
    list.forEach((i) => groups[SECTIONS.findIndex((s) => s.has(i))].items.push(i));
    // 先分國家（照自選順序）再排序，國家段的順序才不會跟著漲跌變
    return groups.flatMap((g) => (g.id === 'gl' ? byCountry(g.items) : [g])).filter((g) => g.items.length)
      .map((g) => ({ ...g, items: [...g.items.filter(isIndex), ...sortStocks(g.items.filter((i) => !isIndex(i)), quotes, sort)] }));
  }

  return {
    DEFAULT, WATCH_MAX, TAB_MAX, TAB_NAME_MAX, BUILTIN_TABS, MINOR_CUR, SORT_ORDER, nextSort, merge, load, update, watch, items, sections, labelOf,
    normalize, classify, keyOf, has, isFull, addWatch, removeWatch, moveWatch,
    visibleTabs, currentTab, tabError, addTab, renameTab, removeTab, moveTab, setInTab, forgetKey,
  };
})();
