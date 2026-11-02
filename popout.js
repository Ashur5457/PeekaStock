// 彈出小視窗：這個頁面是「主人視窗」，按按鈕開 Chrome 的文件子母畫面（永遠在最上層，可以浮在桌面、Excel 上），
// 把 overlay.js 畫好的框整個搬進去。框的程式還是跑在這個頁面，所以主人視窗被蓋住或縮小時報價照常更新（實測見 CLAUDE.md 7.5）。
//   主人視窗關掉，小視窗跟著關；藏身鍵、點圖示（hidden 變 true）也關掉小視窗，因為小視窗沒辦法只是藏起來
//   開小視窗一定要有人親手按（Chrome 的規定），所以不能自動開
(() => {
  const SIZE = { width: 340, height: 360 };
  const BG = { normal: '#1E1C24', stealth: '#fff' };   // 隱身模式的框是透明的，底色要跟著換
  const openBtn = document.getElementById('open');
  const host = document.querySelector('peek-stock');
  let pip = null;

  const paint = (p) => {
    if (pip) pip.document.body.style.background = p.stealth ? BG.stealth : BG.normal;
  };

  function closed() {
    pip = null;
    document.body.append(host);   // 搬回主人視窗，下次才開得起來
    openBtn.disabled = false;
  }

  async function open() {
    try {
      pip = await documentPictureInPicture.requestWindow(SIZE);
    } catch (e) {
      document.getElementById('msg').textContent = PSI18n.t('pop.fail', { detail: e.message });
      return;
    }
    pip.document.body.style.margin = '0';
    pip.document.body.append(host);
    pip.addEventListener('pagehide', closed);
    openBtn.disabled = true;
    paint(await PSPrefs.load());
    const { hidden } = await chrome.storage.session.get('hidden');
    if (hidden) chrome.runtime.sendMessage({ to: 'sw', cmd: 'toggleHidden' }).catch(() => {});   // 藏著時按「開」＝叫出來
  }

  openBtn.addEventListener('click', open);
  chrome.storage.session.onChanged.addListener((ch) => {
    if (ch.hidden?.newValue) pip?.close();
  });
  PSPrefs.watch(paint);
  PSPrefs.load().then((p) => {
    PSI18n.use(p.uiLang);
    PSI18n.apply(document);
  });
})();
