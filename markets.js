// 市場表與指數表：背景程式（sw.js）、懸浮框（overlay.js）、測試共用。
// 交易時段一律用交易所當地時間，判斷盤中或休市；國定假日不管（v0.x 先不處理）。
// 懸浮框可能被重複注入同一個網頁，所以用 ??= 避免重複定義。
globalThis.PSMarkets ??= (() => {
  const ALL_DAY = [['00:00', '24:00']];
  const FUT_DAY = [['00:00', '17:00'], ['18:00', '24:00']];
  const TXF_MON = [['08:45', '13:45'], ['15:00', '24:00']];
  const TXF_DAY = [['00:00', '05:00'], ...TXF_MON];
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
    // 只有自選個股的市場（沒有指數）：不寫時段，看 Yahoo 報價附的交易時段 quote.period（見 isOpen）。
    // Yahoo 的時段已經算進國定假日和各國的週末（中東是週日到週四），不用自己維護；午休不分開算，午休時只是價格不動
    ...Object.fromEntries(Object.entries({
      au: 'Australia/Sydney', nz: 'Pacific/Auckland', in: 'Asia/Kolkata', id: 'Asia/Jakarta', my: 'Asia/Kuala_Lumpur',
      th: 'Asia/Bangkok', vn: 'Asia/Ho_Chi_Minh', nl: 'Europe/Amsterdam', be: 'Europe/Brussels', it: 'Europe/Rome',
      es: 'Europe/Madrid', ch: 'Europe/Zurich', se: 'Europe/Stockholm', no: 'Europe/Oslo', dk: 'Europe/Copenhagen',
      fi: 'Europe/Helsinki', at: 'Europe/Vienna', pt: 'Europe/Lisbon', ie: 'Europe/Dublin', pl: 'Europe/Warsaw',
      tr: 'Europe/Istanbul', ca: 'America/Toronto', br: 'America/Sao_Paulo', mx: 'America/Mexico_City',
      ar: 'America/Argentina/Buenos_Aires', cl: 'America/Santiago', za: 'Africa/Johannesburg', il: 'Asia/Jerusalem',
      sa: 'Asia/Riyadh', qa: 'Asia/Qatar',
    }).map(([m, tz]) => [m, { tz }])),
    // 不是週一到週五的市場用 byDay：每天各自的時段，沒寫的那天休市
    crypto: { tz: 'UTC', byDay: Object.fromEntries(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => [d, ALL_DAY])) },
    // CME 期貨：週日 18:00 開到週五 17:00（美東時間），每天 17:00～18:00 休息
    fut: { tz: 'America/New_York', byDay: {
      Sun: [['18:00', '24:00']], Mon: FUT_DAY, Tue: FUT_DAY, Wed: FUT_DAY, Thu: FUT_DAY, Fri: [['00:00', '17:00']],
    } },
    // 台指期（期交所）：日盤 08:45～13:45、夜盤 15:00～隔天 05:00；週一凌晨沒有夜盤，週五的夜盤做到週六 05:00
    txf: { tz: 'Asia/Taipei', byDay: {
      Mon: TXF_MON, Tue: TXF_DAY, Wed: TXF_DAY, Thu: TXF_DAY, Fri: TXF_DAY, Sat: [['00:00', '05:00']],
    } },
  };

  // 指數表：加一行就多一個指數（名稱在 i18n.js 的 idx.＋代號）。group 決定由哪個抓取群組負責（見 sw.js 的 GROUPS）：
  //   tw  → 證交所 MIS（台灣兩個指數 Yahoo 延遲 20 分，改用 MIS，見 CLAUDE.md 7.3）
  //   idx → Yahoo spark，每 30 秒；crypto → Yahoo spark，每 5 秒（實測只晚約 5 秒）
  //   txf → 期交所 MIS（台指期近月，日盤、夜盤自動切換，見 sources.js 的 taifex）
  //   美股指數期貨（ES、NQ、YM）幾乎 24 小時交易：美股夜盤沒有免費資料（CLAUDE.md 7.7），用它看美股晚上的方向
  // 第 4 欄 delay：來源固定延遲幾秒（CLAUDE.md 7.2 實測）。變灰的門檻要加上它，不然盤中永遠是灰的；
  // 收盤後也要多抓這麼久，才拿得到收盤價（見 isOpen）
  const INDICES = [
    ['tw', 'tw', 'tse_t00'], ['tw', 'tw', 'otc_o00'], ['txf', 'txf', 'TXF'],
    ['us', 'idx', '^DJI'], ['us', 'idx', '^GSPC'], ['us', 'idx', '^IXIC'], ['us', 'idx', '^SOX'],
    ['cn', 'idx', '000001.SS', 900], ['cn', 'idx', '399001.SZ', 900], ['cn', 'idx', '000300.SS', 900],
    ['hk', 'idx', '^HSI', 900], ['jp', 'idx', '^N225', 900], ['kr', 'idx', '^KS11', 1200],
    ['sg', 'idx', '^STI', 900], ['uk', 'idx', '^FTSE', 900], ['fr', 'idx', '^FCHI', 900], ['de', 'idx', '^GDAXI', 900],
    ['crypto', 'crypto', 'BTC-USD'], ['crypto', 'crypto', 'ETH-USD'],
    ['fut', 'idx', 'ES=F', 600], ['fut', 'idx', 'NQ=F', 600], ['fut', 'idx', 'YM=F', 600],
    ['fut', 'idx', 'GC=F', 600], ['fut', 'idx', 'SI=F', 600], ['fut', 'idx', 'CL=F', 600],
  ].map(([market, group, symbol, delay = 0]) => ({ key: `idx:${symbol}`, market, group, symbol, delay, nameKey: `idx.${symbol}` }));

  // 其他國家個股：Yahoo 代號的後綴 → 市場、來源固定延遲幾秒（CLAUDE.md 7.6 實測；還沒量到的先當 20 分鐘）。
  // 美股 BRK.B 的 B 不在表裡，所以照樣是美股
  const SUFFIX = Object.fromEntries([
    ['HK', 'hk', 900], ['T', 'jp', 900], ['KS', 'kr', 1200], ['KQ', 'kr', 1200], ['SS', 'cn', 900], ['SZ', 'cn', 900],
    ['SI', 'sg', 900], ['AX', 'au'], ['NZ', 'nz'], ['NS', 'in'], ['BO', 'in'], ['JK', 'id'], ['KL', 'my'], ['BK', 'th'],
    ['VN', 'vn'], ['L', 'uk', 900], ['DE', 'de', 900], ['F', 'de', 1380], ['PA', 'fr', 900], ['AS', 'nl', 900],
    ['BR', 'be', 900], ['MI', 'it', 900], ['MC', 'es', 900], ['SW', 'ch', 900], ['VI', 'at', 900], ['LS', 'pt', 900],
    ['IR', 'ie', 1800], ['WA', 'pl', 900], ['ST', 'se', 0], ['HE', 'fi', 0], ['OL', 'no'], ['CO', 'dk'], ['IS', 'tr'],
    ['TO', 'ca', 0], ['SA', 'br', 900], ['MX', 'mx', 1200], ['BA', 'ar', 1200], ['SN', 'cl', 2700],
    ['JO', 'za'], ['TA', 'il'], ['SR', 'sa'], ['QA', 'qa'],
  ].map(([sfx, market, delay = 1200]) => [sfx, { market, delay }]));
  const suffixOf = (code) => SUFFIX[/^[A-Z0-9][A-Z0-9&-]{0,11}\.([A-Z]{1,2})$/.exec(code)?.[1]] ?? null;

  function clockIn(tz, now) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    return { day: parts.weekday, hm: `${parts.hour}:${parts.minute}` };
  }

  const within = ([from, to], hm) => hm >= from && hm < to;
  const isWeekend = (day) => day === 'Sat' || day === 'Sun';

  // 沒寫時段的市場（見 MARKETS）看報價附的交易時段 quote.period = [開盤, 收盤]（毫秒）
  const byQuote = (market) => !MARKETS[market].hours && !MARKETS[market].byDay;

  // 交易所當地那一天的時段表（[[開, 收]…]，週末或 byDay 沒寫的那天是空的）
  function sessionsOf(market, at) {
    const { tz, hours, byDay } = MARKETS[market];
    const { day, hm } = clockIn(tz, at);
    return { hm, today: byDay ? byDay[day] ?? [] : isWeekend(day) ? [] : hours };
  }

  function openAt(market, at, quote) {
    if (byQuote(market)) return Boolean(quote?.period) && at >= quote.period[0] && at < quote.period[1];
    const { hm, today } = sessionsOf(market, at);
    return today.some((range) => within(range, hm));
  }

  // delay：來源固定延遲幾秒。收盤後還要再算 delay 秒才收，才拿得到最後的價格（例如延遲 15 分的市場，收盤 15 分鐘後才看到收盤價）
  const isOpen = (market, now, quote, delay = 0) => openAt(market, now, quote) || (delay > 0 && openAt(market, now - delay * 1000, quote));

  // 現在是不是延長交易時段：回傳 'pre'、'post' 或 null
  function extSession(market, now) {
    const { tz, ext = {} } = MARKETS[market];
    const { day, hm } = clockIn(tz, now);
    if (isWeekend(day)) return null;
    return Object.keys(ext).find((k) => within(ext[k], hm)) ?? null;
  }

  // 台指期現在該看哪一盤：08:45～15:00 看日盤（收盤後到夜盤開始前，日盤收盤是最新的），其他時間看夜盤
  const txfSession = (now) => (within(['08:45', '15:00'], clockIn(MARKETS.txf.tz, now).hm) ? 'day' : 'night');

  // 時區偏移（毫秒）：把當地的年月日時分秒當成 UTC 算出來的時間，減掉真正的時間
  function offsetOf(tz, at) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
  }

  // at 那一天（交易所當地）從第一段開盤到最後一段收盤 [開, 收]（毫秒）；那天休市或沒寫時段的市場回 null
  function dayRange(market, at) {
    if (byQuote(market)) return null;
    const { today } = sessionsOf(market, at);
    if (!today.length) return null;
    const off = offsetOf(MARKETS[market].tz, at);
    const local = new Date(at + off);
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off;
    const ms = (hm) => midnight + (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60000;
    return [ms(today[0][0]), ms(today.at(-1)[1])];
  }

  // 走勢線的橫軸 [開, 收]（毫秒）：那一天的交易時段；Yahoo 的時段只在還沒換到下一個交易日時能用（收盤後它給的是下一天）。
  // 都沒有就用線本身的頭尾（畫滿整列）。line＝[[時間（秒）, 價格]…]
  function lineDomain(market, quote) {
    const line = quote?.line ?? [];
    if (!line.length) return null;
    const first = line[0][0] * 1000, last = line.at(-1)[0] * 1000;
    const p = quote.period;
    return dayRange(market, last) ?? (p && p[0] <= first && last <= p[1] ? p : [first, Math.max(last, first + 1)]);
  }

  // 市場狀態：盤中 open、午休 break（今天還有下一段）、盤前 pre、盤後 post（只有美股有延長交易）、休市 closed
  function phase(market, now, quote) {
    if (openAt(market, now, quote)) return 'open';
    const ext = extSession(market, now);
    if (ext) return ext;
    const r = dayRange(market, now);
    return r && now > r[0] && now < r[1] ? 'break' : 'closed';
  }

  return { MARKETS, INDICES, SUFFIX, suffixOf, byQuote, isOpen, extSession, txfSession, dayRange, lineDomain, phase };
})();
