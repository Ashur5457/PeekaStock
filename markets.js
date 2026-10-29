// 市場表與指數表：背景程式（sw.js）、懸浮框（overlay.js）、測試共用。
// 交易時段一律用交易所當地時間，判斷盤中或休市；國定假日不管（v0.x 先不處理）。
// 懸浮框可能被重複注入同一個網頁，所以用 ??= 避免重複定義。
globalThis.PSMarkets ??= (() => {
  // 地區名稱在 i18n.js 的 mkt.＋市場代號
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
  };

  // 指數表：加一行就多一個指數（名稱在 i18n.js 的 idx.＋代號）。group 決定由哪個抓取群組負責（見 sw.js 的 GROUPS）：
  //   tw  → 證交所 MIS（台灣兩個指數 Yahoo 延遲 20 分，改用 MIS，見 CLAUDE.md 7.3）
  //   idx → Yahoo spark，每 30 秒
  const INDICES = [
    ['tw', 'tw', 'tse_t00'], ['tw', 'tw', 'otc_o00'],
    ['us', 'idx', '^DJI'], ['us', 'idx', '^GSPC'], ['us', 'idx', '^IXIC'], ['us', 'idx', '^SOX'],
    ['cn', 'idx', '000001.SS'], ['cn', 'idx', '399001.SZ'], ['cn', 'idx', '000300.SS'],
    ['hk', 'idx', '^HSI'], ['jp', 'idx', '^N225'], ['kr', 'idx', '^KS11'],
    ['sg', 'idx', '^STI'], ['uk', 'idx', '^FTSE'], ['fr', 'idx', '^FCHI'], ['de', 'idx', '^GDAXI'],
  ].map(([market, group, symbol]) => ({ key: `idx:${symbol}`, market, group, symbol, nameKey: `idx.${symbol}` }));

  function clockIn(tz, now) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    return { day: parts.weekday, hm: `${parts.hour}:${parts.minute}` };
  }

  function isOpen(market, now) {
    const { tz, hours } = MARKETS[market];
    const { day, hm } = clockIn(tz, now);
    if (day === 'Sat' || day === 'Sun') return false;
    return hours.some(([from, to]) => hm >= from && hm < to);
  }

  return { MARKETS, INDICES, isOpen };
})();
