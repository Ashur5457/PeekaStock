// 介面文字對照表（架構沿用 FreeLiveSub 的 i18n.js）：懸浮框、設定面板共用。
// 每一句一行，欄位順序固定是 UI_LANGS 的順序，所以不會有哪個語言漏翻某一句；要加語言就在每行多加一欄。
//   畫面上的固定文字：HTML 標 data-i18n="key"（文字）、data-i18n-title（滑鼠提示）、data-i18n-placeholder（輸入框提示），用 apply() 一次換掉
//   程式裡的訊息：t('key', { 變數 })，文字中的 {變數} 會被換成實際的值
// 股票名稱（台積電、Apple Inc.）是資料來源給的，不翻譯。繁中以外由 Claude 翻譯，歡迎母語者修正。
// 懸浮框可能被重複注入同一個網頁，所以用 ??= 避免重複定義。
globalThis.PSI18n ??= (() => {
  const UI_LANGS = ['zh-Hant', 'en', 'zh-Hans', 'ja', 'ko', 'es'];
  const NAMES = ['繁體中文', 'English', '简体中文', '日本語', '한국어', 'Español'];

  /* eslint-disable max-len */
  const S = {
    // ---------- 工具列 ----------
    'bar.settings': ['設定：自選股、分頁、指數、顯示', 'Settings: watchlist, tabs, indices, display', '设置：自选股、分页、指数、显示', '設定：ウォッチリスト・タブ・指数・表示', '설정: 관심종목, 탭, 지수, 표시', 'Ajustes: lista, pestañas, índices, vista'],
    'bar.stealth': ['隱身外觀', 'Stealth look', '隐身外观', 'ステルス表示', '스텔스 모드', 'Modo discreto'],
    'bar.hide': ['隱藏（按 Alt+Shift+H 或點 PeekStock 圖示叫回來）', 'Hide (press Alt+Shift+H or click the PeekStock icon to bring it back)', '隐藏（按 Alt+Shift+H 或点 PeekStock 图标找回）', '隠す（Alt+Shift+H か PeekStock アイコンで再表示）', '숨기기 (Alt+Shift+H 또는 PeekStock 아이콘으로 다시 표시)', 'Ocultar (Alt+Shift+H o el icono de PeekStock para volver a mostrarlo)'],
    'bar.reset': ['重設位置和大小', 'Reset position and size', '重置位置和大小', '位置とサイズをリセット', '위치와 크기 초기화', 'Restablecer posición y tamaño'],

    // ---------- 分頁、段標題 ----------
    'tab.all': ['全部', 'All', '全部', 'すべて', '전체', 'Todo'],
    'tab.tw': ['台股', 'Taiwan', '台股', '台湾', '대만', 'Taiwán'],
    'tab.us': ['美股', 'US', '美股', '米国', '미국', 'EE. UU.'],
    'tab.world': ['國際', 'World', '国际', '海外', '해외', 'Mundo'],
    'sec.tw': ['台股', 'Taiwan', '台股', '台湾株', '대만 주식', 'Taiwán'],
    'sec.us': ['美股', 'US', '美股', '米国株', '미국 주식', 'EE. UU.'],
    'sec.world': ['國際指數', 'World indices', '国际指数', '海外指数', '해외 지수', 'Índices mundiales'],

    // ---------- 報價列 ----------
    'tag.bid': ['買', 'Bid', '买', '買', '매수', 'C'],
    'tag.ask': ['賣', 'Ask', '卖', '売', '매도', 'V'],
    'tag.bidHint': ['盤中沒有成交價，顯示最佳買價', 'No trade price yet; showing the best bid', '盘中没有成交价，显示最佳买价', '約定値がないため最良買い気配を表示', '체결가가 없어 최우선 매수호가를 표시', 'Sin precio de operación; se muestra la mejor compra'],
    'tag.askHint': ['盤中沒有成交價，顯示最佳賣價', 'No trade price yet; showing the best ask', '盘中没有成交价，显示最佳卖价', '約定値がないため最良売り気配を表示', '체결가가 없어 최우선 매도호가를 표시', 'Sin precio de operación; se muestra la mejor venta'],

    // ---------- 框的底部：錯誤、MIS 延遲統計 ----------
    'err.line': ['⚠ {group}：{msg}（連續 {fails} 次失敗）', '⚠ {group}: {msg} ({fails} failures in a row)', '⚠ {group}：{msg}（连续 {fails} 次失败）', '⚠ {group}：{msg}（{fails} 回連続で失敗）', '⚠ {group}: {msg} ({fails}회 연속 실패)', '⚠ {group}: {msg} ({fails} fallos seguidos)'],
    'err.http': ['{src} 伺服器回應 HTTP {detail}', '{src} server returned HTTP {detail}', '{src} 服务器返回 HTTP {detail}', '{src} サーバーが HTTP {detail} を返しました', '{src} 서버가 HTTP {detail}을 반환했습니다', 'El servidor de {src} devolvió HTTP {detail}'],
    'err.notJson': ['{src} 回應的不是報價資料（可能被導到同意頁）', '{src} did not return quote data (maybe redirected to a consent page)', '{src} 返回的不是行情数据（可能被导向同意页）', '{src} から相場データが返りませんでした（同意ページへの転送の可能性）', '{src}에서 시세 데이터가 오지 않았습니다(동의 페이지로 이동했을 수 있음)', '{src} no devolvió cotizaciones (quizá redirigió a una página de consentimiento)'],
    'err.mis': ['證交所 MIS 回報錯誤：{detail}', 'TWSE MIS reported an error: {detail}', '证交所 MIS 返回错误：{detail}', '証券取引所 MIS のエラー：{detail}', '증권거래소 MIS 오류: {detail}', 'Error de TWSE MIS: {detail}'],
    'err.timeout': ['{src} 超過 15 秒沒有回應', '{src} did not respond within 15 seconds', '{src} 超过 15 秒没有响应', '{src} が 15 秒以内に応答しません', '{src}이(가) 15초 동안 응답하지 않습니다', '{src} no respondió en 15 segundos'],
    'err.other': ['{src} 錯誤：{detail}', '{src} error: {detail}', '{src} 错误：{detail}', '{src} エラー：{detail}', '{src} 오류: {detail}', 'Error de {src}: {detail}'],
    'lag.none': ['MIS 延遲：台股盤中才統計', 'MIS delay: measured only during Taiwan trading hours', 'MIS 延迟：台股盘中才统计', 'MIS 遅延：台湾市場の取引時間中のみ集計', 'MIS 지연: 대만 장중에만 집계', 'Retraso de MIS: solo se mide en horario de Taiwán'],
    'lag.stats': ['MIS 延遲：最近一次中位數 {median}s／最大 {max}s｜{since} 起共 {n} 筆：{pcts}', 'MIS delay: last median {median}s / max {max}s | {n} quotes since {since}: {pcts}', 'MIS 延迟：最近一次中位数 {median}s／最大 {max}s｜{since} 起共 {n} 笔：{pcts}', 'MIS 遅延：直近の中央値 {median}s／最大 {max}s｜{since} から {n} 件：{pcts}', 'MIS 지연: 최근 중앙값 {median}s / 최대 {max}s | {since}부터 {n}건: {pcts}', 'Retraso de MIS: mediana {median}s / máx. {max}s | {n} cotizaciones desde {since}: {pcts}'],

    // ---------- 設定面板 ----------
    'p.title': ['設定', 'Settings', '设置', '設定', '설정', 'Ajustes'],
    'p.close': ['關閉', 'Close', '关闭', '閉じる', '닫기', 'Cerrar'],
    'p.watch': ['自選股', 'Watchlist', '自选股', 'ウォッチリスト', '관심종목', 'Lista de seguimiento'],
    'p.codeHolder': ['輸入代號：2330、AAPL', 'Enter a code: 2330, AAPL', '输入代码：2330、AAPL', 'コードを入力：2330、AAPL', '코드 입력: 2330, AAPL', 'Escribe un código: 2330, AAPL'],
    'p.add': ['新增', 'Add', '添加', '追加', '추가', 'Añadir'],
    'p.tabs': ['自創分頁', 'Custom tabs', '自定义分页', 'カスタムタブ', '사용자 탭', 'Pestañas propias'],
    'p.tabHolder': ['分頁名稱：科技股、存股', 'Tab name: Tech, Dividend', '分页名称：科技股、存股', 'タブ名：ハイテク、高配当', '탭 이름: 기술주, 배당주', 'Nombre: Tecnología, Dividendos'],
    'p.putIn': ['放進分頁', 'Add to tab', '放进分页', 'タブに入れる', '탭에 넣기', 'Añadir a la pestaña'],
    'p.stocks': ['自選股', 'Stocks', '自选股', '銘柄', '종목', 'Acciones'],
    'p.indices': ['指數', 'Indices', '指数', '指数', '지수', 'Índices'],
    'p.count': ['{n} 項', '{n} items', '{n} 项', '{n} 件', '{n}개', '{n} elem.'],
    'p.display': ['顯示', 'Display', '显示', '表示', '표시', 'Vista'],
    'p.uiLang': ['介面語言', 'Language', '界面语言', '表示言語', '언어', 'Idioma'],
    'p.upColor': ['漲跌顏色', 'Up/down colors', '涨跌颜色', '騰落の色', '등락 색상', 'Colores'],
    'p.debug': ['除錯', 'Debug', '调试', 'デバッグ', '디버그', 'Depuración'],
    'p.showLag': ['顯示 MIS 延遲統計', 'Show MIS delay stats', '显示 MIS 延迟统计', 'MIS 遅延の統計を表示', 'MIS 지연 통계 표시', 'Mostrar retraso de MIS'],
    'opt.auto':['自動', 'Auto', '自动', '自動', '자동', 'Automático'],
    'opt.redUp': ['紅漲綠跌', 'Red up, green down', '红涨绿跌', '赤が上昇・緑が下落', '빨강 상승·초록 하락', 'Rojo sube, verde baja'],
    'opt.greenUp': ['綠漲紅跌', 'Green up, red down', '绿涨红跌', '緑が上昇・赤が下落', '초록 상승·빨강 하락', 'Verde sube, rojo baja'],
    'ex.tse': ['上市', 'TWSE', '上市', '上場', '상장', 'TWSE'],
    'ex.otc': ['上櫃', 'TPEx', '上柜', '店頭', '장외', 'TPEx'],
    'ex.us': ['美股', 'US', '美股', '米国', '미국', 'EE. UU.'],
    'op.up': ['往上', 'Move up', '上移', '上へ', '위로', 'Subir'],
    'op.down': ['往下', 'Move down', '下移', '下へ', '아래로', 'Bajar'],
    'op.del': ['刪除', 'Remove', '删除', '削除', '삭제', 'Quitar'],
    'op.ren': ['改名', 'Rename', '改名', '名前を変更', '이름 변경', 'Renombrar'],
    'op.tup': ['往前', 'Move left', '前移', '前へ', '앞으로', 'Mover a la izquierda'],
    'op.tdown': ['往後', 'Move right', '后移', '後へ', '뒤로', 'Mover a la derecha'],
    'op.tdel': ['刪除分頁（不會刪掉裡面的股票）', 'Delete tab (the stocks stay in your watchlist)', '删除分页（不会删掉里面的股票）', 'タブを削除（銘柄は残ります）', '탭 삭제 (종목은 남습니다)', 'Eliminar pestaña (las acciones se conservan)'],

    // ---------- 設定面板的訊息 ----------
    'msg.format': ['代號格式不對：台股 4～6 位數字（例如 2330、00878），美股英文代號（例如 AAPL）', 'Invalid code: Taiwan uses 4–6 digits (e.g. 2330, 00878), US uses letters (e.g. AAPL)', '代码格式不对：台股 4～6 位数字（例如 2330、00878），美股英文代码（例如 AAPL）', 'コードの形式が違います：台湾株は 4～6 桁の数字（例：2330、00878）、米国株は英字（例：AAPL）', '코드 형식이 올바르지 않습니다: 대만은 숫자 4~6자리(예: 2330, 00878), 미국은 영문(예: AAPL)', 'Código no válido: Taiwán usa 4–6 dígitos (p. ej. 2330, 00878); EE. UU. usa letras (p. ej. AAPL)'],
    'msg.notFound': ['找不到 {code}', '{code} not found', '找不到 {code}', '{code} が見つかりません', '{code}을(를) 찾을 수 없습니다', 'No se encontró {code}'],
    'msg.dup': ['{code} 已經在清單裡', '{code} is already in the list', '{code} 已经在列表里', '{code} はすでにリストにあります', '{code}은(는) 이미 목록에 있습니다', '{code} ya está en la lista'],
    'msg.full': ['自選股最多 {n} 檔', 'The watchlist holds up to {n} stocks', '自选股最多 {n} 只', 'ウォッチリストは最大 {n} 銘柄です', '관심종목은 최대 {n}개입니다', 'La lista admite hasta {n} acciones'],
    'msg.checking': ['查詢 {code}…', 'Looking up {code}…', '查询 {code}…', '{code} を照会中…', '{code} 조회 중…', 'Buscando {code}…'],
    'msg.added': ['已加入 {name}（{code}）', 'Added {name} ({code})', '已添加 {name}（{code}）', '{name}（{code}）を追加しました', '{name}({code})을(를) 추가했습니다', 'Se añadió {name} ({code})'],
    'msg.noReply': ['背景程式沒有回應', 'The background script did not respond', '后台程序没有响应', 'バックグラウンドが応答しません', '백그라운드가 응답하지 않습니다', 'El proceso en segundo plano no respondió'],
    'msg.tabEmpty': ['請輸入分頁名稱', 'Enter a tab name', '请输入分页名称', 'タブ名を入力してください', '탭 이름을 입력하세요', 'Escribe un nombre'],
    'msg.tabLong': ['分頁名稱最多 {n} 個字', 'Tab names can be up to {n} characters', '分页名称最多 {n} 个字', 'タブ名は {n} 文字までです', '탭 이름은 최대 {n}자입니다', 'El nombre admite hasta {n} caracteres'],
    'msg.tabDup': ['已經有「{name}」分頁', 'A tab named "{name}" already exists', '已经有「{name}」分页', '「{name}」タブはすでにあります', '"{name}" 탭이 이미 있습니다', 'Ya existe una pestaña «{name}»'],
    'msg.tabFull': ['自創分頁最多 {n} 個', 'You can create up to {n} tabs', '自定义分页最多 {n} 个', 'カスタムタブは最大 {n} 個です', '사용자 탭은 최대 {n}개입니다', 'Puedes crear hasta {n} pestañas'],
    'msg.tabAdded': ['已新增「{name}」，在下面勾選要放進去的股票和指數', 'Added "{name}". Tick the stocks and indices to include below.', '已添加「{name}」，在下面勾选要放进去的股票和指数', '「{name}」を追加しました。下で入れる銘柄と指数を選んでください', '"{name}"을(를) 추가했습니다. 아래에서 넣을 종목과 지수를 선택하세요', 'Se añadió «{name}». Marca abajo las acciones e índices que quieras incluir.'],

    // ---------- 地區（設定面板「指數」） ----------
    'mkt.tw': ['台灣', 'Taiwan', '台湾', '台湾', '대만', 'Taiwán'],
    'mkt.us': ['美國', 'US', '美国', '米国', '미국', 'EE. UU.'],
    'mkt.cn': ['中國', 'China', '中国', '中国', '중국', 'China'],
    'mkt.hk': ['香港', 'Hong Kong', '香港', '香港', '홍콩', 'Hong Kong'],
    'mkt.jp': ['日本', 'Japan', '日本', '日本', '일본', 'Japón'],
    'mkt.kr': ['韓國', 'Korea', '韩国', '韓国', '한국', 'Corea'],
    'mkt.sg': ['新加坡', 'Singapore', '新加坡', 'シンガポール', '싱가포르', 'Singapur'],
    'mkt.uk': ['英國', 'UK', '英国', '英国', '영국', 'Reino Unido'],
    'mkt.fr': ['法國', 'France', '法国', 'フランス', '프랑스', 'Francia'],
    'mkt.de': ['德國', 'Germany', '德国', 'ドイツ', '독일', 'Alemania'],

    // ---------- 指數名稱（key 是 idx.＋代號，見 markets.js 的 INDICES） ----------
    'idx.tse_t00': ['加權指數', 'TAIEX', '台湾加权指数', '台湾加権指数', '대만 가권지수', 'TAIEX'],
    'idx.otc_o00': ['櫃買指數', 'TPEx Index', '柜买指数', 'TPEx 指数', '대만 장외지수', 'Índice TPEx'],
    'idx.^DJI': ['道瓊', 'Dow Jones', '道琼斯', 'NY ダウ', '다우존스', 'Dow Jones'],
    'idx.^GSPC': ['S&P 500', 'S&P 500', '标普 500', 'S&P 500', 'S&P 500', 'S&P 500'],
    'idx.^IXIC': ['那斯達克', 'Nasdaq', '纳斯达克', 'ナスダック', '나스닥', 'Nasdaq'],
    'idx.^SOX': ['費城半導體', 'PHLX Semiconductor', '费城半导体', 'SOX 指数', '필라델피아 반도체', 'Semiconductores PHLX'],
    'idx.000001.SS': ['上證指數', 'Shanghai Composite', '上证指数', '上海総合', '상하이종합', 'Shanghái Compuesto'],
    'idx.399001.SZ': ['深證成指', 'Shenzhen Component', '深证成指', '深セン成分', '선전성분', 'Shenzhen Componente'],
    'idx.000300.SS': ['滬深 300', 'CSI 300', '沪深 300', 'CSI 300', 'CSI 300', 'CSI 300'],
    'idx.^HSI': ['恒生指數', 'Hang Seng', '恒生指数', 'ハンセン', '항셍', 'Hang Seng'],
    'idx.^N225': ['日經 225', 'Nikkei 225', '日经 225', '日経平均', '닛케이 225', 'Nikkei 225'],
    'idx.^KS11': ['KOSPI', 'KOSPI', 'KOSPI', 'KOSPI', '코스피', 'KOSPI'],
    'idx.^STI': ['海峽時報', 'Straits Times', '海峡时报', 'STI', '스트레이츠타임스', 'Straits Times'],
    'idx.^FTSE': ['FTSE 100', 'FTSE 100', '富时 100', 'FTSE 100', 'FTSE 100', 'FTSE 100'],
    'idx.^FCHI': ['CAC 40', 'CAC 40', 'CAC 40', 'CAC 40', 'CAC 40', 'CAC 40'],
    'idx.^GDAXI': ['DAX', 'DAX', 'DAX', 'DAX', 'DAX', 'DAX'],
  };
  /* eslint-enable max-len */

  // 「自動」：跟著瀏覽器的語言；沒有對應的就用英文
  function resolve(pref) {
    if (UI_LANGS.includes(pref)) return pref;
    const nav = (globalThis.navigator?.language || 'en').toLowerCase();
    if (/^zh-(tw|hk|mo|hant)/.test(nav)) return 'zh-Hant';
    if (nav.startsWith('zh')) return 'zh-Hans';
    return UI_LANGS.find((l) => nav.startsWith(l)) ?? 'en';
  }

  let current = resolve('auto');
  const use = (pref) => { current = resolve(pref); return current; };

  // 找不到這個語言就用英文，連英文都沒有就直接顯示 key（方便發現漏掉的字）
  function t(key, vars = {}) {
    const row = S[key];
    const text = row ? (row[UI_LANGS.indexOf(current)] ?? row[1]) : key;
    return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  function apply(root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  }

  // 介面語言選單：「自動」加上 6 種語言（語言名稱用各自的寫法）
  const UI_OPTIONS = [['auto', null], ...UI_LANGS.map((l, i) => [l, NAMES[i]])];

  return { UI_LANGS, UI_OPTIONS, S, resolve, use, t, apply, current: () => current };
})();
