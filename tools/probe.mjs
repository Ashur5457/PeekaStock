// v0.1 資料來源實測：Node 直接執行（node tools/probe.mjs），不裝套件，可重複執行。
// 對證交所 MIS 和 Yahoo Finance 的各個端點實際打一輪，印出：每個代號抓不抓得到、名稱、價格、
// 資料時間與現在差幾秒、該市場現在盤中還是休市（休市時延遲沒有意義），以及每個端點能不能一次抓多檔、要不要 cookie／crumb。
//   結果：tools/probe-results/日期-時間.json（每次一份，方便比較盤中／休市）
//   原始回應：tools/samples/端點.json（每次覆蓋；v0.2 起假 fetch 測試用真實格式）
// 注意：Node 的 fetch 不會自動帶 cookie，所以這裡手動帶；擴充功能裡由 Chrome 處理 cookie。
import { mkdir, writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const LAG_WARN = 60;   // 盤中延遲超過幾秒要標 ⚠
const GAP_MS = 250;    // 每個請求之間隔一下，不要打太快
const HERE = new URL('./', import.meta.url);

// ---------- 市場表：時區＋交易時段（當地時間），判斷盤中或休市 ----------

const MARKETS = {
  tw: { tz: 'Asia/Taipei', hours: [['09:00', '13:30']] },
  us: { tz: 'America/New_York', hours: [['09:30', '16:00']] },
  cn: { tz: 'Asia/Shanghai', hours: [['09:30', '11:30'], ['13:00', '15:00']] },
  hk: { tz: 'Asia/Hong_Kong', hours: [['09:30', '12:00'], ['13:00', '16:00']] },
  jp: { tz: 'Asia/Tokyo', hours: [['09:00', '11:30'], ['12:30', '15:30']] },
  kr: { tz: 'Asia/Seoul', hours: [['09:00', '15:30']] },
  sg: { tz: 'Asia/Singapore', hours: [['09:00', '12:00'], ['13:00', '17:00']] },
  uk: { tz: 'Europe/London', hours: [['08:00', '16:30']] },
  fr: { tz: 'Europe/Paris', hours: [['09:00', '17:30']] },
  de: { tz: 'Europe/Berlin', hours: [['09:00', '17:30']] },
  fut: { tz: 'America/New_York', hours: [['00:00', '17:00'], ['18:00', '24:00']] },   // 美股期貨：幾乎 24 小時
  fx: { tz: 'UTC', hours: [['00:00', '24:00']] },                                      // 外匯：平日 24 小時
};

function clockIn(tz, now) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { day: parts.weekday, hm: `${parts.hour}:${parts.minute}` };
}

// 國定假日不管（v0.x 先不處理），只看週末和時段
function isOpen(market, now) {
  const { tz, hours } = MARKETS[market];
  const { day, hm } = clockIn(tz, now);
  if (day === 'Sat' || day === 'Sun') return false;
  return hours.some(([from, to]) => hm >= from && hm < to);
}

// ---------- 代號表 ----------

// 台股 20 檔（一次查 20 檔的測試）：前 16 檔上市（tse）、後 4 檔上櫃（otc）
const TW = [
  ...['2330', '2317', '2454', '2308', '2412', '2881', '2882', '2303', '1301', '2002',
      '3008', '2891', '2886', '1216', '2382', '2603'].map((code) => ({ code, ex: 'tse' })),
  ...['6488', '5483', '3105', '8069'].map((code) => ({ code, ex: 'otc' })),
];

// Yahoo：美股、CLAUDE.md 2.2 的全部指數、富途候選功能用到的期貨與匯率
const YAHOO = [
  ['AAPL', 'us', 'stock'], ['NVDA', 'us', 'stock'],
  // ^TWOII 是 CLAUDE.md 原本寫的櫃買指數代號，v0.1 實測 404；Yahoo 搜尋到的正確代號是 IX0043.TWO
  ['^TWII', 'tw', 'index'], ['^TWOII', 'tw', 'index'], ['IX0043.TWO', 'tw', 'index'],
  ['^DJI', 'us', 'index'], ['^GSPC', 'us', 'index'], ['^IXIC', 'us', 'index'], ['^SOX', 'us', 'index'],
  ['000001.SS', 'cn', 'index'], ['399001.SZ', 'cn', 'index'], ['000300.SS', 'cn', 'index'],
  ['^HSI', 'hk', 'index'], ['^N225', 'jp', 'index'], ['^KS11', 'kr', 'index'], ['^STI', 'sg', 'index'],
  ['^FTSE', 'uk', 'index'], ['^FCHI', 'fr', 'index'], ['^GDAXI', 'de', 'index'],
  ['ES=F', 'fut', 'candidate'], ['NQ=F', 'fut', 'candidate'], ['TWD=X', 'fx', 'candidate'],
].map(([symbol, market, kind]) => ({ symbol, market, kind }));

// ---------- HTTP ----------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const cookieOf = (res) => res.cookies.map((c) => c.split(';')[0]).join('; ');

// 失敗也回傳同樣形狀（status 0 = 連不上），呼叫端不必另外 try
async function get(url, headers = {}) {
  await sleep(GAP_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text, json: parse(text), cookies: res.headers.getSetCookie(), at: Date.now() };
  } catch (e) {
    return { status: 0, ok: false, text: String(e), json: null, cookies: [], at: Date.now() };
  }
}

const samples = {};
const keep = (name, res) => { samples[name] ??= res.json ?? res.text; };

// ---------- 輸出用 ----------

const localTime = (ms) => new Date(ms).toLocaleString('sv-SE');   // 本機時間 YYYY-MM-DD HH:MM:SS
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// q = { name, price, time(ms) }；抓不到時 q 是 null。at＝收到回應的時間，延遲用它算
function quoteRow(source, symbol, market, q, at, extra = {}) {
  const open = isOpen(market, at);
  const lag = q?.time ? Math.round((at - q.time) / 1000) : null;
  return {
    來源: source, 代號: symbol, 市場: market, 狀態: open ? '盤中' : '休市', 抓到: q ? '✓' : '✗',
    名稱: q?.name?.trim() ?? '', 價格: q?.price ?? '', 資料時間: q?.time ? localTime(q.time) : '',
    延遲秒: lag, 警告: open && lag > LAG_WARN ? '⚠ >1分' : '', ...extra,
  };
}

const endpoints = [];
const note = (name, res, fields) => endpoints.push({ 端點: name, HTTP: res.status, ...fields });

// ---------- 證交所 MIS ----------

const MIS = 'https://mis.twse.com.tw/stock';
const misUrl = (chs) => `${MIS}/api/getStockInfo.jsp?ex_ch=${chs.join('%7C')}&json=1&delay=0&_=${Date.now()}`;
const ch = ({ code, ex }) => `${ex}_${code}.tw`;
// 查不到的代號（例如上市股問 otc_）也會回一筆沒有 c（代號）的空資料，不算
const misList = (res) => (res.json?.msgArray ?? []).filter((m) => m.c);
// 指數也在 MIS：t00＝加權指數、o00＝櫃買指數
const MIS_INDEX = [{ code: 't00', ex: 'tse' }, { code: 'o00', ex: 'otc' }];

// 五檔價格 '2420.0000_2415.0000_…' 裡第一個大於 0 的（市價單的價格是 0，例如漲停時的買單）
const firstPositive = (s) => (s ?? '').split('_').map(num).find((v) => v > 0) ?? null;

// z（成交價）盤中常常是 '-'，這時依序改用最佳買價、最佳賣價，並記下用的是哪一個
const PRICE_FROM = [['成交', (m) => num(m.z)], ['買價', (m) => firstPositive(m.b)], ['賣價', (m) => firstPositive(m.a)]];

function misQuote(m) {
  const [from, pick] = PRICE_FROM.find(([, f]) => f(m) > 0) ?? ['無', () => null];
  return { name: m.n, price: pick(m), time: num(m.tlong), from };
}

async function probeMis() {
  const pair = [{ code: '2330', ex: 'tse' }, { code: '6488', ex: 'otc' }].map(ch);
  const bare = await get(misUrl(pair));
  keep('mis', bare);
  note('MIS 不帶 cookie', bare, { 結果: `${bare.json?.rtmessage ?? bare.text.slice(0, 60)}，回傳 ${misList(bare).length}/2 檔` });

  const home = await get(`${MIS}/index.jsp`);
  const cookie = cookieOf(home);
  const withCookie = await get(misUrl(pair), { Cookie: cookie });
  note('MIS 先取 cookie', withCookie, { 結果: `cookie=${cookie ? cookie.split('=')[0] : '（沒拿到）'}，回傳 ${misList(withCookie).length}/2 檔` });
  const headers = misList(bare).length ? {} : { Cookie: cookie };

  // 上市／上櫃自動判斷：同一檔同時問 tse 和 otc，看哪個有回
  const guess = await get(misUrl(['6488', '2330'].flatMap((code) => ['tse', 'otc'].map((ex) => ch({ code, ex })))), headers);
  note('MIS 上市/上櫃判斷', guess, { 結果: misList(guess).map((m) => `${m.c}→${m.ex}`).join('、') || '沒有回傳' });

  const batch = await get(misUrl(TW.map(ch)), headers);
  const got = new Map(misList(batch).map((m) => [m.c, m]));
  const dash = misList(batch).filter((m) => m.z === '-').length;
  const fields = Object.keys(misList(batch)[0] ?? {});
  note('MIS 一次 20 檔', batch, { 結果: `回傳 ${got.size}/20 檔，z='-' 有 ${dash} 檔`, 欄位: fields.join(',') });
  const index = await get(misUrl(MIS_INDEX.map(ch)), headers);
  keep('mis-index', index);
  misList(index).forEach((m) => got.set(m.c, m));
  note('MIS 指數 t00/o00', index, { 結果: `回傳 ${misList(index).length}/2 檔` });
  const rows = [...TW, ...MIS_INDEX].map(({ code, ex }) => {
    const m = got.get(code);
    const q = m && misQuote(m);
    return quoteRow(`MIS ${ex}`, code, 'tw', q, batch.at, {
      價格來源: q?.from ?? '', z: m?.z ?? '', 買1: m?.b?.split('_')[0] ?? '', 漲停: m?.u ?? '', 跌停: m?.w ?? '',
    });
  });

  await probeMisLimit(headers);
  return rows;
}

// 上限：用 1101 起的連號（有些號碼不存在），看要求 N 檔時回傳幾檔、請求會不會被拒絕
async function probeMisLimit(headers) {
  for (const n of [50, 100, 125, 150, 175, 200]) {
    const codes = Array.from({ length: n }, (_, i) => ({ code: String(1101 + i), ex: 'tse' }));
    const res = await get(misUrl(codes.map(ch)), headers);
    note(`MIS 一次 ${n} 個代號`, res, { 結果: res.ok ? `回傳 ${misList(res).length} 檔存在的（連號，部分號碼不存在）` : res.text.slice(0, 60) });
    if (!res.ok || !misList(res).length) return;
  }
}

// ---------- Yahoo Finance ----------

const Q1 = 'https://query1.finance.yahoo.com';
const symbolsParam = (list) => list.map((y) => encodeURIComponent(y.symbol)).join(',');

const metaQuote = (meta) => meta && {
  name: meta.shortName ?? meta.longName ?? '', price: meta.regularMarketPrice, time: meta.regularMarketTime * 1000,
};

// v8 chart：一次一檔，不用 crumb
async function probeChart() {
  const rows = [];
  for (const y of YAHOO) {
    const res = await get(`${Q1}/v8/finance/chart/${encodeURIComponent(y.symbol)}?interval=1m&range=1d`);
    keep('yahoo-chart', res);
    const meta = res.json?.chart?.result?.[0]?.meta;
    rows.push(quoteRow('v8 chart', y.symbol, y.market, metaQuote(meta), res.at, { 類別: y.kind, HTTP: res.status }));
  }
  const ok = rows.filter((r) => r.抓到 === '✓').length;
  note('Yahoo v8 chart（逐檔）', { status: 200 }, { 結果: `${ok}/${YAHOO.length} 檔抓到，需要 ${YAHOO.length} 個請求` });
  return rows;
}

// spark：兩個版本都試。先全部代號一次送出（超過 20 檔，看上限），再每 20 檔一批
const sparkUrl = (ver, list) => `${Q1}/${ver}/finance/spark?symbols=${symbolsParam(list)}&range=1d&interval=5m`;
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

async function probeSpark() {
  const all = await get(sparkUrl('v7', YAHOO));
  note(`Yahoo v7 spark 一次 ${YAHOO.length} 檔`, all, { 結果: `回傳 ${(all.json?.spark?.result ?? []).length} 檔`, 錯誤: errorOf(all) });

  const rows = [];
  for (const part of chunks(YAHOO, 20)) {
    const res = await get(sparkUrl('v7', part));
    keep('yahoo-spark-v7', res);
    const list = res.json?.spark?.result ?? [];
    note(`Yahoo v7 spark 一次 ${part.length} 檔`, res, { 結果: `回傳 ${list.length}/${part.length} 檔`, 錯誤: errorOf(res) });
    const metas = new Map(list.map((r) => [r.symbol, r.response?.[0]?.meta]));
    rows.push(...part.map((y) => quoteRow('v7 spark', y.symbol, y.market, metaQuote(metas.get(y.symbol)), res.at, { 類別: y.kind })));
  }

  // v8 spark 只回收盤價陣列（沒有名稱、沒有 regularMarketTime），只記能不能用
  const v8 = await get(sparkUrl('v8', YAHOO.slice(0, 20)));
  keep('yahoo-spark-v8', v8);
  const v8keys = Object.keys(v8.json ?? {}).filter((k) => YAHOO.some((y) => y.symbol === k));
  note('Yahoo v8 spark 一次 20 檔', v8, { 結果: `回傳 ${v8keys.length}/20 檔`, 錯誤: errorOf(v8) });
  return rows;
}

function errorOf(res) {
  if (res.ok) return '';
  const j = res.json;
  return String(j?.finance?.error?.description ?? j?.spark?.error?.description ?? j?.chart?.error?.description ?? res.text).slice(0, 120);
}

// v7 quote：先不帶 crumb；失敗就走 fc.yahoo.com 取 cookie → getcrumb 再試
async function probeQuote() {
  const url = `${Q1}/v7/finance/quote?symbols=${symbolsParam(YAHOO)}`;
  const bare = await get(url);
  note('Yahoo v7 quote 不帶 crumb', bare, { 結果: bare.ok ? `回傳 ${quoteList(bare).length} 檔` : '失敗', 錯誤: errorOf(bare) });

  const fc = await get('https://fc.yahoo.com');
  const cookie = cookieOf(fc);
  const crumbRes = await get(`${Q1}/v1/test/getcrumb`, { Cookie: cookie });
  const crumb = crumbRes.ok ? crumbRes.text.trim() : '';
  note('Yahoo getcrumb', crumbRes, { 結果: `cookie=${cookie ? cookie.split('=')[0] : '（沒拿到）'}，crumb ${crumb ? '拿到' : '沒拿到'}` });

  const res = crumb ? await get(`${url}&crumb=${encodeURIComponent(crumb)}`, { Cookie: cookie }) : bare;
  keep('yahoo-quote', res);
  const list = quoteList(res);
  note('Yahoo v7 quote 帶 crumb', res, { 結果: `回傳 ${list.length}/${YAHOO.length} 檔`, 錯誤: errorOf(res) });
  const bySymbol = new Map(list.map((x) => [x.symbol, x]));
  return YAHOO.map((y) => quoteRowFromQuote(y, bySymbol.get(y.symbol), res.at));
}

const quoteList = (res) => res.json?.quoteResponse?.result ?? [];

// quote 多了官方延遲（exchangeDataDelayedBy，分鐘）、市場狀態與盤前盤後價，富途候選功能要看這些欄位
function quoteRowFromQuote(y, x, at) {
  const q = x?.regularMarketTime && { name: x.shortName ?? x.longName ?? '', price: x.regularMarketPrice, time: x.regularMarketTime * 1000 };
  return quoteRow('v7 quote', y.symbol, y.market, q, at, {
    類別: y.kind, 官方延遲分: x?.exchangeDataDelayedBy ?? '', marketState: x?.marketState ?? '',
    盤前: x?.preMarketPrice ?? '', 盤後: x?.postMarketPrice ?? '',
  });
}

// ---------- 主程式 ----------

async function save(result) {
  const stamp = localTime(result.runAt).replace(/[-:]/g, '').replace(' ', '-').slice(0, 13);
  await mkdir(new URL('probe-results/', HERE), { recursive: true });
  await mkdir(new URL('samples/', HERE), { recursive: true });
  await writeFile(new URL(`probe-results/${stamp}.json`, HERE), JSON.stringify(result, null, 2));
  for (const [name, body] of Object.entries(samples)) {
    await writeFile(new URL(`samples/${name}.json`, HERE), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return stamp;
}

function print(title, rows) {
  console.log(`\n=== ${title} ===`);
  console.table(rows);
}

const now = Date.now();
console.log(`執行時間（本機）：${localTime(now)}`);
console.log(`盤中的市場：${Object.keys(MARKETS).filter((m) => isOpen(m, now)).join('、') || '（沒有）'}`);

const tables = {
  mis: await probeMis(),
  chart: await probeChart(),
  spark: await probeSpark(),
  quote: await probeQuote(),
};
print('證交所 MIS（台股 20 檔）', tables.mis);
print('Yahoo v8 chart（逐檔）', tables.chart);
print('Yahoo v7 spark（批次）', tables.spark);
print('Yahoo v7 quote（批次，帶 crumb）', tables.quote);
print('端點總表', endpoints);

const stamp = await save({ runAt: now, open: Object.keys(MARKETS).filter((m) => isOpen(m, now)), endpoints, tables });
console.log(`\n已存：tools/probe-results/${stamp}.json、tools/samples/*.json`);
