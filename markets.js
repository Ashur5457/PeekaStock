// 市場表與指數表：背景程式（sw.js）、懸浮框（overlay.js）、測試共用。
// 交易時段一律用交易所當地時間，判斷盤中或休市；國定假日不管（v0.x 先不處理）。
// 懸浮框可能被重複注入同一個網頁，所以用 ??= 避免重複定義。
globalThis.PSMarkets ??= (() => {
  const ALL_DAY = [['00:00', '24:00']];
  const FUT_DAY = [['00:00', '17:00'], ['18:00', '24:00']];
  // 地區名稱在 i18n.js 的 mkt.＋市場代號
  const MARKETS = {
    tw: { tz: 'Asia/Taipei', hours: [['09:00', '13:30']] },
    // ext：美股延長交易（盤前、盤後），只有自選美股會抓（見 sources.js 的 ext）
    us: { tz: 'America/New_York', hours: [['09:30', '16:00']], ext: { pre: ['04:00', '09:30'], post: ['16:00', '20:00'] } },
    cn: { tz: 'Asia/Shanghai', hours: [['09:30', '11:30'], ['13:00', '15:00']] },
    hk: { tz: 'Asia/Hong_Kong', hours: [['09:30', '12:00'], ['13:00', '16:00']] },
    jp: { tz: 'Asia/Tokyo', hours: [['09:00', '11:30'], ['12:30', '15:30']] },
    kr: { tz: 'Asia/Seoul', hours: [['09:00', '15:30']] },
    sg: { tz: 'Asia/Singapore', hours: [['09:00', '12:00'], ['13:00', '17:00']] },
    uk: { tz: 'Europe/London', hours: [['08:00', '16:30']] },
    fr: { tz: 'Europe/Paris', hours: [['09:00', '17:30']] },
    de: { tz: 'Europe/Berlin', hours: [['09:00', '17:30']] },
    // 不是週一到週五的市場用 byDay：每天各自的時段，沒寫的那天休市
    crypto: { tz: 'UTC', byDay: Object.fromEntries(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => [d, ALL_DAY])) },
    // CME 期貨：週日 18:00 開到週五 17:00（美東時間），每天 17:00～18:00 休息
    fut: { tz: 'America/New_York', byDay: {
      Sun: [['18:00', '24:00']], Mon: FUT_DAY, Tue: FUT_DAY, Wed: FUT_DAY, Thu: FUT_DAY, Fri: [['00:00', '17:00']],
    } },
  };

  // 指數表：加一行就多一個指數（名稱在 i18n.js 的 idx.＋代號）。group 決定由哪個抓取群組負責（見 sw.js 的 GROUPS）：
  //   tw  → 證交所 MIS（台灣兩個指數 Yahoo 延遲 20 分，改用 MIS，見 CLAUDE.md 7.3）
  //   idx → Yahoo spark，每 30 秒；crypto → Yahoo spark，每 5 秒（實測只晚約 5 秒）
  // 第 4 欄 delay：來源固定延遲幾秒，畫面變灰的門檻要加上它（Yahoo 的期貨固定晚 10 分鐘，不然永遠是灰的）
  const INDICES = [
    ['tw', 'tw', 'tse_t00'], ['tw', 'tw', 'otc_o00'],
    ['us', 'idx', '^DJI'], ['us', 'idx', '^GSPC'], ['us', 'idx', '^IXIC'], ['us', 'idx', '^SOX'],
    ['cn', 'idx', '000001.SS'], ['cn', 'idx', '399001.SZ'], ['cn', 'idx', '000300.SS'],
    ['hk', 'idx', '^HSI'], ['jp', 'idx', '^N225'], ['kr', 'idx', '^KS11'],
    ['sg', 'idx', '^STI'], ['uk', 'idx', '^FTSE'], ['fr', 'idx', '^FCHI'], ['de', 'idx', '^GDAXI'],
    ['crypto', 'crypto', 'BTC-USD'], ['crypto', 'crypto', 'ETH-USD'],
    ['fut', 'idx', 'GC=F', 600], ['fut', 'idx', 'SI=F', 600], ['fut', 'idx', 'CL=F', 600],
  ].map(([market, group, symbol, delay = 0]) => ({ key: `idx:${symbol}`, market, group, symbol, delay, nameKey: `idx.${symbol}` }));

  function clockIn(tz, now) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    return { day: parts.weekday, hm: `${parts.hour}:${parts.minute}` };
  }

  const within = ([from, to], hm) => hm >= from && hm < to;
  const isWeekend = (day) => day === 'Sat' || day === 'Sun';

  function isOpen(market, now) {
    const { tz, hours, byDay } = MARKETS[market];
    const { day, hm } = clockIn(tz, now);
    const today = byDay ? byDay[day] ?? [] : isWeekend(day) ? [] : hours;
    return today.some((range) => within(range, hm));
  }

  // 現在是不是延長交易時段：回傳 'pre'、'post' 或 null
  function extSession(market, now) {
    const { tz, ext = {} } = MARKETS[market];
    const { day, hm } = clockIn(tz, now);
    if (isWeekend(day)) return null;
    return Object.keys(ext).find((k) => within(ext[k], hm)) ?? null;
  }

  return { MARKETS, INDICES, isOpen, extSession };
})();
