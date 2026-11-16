// 排程：這次 tick 要抓哪些。純函式，不碰網路和 chrome，可以在 Node 用假時鐘測（tools/test.mjs）。
//   plan  = { id, every, source, items, wanted? }（群組表＋這個群組目前的項目，見 sw.js；wanted＝這個群組自己的抓取條件）
//   state = { [群組 id]: { last: 上次開始抓的時間, fails: 連續失敗次數 } }
//   quotes = 目前已有的報價（key → quote）
//   holidays = 判斷出來的國定假日（markets.js 的 holidays，存在 storage.session）
// markets.js 要比這個檔案先載入。
globalThis.PSSchedule ??= (() => {
  const MAX_WAIT = 5 * 60 * 1000;   // 退避最長 5 分鐘

  // 連續失敗就把間隔加倍：5 → 10 → 20 秒…，最多 5 分鐘；成功一次就恢復
  const waitOf = (plan, s) => Math.min(plan.every * 2 ** (s?.fails ?? 0), MAX_WAIT);

  const REFRESH = 30 * 60 * 1000;
  // 收盤後再多抓幾分鐘：收盤價是收盤「之後」才出來的（台股 13:25～13:30 集合競價，13:30 才公布；美股指數收盤後幾分鐘才定案）。
  // 收盤那一秒就停的話，整晚顯示的是收盤前最後一筆，不是收盤價。只影響抓不抓，畫面上的盤中／休市照原本的時段
  const GRACE_SEC = 5 * 60;

  // 市場開著的才抓；休市的只有「還沒有報價」時抓一次（晚上打開也看得到前一個交易日的收盤）。
  // 看報價交易時段的市場（markets.js 的 byQuote）休市時每 30 分鐘再問一次，才知道下一次幾點開盤；
  // 判斷成國定假日的市場也每 30 分鐘再問一次（萬一只是延後開盤，不會整天都抓不到）
  function wanted(item, now, quotes, holidays) {
    const q = quotes[item.key];
    const holiday = PSMarkets.isHoliday(item.market, now, holidays);
    if (!q || (!holiday && PSMarkets.isOpen(item.market, now, q, (item.delay ?? 0) + GRACE_SEC))) return true;
    return (holiday || PSMarkets.byQuote(item.market)) && now - q.fetchedAt >= REFRESH;
  }

  function due(plans, now, state, quotes, holidays = {}) {
    return plans
      .filter((p) => now - (state[p.id]?.last ?? 0) >= waitOf(p, state[p.id]))
      .map((p) => ({ ...p, items: p.items.filter((i) => (p.wanted ?? wanted)(i, now, quotes, holidays)) }))
      .filter((p) => p.items.length);
  }

  return { due, waitOf, MAX_WAIT, REFRESH, GRACE_SEC };
})();
