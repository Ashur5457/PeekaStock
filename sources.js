// 資料來源：每個來源是一個函式 (items, fetchFn) => Promise<quote[]>。來源壞了只換這一個函式。
//   item  = { key, market, group, symbol, … }（見 prefs.js 的 items()）
//   quote = { key, name, price, prev, chg, pct, time, fetchedAt, from }
//     time：資料時間（毫秒）；fetchedAt：收到回應的時間；from：價格是成交價（trade）、買價（bid）、賣價（ask）、盤前（pre）還是盤後（post）
// 「發請求」和「解析回應」分開，解析可以直接拿 tools/samples/ 的真實回應測（見 tools/test.mjs）。
// 回應不是 JSON（例如被導到同意頁的 HTML）或 HTTP 失敗就丟錯誤，由 sw.js 記下並顯示，不默默沿用舊資料。
globalThis.PSSources ??= (() => {
  const TIMEOUT_MS = 15000;   // 盤中一次查很多檔時 MIS 曾 10 秒才回（CLAUDE.md 7.2）

  const num = (v) => (v === '' || v == null || v === '-' || Number.isNaN(Number(v)) ? null : Number(v));

  // 漲跌只用價格和昨收算，兩個來源算法一致
  function withChange(q) {
    const ok = q.price != null && q.prev;
    return { ...q, chg: ok ? q.price - q.prev : null, pct: ok ? ((q.price - q.prev) / q.prev) * 100 : null };
  }

  // 錯誤一律帶代碼：code（http／notJson／mis／timeout／other）、src（MIS／Yahoo）、detail。
  // 背景程式只存代碼，框再依目前的介面語言翻成文字（i18n.js 的 err.＋代碼），換語言時已顯示的錯誤也會跟著換
  const fail = (code, src, detail = '') => Object.assign(new Error(`${src} ${code} ${detail}`.trim()), { code, src, detail });

  async function getJson(fetchFn, url, src) {
    let res;
    try {
      res = await fetchFn(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw e.name === 'TimeoutError' ? fail('timeout', src) : fail('other', src, e.message);
    }
    if (!res.ok) throw fail('http', src, String(res.status));
    try {
      return await res.json();
    } catch {
      throw fail('notJson', src);
    }
  }

  // ---------- 證交所 MIS ----------

  // 五檔價格 '2420.0000_2415.0000_…' 裡第一個大於 0 的（市價單的價格記成 0，例如漲停時的買單）
  const firstPositive = (s) => (s ?? '').split('_').map(num).find((v) => v > 0) ?? null;
  // 盤中成交價 z 幾乎都是 '-'（CLAUDE.md 7.2），依序改用最佳買價、最佳賣價
  const PRICE_FROM = [['trade', (m) => num(m.z)], ['bid', (m) => firstPositive(m.b)], ['ask', (m) => firstPositive(m.a)]];

  function misPrice(m) {
    for (const [from, pick] of PRICE_FROM) {
      const price = pick(m);
      if (price > 0) return { price, from };
    }
    return { price: null, from: null };
  }

  // 查不到的代號也會回一筆沒有 c 的空資料，跳過
  function parseMis(json, at, items) {
    const bySymbol = new Map(items.map((i) => [i.symbol, i]));
    return (json?.msgArray ?? []).filter((m) => m.c && bySymbol.has(`${m.ex}_${m.c}`)).map((m) => {
      const item = bySymbol.get(`${m.ex}_${m.c}`);
      return withChange({ key: item.key, name: m.n, prev: num(m.y), time: num(m.tlong), fetchedAt: at, ...misPrice(m) });
    });
  }

  async function mis(items, fetchFn = fetch) {
    const chs = items.map((i) => `${i.symbol}.tw`).join('%7C');
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${chs}&json=1&delay=0&_=${Date.now()}`;
    const json = await getJson(fetchFn, url, 'MIS');
    if (json.rtcode && json.rtcode !== '0000') throw fail('mis', 'MIS', json.rtmessage ?? json.rtcode);
    return parseMis(json, Date.now(), items);
  }

  // ---------- Yahoo spark（一次最多 20 檔，不用 crumb） ----------

  const SPARK_MAX = 20;
  const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

  // 名稱是 Yahoo 給的（有些中間夾一大串空白，例如 DAX，收成一格）；指數畫面上用 i18n 的名稱，不用這個
  // 這一個交易日的時段 [開盤, 收盤]（毫秒）。收盤後 Yahoo 給的是下一個交易日的時段（2026-11-04 實測）
  const periodOf = (meta) => {
    const p = meta.currentTradingPeriod?.regular;
    return p?.start && p?.end ? [p.start * 1000, p.end * 1000] : null;
  };

  // 當天走勢（迷你走勢線用）：spark 本來就回傳每 5 分鐘的收盤價，不用多發請求。[[時間（秒）, 價格]…]，沒有成交的那 5 分鐘（null）跳過
  const lineOf = (resp) => {
    const closes = resp.indicators?.quote?.[0]?.close ?? [];
    return (resp.timestamp ?? []).map((ts, i) => [ts, closes[i]]).filter(([, v]) => v != null);
  };

  // cur：幣別。倫敦 GBp、南非 ZAc、以色列 ILA 的單位是「分」（Yahoo 照當地交易所的報法），不換算
  function parseSpark(json, at, items) {
    const bySymbol = new Map(items.map((i) => [i.symbol, i]));
    return (json?.spark?.result ?? []).filter((r) => bySymbol.has(r.symbol) && r.response?.[0]?.meta).map((r) => {
      const meta = r.response[0].meta;
      const item = bySymbol.get(r.symbol);
      return withChange({
        key: item.key, name: (meta.shortName ?? meta.longName ?? r.symbol).replace(/\s+/g, ' '),
        price: meta.regularMarketPrice ?? null, prev: meta.previousClose ?? meta.chartPreviousClose ?? null,
        time: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null, fetchedAt: at, from: 'trade',
        cur: meta.currency ?? null, period: periodOf(meta), line: lineOf(r.response[0]),
      });
    });
  }

  // Yahoo 回 Cache-Control: max-age=300，中間的快取伺服器會把同一個網址的舊結果重複給（實測舊了 27 秒，
  // 甚至比上一次還舊），所以網址加上時間戳記 _=，每次都是新網址（MIS 本來就這樣做）
  async function sparkPart(items, fetchFn) {
    const symbols = items.map((i) => encodeURIComponent(i.symbol)).join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols}&range=1d&interval=5m&_=${Date.now()}`;
    return parseSpark(await getJson(fetchFn, url, 'Yahoo'), Date.now(), items);
  }

  async function spark(items, fetchFn = fetch) {
    const parts = await Promise.all(chunks(items, SPARK_MAX).map((part) => sparkPart(part, fetchFn)));
    return parts.flat();
  }

  // ---------- Yahoo chart：美股盤前盤後（不用 crumb，但一次一檔；實測最新價只晚 2～20 秒，CLAUDE.md 7.4） ----------

  const EXT_MAX = 20;   // 每檔一個請求，每 30 秒一輪，所以只抓前 20 檔自選美股

  // 最後一筆有價格的資料落在盤前或盤後才算；漲跌的基準是上次收盤 regularMarketPrice（previousClose 是更前一天的收盤）。
  // 其他情況（還沒有今天的盤前成交、已經進入正常交易）回傳 null，畫面維持原本的價格
  function parseChart(json, at, item) {
    const r = json?.chart?.result?.[0];
    const stamps = r?.timestamp ?? [], closes = r?.indicators?.quote?.[0]?.close ?? [];
    const i = stamps.findLastIndex((_, j) => closes[j] != null);
    const periods = r?.meta?.currentTradingPeriod;
    const from = i < 0 ? null : ['pre', 'post'].find((k) => stamps[i] >= periods?.[k]?.start && stamps[i] < periods?.[k]?.end);
    if (!from) return null;
    return withChange({
      key: item.key, name: (r.meta.shortName ?? r.meta.longName ?? item.symbol).replace(/\s+/g, ' '),
      price: closes[i], prev: r.meta.regularMarketPrice ?? null, time: stamps[i] * 1000, fetchedAt: at, from,
    });
  }

  async function chartOne(item, fetchFn) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=1d&interval=1m&includePrePost=true&_=${Date.now()}`;
    return parseChart(await getJson(fetchFn, url, 'Yahoo'), Date.now(), item);
  }

  // 一檔失敗不影響其他檔；全部失敗才算這個來源壞了
  async function ext(items, fetchFn = fetch) {
    const got = await Promise.allSettled(items.slice(0, EXT_MAX).map((i) => chartOne(i, fetchFn)));
    const ok = got.filter((g) => g.status === 'fulfilled');
    if (!ok.length) throw got[0].reason;
    return ok.map((g) => g.value).filter(Boolean);
  }

  const SOURCES = { mis, spark, ext };

  // ---------- 新增自選股時查代號（存不存在、名稱、台股是上市還是上櫃） ----------

  // 台股：同一個代號同時問 tse_ 和 otc_，有回資料的那個就是答案（查不到的會回沒有 c 的空資料，parseMis 會跳過）
  async function lookupTw(code, fetchFn = fetch) {
    const asks = ['tse', 'otc'].map((ex) => ({ key: ex, symbol: `${ex}_${code}` }));
    const [found] = await mis(asks, fetchFn);
    return found ? { market: 'tw', code, ex: found.key, name: found.name } : null;
  }

  // 美股和其他國家個股：spark 查一次，不存在的代號不會出現在回應裡
  async function lookupYahoo(code, fetchFn = fetch, market = 'us') {
    const [found] = await spark([{ key: market, symbol: code }], fetchFn);
    return found ? { market, code, name: found.name } : null;
  }

  // 台股要問上市還是上櫃；其他市場都問 Yahoo
  const LOOKUP = { tw: lookupTw };
  const lookup = (market, code, fetchFn = fetch) => (LOOKUP[market] ?? lookupYahoo)(code, fetchFn, market);

  return { SOURCES, lookup, SPARK_MAX, EXT_MAX, parseMis, parseSpark, parseChart, num };
})();
