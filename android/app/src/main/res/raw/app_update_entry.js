// SPDX-License-Identifier: AGPL-3.0-only
// Loaded by the Android shell even when the connected server has an older About page.
(() => {
  const view = document.getElementById('view');
  if (!view || !/\bPipiPhoneUpdater\/3\b/.test(navigator.userAgent) || view.dataset.pipiUpdateObserver) return;
  view.dataset.pipiUpdateObserver = '1';

  function addEntry() {
    if (view.dataset.route !== 'about' || view.querySelector('[data-android-app-update]')) return;
    const webEntry = view.querySelector('details[data-update-entry]') || view.querySelector('[data-software-update]');
    const anchor = webEntry || view.querySelector('.about-intro') || view.querySelector('.about-logo');
    if (!anchor) return;
    // Keep older servers' own form and its click handlers.
    const webTitle = webEntry?.querySelector('summary .cell-title, #software-update-title');
    if (webTitle && webTitle.textContent !== '网页程序更新') webTitle.textContent = '网页程序更新';
    const section = document.createElement('section');
    section.className = 'section';
    section.dataset.androidAppUpdate = '';
    section.innerHTML = '<a class="cell plain-cell" href="/__android/update"><span class="cell-body"><span class="cell-title">安卓 App 更新</span></span><span class="icon mask-icon chevron" aria-hidden="true"></span></a>';
    const link = section.firstElementChild;
    link.querySelector('.chevron').style.setProperty('--icon-url', "url('/vendor/fake-world/masks/arrow-outlined.svg')");
    anchor.after(section);
  }

  addEntry();
  new MutationObserver(addEntry).observe(view, {childList: true, attributes: true, attributeFilter: ['data-route']});
})();
