// 提醒：到價（漲到 ≥ 上限、跌到 ≤ 下限）與大漲大跌（漲跌幅 ≥ ±pct%）。純函式，不碰 chrome，可以在 Node 測。
//   prefs.alerts    = { [項目 key]: { above?, below? } }   到價提醒（每檔自己設）
//   prefs.moveAlert = { on, pct }                          大漲大跌（所有自選股和開著的指數）
//   fired           = { [提醒 id]: true }                  今天已經響過的（存在 storage.session，背景程式維護）
// 提醒 id＝`${key}|${kind}|${交易日}`：同一個條件一天只響一次，隔天日期變了自然會再響。
//   交易日＝交易所當地日期；跨午夜的市場（台指期夜盤、CME 期貨）往後推 dayShift 小時，過午夜才不會再響一次
// 只看盤中、而且是「這個交易時段」的報價：休市時的舊資料不會觸發；剛開盤、國定假日、延遲的指數開盤後那段時間，
// 來源給的還是上一個交易日的收盤，也不會觸發（PSMarkets.freshFrom）。markets.js 要比這個檔案先載入。
globalThis.PSAlerts ??= (() => {
  const RULES = [
    { kind: 'above', test: (q, a) => a?.above != null && q.price >= a.above, target: (a) => a.above },
    { kind: 'below', test: (q, a) => a?.below != null && q.price <= a.below, target: (a) => a.below },
    { kind: 'up', test: (q, a, m) => m?.on && q.pct != null && q.pct >= m.pct, target: (a, m) => m.pct },
    { kind: 'down', test: (q, a, m) => m?.on && q.pct != null && q.pct <= -m.pct, target: (a, m) => m.pct },
  ];

  const EXT = ['pre', 'post'];   // 盤前盤後成交量小、價格容易跳動，不觸發提醒
  const dayIn = (market, now) => new Date(now).toLocaleDateString('sv-SE', { timeZone: PSMarkets.MARKETS[market].tz });
  const tradeDay = (market, now) => dayIn(market, now + (PSMarkets.MARKETS[market].dayShift ?? 0) * 3600000);
  const idOf = (key, kind, market, now) => `${key}|${kind}|${tradeDay(market, now)}`;
  // 沒有資料時間的報價不知道新舊，不拿來提醒
  const isFresh = (item, q, now) => q.time != null && q.time >= PSMarkets.freshFrom(item.market, now, q, item.delay);

  // 這次該響的提醒（還沒響過的）。回傳 [{ id, key, kind, target, price, pct, from, at }]
  function check(items, quotes, prefs, fired, now) {
    const hits = [];
    for (const item of items) {
      const q = quotes[item.key];
      if (!q || q.price == null || EXT.includes(q.from) || !PSMarkets.isOpen(item.market, now, q, item.delay) || !isFresh(item, q, now)) continue;
      const a = prefs.alerts?.[item.key];
      RULES.filter((r) => r.test(q, a, prefs.moveAlert)).forEach((r) => {
        const id = idOf(item.key, r.kind, item.market, now);
        if (!fired[id]) hits.push({ id, key: item.key, kind: r.kind, target: r.target(a, prefs.moveAlert), price: q.price, pct: q.pct, from: q.from, at: now });
      });
    }
    return hits;
  }

  // 背景提醒只抓有設到價提醒的項目（CLAUDE.md 第 8 節 2026-10-30 的決定）。大漲大跌照樣檢查這些項目，
  // 但不會為了它去抓全部自選股和指數（大漲大跌預設開著，不然背景每分鐘都在抓全部）
  const watched = (items, prefs) => items.filter((i) => prefs.alerts?.[i.key]);

  // fired 只留今天的（id 結尾是日期），避免一直變大
  const prune = (fired, now) => Object.fromEntries(Object.entries(fired).filter(([id]) =>
    Object.keys(PSMarkets.MARKETS).some((m) => id.endsWith(`|${tradeDay(m, now)}`))));

  return { RULES, check, watched, prune, dayIn, tradeDay };
})();
