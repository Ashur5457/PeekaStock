// 設定面板（工具列 ⚙）：自選股新增／刪除／排序、自創分頁（新增、改名、排序、刪除、勾選內容）、指數開關、
// 顯示（介面語言、漲跌顏色）。和懸浮框放在同一個 Shadow DOM，所以 CSS 一律限定元素類型（input.code、button.op…），
// 避免和框的樣式撞名（CLAUDE.md 第 4 節坑 2）。
//   新增自選：先在這裡判斷代號格式、重複、上限，再請背景程式查（lookup：存不存在、名稱、上市或上櫃）
//   清單和分頁的操作都用 prefs.js 的純函式，結果存回 prefs；所有分頁的框和面板監聽 prefs 變更跟著更新
//   文字都在 i18n.js：固定文字標 data-i18n（由 overlay 的 PSI18n.apply 換掉），動態文字用 t()
// i18n.js、markets.js、prefs.js、box.js 會先載入。
globalThis.PSPanel ??= (() => {
  const WIDTH = 300;
  const { t } = PSI18n;   // 不要再拿 t 當區域變數名稱（CLAUDE.md 第 4 節坑 3）

  const CSS = `
    div.settings { position: fixed; z-index: 2147483647; width: ${WIDTH}px; max-height: 80vh; overflow: auto; box-sizing: border-box;
                   padding: 10px 12px; border-radius: 12px; background: #202020; color: #eee; border: 1px solid #555;
                   box-shadow: 0 8px 24px rgba(0, 0, 0, .45); font: 12px/1.5 "Microsoft JhengHei", system-ui, sans-serif;
                   scrollbar-width: thin; scrollbar-color: #555 transparent; }
    div.settings[hidden] { display: none; }
    div.phead { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 13px; }
    button.pclose, button.op { flex: none; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; cursor: pointer;
                               color: #ddd; background: #3a3a3a; font: 12px/1 system-ui, sans-serif; }
    button.pclose:hover, button.op:hover { background: #555; }
    div.psec { margin: 12px 0 4px; color: #1D9E75; font-size: 11px; font-weight: 600; letter-spacing: .08em; }
    form.padd { display: flex; gap: 6px; margin: 0; }
    input.code, input.tname, input.tedit, select.tpick { min-width: 0; padding: 4px 8px; border-radius: 6px; border: 1px solid #555;
                                                         background: #111; color: #eee; font: inherit; }
    input.code, input.tname, input.tedit { flex: 1; }
    button.add { flex: none; padding: 4px 12px; border: 0; border-radius: 6px; background: #1D9E75; color: #fff; cursor: pointer; font: inherit; }
    button.add:disabled { opacity: .5; cursor: default; }
    div.pmsg { min-height: 1.5em; margin-top: 2px; color: #bbb; font-size: 11px; }
    div.wrow { display: flex; align-items: center; gap: 4px; padding: 2px 0; }
    span.wname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    span.wcode { color: #999; }
    span.wex { width: 3em; color: #777; font-size: 11px; overflow: hidden; white-space: nowrap; }
    div.tedit { margin-top: 6px; padding: 6px 8px; border-radius: 8px; background: #2a2a2a; }
    div.tedit[hidden] { display: none; }
    div.thead { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: #bbb; }
    select.tpick { flex: 1; }
    div.irow { display: flex; align-items: baseline; gap: 6px; margin: 3px 0; }
    span.region { flex: none; width: 6em; color: #999; }   /* 西班牙文的地區名稱最長（Reino Unido） */
    div.ichecks { display: flex; flex-wrap: wrap; gap: 2px 10px; flex: 1; min-width: 0; }
    label.idx { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
    input.idx { margin: 0; accent-color: #1D9E75; }`;

  const HTML = `
    <div class="settings" hidden>
      <div class="phead"><span data-i18n="p.title"></span><button class="pclose" data-act="settings" data-i18n-title="p.close">✕</button></div>
      <div class="psec" data-i18n="p.watch"></div>
      <form class="padd" data-form="watch"><input class="code" data-i18n-placeholder="p.codeHolder" autocomplete="off" maxlength="12"><button class="add" type="submit" data-i18n="p.add"></button></form>
      <div class="pmsg" data-msg="watch"></div>
      <div class="wlist"></div>
      <div class="psec" data-i18n="p.tabs"></div>
      <form class="padd" data-form="tab"><input class="tname" data-i18n-placeholder="p.tabHolder" autocomplete="off" maxlength="${PSPrefs.TAB_NAME_MAX}"><button class="add" type="submit" data-i18n="p.add"></button></form>
      <div class="pmsg" data-msg="tab"></div>
      <div class="tlist"></div>
      <div class="tedit" hidden>
        <div class="thead"><span data-i18n="p.putIn"></span><select class="tpick"></select></div>
        <div class="tchecks"></div>
      </div>
      <div class="psec" data-i18n="p.indices"></div>
      <div class="ilist"></div>
      <div class="psec" data-i18n="p.display"></div>
      <div class="irow"><span class="region" data-i18n="p.uiLang"></span><select class="tpick" data-pref="uiLang"></select></div>
      <div class="irow"><span class="region" data-i18n="p.upColor"></span><div class="ichecks">
        <label class="idx"><input type="radio" class="idx" name="upColor" data-pref="upColor" value="red"><span data-i18n="opt.redUp"></span></label>
        <label class="idx"><input type="radio" class="idx" name="upColor" data-pref="upColor" value="green"><span data-i18n="opt.greenUp"></span></label>
      </div></div>
      <div class="irow"><span class="region" data-i18n="p.debug"></span><div class="ichecks">
        <label class="idx"><input type="checkbox" class="idx" data-pref="showLag"><span data-i18n="p.showLag"></span></label>
      </div></div>
    </div>`;

  function span(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  // data-op＝哪個動作，data-key＝對誰（自選股的 key 或分頁的 id）；提示文字是 i18n 的 op.＋動作
  function opButton(op, key, text) {
    const b = document.createElement('button');
    Object.assign(b, { className: 'op', textContent: text, title: t(`op.${op}`) });
    Object.assign(b.dataset, { op, key });
    return b;
  }

  // 一個勾選框：cls 決定是哪一種（tkey＝放進分頁，沒有＝指數開關），data 放在 dataset
  function check(cls, text, checked, data) {
    const label = document.createElement('label');
    label.className = 'idx';
    const box = document.createElement('input');
    Object.assign(box, { type: 'checkbox', className: `idx ${cls}`, checked });
    Object.assign(box.dataset, data);
    label.append(box, text);
    return label;
  }

  // 一列：左邊標題、右邊一排勾選框（換行時對齊）
  function checkRow(title, checks) {
    const row = document.createElement('div');
    row.className = 'irow';
    const box = document.createElement('div');
    box.className = 'ichecks';
    box.append(...checks);
    row.append(span('region', title), box);
    return row;
  }

  // 照市場分組，保留原本順序
  function byMarket(list) {
    const groups = new Map();
    list.forEach((i) => groups.set(i.market, [...(groups.get(i.market) ?? []), i]));
    return [...groups];
  }

  // 內建分頁目前語言的名稱：自創分頁不能和它們同名
  const reservedNames = () => PSPrefs.BUILTIN_TABS.map((x) => t(x.nameKey));

  // 介面語言選單：「自動（目前判斷出來的語言）」加 6 種語言
  function langOptions(pref) {
    const resolved = PSI18n.UI_OPTIONS.find(([v]) => v === PSI18n.resolve('auto'))[1];
    return PSI18n.UI_OPTIONS.map(([v, name]) => new Option(name ?? `${t('opt.auto')} (${resolved})`, v, false, v === pref));
  }

  // 清單和分頁的動作：收最新的設定，回傳要存的欄位（prefs.js 的純函式）
  const OPS = {
    up: (p, key) => ({ watchlist: PSPrefs.moveWatch(p.watchlist, key, -1) }),
    down: (p, key) => ({ watchlist: PSPrefs.moveWatch(p.watchlist, key, 1) }),
    del: (p, key) => ({ watchlist: PSPrefs.removeWatch(p.watchlist, key), tabs: PSPrefs.forgetKey(p.tabs, key) }),
    tup: (p, id) => ({ tabs: PSPrefs.moveTab(p.tabs, id, -1) }),
    tdown: (p, id) => ({ tabs: PSPrefs.moveTab(p.tabs, id, 1) }),
    tdel: (p, id) => ({ tabs: PSPrefs.removeTab(p.tabs, id) }),
  };

  // root：懸浮框的 Shadow DOM；getPrefs／getQuotes：目前的設定與報價（名稱還沒查到時用報價的名稱）
  function create(root, { getPrefs, getQuotes }) {
    const q = (sel) => root.querySelector(sel);
    const panel = q('div.settings');
    const codeInput = q('input.code'), tabInput = q('input.tname'), addBtn = q('[data-form=watch] button.add');
    const wlist = q('div.wlist'), tlist = q('div.tlist'), tedit = q('div.tedit'), tpick = q('div.tedit select.tpick');
    const tchecks = q('div.tchecks'), ilist = q('div.ilist'), langPick = q('select[data-pref=uiLang]');
    const say = (which, text) => { q(`[data-msg=${which}]`).textContent = text; };
    let editing = null;   // 下方「放進分頁」正在編輯哪個自創分頁

    // 在面板裡打字時，按鍵不要傳給網頁（例如 YouTube 的 L＝快轉 10 秒、K＝暫停）
    ['keydown', 'keyup', 'keypress'].forEach((type) => panel.addEventListener(type, (e) => e.stopPropagation()));

    // ---------- 畫面 ----------

    function watchRow(w, quotes) {
      const key = PSPrefs.keyOf(w);
      const row = document.createElement('div');
      row.className = 'wrow';
      row.append(
        span('wname', w.name ?? quotes[key]?.name ?? w.code), span('wcode', w.code), span('wex', t(`ex.${w.ex ?? 'us'}`)),
        opButton('up', key, '↑'), opButton('down', key, '↓'), opButton('del', key, '✕'),
      );
      return row;
    }

    function tabRow(x) {
      const row = document.createElement('div');
      row.className = 'wrow';
      row.dataset.tab = x.id;
      row.append(
        span('wname', x.name), span('wcode', t('p.count', { n: x.keys.length })),
        opButton('ren', x.id, '✎'), opButton('tup', x.id, '↑'), opButton('tdown', x.id, '↓'), opButton('tdel', x.id, '✕'),
      );
      return row;
    }

    // 「放進分頁」：選一個自創分頁，勾選自選股和開著的指數
    function renderTabEditor(p, quotes) {
      tedit.hidden = !p.tabs.length;
      if (!p.tabs.length) return;
      if (!p.tabs.some((x) => x.id === editing)) editing = p.tabs[0].id;
      tpick.replaceChildren(...p.tabs.map((x) => new Option(x.name, x.id, false, x.id === editing)));
      const tab = p.tabs.find((x) => x.id === editing);
      const items = PSPrefs.items(p);
      const box = (i) => check('tkey', PSPrefs.labelOf(i, quotes[i.key], t)[0], tab.keys.includes(i.key), { key: i.key });
      tchecks.replaceChildren(
        checkRow(t('p.stocks'), items.filter((i) => i.code).map(box)),
        checkRow(t('p.indices'), items.filter((i) => !i.code).map(box)),
      );
    }

    function render() {
      const p = getPrefs();
      const quotes = getQuotes() ?? {};
      wlist.replaceChildren(...p.watchlist.map((w) => watchRow(w, quotes)));
      tlist.replaceChildren(...p.tabs.map(tabRow));
      renderTabEditor(p, quotes);
      ilist.replaceChildren(...byMarket(PSMarkets.INDICES).map(([market, list]) => checkRow(
        t(`mkt.${market}`), list.map((i) => check('', t(i.nameKey), p.indices[i.symbol], { sym: i.symbol })),
      )));
      langPick.replaceChildren(...langOptions(p.uiLang));
      panel.querySelectorAll('input[data-pref=upColor]').forEach((r) => { r.checked = r.value === p.upColor; });
      q('input[data-pref=showLag]').checked = p.showLag;
    }

    // ---------- 新增 ----------

    // 查代號的錯誤：格式、找不到用 msg.，連線問題用 err.（和框底部的錯誤同一套）
    const lookupError = (r, code) => (['format', 'notFound'].includes(r?.error)
      ? t(`msg.${r.error}`, { code }) : r?.error ? t(`err.${r.error}`, r) : t('msg.noReply'));

    // 自選股：格式、重複、上限在這裡先擋，通過了才請背景程式查
    async function addStock() {
      const code = PSPrefs.normalize(codeInput.value);
      if (!code) return;
      const market = PSPrefs.classify(code);
      const list = getPrefs().watchlist;
      if (!market) return say('watch', t('msg.format'));
      if (PSPrefs.has(list, { market, code })) return say('watch', t('msg.dup', { code }));
      if (PSPrefs.isFull(list)) return say('watch', t('msg.full', { n: PSPrefs.WATCH_MAX }));
      say('watch', t('msg.checking', { code }));
      addBtn.disabled = true;
      try {
        const r = await chrome.runtime.sendMessage({ to: 'sw', cmd: 'lookup', code })
          .catch((e) => ({ error: 'other', src: '', detail: e.message }));
        if (!r?.found) return say('watch', lookupError(r, code));
        const latest = await PSPrefs.load();
        await PSPrefs.update({ watchlist: PSPrefs.addWatch(latest.watchlist, r.found) });
        codeInput.value = '';
        say('watch', t('msg.added', { code, name: r.found.name }));
      } finally {
        addBtn.disabled = false;
      }
    }

    // 分頁名稱的錯誤訊息（tabError 回傳的代碼 → msg.＋代碼）
    const tabMessage = (err, name) => t(`msg.${err}`, { name, n: err === 'tabLong' ? PSPrefs.TAB_NAME_MAX : PSPrefs.TAB_MAX });

    async function addTab() {
      const name = tabInput.value.trim();
      const latest = await PSPrefs.load();
      const err = PSPrefs.tabError(latest.tabs, name, null, reservedNames());
      if (err) return say('tab', tabMessage(err, name));
      const tabs = PSPrefs.addTab(latest.tabs, name, reservedNames());
      editing = tabs.at(-1).id;   // 新增完直接在下面勾選內容
      await PSPrefs.update({ tabs });
      tabInput.value = '';
      say('tab', t('msg.tabAdded', { name }));
    }

    const ADDS = { watch: addStock, tab: addTab };
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      ADDS[e.target.dataset.form]();
    });

    // ---------- 改名（就地把名稱換成輸入框；Enter 或離開輸入框＝存，Esc＝取消） ----------

    function startRename(id) {
      const row = tlist.querySelector(`div.wrow[data-tab="${id}"]`);
      const old = getPrefs().tabs.find((x) => x.id === id);
      if (!row || !old) return;
      const input = document.createElement('input');
      Object.assign(input, { className: 'tedit', value: old.name, maxLength: PSPrefs.TAB_NAME_MAX });
      row.querySelector('span.wname').replaceWith(input);
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        const latest = await PSPrefs.load();
        const changed = save && name !== old.name;
        const err = changed ? PSPrefs.tabError(latest.tabs, name, id, reservedNames()) : null;
        if (err) say('tab', tabMessage(err, name));
        if (changed && !err) return PSPrefs.update({ tabs: PSPrefs.renameTab(latest.tabs, id, name, reservedNames()) });
        render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      input.focus();
      input.select();
    }

    // ↑ ↓ ✕ ✎：按下就做，不等放開（CLAUDE.md 第 4 節坑 1）
    async function op(name, key) {
      if (name === 'ren') return startRename(key);
      const latest = await PSPrefs.load();
      await PSPrefs.update(OPS[name](latest, key));
    }
    panel.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-op]');
      if (!b || e.button !== 0) return;
      e.preventDefault();
      op(b.dataset.op, b.dataset.key);
    });

    // 選單和勾選框：顯示設定（data-pref）、指數開關（data-sym）、放進分頁（data-key）
    const CHANGES = {
      pref: (box) => ({ [box.dataset.pref]: box.type === 'checkbox' ? box.checked : box.value }),
      sym: (box, p) => ({ indices: { ...p.indices, [box.dataset.sym]: box.checked } }),
      key: (box, p) => ({ tabs: PSPrefs.setInTab(p.tabs, editing, box.dataset.key, box.checked) }),
    };
    panel.addEventListener('change', async (e) => {
      if (e.target === tpick) {
        editing = tpick.value;
        return renderTabEditor(getPrefs(), getQuotes() ?? {});
      }
      const kind = Object.keys(CHANGES).find((k) => k in e.target.dataset);
      if (kind) PSPrefs.update(CHANGES[kind](e.target, await PSPrefs.load()));
    });

    // ---------- 位置 ----------

    const isOpen = () => !panel.hidden;

    // 依序試：框的下方、上方、左邊、右邊，第一個放得下的就用；都放不下就貼在畫面左上（會蓋到框）
    const clampX = (x, view) => Math.max(8, Math.min(x, view.w - WIDTH - 8));
    const clampY = (y, h, view) => Math.max(8, Math.min(y, view.h - h - 8));
    const SPOTS = [
      (r, h, v) => ({ fits: r.bottom + 8 + h <= v.h, left: clampX(r.right - WIDTH, v), top: r.bottom + 8 }),
      (r, h) => ({ fits: r.top - PSBox.BAR_ROOM - 8 - h >= 0, left: null, top: r.top - PSBox.BAR_ROOM - 8 - h }),
      (r, h, v) => ({ fits: r.left - 8 - WIDTH >= 0, left: r.left - 8 - WIDTH, top: clampY(r.top, h, v) }),
      (r, h, v) => ({ fits: r.right + 8 + WIDTH <= v.w, left: r.right + 8, top: clampY(r.top, h, v) }),
    ];

    function place(rect, view) {
      if (!isOpen()) return;
      const h = panel.offsetHeight;
      const spot = SPOTS.map((f) => f(rect, h, view)).find((s) => s.fits) ?? { left: 8, top: 8 };
      panel.style.left = `${spot.left ?? clampX(rect.right - WIDTH, view)}px`;
      panel.style.top = `${spot.top}px`;
    }

    function toggle(open = !isOpen()) {
      panel.hidden = !open;
      if (open) {
        say('watch', '');
        say('tab', '');
        render();
      }
      return open;
    }

    return { render, toggle, place, isOpen };
  }

  return { CSS, HTML, create };
})();
