// 測試：node tools/test.mjs（不裝套件）。
// 用 tools/fixtures/ 的真實回應跑主要流程，不只測錯誤分支（CLAUDE.md 第 4 節坑 4）。
// fixtures 是 probe.mjs 存在 tools/samples/ 的原始回應縮減而成（只留測試用到的欄位；samples 不上傳）：
//   解析 MIS／spark → 排程 → 背景程式收到 tick 後真的寫進 storage.session
// chrome 和 fetch 都是假的；擴充功能的檔案用 vm 載入，和 importScripts 一樣是一般 script。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const load = (f) => vm.runInThisContext(readFileSync(new URL(f, ROOT), 'utf8'), { filename: f });
const sample = (f) => JSON.parse(readFileSync(new URL(`tools/fixtures/${f}`, ROOT), 'utf8'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------- 假的 chrome ----------

function fakeArea(name, listeners) {
  const data = {};
  return {
    data,
    get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (obj) => {
      const ch = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: structuredClone(v) }]));
      Object.assign(data, structuredClone(obj));
      listeners.forEach((cb) => cb(ch, name));
    },
    setAccessLevel: async () => {},
  };
}

const changeListeners = [];
const messageListeners = [];
const commandListeners = [];
const actionListeners = [];
const alarmListeners = [];
const alarms = {};   // 名稱 → 設定（假的 chrome.alarms 只記下來，測試自己叫 alarmListeners）
globalThis.chrome = {
  storage: {
    local: fakeArea('local', changeListeners),
    session: fakeArea('session', changeListeners),
    onChanged: { addListener: (cb) => changeListeners.push(cb) },
  },
  runtime: { onMessage: { addListener: (cb) => messageListeners.push(cb) } },
  commands: { onCommand: { addListener: (cb) => commandListeners.push(cb) } },
  action: { onClicked: { addListener: (cb) => actionListeners.push(cb) } },
  alarms: {
    create: async (name, info) => { alarms[name] = info; },
    clear: async (name) => delete alarms[name],
    onAlarm: { addListener: (cb) => alarmListeners.push(cb) },
  },
};
globalThis.importScripts = (...files) => files.forEach(load);

// 假的 fetch：依網址回傳真實樣本，並記下每次請求的網址
const calls = [];
const reply = (body, status = 200) => ({
  ok: status < 400, status,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : structuredClone(body)),
});
function fakeFetch(url) {
  calls.push(url);
  if (url.includes('mis.twse.com.tw')) {
    return Promise.resolve(reply({ ...sample('mis.json'), msgArray: [...sample('mis.json').msgArray, ...sample('mis-index.json').msgArray] }));
  }
  if (url.includes('/v7/finance/spark')) return Promise.resolve(reply(sample('yahoo-spark-v7.json')));
  return Promise.resolve(reply('<html>?</html>'));
}

// ---------- 小型測試框架 ----------

let passed = 0;
const failed = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
}

load('i18n.js');
PSI18n.use('zh-Hant');   // 測試裡的中文斷言用繁中
load('markets.js');
load('prefs.js');
load('sources.js');
load('schedule.js');
load('alerts.js');
const { isOpen, INDICES } = PSMarkets;
const { parseMis, parseSpark, SOURCES } = PSSources;

// 已知時間點（UTC）：2026-10-28 是週三，美東仍是夏令時間
const AT = {
  twOpen: Date.UTC(2026, 9, 28, 1, 30),     // 台北 09:30
  twClosed: Date.UTC(2026, 9, 28, 6, 0),    // 台北 14:00
  usOpen: Date.UTC(2026, 9, 28, 14, 42),    // 紐約 10:42
  saturday: Date.UTC(2026, 9, 31, 2, 0),    // 台北週六 10:00
};

console.log('\n介面文字（i18n.js）');
const { S: STRINGS, UI_LANGS } = PSI18n;
const src = (f) => readFileSync(new URL(f, ROOT), 'utf8');
await test('每個 key 剛好 6 欄（六種語言），而且都是非空字串', () => {
  Object.entries(STRINGS).forEach(([k, row]) => {
    assert.equal(row.length, UI_LANGS.length, k);
    row.forEach((s, i) => assert.ok(typeof s === 'string' && s.length, `${k} 第 ${i + 1} 欄`));
  });
});
await test('同一句的 {變數} 在六種語言都一樣', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  Object.entries(STRINGS).forEach(([k, row]) => row.forEach((s) => assert.equal(vars(s), vars(row[0]), `${k}：${s}`)));
});
await test('畫面和程式裡寫死的 key 都存在（data-i18n、t(\'…\')）', () => {
  const used = ['overlay.js', 'panel.js'].flatMap((f) => [
    ...src(f).matchAll(/data-i18n(?:-title|-placeholder)?="([^"$]+)"/g), ...src(f).matchAll(/\bt\('([^']+)'/g),
    ...src(f).matchAll(/'(help\.\w+|tag\.\w+)'/g),   // 使用說明（panel.js 的 HELP 表）
  ].map((m) => m[1]));
  assert.ok(used.length > 30, `只找到 ${used.length} 個`);
  used.forEach((k) => assert.ok(STRINGS[k], `少了 ${k}`));
});
await test('組出來的 key 也都存在：指數、地區、分頁、段標題、錯誤、上市櫃、按鈕提示、分頁錯誤', () => {
  const keys = [
    ...INDICES.map((i) => i.nameKey), ...Object.keys(PSMarkets.MARKETS).map((m) => `mkt.${m}`),
    ...PSPrefs.BUILTIN_TABS.map((x) => x.nameKey), ...PSPrefs.sections(PSPrefs.items(PSPrefs.DEFAULT)).map((s) => s.titleKey),
    ...['http', 'notJson', 'mis', 'timeout', 'other'].map((c) => `err.${c}`), 'err.line',
    ...['tse', 'otc', 'us'].map((x) => `ex.${x}`), ...['up', 'down', 'del', 'ren', 'tup', 'tdown', 'tdel', 'bell', 'asave', 'aclear'].map((x) => `op.${x}`),
    ...PSAlerts.RULES.map((r) => `alert.${r.kind}`),
    ...['tabEmpty', 'tabLong', 'tabDup', 'tabFull', 'format', 'notFound'].map((x) => `msg.${x}`),
    ...['bid', 'ask'].flatMap((x) => [`tag.${x}`, `tag.${x}Hint`]),
  ];
  keys.forEach((k) => assert.ok(STRINGS[k], `少了 ${k}`));
});
await test('程式碼裡沒有漏掉的中日韓文字（註解以外都要搬進 i18n.js）', () => {
  const CJK = /[　-ヿ㐀-鿿가-힯＀-￯]/;
  const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  ['overlay.js', 'panel.js', 'markets.js', 'prefs.js', 'sources.js', 'schedule.js', 'box.js', 'sw.js', 'alerts.js', 'blank.js'].forEach((f) => {
    const bad = strip(src(f)).split('\n').filter((line) => CJK.test(line));
    assert.deepEqual(bad, [], f);
  });
});
await test('語言：指定的就用；「自動」一定落在六種之一；找不到的 key 顯示 key 本身', () => {
  assert.equal(PSI18n.resolve('ja'), 'ja');
  assert.ok(UI_LANGS.includes(PSI18n.resolve('auto')));
  assert.equal(PSI18n.resolve('fr'), PSI18n.resolve('auto'));
  PSI18n.use('en');
  assert.equal(PSI18n.t('msg.notFound', { code: 'ZZZ' }), 'ZZZ not found');
  assert.equal(PSI18n.t('no.such.key'), 'no.such.key');
  PSI18n.use('zh-Hant');
});
await test('_locales：六種語言的 messages.json 都有 manifest 用到的每個 key', () => {
  const manifest = src('manifest.json');
  const needed = [...manifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
  assert.equal(JSON.parse(manifest).default_locale, 'en');
  ['en', 'zh_TW', 'zh_CN', 'ja', 'ko', 'es'].forEach((dir) => {
    const msgs = JSON.parse(src(`_locales/${dir}/messages.json`));
    needed.forEach((k) => assert.ok(msgs[k]?.message, `${dir} 少了 ${k}`));
  });
});
await test('manifest 用到的圖示檔都存在（由 tools/make_icons.ps1 從 icons/icon.svg 產生）', () => {
  const m = JSON.parse(src('manifest.json'));
  const files = [...Object.values(m.icons), ...Object.values(m.action.default_icon)];
  assert.ok(files.length >= 4);
  files.forEach((f) => assert.ok(readFileSync(new URL(f, ROOT)).length > 100, f));
});
await test('設定新欄位有預設值：介面語言自動、紅漲綠跌；舊設定讀得進來', () => {
  const p = PSPrefs.merge({ watchlist: [] });
  assert.deepEqual([p.uiLang, p.upColor, p.showLag, p.mini], ['auto', 'red', false, false]);
});

console.log('\n市場表');
await test('台股 09:30 盤中、14:00 休市、週六休市', () => {
  assert.equal(isOpen('tw', AT.twOpen), true);
  assert.equal(isOpen('tw', AT.twClosed), false);
  assert.equal(isOpen('tw', AT.saturday), false);
});
await test('美股紐約 10:42 盤中，同一時間台股休市', () => {
  assert.equal(isOpen('us', AT.usOpen), true);
  assert.equal(isOpen('tw', AT.usOpen), false);
});
await test('每個指數的市場都在市場表裡', () => INDICES.forEach((i) => assert.ok(PSMarkets.MARKETS[i.market], i.symbol)));

console.log('\n設定 → 項目');
await test('預設自選＋指數：key、群組、代號', () => {
  const items = PSPrefs.items(PSPrefs.DEFAULT);
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.deepEqual([by['tw:2330'].symbol, by['tw:2330'].group], ['tse_2330', 'tw']);
  assert.deepEqual([by['tw:6488'].symbol, by['tw:6488'].group], ['otc_6488', 'tw']);
  assert.deepEqual([by['us:AAPL'].symbol, by['us:AAPL'].group], ['AAPL', 'us']);
  assert.equal(by['idx:tse_t00'].group, 'tw');
  assert.equal(by['idx:^N225'].group, 'idx');
  assert.equal(items.length, 4 + INDICES.length);
});
await test('隱身模式預設關；舊設定沒有 stealth 欄位也讀得進來', () => {
  assert.equal(PSPrefs.DEFAULT.stealth, false);
  assert.equal(PSPrefs.merge({ watchlist: [] }).stealth, false);
  assert.equal(PSPrefs.merge({ stealth: true }).stealth, true);
});
await test('關掉的指數不出現；舊設定沒有新指數也會補上預設', () => {
  const p = PSPrefs.merge({ indices: { '^N225': false } });
  const keys = PSPrefs.items(p).map((i) => i.key);
  assert.ok(!keys.includes('idx:^N225'));
  assert.ok(keys.includes('idx:^HSI'));
});

console.log('\n自選清單（prefs.js 純函式）');
const { classify, normalize, addWatch, removeWatch, moveWatch, has, isFull, keyOf, sections, items: itemsOf } = PSPrefs;
await test('代號格式：台股數字／ETF、美股英文；亂打的擋下', () => {
  const cases = { 2330: 'tw', '00878': 'tw', '00631L': 'tw', 6488: 'tw', AAPL: 'us', 'BRK-B': 'us', 'BRK.B': 'us',
    '': null, 123: null, 1234567: null, '2330.TW': null, 'AB$': null, '2AB': null };
  Object.entries(cases).forEach(([raw, want]) => assert.equal(classify(normalize(raw)), want, raw));
  assert.equal(normalize('  aapl '), 'AAPL');
});
const W = (code, market = 'tw', ex = 'tse') => (market === 'tw' ? { market, code, ex } : { market, code });
await test('新增：加在最後；已有的不重複加；滿 100 檔不加', () => {
  const list = [W('2330'), W('AAPL', 'us')];
  assert.deepEqual(addWatch(list, W('2603')).map(keyOf), ['tw:2330', 'us:AAPL', 'tw:2603']);
  assert.equal(addWatch(list, W('2330', 'tw', 'otc')), list);
  assert.ok(has(list, { market: 'us', code: 'AAPL' }));
  const full = Array.from({ length: PSPrefs.WATCH_MAX }, (_, i) => W(String(1000 + i)));
  assert.ok(isFull(full));
  assert.equal(addWatch(full, W('9999')), full);
});
await test('刪除與上下搬移；到頂、到底、找不到都不動', () => {
  const list = [W('2330'), W('2603'), W('AAPL', 'us')];
  assert.deepEqual(removeWatch(list, 'tw:2603').map(keyOf), ['tw:2330', 'us:AAPL']);
  assert.deepEqual(moveWatch(list, 'us:AAPL', -1).map(keyOf), ['tw:2330', 'us:AAPL', 'tw:2603']);
  assert.deepEqual(moveWatch(list, 'tw:2330', 1).map(keyOf), ['tw:2603', 'tw:2330', 'us:AAPL']);
  assert.equal(moveWatch(list, 'tw:2330', -1), list);
  assert.equal(moveWatch(list, 'us:AAPL', 1), list);
  assert.equal(moveWatch(list, 'tw:0000', 1), list);
});
await test('分段：台股／美股／國際指數，段內指數在前、自選股在後', () => {
  const secs = sections(itemsOf(PSPrefs.DEFAULT));
  assert.deepEqual(secs.map((s) => s.id), ['tw', 'us', 'world']);
  assert.deepEqual(secs[0].items.map((i) => i.key), ['idx:tse_t00', 'idx:otc_o00', 'tw:2330', 'tw:6488']);
  assert.deepEqual(secs[1].items.slice(-2).map((i) => i.key), ['us:AAPL', 'us:NVDA']);
  assert.ok(secs[2].items.every((i) => i.key.startsWith('idx:') && !['tw', 'us'].includes(i.market)));
});
await test('空的段不出現（美國指數全關、也沒有自選美股）', () => {
  const p = PSPrefs.merge({
    watchlist: [W('2330')],
    indices: Object.fromEntries(INDICES.filter((i) => i.market === 'us').map((i) => [i.symbol, false])),
  });
  assert.deepEqual(sections(itemsOf(p)).map((s) => s.id), ['tw', 'world']);
});
await test('新增時查到的名稱當作備用名稱（還沒抓到報價時顯示）', () => {
  const p = PSPrefs.merge({ watchlist: [{ market: 'tw', code: '2603', ex: 'tse', name: '長榮' }] });
  assert.equal(itemsOf(p)[0].label, '長榮');
});

console.log('\n顯示名稱與分頁（prefs.js 純函式）');
const { labelOf, visibleTabs, currentTab, tabError, addTab, renameTab, removeTab, moveTab, setInTab, forgetKey } = PSPrefs;
await test('美股顯示代號（全名放提示）、台股顯示名稱（代號放提示）、指數顯示我們的名稱', () => {
  const by = Object.fromEntries(itemsOf(PSPrefs.DEFAULT).map((i) => [i.key, i]));
  assert.deepEqual(labelOf(by['us:AAPL'], { name: 'Apple Inc.' }), ['AAPL', 'Apple Inc.']);
  assert.deepEqual(labelOf(by['tw:2330'], { name: '台積電' }), ['台積電', '2330']);
  assert.deepEqual(labelOf(by['tw:2330'], undefined), ['2330', '2330']);   // 還沒有報價也沒有查到名稱
  assert.deepEqual(labelOf(by['idx:tse_t00'], { name: '發行量加權股價指數' }, PSI18n.t), ['加權指數', '']);
  assert.deepEqual(labelOf(by['idx:tse_t00'], undefined), ['idx.tse_t00', '']);   // 沒給翻譯函式就是 key
});
await test('內建分頁：全部／台股／美股／國際；沒東西的內建分頁不顯示，自創分頁就算空的也顯示', () => {
  const list = itemsOf(PSPrefs.DEFAULT);
  assert.deepEqual(visibleTabs(PSPrefs.DEFAULT, list).map((x) => x.id), ['all', 'tw', 'us', 'world']);
  const p = PSPrefs.merge({
    watchlist: [W('2330')], tabs: [{ id: 't1', name: '空的', keys: [] }],
    indices: Object.fromEntries(INDICES.filter((i) => i.market === 'us').map((i) => [i.symbol, false])),
  });
  assert.deepEqual(visibleTabs(p, itemsOf(p)).map((x) => x.id), ['all', 'tw', 'world', 't1']);
});
await test('分頁內容：台股分頁只有台股、國際分頁沒有台美、自創分頁照 keys（可跨市場）', () => {
  const p = PSPrefs.merge({ tabs: [{ id: 't1', name: '科技', keys: ['us:NVDA', 'tw:2330', 'idx:^SOX'] }] });
  const list = itemsOf(p);
  const keysIn = (id) => list.filter(visibleTabs(p, list).find((x) => x.id === id).has).map((i) => i.key);
  assert.ok(keysIn('tw').every((k) => k === 'tw:2330' || k === 'tw:6488' || k.startsWith('idx:t') || k.startsWith('idx:o')));
  assert.ok(keysIn('world').every((k) => !['idx:^DJI', 'tw:2330', 'us:AAPL'].includes(k)));
  assert.deepEqual(keysIn('t1'), ['tw:2330', 'us:NVDA', 'idx:^SOX']);   // 照自選清單＋指數表的順序
  assert.equal(keysIn('all').length, list.length);
});
await test('目前分頁：選的分頁被刪掉或變空 → 回到「全部」', () => {
  const p = PSPrefs.merge({ tab: 't9' });
  assert.equal(currentTab(p, itemsOf(p)).id, 'all');
  const q2 = PSPrefs.merge({ tab: 'us', watchlist: [W('2330')],
    indices: Object.fromEntries(INDICES.filter((i) => i.market === 'us').map((i) => [i.symbol, false])) });
  assert.equal(currentTab(q2, itemsOf(q2)).id, 'all');
  assert.equal(currentTab(PSPrefs.merge({ tab: 'us' }), itemsOf(PSPrefs.DEFAULT)).id, 'us');
});
await test('新增分頁：名稱空白、太長、重複（含內建名稱）、超過 10 個都擋下', () => {
  assert.equal(tabError([], ''), 'tabEmpty');
  assert.equal(tabError([], '一二三四五六七八九'), 'tabLong');
  assert.equal(tabError([], '台股', null, ['全部', '台股']), 'tabDup');   // 和內建分頁（目前語言的名稱）同名
  assert.equal(tabError([], '台股'), null);
  const tabs = addTab([], '科技');
  assert.deepEqual(tabs, [{ id: 't1', name: '科技', keys: [] }]);
  assert.equal(tabError(tabs, '科技'), 'tabDup');
  assert.equal(addTab(tabs, '科技'), tabs);
  const ten = Array.from({ length: PSPrefs.TAB_MAX }, (_, i) => ({ id: `t${i + 1}`, name: `分頁${i}`, keys: [] }));
  assert.equal(tabError(ten, '再一個'), 'tabFull');
});
await test('分頁 id：刪掉再加不會撞到舊 id', () => {
  const tabs = addTab(addTab([], 'A'), 'B');
  const after = addTab(removeTab(tabs, 't1'), 'C');
  assert.deepEqual(after.map((x) => x.id), ['t2', 't3']);
});
await test('改名（同名＝自己不算重複）、搬移、刪除分頁', () => {
  const tabs = addTab(addTab([], 'A'), 'B');
  assert.equal(renameTab(tabs, 't1', 'Z')[0].name, 'Z');
  assert.equal(tabError(tabs, 'A', 't1'), null);
  assert.equal(renameTab(tabs, 't1', 'B'), tabs);   // 和別的分頁撞名，不改
  assert.deepEqual(moveTab(tabs, 't2', -1).map((x) => x.id), ['t2', 't1']);
  assert.deepEqual(removeTab(tabs, 't1').map((x) => x.id), ['t2']);
});
await test('放進／拿出分頁；同一檔可以在多個分頁；刪自選股時所有分頁都拿掉它', () => {
  let tabs = addTab(addTab([], 'A'), 'B');
  tabs = setInTab(setInTab(tabs, 't1', 'tw:2330', true), 't2', 'tw:2330', true);
  tabs = setInTab(tabs, 't1', 'tw:2330', true);   // 重複放不會變兩筆
  assert.deepEqual(tabs.map((x) => x.keys), [['tw:2330'], ['tw:2330']]);
  assert.deepEqual(setInTab(tabs, 't1', 'tw:2330', false)[0].keys, []);
  assert.deepEqual(forgetKey(tabs, 'tw:2330').map((x) => x.keys), [[], []]);
});

console.log('\nMIS 解析（真實樣本）');
const misItems = PSPrefs.items(PSPrefs.DEFAULT).filter((i) => i.group === 'tw');
const misJson = { ...sample('mis.json'), msgArray: [...sample('mis.json').msgArray, ...sample('mis-index.json').msgArray] };
const one = (json, key) => parseMis(json, 1, misItems).find((q) => q.key === key);
const patched = (patch) => ({ msgArray: [{ ...sample('mis.json').msgArray.find((m) => m.c === '2330'), ...patch }] });

await test('2330、6488、兩個指數都解析出來，數字是 number', () => {
  const quotes = parseMis(misJson, 1, misItems);
  assert.deepEqual(quotes.map((q) => q.key).sort(), ['idx:otc_o00', 'idx:tse_t00', 'tw:2330', 'tw:6488']);
  quotes.forEach((q) => {
    assert.equal(typeof q.price, 'number', q.key);
    assert.equal(typeof q.prev, 'number', q.key);
    assert.ok(q.time > 1e12, `${q.key} time`);
  });
});
await test('漲跌與漲跌幅用價格和昨收算', () => {
  const q = one(misJson, 'tw:2330');
  assert.equal(q.chg, q.price - q.prev);
  assert.ok(Math.abs(q.pct - ((q.price - q.prev) / q.prev) * 100) < 1e-9);
});
await test('名稱是 MIS 給的（指數畫面上另外用 i18n 的名稱）', () => {
  assert.equal(one(misJson, 'idx:tse_t00').name, '發行量加權股價指數');
  assert.equal(one(misJson, 'tw:2330').name, '台積電');
});
await test("z='-'（盤中常見）→ 改用最佳買價，from=bid", () => {
  const q = one(patched({ z: '-', b: '2420.0000_2415.0000_', a: '2425.0000_' }), 'tw:2330');
  assert.deepEqual([q.price, q.from], [2420, 'bid']);
});
await test('漲停時買 1 是 0 → 跳過，取第一個大於 0 的買價', () => {
  const q = one(patched({ z: '-', b: '0.0000_539.5000_', a: '-' }), 'tw:2330');
  assert.deepEqual([q.price, q.from], [539.5, 'bid']);
});
await test('買價全是 0 → 改用賣價，from=ask', () => {
  const q = one(patched({ z: '-', b: '0.0000_', a: '541.0000_542.0000_' }), 'tw:2330');
  assert.deepEqual([q.price, q.from], [541, 'ask']);
});
await test('查不到的代號（沒有 c 的空資料）跳過', () => {
  assert.equal(parseMis({ msgArray: [{ ex: 'otc', c: '' }, {}] }, 1, misItems).length, 0);
});

console.log('\nspark 解析（真實樣本）');
const sparkJson = sample('yahoo-spark-v7.json');
const sparkItems = PSPrefs.items(PSPrefs.DEFAULT).filter((i) => i.group !== 'tw');
await test('美股和指數都解析出來，時間是毫秒', () => {
  const quotes = parseSpark(sparkJson, 1, sparkItems);
  const by = Object.fromEntries(quotes.map((q) => [q.key, q]));
  ['us:AAPL', 'us:NVDA', 'idx:^GSPC', 'idx:^N225', 'idx:^GDAXI'].forEach((k) => {
    assert.ok(by[k], k);
    assert.equal(typeof by[k].price, 'number', k);
    assert.equal(typeof by[k].prev, 'number', k);
    assert.ok(by[k].time > 1e12, `${k} time`);
  });
  assert.ok(!/\s{2}/.test(by['idx:^GDAXI'].name), 'DAX 名稱裡的一大串空白要收掉');
  assert.ok(!/\s{2}/.test(by['us:AAPL'].name), '名稱裡的連續空白要收掉');
});

console.log('\n來源函式（假 fetch）');
await test('mis()：一個請求、代號用 %7C 串起來', async () => {
  calls.length = 0;
  const quotes = await SOURCES.mis(misItems, fakeFetch);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('ex_ch=tse_2330.tw%7Cotc_6488.tw%7Ctse_t00.tw%7Cotc_o00.tw'), calls[0]);
  assert.equal(quotes.length, 4);
});
await test('spark()：25 檔拆成兩個請求（每個最多 20 檔）', async () => {
  calls.length = 0;
  const many = Array.from({ length: 25 }, (_, i) => ({ key: `us:X${i}`, market: 'us', group: 'us', symbol: `X${i}` }));
  await SOURCES.spark(many, fakeFetch);
  assert.equal(calls.length, 2);
  calls.forEach((u) => assert.ok(new URL(u).searchParams.get('symbols').split(',').length <= 20, u));
});
await test('每次請求的網址都帶時間戳記 _=（避開 Yahoo／MIS 中間快取的舊資料）', async () => {
  calls.length = 0;
  await SOURCES.spark(sparkItems, fakeFetch);
  await SOURCES.mis(misItems, fakeFetch);
  calls.forEach((u) => assert.ok(/^\d{13}$/.test(new URL(u).searchParams.get('_')), u));
});
await test('回應是 HTML（例如被導到同意頁）→ 丟錯誤', async () => {
  const html = () => Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse('<html>') });
  await assert.rejects(SOURCES.spark(sparkItems, html), (e) => e.code === 'notJson' && e.src === 'Yahoo');
});
await test('HTTP 500 → 丟錯誤', async () => {
  await assert.rejects(SOURCES.mis(misItems, () => Promise.resolve(reply({}, 500))),
    (e) => e.code === 'http' && e.src === 'MIS' && e.detail === '500');
});
await test('逾時 → 錯誤代碼 timeout；連不上 → other', async () => {
  const timeout = () => Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' }));
  await assert.rejects(SOURCES.mis(misItems, timeout), (e) => e.code === 'timeout');
  await assert.rejects(SOURCES.mis(misItems, () => Promise.reject(new TypeError('Failed to fetch'))),
    (e) => e.code === 'other' && e.detail === 'Failed to fetch');
});

console.log('\n排程');
const plansOf = (items) => [
  { id: 'tw', every: 5000, source: 'mis', items: items.filter((i) => i.group === 'tw') },
  { id: 'idx', every: 30000, source: 'spark', items: items.filter((i) => i.group === 'idx') },
];
const allItems = PSPrefs.items(PSPrefs.DEFAULT);
const haveAll = Object.fromEntries(allItems.map((i) => [i.key, {}]));
await test('還沒有報價 → 休市也要抓一次', () => {
  const todo = PSSchedule.due(plansOf(allItems), AT.saturday, {}, {});
  assert.deepEqual(todo.map((p) => p.id), ['tw', 'idx']);
});
await test('休市且已有報價 → 不抓', () => {
  assert.equal(PSSchedule.due(plansOf(allItems), AT.saturday, {}, haveAll).length, 0);
});
await test('台股盤中 → 休市的指數被濾掉；時間沒到的群組不抓', () => {
  const todo = PSSchedule.due(plansOf(allItems), AT.twOpen, {}, haveAll);
  assert.deepEqual(todo.map((p) => p.id), ['tw', 'idx']);   // idx 裡日經、韓國等休市，但沒有開的就被濾掉
  const idx = todo.find((p) => p.id === 'idx');
  assert.ok(idx.items.every((i) => isOpen(i.market, AT.twOpen)));
  assert.equal(PSSchedule.due(plansOf(allItems), AT.twOpen, { tw: { last: AT.twOpen - 3000, fails: 0 } }, haveAll)
    .some((p) => p.id === 'tw'), false);
});
await test('連續失敗 2 次 → 間隔變 4 倍；最多 5 分鐘', () => {
  const plan = { every: 5000 };
  assert.equal(PSSchedule.waitOf(plan, { fails: 2 }), 20000);
  assert.equal(PSSchedule.waitOf(plan, { fails: 20 }), PSSchedule.MAX_WAIT);
});

console.log('\n提醒（alerts.js）');
const alertPrefs = (extra = {}) => ({ alerts: {}, moveAlert: { on: true, pct: 3 }, ...extra });
const stock = { key: 'tw:2330', market: 'tw' };
const kindsOf = (hits) => hits.map((h) => h.kind).sort();
await test('到價：剛好等於上限／下限就響；沒設就不響', () => {
  const p = alertPrefs({ alerts: { 'tw:2330': { above: 2400, below: 2300 } }, moveAlert: { on: false, pct: 3 } });
  const at = (price, prefs = p) => kindsOf(PSAlerts.check([stock], { 'tw:2330': { price, pct: 0 } }, prefs, {}, AT.twOpen));
  assert.deepEqual(at(2400), ['above']);
  assert.deepEqual(at(2300), ['below']);
  assert.deepEqual(at(2350), []);
  assert.deepEqual(at(9999, alertPrefs({ moveAlert: { on: false, pct: 3 } })), []);
});
await test('大漲大跌：±3% 剛好就響，2.99% 不響；關掉就不響', () => {
  const at = (pct, p = alertPrefs()) => kindsOf(PSAlerts.check([stock], { 'tw:2330': { price: 1, pct } }, p, {}, AT.twOpen));
  assert.deepEqual(at(3), ['up']);
  assert.deepEqual(at(-3), ['down']);
  assert.deepEqual(at(2.99), []);
  assert.deepEqual(at(5, alertPrefs({ moveAlert: { on: false, pct: 3 } })), []);
});
await test('休市不響；同一天響過不再響，隔天會再響', () => {
  const quotes = { 'tw:2330': { price: 1, pct: 5 } };
  assert.deepEqual(PSAlerts.check([stock], quotes, alertPrefs(), {}, AT.twClosed), []);
  const [hit] = PSAlerts.check([stock], quotes, alertPrefs(), {}, AT.twOpen);
  assert.equal(hit.id, 'tw:2330|up|2026-10-28');
  assert.deepEqual(PSAlerts.check([stock], quotes, alertPrefs(), { [hit.id]: true }, AT.twOpen), []);
  const nextDay = AT.twOpen + 86400000;
  assert.equal(PSAlerts.check([stock], quotes, alertPrefs(), { [hit.id]: true }, nextDay).length, 1);
  assert.deepEqual(PSAlerts.prune({ [hit.id]: true }, AT.twOpen), { [hit.id]: true });
  assert.deepEqual(PSAlerts.prune({ [hit.id]: true }, nextDay + 86400000), {});
});
await test('背景提醒只抓要看的：大漲大跌開著＝全部；關著＝只有設了到價的', () => {
  const list = PSPrefs.items(PSPrefs.DEFAULT);
  assert.equal(PSAlerts.watched(list, alertPrefs()).length, list.length);
  const only = PSAlerts.watched(list, alertPrefs({ alerts: { 'us:AAPL': { above: 1 } }, moveAlert: { on: false, pct: 3 } }));
  assert.deepEqual(only.map((i) => i.key), ['us:AAPL']);
});
await test('新設定的預設值：沒有到價提醒、大漲大跌 ±3% 開著、背景提醒關著', () => {
  const p = PSPrefs.merge({ stealth: true });
  assert.deepEqual([p.alerts, p.moveAlert, p.bgAlert], [{}, { on: true, pct: 3 }, false]);
});

console.log('\n空白處點兩下（blank.js）');
load('blank.js');
// 假的元素：chain＝自己到最外層的標籤或屬性（例如 ['span', 'a', 'body']）；closest 只要鏈上有一個在選擇器清單裡就算找到
const fakeEl = (chain, editable = false) => ({
  isContentEditable: editable,
  closest: (sel) => (chain.some((x) => sel.split(',').includes(x)) ? {} : null),
});
const HOST = { tag: 'peek-stock' };
const dbl = (chain, extra = {}) => ({ target: fakeEl(chain), defaultPrevented: false, composedPath: () => [], ...extra });
await test('空白處點兩下（沒有選到字）→ 算；選到字 → 不算', () => {
  assert.equal(PSBlank.isBlank(dbl(['div', 'body']), '', HOST), true);
  assert.equal(PSBlank.isBlank(dbl(['html']), '  ', HOST), true);
  assert.equal(PSBlank.isBlank(dbl(['p', 'body']), '台積電', HOST), false);
});
await test('輸入框、可編輯區、連結、按鈕、影片、畫布、圖片裡面點兩下 → 不算', () => {
  ['input', 'textarea', 'a', 'button', 'video', 'canvas', 'img', 'iframe', '[role="button"]'].forEach((x) =>
    assert.equal(PSBlank.isBlank(dbl(['span', x, 'body']), '', HOST), false, x));
  assert.equal(PSBlank.isBlank({ ...dbl(['div']), target: fakeEl(['div'], true) }, '', HOST), false);
});
await test('網頁自己處理掉的、點在框裡面的 → 不算', () => {
  assert.equal(PSBlank.isBlank(dbl(['div'], { defaultPrevented: true }), '', HOST), false);
  assert.equal(PSBlank.isBlank(dbl(['div'], { composedPath: () => [{}, HOST, {}] }), '', HOST), false);
});
await test('新設定的預設值：空白處點兩下藏身開著、按鍵是 Esc 連按兩下', () => {
  const p = PSPrefs.merge({ stealth: true });
  assert.equal(p.dblHide, true);
  assert.deepEqual(p.hideKey, { on: true, key: 'Escape', double: true });
  assert.equal(PSBlank.keyLabel(p.hideKey), 'Esc');
});
const key = (k, extra = {}) => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, defaultPrevented: false, ...extra });
const ESC2 = { on: true, key: 'Escape', double: true };
await test('Esc 連按兩下：0.4 秒內第二下才觸發；太慢、中間按了別的鍵都要重來', () => {
  const first = PSBlank.keyFires(key('Escape'), ESC2, null, 1000);
  assert.deepEqual(first, { fire: false, last: 1000 });
  assert.equal(PSBlank.keyFires(key('Escape'), ESC2, first.last, 1400).fire, true);
  assert.equal(PSBlank.keyFires(key('Escape'), ESC2, first.last, 1401).fire, false);
  const other = PSBlank.keyFires(key('a'), ESC2, first.last, 1100);
  assert.equal(PSBlank.keyFires(key('Escape'), ESC2, other.last, 1200).fire, false);
});
await test('按住不放（repeat）、網頁處理掉的、關掉的、修飾鍵不同 → 不觸發', () => {
  assert.equal(PSBlank.keyFires(key('Escape', { repeat: true }), ESC2, 1000, 1100).fire, false);
  assert.equal(PSBlank.keyFires(key('Escape', { defaultPrevented: true }), ESC2, 1000, 1100).fire, false);
  assert.equal(PSBlank.keyFires(key('Escape'), { ...ESC2, on: false }, 1000, 1100).fire, false);
  assert.equal(PSBlank.keyFires(key('Escape', { ctrlKey: true }), ESC2, 1000, 1100).fire, false);
});
await test('錄製：Ctrl+Alt+H 單按一下就觸發；只按修飾鍵不算；顯示成 Ctrl+Alt+H', () => {
  assert.equal(PSBlank.recorded(key('Shift', { shiftKey: true }), ESC2), null);
  const hk = { ...PSBlank.recorded(key('h', { ctrlKey: true, altKey: true }), ESC2), double: false };
  assert.equal(PSBlank.keyLabel(hk), 'Ctrl+Alt+H');
  assert.equal(PSBlank.keyFires(key('H', { ctrlKey: true, altKey: true }), hk, null, 0).fire, true);
  assert.equal(PSBlank.keyFires(key('h', { ctrlKey: true }), hk, null, 0).fire, false);
});
await test('在輸入框、可編輯區（包括框裡的輸入框）按的鍵不算', () => {
  const typing = (chain, editable = false) => PSBlank.isTyping({ composedPath: () => [fakeEl(chain, editable)] });
  assert.equal(typing(['input', 'form', 'body']), true);
  assert.equal(typing(['div'], true), true);
  assert.equal(typing(['div', 'body']), false);
});

console.log('\n懸浮框位置大小（box.js）');
load('box.js');
const VIEW = { w: 1280, h: 720 };
const { fitted, moved, resized, defaultBox, MIN_W, MIN_H, BAR_ROOM } = PSBox;
await test('預設框在右下角、完全在畫面內', () => {
  const b = defaultBox(VIEW);
  assert.deepEqual(fitted(b, VIEW), b);
  assert.equal(b.left + b.width, VIEW.w - 16);
  assert.equal(b.top + b.height, VIEW.h - 16);
});
await test('拖到畫面外 → 畫的時候拉回畫面內（上方留工具列的空間）', () => {
  const start = defaultBox(VIEW);
  assert.deepEqual(fitted(moved(start, 5000, 5000), VIEW), { ...start, left: VIEW.w - start.width, top: VIEW.h - start.height });
  const r = fitted(moved(start, -5000, -5000), VIEW);
  assert.deepEqual([r.left, r.top], [0, BAR_ROOM]);
});
await test('右下角縮放：往右下長大，左上角不動；到畫面邊緣就停', () => {
  const start = { left: 100, top: 100, width: 300, height: 300 };
  assert.deepEqual(resized(start, 'se', 50, 40, VIEW), { left: 100, top: 100, width: 350, height: 340 });
  const big = resized(start, 'se', 5000, 5000, VIEW);
  assert.equal(big.left + big.width, VIEW.w);
  assert.ok(big.top + big.height <= VIEW.h);
});
await test('左上角縮放：右下角固定；縮到最小尺寸就停', () => {
  const start = { left: 100, top: 100, width: 300, height: 300 };
  const grown = resized(start, 'nw', -50, -30, VIEW);
  assert.deepEqual(grown, { left: 50, top: 70, width: 350, height: 330 });
  const tiny = resized(start, 'nw', 1000, 1000, VIEW);
  assert.deepEqual([tiny.width, tiny.height], [MIN_W, MIN_H]);
  assert.deepEqual([tiny.left + tiny.width, tiny.top + tiny.height], [400, 400]);
});
await test('視窗變小時框跟著縮，存檔的大小不變；視窗變大恢復', () => {
  const saved = { left: 900, top: 200, width: 360, height: 500 };
  const small = fitted(saved, { w: 400, h: 300 });
  assert.ok(small.width <= 400 * 0.95 && small.left + small.width <= 400);
  assert.ok(small.top + small.height <= 300);
  assert.deepEqual(fitted(saved, VIEW), saved);
});

console.log('\n背景程式（tick → 抓取 → storage.session）');
globalThis.fetch = fakeFetch;
load('sw.js');
const session = chrome.storage.session.data;
const tickOnce = async () => {
  messageListeners.forEach((cb) => cb({ to: 'sw', cmd: 'tick' }));
  for (let i = 0; i < 50 && running; i += 1) await sleep(10);   // running 是 sw.js 裡「正在抓」的那次
};
await test('第一次 tick：三個群組都抓，報價寫進 storage.session', async () => {
  calls.length = 0;
  await tickOnce();
  ['tw:2330', 'tw:6488', 'us:AAPL', 'us:NVDA', 'idx:tse_t00', 'idx:^N225', 'idx:^GDAXI'].forEach((k) =>
    assert.ok(session.quotes?.[k]?.price > 0, k));
  assert.deepEqual(Object.keys(session.status).sort(), ['idx', 'tw', 'us']);
  assert.ok(Object.values(session.status).every((s) => s.ok));
  assert.equal(calls.filter((u) => u.includes('mis.twse')).length, 1);
});
await test('馬上再 tick：時間沒到，不發任何請求', async () => {
  calls.length = 0;
  await tickOnce();
  assert.equal(calls.length, 0);
});
await test('同時來 5 個 tick（多個視窗）→ 只抓一次', async () => {
  Object.keys(state).forEach((k) => { state[k].last = 0; });
  delete session.quotes;   // 讓休市的項目也要抓
  calls.length = 0;
  messageListeners.forEach((cb) => [1, 2, 3, 4, 5].forEach(() => cb({ to: 'sw', cmd: 'tick' })));
  await tickOnce();
  assert.equal(calls.filter((u) => u.includes('mis.twse')).length, 1);
});
await test('MIS 失敗 → status 記錯誤和次數，其他群組照常', async () => {
  Object.keys(state).forEach((k) => { state[k].last = 0; });
  delete session.quotes;
  globalThis.fetch = (url) => (url.includes('mis.twse') ? Promise.resolve(reply({}, 503)) : fakeFetch(url));
  await tickOnce();
  assert.equal(session.status.tw.ok, false);
  assert.deepEqual([session.status.tw.error, session.status.tw.src, session.status.tw.detail], ['http', 'MIS', '503']);
  assert.equal(session.status.tw.fails, 1);
  assert.equal(session.status.us.ok, true);
  globalThis.fetch = fakeFetch;
});
await test('藏身鍵：快捷鍵、點圖示、框上的 👁 都切換 hidden', async () => {
  commandListeners.forEach((cb) => cb('toggle-hide'));
  await sleep(20);
  assert.equal(session.hidden, true);
  actionListeners.forEach((cb) => cb({}));
  await sleep(20);
  assert.equal(session.hidden, false);
  messageListeners.forEach((cb) => cb({ to: 'sw', cmd: 'toggleHidden' }));
  await sleep(20);
  assert.equal(session.hidden, true);
});
await test('藏起來時 tick 不發任何請求；叫出來後照常抓', async () => {
  Object.keys(state).forEach((k) => { state[k].last = 0; });
  delete session.quotes;
  calls.length = 0;
  await tickOnce();
  assert.equal(calls.length, 0);
  await chrome.storage.session.set({ hidden: false });
  await tickOnce();
  assert.ok(calls.length > 0);
});
// 送一個要回覆的訊息給背景程式，等它回覆
const ask = (m) => new Promise((resolve) => messageListeners.forEach((cb) => cb({ to: 'sw', ...m }, {}, resolve)));
await test('查代號：上市 2330 → tse、上櫃 6488 → otc，附名稱', async () => {
  assert.deepEqual(await ask({ cmd: 'lookup', code: '2330' }), { found: { market: 'tw', code: '2330', ex: 'tse', name: '台積電' } });
  assert.deepEqual((await ask({ cmd: 'lookup', code: ' 6488 ' })).found, { market: 'tw', code: '6488', ex: 'otc', name: '環球晶' });
});
await test('查代號：一次同時問上市和上櫃（一個請求）', async () => {
  calls.length = 0;
  await ask({ cmd: 'lookup', code: '2330' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('ex_ch=tse_2330.tw%7Cotc_2330.tw'), calls[0]);
});
await test('查代號：美股 aapl → AAPL；找不到、格式錯都回原因', async () => {
  const r = await ask({ cmd: 'lookup', code: 'aapl' });
  assert.equal(r.found.code, 'AAPL');
  assert.equal(r.found.market, 'us');
  assert.equal(typeof r.found.name, 'string');
  assert.deepEqual(await ask({ cmd: 'lookup', code: '9999' }), { error: 'notFound' });
  assert.deepEqual(await ask({ cmd: 'lookup', code: 'ZZZZQ' }), { error: 'notFound' });
  assert.deepEqual(await ask({ cmd: 'lookup', code: '2330.TW' }), { error: 'format' });
});
await test('查代號：網路錯誤 → 回錯誤訊息，不會卡住', async () => {
  globalThis.fetch = () => Promise.resolve(reply({}, 500));
  const r = await ask({ cmd: 'lookup', code: '2330' });
  globalThis.fetch = fakeFetch;
  assert.deepEqual([r.error, r.detail], ['http', '500']);
});
await test('MIS 延遲統計：台股盤中才算，分到正確的格子', () => {
  const realOpen = PSMarkets.isOpen;
  const now = Date.now();
  PSMarkets.isOpen = () => true;
  const q = (sec) => ({ time: now - sec * 1000, fetchedAt: now });
  const m = countLag(null, [q(5), q(25), q(50), q(100), q(300)]);
  PSMarkets.isOpen = () => false;
  const closed = countLag(m, [q(5)]);
  PSMarkets.isOpen = realOpen;
  assert.deepEqual(m.buckets, [1, 1, 1, 1, 1]);
  assert.deepEqual([m.n, m.last.median, m.last.max], [5, 50, 300]);
  assert.equal(closed, m);
});

await test('提醒：抓到報價後放進佇列，只放一次；框顯示完送 dismissAlert 拿掉', async () => {
  const realOpen = PSMarkets.isOpen;
  PSMarkets.isOpen = () => true;
  await chrome.storage.session.set({ hidden: false, alertQueue: [], alertFired: {} });
  await PSPrefs.update({ alerts: { 'us:AAPL': { above: 1 } }, moveAlert: { on: false, pct: 3 } });
  for (const _ of [1, 2]) {
    Object.keys(state).forEach((k) => { state[k].last = 0; });
    await tickOnce();
  }
  PSMarkets.isOpen = realOpen;
  assert.deepEqual(session.alertQueue.map((a) => [a.key, a.kind]), [['us:AAPL', 'above']]);
  messageListeners.forEach((cb) => cb({ to: 'sw', cmd: 'dismissAlert', id: session.alertQueue[0].id }));
  await sleep(20);
  assert.deepEqual(session.alertQueue, []);
});
await test('背景提醒：打開才設鬧鐘；鬧鐘響時框藏著也抓，但只抓有設提醒的', async () => {
  assert.equal(alarms.bgAlert, undefined);
  await PSPrefs.update({ bgAlert: true });
  await sleep(20);
  assert.deepEqual(alarms.bgAlert, { periodInMinutes: 1 });
  const realOpen = PSMarkets.isOpen;
  PSMarkets.isOpen = () => true;
  await chrome.storage.session.set({ hidden: true });
  Object.keys(state).forEach((k) => { state[k].last = 0; });
  delete session.quotes;
  calls.length = 0;
  alarmListeners.forEach((cb) => cb({ name: 'bgAlert' }));
  for (let i = 0; i < 50 && running; i += 1) await sleep(10);
  PSMarkets.isOpen = realOpen;
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/v7/finance/spark') && calls[0].includes('AAPL') && !calls[0].includes('NVDA'), calls[0]);
  await PSPrefs.update({ bgAlert: false });
  await sleep(20);
  assert.equal(alarms.bgAlert, undefined);
});

console.log(`\n${passed} 個通過，${failed.length} 個失敗`);
if (failed.length) process.exit(1);
