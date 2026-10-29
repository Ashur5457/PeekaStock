// 懸浮框的位置大小計算（搬自 FreeLiveSub overlay.js，抽成純函式）：只吃數字、回傳數字，不碰 DOM，可以在 Node 測。
//   box  = { left, top, width, height }：使用者要的位置大小（存檔的就是這個）
//   view = { w, h }：可見範圍（扣掉捲軸）
// 畫的時候一律用 fitted(box, view)：框一定在可見範圍內，工具列和縮放把手才按得到；
// box 本身保留使用者的設定，視窗暫時變小時框跟著縮，變大時恢復。
globalThis.PSBox ??= (() => {
  const MIN_W = 220, MIN_H = 80;
  const BAR_ROOM = 24;   // 工具列浮在框上緣外面，框的上方要留這麼多空間，工具列才不會跑出畫面
  const DEFAULT_W = 320, DEFAULT_H = 420, MARGIN = 16;

  const fit = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  // 框最大只能佔畫面寬 95%、高 90%（例如全螢幕時拉大的存檔回到一般視窗）
  const maxW = (view) => Math.max(MIN_W, view.w * 0.95);
  const maxH = (view) => Math.max(MIN_H, view.h * 0.9 - BAR_ROOM);

  // 預設：右下角
  const defaultBox = (view) => ({
    width: DEFAULT_W, height: DEFAULT_H,
    left: Math.max(0, view.w - DEFAULT_W - MARGIN), top: Math.max(BAR_ROOM, view.h - DEFAULT_H - MARGIN),
  });

  function fitted(box, view) {
    const width = fit(box.width, MIN_W, maxW(view));
    const height = fit(box.height, MIN_H, maxH(view));
    return { width, height, left: fit(box.left, 0, view.w - width), top: fit(box.top, BAR_ROOM, view.h - height) };
  }

  const moved = (start, dx, dy) => ({ ...start, left: start.left + dx, top: start.top + dy });

  // 每個角往哪個方向長大：+1 = 往右／往下，-1 = 往左／往上。對角那一點固定不動。
  const CORNERS = { nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] };

  // 一個方向（寬或高）的縮放：拉到畫面邊緣或最大尺寸就停。回傳 [新位置, 新大小]
  function stretch(pos, size, sign, d, min, max, lo, viewSize) {
    const room = sign > 0 ? viewSize - pos : pos + size - lo;   // 往這個方向最多能長到多大
    const next = fit(size + sign * d, min, Math.min(max, room));
    return [sign > 0 ? pos : pos + size - next, next];
  }

  // start 是拖曳開始時畫出來的框（fitted 過）
  function resized(start, corner, dx, dy, view) {
    const [sx, sy] = CORNERS[corner];
    const [left, width] = stretch(start.left, start.width, sx, dx, MIN_W, maxW(view), 0, view.w);
    const [top, height] = stretch(start.top, start.height, sy, dy, MIN_H, maxH(view), BAR_ROOM, view.h);
    return { left, top, width, height };
  }

  return { MIN_W, MIN_H, BAR_ROOM, CORNERS, defaultBox, fitted, moved, resized };
})();
