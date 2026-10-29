// 排程：這次 tick 要抓哪些。純函式，不碰網路和 chrome，可以在 Node 用假時鐘測（tools/test.mjs）。
//   plan  = { id, every, source, items }（群組表＋這個群組目前的項目，見 sw.js）
//   state = { [群組 id]: { last: 上次開始抓的時間, fails: 連續失敗次數 } }
//   quotes = 目前已有的報價（key → quote）
// markets.js 要比這個檔案先載入。
globalThis.PSSchedule ??= (() => {
  const MAX_WAIT = 5 * 60 * 1000;   // 退避最長 5 分鐘

  // 連續失敗就把間隔加倍：5 → 10 → 20 秒…，最多 5 分鐘；成功一次就恢復
  const waitOf = (plan, s) => Math.min(plan.every * 2 ** (s?.fails ?? 0), MAX_WAIT);

  // 市場開著的才抓；休市的只有「還沒有報價」時抓一次（晚上打開也看得到前一個交易日的收盤）
  const wanted = (item, now, quotes) => PSMarkets.isOpen(item.market, now) || !quotes[item.key];

  function due(plans, now, state, quotes) {
    return plans
      .filter((p) => now - (state[p.id]?.last ?? 0) >= waitOf(p, state[p.id]))
      .map((p) => ({ ...p, items: p.items.filter((i) => wanted(i, now, quotes)) }))
      .filter((p) => p.items.length);
  }

  return { due, waitOf, MAX_WAIT };
})();
