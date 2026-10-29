// 背景程式：懸浮框每 5 秒送 { to:'sw', cmd:'tick' }（只有看得見的分頁會送）→ 依排程抓報價 → 寫進 chrome.storage.session。
//   quotes：key → quote（見 sources.js）
//   status：群組 id → { ok, error, at, fails, count }，懸浮框顯示錯誤用
//   misLag：MIS 盤中延遲統計（CLAUDE.md 7.2 留下的問題：長時間觀察 MIS 延遲）
//   hidden：老闆鍵狀態（true＝所有分頁的框都藏起來）
// 沒有分頁送 tick（沒有看得見的分頁）或框藏起來時，就完全不發請求；多個 tick 同時進來共用同一次抓取。
importScripts('markets.js', 'prefs.js', 'sources.js', 'schedule.js');

// storage.session 預設只有背景程式讀得到，懸浮框（content script）要先開放才能讀和收到變更
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

// 抓取群組：every＝多久抓一次，source＝用哪個來源函式（sources.js 的 SOURCES）
const GROUPS = [
  { id: 'tw', every: 5000, source: 'mis' },      // 自選台股＋台灣兩個指數，一個請求
  { id: 'us', every: 5000, source: 'spark' },    // 自選美股
  { id: 'idx', every: 30000, source: 'spark' },  // 其他國家指數
];

// 每個群組上次抓的時間與連續失敗次數。背景程式閒置被 Chrome 暫停後會清空，最多只是多抓一次
const state = {};
let running = null;

// 老闆鍵：快捷鍵、點工具列圖示、框上的 👁 都切換同一個 hidden，所有分頁的框監聽它跟著藏起來
async function toggleHidden() {
  const { hidden = false } = await chrome.storage.session.get('hidden');
  await chrome.storage.session.set({ hidden: !hidden });
}

// 新增自選股前查代號：框（content script）不能直接連 MIS／Yahoo（跨網域會被擋），所以由這裡查。
// 回傳 { found: { market, code, ex?, name } } 或 { error: 錯誤代碼, src?, detail? }（代碼見 sources.js 的 fail，另有 format、notFound）
async function lookup(m) {
  const code = PSPrefs.normalize(m.code);
  const market = PSPrefs.classify(code);
  if (!market) return { error: 'format' };
  const found = await PSSources.LOOKUP[market](code);
  return found ? { found } : { error: 'notFound' };
}

const COMMANDS = {
  tick: () => { running ??= refresh().finally(() => { running = null; }); },
  toggleHidden,
};
const REPLIES = { lookup };   // 要回覆結果的指令
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.to !== 'sw') return;
  if (!REPLIES[m.cmd]) {
    COMMANDS[m.cmd]?.();   // 不回傳它的 Promise：新版 Chrome 會把回傳的 Promise 當成「要回覆」
    return;
  }
  REPLIES[m.cmd](m).then(reply, (e) => reply(errorOf(e)));
  return true;   // 告訴 Chrome 等一下才回覆
});
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'toggle-hide') toggleHidden();
});
chrome.action.onClicked.addListener(() => toggleHidden());

async function refresh() {
  const now = Date.now();
  const [prefs, stored] = await Promise.all([PSPrefs.load(), chrome.storage.session.get(['quotes', 'status', 'misLag', 'hidden'])]);
  if (stored.hidden) return;   // 框藏起來時不抓（框本來就不送 tick，這裡再擋一次舊的框）
  const all = PSPrefs.items(prefs);
  const plans = GROUPS.map((g) => ({ ...g, items: all.filter((i) => i.group === g.id) }));
  const todo = PSSchedule.due(plans, now, state, stored.quotes ?? {});
  if (!todo.length) return;
  const results = await Promise.all(todo.map(run));
  await save(results, stored);
}

// 錯誤只存代碼和細節，框再翻成目前介面語言的文字（sources.js 的 fail；沒有代碼的當 other）
const errorOf = (e) => ({ error: e.code ?? 'other', src: e.src ?? '', detail: e.detail ?? e.message });

async function run(plan) {
  const s = (state[plan.id] ??= { last: 0, fails: 0 });
  s.last = Date.now();
  try {
    const quotes = await PSSources.SOURCES[plan.source](plan.items);
    s.fails = 0;
    return { id: plan.id, quotes, status: { ok: true, at: Date.now(), fails: 0, count: quotes.length } };
  } catch (e) {
    s.fails += 1;
    console.warn(`[PeekStock] ${plan.id} failed (${s.fails} in a row): ${e.message}`);
    return { id: plan.id, quotes: [], status: { ok: false, ...errorOf(e), at: Date.now(), fails: s.fails, count: 0 } };
  }
}

async function save(results, stored) {
  const quotes = { ...stored.quotes };
  const status = { ...stored.status };
  for (const r of results) {
    r.quotes.forEach((q) => { quotes[q.key] = q; });
    status[r.id] = r.status;
  }
  const tw = results.find((r) => r.id === 'tw');
  const misLag = tw?.quotes.length ? countLag(stored.misLag, tw.quotes) : stored.misLag;
  await chrome.storage.session.set({ quotes, status, ...(misLag && { misLag }) });
}

// ---------- MIS 延遲統計 ----------

// 每筆報價的延遲（收到時間 − 資料時間）落在哪一格：≤10 秒、≤30、≤60、≤120、超過 120
const LAG_EDGES = [10, 30, 60, 120];
function bucketOf(sec) {
  const i = LAG_EDGES.findIndex((e) => sec <= e);
  return i < 0 ? LAG_EDGES.length : i;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// 只算台股盤中（休市的延遲沒有意義）
function countLag(prev, quotes) {
  const lags = quotes.filter((q) => q.time).map((q) => Math.round((q.fetchedAt - q.time) / 1000));
  if (!lags.length || !PSMarkets.isOpen('tw', Date.now())) return prev;
  const base = prev ?? { since: Date.now(), n: 0, buckets: Array(LAG_EDGES.length + 1).fill(0) };
  const buckets = [...base.buckets];
  lags.forEach((sec) => { buckets[bucketOf(sec)] += 1; });
  return { ...base, n: base.n + lags.length, buckets, last: { median: median(lags), max: Math.max(...lags), at: Date.now() } };
}
