// 網頁裡的藏身觸發（和藏身鍵、點圖示、👁 一樣切換 hidden）。純函式，不碰 chrome，可以在 Node 測。
//   空白處點兩下（prefs.dblHide）：「空白處」用間接的方法判斷：在文字上點兩下，瀏覽器會選取一個字；
//     點在空白處什麼都不會被選取。網頁自己會用到點兩下的元素（輸入框、可編輯區、連結、按鈕、影片、畫布、圖片…）、
//     網頁自己處理掉的（defaultPrevented）、框本身裡面的，一律不算
//   網頁內按鍵（prefs.hideKey）：預設 Esc 連按兩下（0.4 秒內）。Chrome 的擴充功能快捷鍵一定要有 Ctrl 或 Alt，
//     所以 Esc 只能由框自己在網頁上聽；游標在網址列時聽不到。在輸入框裡按的、網頁自己處理掉的不算
globalThis.PSBlank ??= (() => {
  const SKIP = [
    'a', 'button', 'input', 'textarea', 'select', 'option', 'label', 'summary',
    'video', 'audio', 'canvas', 'iframe', 'embed', 'object', 'img', 'svg',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="slider"]', '[role="application"]',
  ].join(',');
  const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
  const KEY_GAP = 400;   // 連按兩下：第二下要在 0.4 秒內

  // e：dblclick 事件；selected：當下選取的文字；host：框的元素（點在框裡面不算）
  function isBlank(e, selected, host) {
    if (e.defaultPrevented || String(selected ?? '').trim()) return false;
    if (e.composedPath?.().includes(host)) return false;
    const target = e.target;
    if (!target?.closest || target.isContentEditable) return false;
    return !target.closest(SKIP);
  }

  // 按鍵是不是打在輸入框裡（Shadow DOM 裡的輸入框也算：取 composedPath 的第一個）
  function isTyping(e) {
    const target = e.composedPath?.()[0] ?? e.target;
    return Boolean(target?.isContentEditable || target?.closest?.(TYPING));
  }

  // hideKey = { on, key（KeyboardEvent.key）, ctrl?, alt?, shift?, meta?, double }
  const MODS = [['ctrl', 'ctrlKey'], ['alt', 'altKey'], ['shift', 'shiftKey'], ['meta', 'metaKey']];
  const sameKey = (e, hk) => String(e.key).toLowerCase() === String(hk.key).toLowerCase()
    && MODS.every(([k, ek]) => Boolean(hk[k]) === Boolean(e[ek]));

  // 這一下要不要觸發。last＝上一次按下同一個鍵的時間（連按兩下用），回傳新的 last 讓呼叫的人存起來
  function keyFires(e, hk, last, now) {
    if (!hk?.on || e.repeat || e.defaultPrevented || !sameKey(e, hk)) return { fire: false, last: null };
    if (!hk.double || (last != null && now - last <= KEY_GAP)) return { fire: true, last: null };
    return { fire: false, last: now };
  }

  // 顯示用：Ctrl+Alt+H、Esc、Space
  const KEY_NAMES = { Escape: 'Esc', ' ': 'Space' };
  const MOD_NAMES = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' };
  const keyLabel = (hk) => [...MODS.filter(([k]) => hk[k]).map(([k]) => MOD_NAMES[k]),
    KEY_NAMES[hk.key] ?? (hk.key.length === 1 ? hk.key.toUpperCase() : hk.key)].join('+');

  // 錄製：按下的鍵 → hideKey（只按修飾鍵不算，回傳 null；on 和 double 沿用原本的）
  const PURE_MODS = ['Control', 'Alt', 'Shift', 'Meta'];
  const recorded = (e, hk) => (PURE_MODS.includes(e.key) ? null : {
    ...hk, on: true, key: e.key, ...Object.fromEntries(MODS.map(([k, ek]) => [k, Boolean(e[ek])])),
  });

  return { SKIP, KEY_GAP, isBlank, isTyping, keyFires, keyLabel, recorded };
})();
