// 懸浮框（content script，所有分頁都有）。外殼搬自 FreeLiveSub：拖工具列移動、四個角縮放、全螢幕時跟著進去、
// 位置大小存 chrome.storage.local（overlayBox），所有分頁共用同一個位置：一個分頁拖了，其他分頁跟著移。
//   分頁看得見時每 5 秒送 { to:'sw', cmd:'tick' }，背景程式決定要不要真的去抓
//   報價、狀態、MIS 延遲統計都從 chrome.storage.session 讀，變了就重畫
//   藏身鍵：session 的 hidden＝true 時藏起來、不送 tick；工具列 👁、快捷鍵、點圖示都切換它（sw.js 的 toggleHidden）
//   隱身模式：prefs.stealth，工具列 ◐ 切換；外觀全部由 CSS 的 data-look="stealth" 決定
//   設定面板：工具列 ⚙；使用說明：工具列 ?（兩個共用 panel.js 的浮動視窗）
//   分頁列：全部／台股／美股／國際＋自創分頁（PSPrefs.visibleTabs）；選的分頁存在 prefs.tab，所有分頁的框同步
//   分頁裡有好幾個市場時（例如「全部」），再依 PSPrefs.sections() 分段加標題
//   介面文字都在 i18n.js（prefs.uiLang）；漲跌顏色 prefs.upColor 由 CSS 的 data-up 決定
// i18n.js、markets.js、prefs.js、box.js、panel.js 會先載入。網頁來的文字一律用 textContent 放進畫面，不用 innerHTML。
(() => {
  if (globalThis.__peekStock) return;
  globalThis.__peekStock = true;
  // 擴充功能重新載入後，舊的框會殘留在網頁上且已失效，先清掉
  document.querySelectorAll('peek-stock').forEach((el) => el.remove());

  // 彈出小視窗（popout.html，見 popout.js）：框填滿小視窗，不要工具列、耳朵、縮放把手；設定都在網頁上的框做。
  // 主人視窗常常被蓋住或縮小，所以不看分頁看不看得見
  const POP = location.pathname.endsWith('/popout.html');
  const pageVisible = () => POP || document.visibilityState === 'visible';

  const BOX_KEY = 'overlayBox';
  const TICK_MS = 5000;
  const STALE_SEC = 120;   // 盤中資料超過 2 分鐘變灰（CLAUDE.md 2.3）
  const { t } = PSI18n;    // 查翻譯；不要再拿 t 當區域變數名稱（CLAUDE.md 第 4 節坑 3）
  // 價格不是正常時段的成交價時標出來：MIS 的買賣價、美股盤前盤後（i18n 的 tag.＋來源，提示 tag.＋來源＋Hint）
  const FROM_TAG = { bid: 'bid', ask: 'ask', pre: 'pre', post: 'post', night: 'night' };   // night：台指期夜盤
  // 偷喵配色（和圖示一致）：黑貓的炭黑底＋金色眼睛當強調色。貓的裝飾只在一般外觀出現，隱身模式全部藏起來
  const GOLD = '#FFC23D';
  // 工具列上的小貓頭（圖示裡那隻黑貓）
  const CAT_HEAD = `<svg class="logo" viewBox="0 0 32 32" width="16" height="16" aria-hidden="true">
    <path d="M5 15 L6 4 L12 9 Q16 8 20 9 L26 4 L27 15 Q28 28 16 28 Q4 28 5 15Z" fill="#25232B" stroke="${GOLD}" stroke-width="1.6" stroke-linejoin="round"/>
    <ellipse cx="11.5" cy="17.5" rx="2.8" ry="3.2" fill="#FFD23F"/><ellipse cx="20.5" cy="17.5" rx="2.8" ry="3.2" fill="#FFD23F"/>
    <ellipse cx="11.5" cy="17.5" rx="1" ry="2.7" fill="#0E0D12"/><ellipse cx="20.5" cy="17.5" rx="1" ry="2.7" fill="#0E0D12"/></svg>`;
  // 縮放把手的貓掌印（金色）
  const PAW = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><g fill="${GOLD}">
    <ellipse cx="10" cy="13.5" rx="5" ry="4"/><circle cx="4.3" cy="8.2" r="2"/><circle cx="8" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="15.7" cy="8.2" r="2"/></g></svg>`);
  // 框頂的貓耳朵（E1 圓弧尖耳）：邊是弧線、尖端圓潤、微微往外張；side＝-1 左耳、1 右耳
  const EAR = (side) => `<span class="ear" style="transform: rotate(${side * 8}deg)"><svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
    <path d="M1 23 C3 14 7 6 12 2 Q15 -0.5 18 2 C23 7 27 14 29 23 Z" fill="#1E1C24" stroke="#3A3646"/>
    <path d="M8 23 C9 17 11.5 11 14 8 Q15 7 16 8 C18.5 11 21 17 22 23 Z" fill="#FF9DB0"/></svg></span>`;
  const STYLE = `
    div.box { position: fixed; z-index: 2147483647; display: flex; flex-direction: column; box-sizing: border-box;
              border-radius: 10px; background: rgba(30, 28, 36, .97); color: #eee; border: 1px solid #3A3646;
              font: 12px/1.5 "Microsoft JhengHei", system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
              transition: opacity .16s, transform .16s; }

    /* 框頂的貓耳朵：整個框像一隻趴著偷看的黑貓；滑鼠移上框時左耳抖一下（工具列在右邊，不會擋到） */
    div.ears { position: absolute; top: -21px; left: 14px; display: flex; gap: 10px; pointer-events: none; transition: transform .16s; }
    span.ear { display: block; transform-origin: 50% 100%; }
    span.ear svg { display: block; overflow: visible; transform-origin: 50% 100%; }
    div.box:hover span.ear:first-child svg { animation: twitch .5s ease-in-out; }
    @keyframes twitch { 30% { transform: rotate(-12deg); } 60% { transform: rotate(6deg); } }

    /* 工具列：浮在框上緣的膠囊，滑鼠移到框上才出現；按住拖曳＝移動框。
       從耳朵右邊開始（最寬到框寬減掉耳朵那一段），永遠不會蓋住耳朵；名稱只留貓頭，滑鼠移上看名字 */
    div.bar { position: absolute; top: -20px; right: 12px; z-index: 3; display: flex; flex-wrap: wrap; justify-content: flex-end;
              align-items: center; gap: 4px; max-width: calc(100% - 104px);
              padding: 3px 4px 3px 8px; border-radius: 999px; background: #333; border: 1px solid #555;
              font: 11px/1 system-ui, sans-serif; color: #bbb; cursor: move; user-select: none;
              opacity: 0; transform: translateY(4px); transition: opacity .15s, transform .15s; }
    div.box:hover div.bar { opacity: 1; transform: none; }
    div.bar button { width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
                     color: #eee; background: #444; font: 14px/1 system-ui, sans-serif; }
    div.bar button:hover { background: #555; }
    div.bar button.on { background: ${GOLD}; color: #2A1F00; }
    svg.logo { flex: none; margin-right: -2px; }

    /* 四個角的縮放把手：滑鼠移上框才出現，一般外觀是金色貓掌印、隱身模式是 L 形標記；拖哪個角就往哪個方向縮放 */
    div.corner { position: absolute; z-index: 2; width: 14px; height: 14px; opacity: 0; transition: opacity .15s;
                 border: 0 solid transparent; background: url("${PAW}") center / 12px no-repeat; }
    div.box:hover div.corner { opacity: 1; }
    div.corner[data-c=nw] { left: 0; top: 0; cursor: nwse-resize; border-width: 2px 0 0 2px; border-top-left-radius: 10px; }
    div.corner[data-c=ne] { right: 0; top: 0; cursor: nesw-resize; border-width: 2px 2px 0 0; border-top-right-radius: 10px; }
    div.corner[data-c=sw] { left: 0; bottom: 0; cursor: nesw-resize; border-width: 0 0 2px 2px; border-bottom-left-radius: 10px; }
    div.corner[data-c=se] { right: 0; bottom: 0; cursor: nwse-resize; border-width: 0 2px 2px 0; border-bottom-right-radius: 10px; }

    /* 分頁列：放不下就左右捲動（不顯示捲軸） */
    div.tabs { display: flex; gap: 2px; overflow-x: auto; padding: 8px 10px 0; scrollbar-width: none; flex: none; }
    button.tab { flex: none; padding: 2px 9px; border: 0; border-radius: 999px; cursor: pointer; white-space: nowrap;
                 color: #999; background: none; font: 11px/1.5 "Microsoft JhengHei", system-ui, sans-serif; }
    button.tab:hover { color: #eee; }
    button.tab.on { color: #2A1F00; background: ${GOLD}; }
    /* 排序鈕：貼在分頁列最右邊，分頁多到要捲動時也看得到 */
    button.sort { position: sticky; right: 0; margin-left: auto; flex: none; padding: 1px 9px; border: 1px solid #666; border-radius: 999px;
                  cursor: pointer; white-space: nowrap; color: #ddd; background: #2A2733;
                  font: 11px/1.5 "Microsoft JhengHei", system-ui, sans-serif; box-shadow: -8px 0 6px rgba(30, 28, 36, .97); }
    button.sort:hover { border-color: ${GOLD}; }
    button.sort.on { color: #2A1F00; background: ${GOLD}; border-color: ${GOLD}; }
    div.box[data-look=stealth] button.sort { background: none; box-shadow: none; color: #888; border-color: #888; }

    /* 報價：放不下就在框裡捲動；下方留空間，捲軸才不會被右下角的縮放把手蓋住 */
    div.list { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; margin: 6px 3px 0 0; padding: 0 6px 0 10px;
               scrollbar-width: thin; scrollbar-color: #555 transparent; }
    /* font、color 要寫明：小視窗的文件是舊式相容模式，表格不會自動繼承字體大小和顏色 */
    table { border-collapse: collapse; font: inherit; color: inherit; font-variant-numeric: tabular-nums; }
    td { padding: 0 4px; white-space: nowrap; }
    td.name { max-width: 6em; overflow: hidden; text-overflow: ellipsis; }   /* 美股全名很長（NVIDIA Corporation），截斷，滑鼠移上看全名 */
    td.num { text-align: right; }
    td.tag { color: #F8B500; padding: 0 2px; }
    td.when { color: #999; }
    td.chg { cursor: pointer; }   /* 點一下切換 ％／點數 */
    td.spark { padding: 0 3px; line-height: 0; }   /* 迷你走勢線（見 sparkSvg） */
    td.spark svg { display: block; }
    tr.section span.st { margin-left: 6px; color: #888; font-weight: normal; letter-spacing: 0; }
    tr.section span.st.open { color: #ddd; }
    tr.stale td { opacity: .45; }
    tr.stale td.when::after { content: " \\1F4A4"; font-size: 10px; }   /* 資料舊了：貓睡著了 💤 */
    tr.section td { padding: 6px 5px 1px; color: ${GOLD}; font-size: 11px; font-weight: 600; letter-spacing: .08em; }
    td.empty { padding: 10px 5px; color: #999; white-space: normal; }
    td.empty::before { content: "\\1F43E  "; }   /* 🐾 */
    tr.section:first-child td { padding-top: 0; }
    tr.closed td.when { color: #666; }
    /* 漲跌顏色：預設紅漲綠跌（台灣習慣）；設定 upColor=green 時綠漲紅跌（美國習慣） */
    .up { color: #ff6b6b; } .down { color: #4cd07d; }
    div.box[data-up=green] .up { color: #4cd07d; } div.box[data-up=green] .down { color: #ff6b6b; }
    div.foot { margin: 4px 10px 10px; padding-top: 4px; border-top: 1px solid #444; color: #aaa; font-size: 11px; }
    div.err { color: #ff9f6b; }
    div.err::before { content: "\\1F640  "; }   /* 🙀 抓不到資料 */
    div.foot[hidden] { display: none; }

    /* 提醒：框上方跳出貓掌泡泡（點一下或 8 秒後消失），觸發提醒的那一列淡淡標亮；隱身模式只標亮、不跳泡泡 */
    div.bubble { position: absolute; z-index: 4; top: 6px; left: 8px; right: 8px; padding: 6px 10px; border-radius: 12px;
                 background: #2A2633; border: 1.5px solid ${GOLD}; color: #fff; font-weight: 600; cursor: pointer;
                 box-shadow: 0 6px 16px rgba(0, 0, 0, .4); animation: pop .25s ease-out; }
    div.bubble::before { content: "\\1F43E  "; }   /* 🐾 */
    div.bubble[hidden] { display: none; }
    div.bubble small { font-weight: normal; color: #bbb; margin-left: 4px; }
    @keyframes pop { from { transform: translateY(-6px) scale(.96); opacity: 0; } }
    tr.alerted td { background: rgba(255, 194, 61, .16); }
    div.box[data-look=stealth] div.bubble { display: none; }
    div.box[data-look=stealth] tr.alerted td { background: rgba(128, 128, 128, .14); }

    /* 迷你偷看模式：只剩耳朵＋一行報價（每 4 秒換下一檔），高度跟著內容 */
    div.miniline { display: none; align-items: center; gap: 4px; padding: 8px 8px 6px 10px; }
    div.box.mini { height: auto !important; }
    div.box.mini div.miniline { display: flex; }
    div.box.mini div.tabs, div.box.mini div.list, div.box.mini div.foot, div.box.mini div.corner { display: none; }

    /* 按 👁 藏起來的動畫：耳朵先縮下去、框往下淡出（藏身鍵和點圖示不走這個，維持瞬間消失） */
    div.box.hiding { opacity: 0; transform: translateY(8px); }
    div.box.hiding div.ears { transform: translateY(14px); }

    /* 彈出小視窗：框填滿視窗 */
    div.box[data-pop] { inset: 0; width: auto !important; height: auto !important; left: 0 !important; top: 0 !important;
                        border: 0; border-radius: 0; box-shadow: none; }
    div.box[data-pop] div.ears, div.box[data-pop] div.bar, div.box[data-pop] div.corner { display: none; }

    /* 隱身模式：看起來像網頁本身的灰色小字。漲跌只靠 ▲▼，不分顏色；所有貓的裝飾都藏起來 */
    div.box[data-look=stealth] div.ears, div.box[data-look=stealth] svg.logo { display: none; }
    div.box[data-look=stealth] tr.stale td.when::after, div.box[data-look=stealth] td.empty::before { content: none; }
    div.box[data-look=stealth] div.err::before { content: "\\26A0  "; }   /* ⚠ */
    div.box[data-look=stealth] div.corner { background: none; }
    div.box[data-look=stealth] { background: transparent; border-color: transparent; box-shadow: none; color: #888; }
    div.box[data-look=stealth] td, div.box[data-look=stealth] div.foot, div.box[data-look=stealth] div.err { color: #888; }
    div.box[data-look=stealth] tr.stale td { opacity: .6; }
    div.box[data-look=stealth] div.foot { border-top-color: transparent; }
    div.box[data-look=stealth] div.corner { border-color: #bbb; }
    div.box[data-look=stealth] button.tab { color: #aaa; }
    div.box[data-look=stealth] button.tab.on { color: #777; background: none; text-decoration: underline; }
    ${PSPanel.CSS}`;

  const host = document.createElement('peek-stock');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="box">
      <div class="ears">${EAR(-1)}${EAR(1)}</div>
      <div class="bar" title="PeekaStock">${CAT_HEAD}<button data-act="settings" data-i18n-title="bar.settings">⚙</button><button data-act="mini" data-i18n-title="bar.mini">▁</button><button data-act="stealth" data-i18n-title="bar.stealth">◐</button><button data-act="hide" data-i18n-title="bar.hide">👁</button><button data-act="reset" data-i18n-title="bar.reset">↺</button><button data-act="pop" data-i18n-title="bar.pop">⧉</button><button data-act="help" data-i18n-title="p.help">?</button></div>
      <div class="corner" data-c="nw"></div><div class="corner" data-c="ne"></div>
      <div class="corner" data-c="sw"></div><div class="corner" data-c="se"></div>
      <div class="tabs"></div>
      <div class="list"><table></table></div>
      <div class="miniline"><table></table></div>
      <div class="foot"></div>
      <div class="bubble" hidden></div>
    </div>
    ${PSPanel.HTML}`;
  const q = (sel) => root.querySelector(sel);
  if (POP) q('.box').dataset.pop = '';
  const el = q('.box'), bar = q('.bar'), table = q('div.list table'), foot = q('.foot'), tabsBar = q('div.tabs');
  const miniTable = q('div.miniline table');

  let prefs = PSPrefs.DEFAULT;
  let session = { quotes: {}, status: {}, misLag: null };
  const panel = PSPanel.create(root, { getPrefs: () => prefs, getQuotes: () => session.quotes });

  // ---------- 位置、大小（計算都在 box.js） ----------

  // 可見範圍：扣掉捲軸（innerWidth 含捲軸，會讓框的右邊被捲軸蓋住）。
  // 取較小值：少數舊式網頁的 clientHeight 是整份文件的高度，不是視窗高度。
  const view = () => ({
    w: Math.min(document.documentElement.clientWidth || innerWidth, innerWidth),
    h: Math.min(document.documentElement.clientHeight || innerHeight, innerHeight),
  });
  // null＝沒存過位置，用預設（右下角）。預設要在畫的時候才算：網頁剛載入時可見範圍可能還是 0，
  // 先算好的話框會卡在左上角
  let box = null;
  const current = () => box ?? PSBox.defaultBox(view());

  function apply() {
    const r = PSBox.fitted(current(), view());
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    panel.place(el.getBoundingClientRect(), view());   // 面板跟著框移動
  }

  // 擴充功能重新載入過、網頁還沒重新整理時，這個框已經失效：再碰 chrome 的功能，Chrome 會記一筆
  // Extension context invalidated 錯誤。所以失效的框一被碰到就自己拿掉（新版的框要等網頁重新整理才會出現）
  let timer = null;
  function alive() {
    if (chrome.runtime?.id) return true;
    clearInterval(timer);
    host.remove();
    return false;
  }
  // 框和面板上的所有操作都先經過這裡（捕捉階段，比 panel.js 的監聽先跑）
  ['pointerdown', 'click', 'change', 'keydown'].forEach((type) => root.addEventListener(type, (e) => {
    if (!alive()) e.stopImmediatePropagation();
  }, true));

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (alive()) chrome.storage.local.set({ [BOX_KEY]: box }); }, 300);
  };

  // 按住 handle 拖曳：onMove 收到「拖曳開始時畫出來的框」和滑鼠移動的距離，回傳新的 box；放開時存檔。
  // 移動（工具列）和縮放（四個角）共用這一段。
  function draggable(handle, onMove) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, start = PSBox.fitted(current(), view());
      const move = (ev) => {
        box = onMove(start, ev.clientX - x0, ev.clientY - y0);
        apply();
      };
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', move);
      handle.addEventListener('lostpointercapture', () => {
        handle.removeEventListener('pointermove', move);
        box = PSBox.fitted(box, view());   // 拖到畫面外的部分不算，存畫出來的樣子
        save();
      }, { once: true });
    });
  }

  draggable(bar, PSBox.moved);
  root.querySelectorAll('.corner').forEach((c) =>
    draggable(c, (s, dx, dy) => PSBox.resized(s, c.dataset.c, dx, dy, view())));

  // 工具列不會重畫，可以用 click（報價表格裡的按鈕才要用 pointerdown，見 CLAUDE.md 第 4 節坑 1）
  const send = (m) => chrome.runtime.sendMessage(m).catch(() => {});
  function showPanel(which) {
    const view = panel.show(which);
    ['settings', 'help'].forEach((v) => q(`[data-act=${v}]`).classList.toggle('on', view === v));
    apply();
  }
  const ACTIONS = {
    // 設定（⚙）和使用說明（?）共用同一個浮動視窗；再按一次同一個按鈕、或按 ✕＝關閉
    settings: () => showPanel('settings'),
    help: () => showPanel('help'),
    pop: () => send({ to: 'sw', cmd: 'openPop' }),
    close: () => showPanel(null),
    stealth: () => PSPrefs.update({ stealth: !prefs.stealth }),
    mini: () => PSPrefs.update({ mini: !prefs.mini }),
    // 先播 0.16 秒「耳朵縮下去」的動畫再藏（只有按 👁 才有；藏身鍵和點圖示維持瞬間消失）
    hide: () => {
      el.classList.add('hiding');
      setTimeout(() => send({ to: 'sw', cmd: 'toggleHidden' }), 160);
    },
    reset: () => {
      box = null;
      apply();
      chrome.storage.local.remove(BOX_KEY);   // 刪掉存檔＝回到預設，其他分頁也會收到變更
    },
  };
  // 在網頁空白處點兩下＝藏身／叫出（判斷見 blank.js；設定 prefs.dblHide 可關掉）。藏起來時框還在網頁裡，照樣聽得到
  const hideFromPage = () => (session.hidden ? send({ to: 'sw', cmd: 'toggleHidden' }) : ACTIONS.hide());
  document.addEventListener('dblclick', (e) => {
    if (POP || !prefs.dblHide || !alive()) return;
    if (PSBlank.isBlank(e, window.getSelection()?.toString(), host)) hideFromPage();
  });
  // 網頁內按鍵（預設 Esc 連按兩下，設定面板可錄製別的鍵）。面板裡的按鍵不會傳到這裡（panel.js 擋掉了）
  let lastKey = null;
  window.addEventListener('keydown', (e) => {
    if (POP || PSBlank.isTyping(e) || !alive()) return;
    const r = PSBlank.keyFires(e, prefs.hideKey, lastKey, Date.now());
    lastKey = r.last;
    if (r.fire) hideFromPage();
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) ACTIONS[b.dataset.act]();
    const tab = e.target.closest('button.tab');   // 分頁列只在設定變更時重畫，可以用 click
    if (tab) PSPrefs.update({ tab: tab.dataset.tab });
    if (e.target.closest('button.sort')) PSPrefs.update({ sort: PSPrefs.nextSort(prefs.sort) });
  });
  // 漲跌欄每幾秒重畫，用 pointerdown（CLAUDE.md 第 4 節坑 1）
  root.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && e.target.closest('td.chg')) PSPrefs.update({ chgMode: (CHG[prefs.chgMode] ?? CHG.pct).next });
  });

  // ---------- 格式 ----------

  const fmtPrice = (v) => (v == null ? '—'
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 3 : 2 }));
  // 漲跌用 ▲▼（台灣看盤習慣），隱身模式拿掉顏色也看得出方向
  const ARROW = { up: '▲', down: '▼', '': '' };
  const dirOf = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const fmtPct = (v) => (v == null ? '' : `${ARROW[dirOf(v)]}${Math.abs(v).toFixed(2)}%`);
  // 漲跌欄：點一下在漲跌幅％和漲跌點數之間切換（prefs.chgMode，所有框同步）。
  // 點數 100 以上不顯示小數（▲1,235），欄寬才不會比％寬
  const fmtPoints = (v) => (Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-US') : fmtPrice(Math.abs(v)));
  const CHG = {
    pct: { next: 'chg', text: (q) => fmtPct(q?.pct) },
    chg: { next: 'pct', text: (q) => (q?.chg == null ? '' : `${ARROW[dirOf(q.chg)]}${fmtPoints(q.chg)}`) },
  };
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  // 今天的資料顯示時:分（秒數放滑鼠提示，讓出走勢線的寬度）；不是今天的（休市中的前一日收盤）只顯示月-日
  const fmtWhen = (ms, now) => {
    if (ms == null) return '';
    const s = new Date(ms).toLocaleString('sv-SE');
    return sameDay(ms, now) ? s.slice(11, 16) : s.slice(5, 10);
  };

  function cell(text, cls = '') {
    const td = document.createElement('td');
    td.className = cls;
    td.textContent = text;
    return td;
  }

  // 走勢線那一欄：所有列都要有（沒有線的留空格），欄位才對得齊；關掉或隱身模式時整欄拿掉
  const showLine = () => prefs.line && !prefs.stealth;
  const COLS = () => (showLine() ? 6 : 5);

  // 一列：名稱、（走勢線）、價格、（買價／賣價／盤前／盤後）、漲跌％、資料時間
  function rowView(item, quote, now) {
    const tr = document.createElement('tr');
    const open = PSMarkets.isOpen(item.market, now, quote, item.delay);
    const lag = quote?.time ? (now - quote.time) / 1000 : null;
    tr.classList.toggle('stale', open && lag > STALE_SEC + (item.delay ?? 0));
    tr.classList.toggle('closed', !open);
    tr.classList.toggle('alerted', (session.alertQueue ?? []).some((a) => a.key === item.key));   // 剛觸發提醒的那一列
    const [label, hint] = PSPrefs.labelOf(item, quote, t);   // 美股顯示代號、台股顯示名稱，另一個放滑鼠提示
    const name = cell(label, 'name');
    name.title = [label, hint].filter(Boolean).join(' ');
    const side = FROM_TAG[quote?.from];
    const tag = cell(side ? t(`tag.${side}`) : '', 'tag');
    if (side) tag.title = t(`tag.${side}Hint`, { close: fmtPrice(quote.prev) });
    const when = cell(fmtWhen(quote?.time, now), 'when');
    if (quote?.time) when.title = new Date(quote.time).toLocaleString('sv-SE');   // 完整資料時間
    const chg = cell((CHG[prefs.chgMode] ?? CHG.pct).text(quote), `num chg ${dirOf(quote?.chg)}`);
    chg.title = t('ov.chgHint');
    const spark = showLine() ? [sparkCell(item, quote)] : [];
    tr.append(name, ...spark, cell(fmtPrice(quote?.price), `num ${dirOf(quote?.chg)}`), tag, chg, when);
    return tr;
  }

  // ---------- 迷你走勢線 ----------

  // 名稱和價格之間的一小格：當天走勢＋昨收虛線，顏色照當天漲跌（像 Robinhood 的自選清單）
  const LINE_COLOR = { red: { up: '#ff6b6b', down: '#4cd07d' }, green: { up: '#4cd07d', down: '#ff6b6b' } };
  const SPARK_W = 40, SPARK_H = 16;
  function sparkCell(item, quote) {
    const td = cell('', 'spark');
    td.innerHTML = sparkSvg(item, quote);   // 只有我們自己算出來的數字，沒有外來文字
    return td;
  }
  function sparkSvg(item, quote) {
    const domain = PSMarkets.lineDomain(item.market, quote);
    if (!domain || quote.line.length < 2) return '';
    const [t0, t1] = domain.map((ms) => ms / 1000);
    const values = [...quote.line.map(([, v]) => v), ...(quote.prev ? [quote.prev] : [])];
    const lo = Math.min(...values), span = Math.max(...values) - lo || 1;
    const x = (ts) => (Math.min(Math.max((ts - t0) / (t1 - t0), 0), 1) * SPARK_W).toFixed(1);
    const y = (v) => (1.5 + (1 - (v - lo) / span) * (SPARK_H - 3)).toFixed(1);
    const path = quote.line.map(([ts, v], i) => `${i ? 'L' : 'M'}${x(ts)} ${y(v)}`).join('');
    const color = (LINE_COLOR[prefs.upColor] ?? LINE_COLOR.red)[dirOf(quote.chg)] ?? '#999';
    const base = quote.prev ? `<path d="M0 ${y(quote.prev)}H${SPARK_W}" stroke="#777" stroke-dasharray="2 2" fill="none"/>` : '';
    return `<svg width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true">${base}`
      + `<path d="${path}" stroke="${color}" stroke-width="1.3" stroke-linejoin="round" fill="none"/></svg>`;
  }

  // 底部：抓取錯誤＋MIS 延遲統計（v0.2 觀察用，貼回來給開發者）
  const LAG_LABELS = ['≤10s', '≤30s', '≤60s', '≤120s', '>120s'];
  function lagText(m) {
    if (!m?.n) return t('lag.none');
    const pcts = m.buckets.map((c, i) => `${LAG_LABELS[i]} ${Math.round((c / m.n) * 100)}%`).join(' ');
    const since = new Date(m.since).toLocaleTimeString('sv-SE').slice(0, 5);
    return t('lag.stats', { median: m.last.median, max: m.last.max, since, n: m.n, pcts });
  }

  // 抓取群組 → 錯誤列上顯示的名稱
  const GROUP_KEY = { tw: 'sec.tw', us: 'sec.us', idx: 'sec.world', crypto: 'sec.alt', ext: 'sec.us', gl: 'grp.gl', txf: 'idx.TXF' };
  function footView() {
    const errors = Object.entries(session.status ?? {}).filter(([, s]) => !s.ok).map(([id, s]) => {
      const d = document.createElement('div');
      d.className = 'err';
      // s 裡有 src、detail；沒有對應翻譯的（例如舊版存下的錯誤文字）就直接顯示原文
      const msg = PSI18n.S[`err.${s.error}`] ? t(`err.${s.error}`, s) : s.error;
      d.textContent = t('err.line', { group: t(GROUP_KEY[id] ?? id), msg, fails: s.fails });
      return d;
    });
    const lag = document.createElement('div');
    lag.textContent = lagText(session.misLag);
    const lines = [...errors, ...(prefs.showLag ? [lag] : [])];   // 延遲統計預設不顯示（設定面板「除錯」打開）
    foot.replaceChildren(...lines);
    foot.hidden = !lines.length;
  }

  // 段標題＋市場狀態（盤中、午休、盤前、盤後、休市）
  function sectionRow(title, status) {
    const tr = document.createElement('tr');
    tr.className = 'section';
    const td = cell(title);
    td.colSpan = COLS();
    if (status) {
      const st = document.createElement('span');
      st.className = `st ${status}`;
      st.textContent = t(`st.${status}`);
      td.append(st);
    }
    tr.append(td);
    return tr;
  }

  // 分頁裡有好幾段才顯示段標題；只有一段時，有市場狀態的話還是留一行只放狀態
  function headRows(s, secs, now, quotes) {
    const status = s.market ? PSMarkets.phase(s.market, now, quotes[s.items[0].key]) : null;
    if (secs.length > 1) return [sectionRow(t(s.titleKey), status)];
    return status ? [sectionRow('', status)] : [];
  }

  // 分頁裡沒有東西時的提示（一般外觀前面有 🐾）
  function emptyRow() {
    const tr = document.createElement('tr');
    const td = cell(t('ov.empty'), 'empty');
    td.colSpan = COLS();
    tr.append(td);
    return tr;
  }

  // 目前分頁的項目；裡面有好幾個市場時才分段加標題（PSPrefs.sections）
  const currentItems = () => {
    const list = PSPrefs.items(prefs);
    return list.filter(PSPrefs.currentTab(prefs, list).has);
  };

  function render() {
    const now = Date.now();
    const quotes = session.quotes ?? {};
    const secs = PSPrefs.sections(currentItems(), quotes, prefs.sort);
    const rows = secs.flatMap((s) => [...headRows(s, secs, now, quotes), ...s.items.map((i) => rowView(i, quotes[i.key], now))]);
    table.replaceChildren(...(rows.length ? rows : [emptyRow()]));
    renderMini(now, quotes);
    footView();
  }

  // 迷你偷看模式：只顯示一檔，每 4 秒換下一檔（目前分頁的順序）
  const MINI_MS = 4000;
  let miniIndex = 0;
  function renderMini(now = Date.now(), quotes = session.quotes ?? {}) {
    if (!prefs.mini) return;
    const items = PSPrefs.sections(currentItems(), quotes, prefs.sort).flatMap((s) => s.items);
    miniTable.replaceChildren(items.length ? rowView(items[miniIndex % items.length], quotes[items[miniIndex % items.length].key], now) : emptyRow());
  }
  setInterval(() => {
    miniIndex += 1;
    if (prefs.mini && !session.hidden) renderMini();
  }, MINI_MS);

  function renderTabs() {
    const list = PSPrefs.items(prefs);
    const on = PSPrefs.currentTab(prefs, list).id;
    tabsBar.replaceChildren(...PSPrefs.visibleTabs(prefs, list).map((x) => {
      const b = document.createElement('button');
      b.className = x.id === on ? 'tab on' : 'tab';
      b.dataset.tab = x.id;
      b.textContent = x.name ?? t(x.nameKey);   // 自創分頁用使用者取的名稱，內建分頁查翻譯
      return b;
    }), sortButton());
  }

  // 分頁列最右邊的排序鈕，直接寫出目前的排序：⇅ 排序 → ▲ 漲幅 → ▼ 跌幅（排序中是金底）
  function sortButton() {
    const mode = PSPrefs.SORT_ORDER.includes(prefs.sort) ? prefs.sort : 'manual';
    const b = document.createElement('button');
    b.className = mode === 'manual' ? 'sort' : 'sort on';
    b.textContent = t(`sortBtn.${mode}`);
    b.title = t(`sort.${mode}`);
    return b;
  }

  // ---------- 提醒的貓掌泡泡 ----------

  // 佇列（session.alertQueue，背景程式放進來）一次顯示一個，停 8 秒或被點掉就請背景程式拿掉；
  // 框藏起來或分頁看不見時不顯示、不計時，等看得見再補顯示。隱身模式時泡泡由 CSS 藏起來，只剩那一列標亮
  const BUBBLE_MS = 8000;
  const bubble = q('div.bubble');
  let showing = null, bubbleTimer = null;
  const fmtPct2 = (v) => Math.abs(v ?? 0).toFixed(2);

  function alertText(a) {
    const item = PSPrefs.items(prefs).find((i) => i.key === a.key);
    const name = item ? PSPrefs.labelOf(item, session.quotes?.[a.key], t)[0] : a.key;
    return t(`alert.${a.kind}`, { name, pct: fmtPct2(a.pct), price: fmtPrice(a.price), target: a.kind === 'up' || a.kind === 'down' ? a.target : fmtPrice(a.target) });
  }

  function dismiss(id) {
    clearTimeout(bubbleTimer);
    showing = null;
    bubble.hidden = true;
    send({ to: 'sw', cmd: 'dismissAlert', id });
  }

  function showAlerts() {
    const next = (session.alertQueue ?? [])[0];
    const visible = !session.hidden && pageVisible();
    if (!next || !visible) {
      if (!next) bubble.hidden = true;
      return;
    }
    if (showing === next.id) return;
    showing = next.id;
    bubble.textContent = alertText(next);
    bubble.title = FROM_TAG[next.from] ? t(`tag.${next.from}Hint`) : '';   // 不是成交價：泡泡裡標「買／賣」，完整說明放滑鼠提示
    if (FROM_TAG[next.from]) bubble.append(Object.assign(document.createElement('small'), { textContent: t(`tag.${next.from}`) }));
    bubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => dismiss(next.id), BUBBLE_MS);
  }
  // 泡泡不會跟著報價重畫，但照坑 1 的習慣一樣用 pointerdown
  bubble.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (showing) dismiss(showing);
  });

  // ---------- tick ----------

  function tick() {
    if (!alive()) return;
    if (session.hidden) return;   // 藏身鍵：藏起來時不抓也不畫
    render();   // 就算不抓，也要重畫（資料時間到了要變灰）
    showAlerts();
    if (!pageVisible()) return;
    send({ to: 'sw', cmd: 'tick' });
  }

  const updateHidden = () => {
    host.style.display = session.hidden ? 'none' : '';
    if (!session.hidden) el.classList.remove('hiding');   // 叫出來時把 👁 的藏起來動畫還原
  };

  function applyPrefs(p) {
    prefs = p;
    PSI18n.use(p.uiLang);
    PSI18n.apply(root);   // 工具列、面板上的固定文字
    el.dataset.look = p.stealth ? 'stealth' : '';
    el.dataset.up = p.upColor;
    el.classList.toggle('mini', p.mini);
    q('[data-act=stealth]').classList.toggle('on', p.stealth);
    q('[data-act=mini]').classList.toggle('on', p.mini);
    renderTabs();
    render();
    showing = null;   // 泡泡文字用新的語言、名稱重寫
    showAlerts();
    if (panel.isOpen()) {   // 清單變了（可能是別的分頁改的），面板跟著更新
      panel.render();
      apply();
    }
  }

  // ---------- 設定與資料的變更 ----------

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch[BOX_KEY]) {   // 別的分頁拖了框（或按了重設），這裡跟著移
      box = ch[BOX_KEY].newValue ?? null;
      apply();
    }
    if (area !== 'session') return;
    Object.entries(ch).forEach(([k, v]) => { session[k] = v.newValue; });
    updateHidden();
    if ('hidden' in ch && !session.hidden) tick();   // 叫出來時立刻補抓
    else render();
    showAlerts();
  });
  PSPrefs.watch(applyPrefs);
  PSPrefs.load().then(applyPrefs);
  // 第一次安裝時背景程式還沒開放 storage.session，讀不到就等 tick 之後的變更通知
  chrome.storage.session.get(['quotes', 'status', 'misLag', 'hidden', 'alertQueue']).then((r) => {
    session = { ...session, ...r };
    updateHidden();
    render();
    showAlerts();
  }, () => {});
  chrome.storage.local.get(BOX_KEY).then((r) => {
    box = r[BOX_KEY] ?? null;
    apply();
  });

  // ---------- 放進網頁 ----------

  // 全螢幕時只有全螢幕的那個元素看得到，所以把框搬進去；退出時搬回來。
  const place = () => (document.fullscreenElement ?? document.documentElement).appendChild(host);
  document.addEventListener('fullscreenchange', place);
  addEventListener('resize', apply);
  document.addEventListener('visibilitychange', tick);

  apply();
  place();
  timer = setInterval(tick, TICK_MS);
  render();
  tick();
})();
