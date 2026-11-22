/* SPDX-License-Identifier: AGPL-3.0-only */
(() => {
  'use strict';

  const seenKey = 'pipi.first-use-notice.seen';
  let shownInPage = false;

  function show(view, { replay = false } = {}) {
    if (shownInPage && !replay) return;
    try {
      if (!replay && localStorage.getItem(seenKey)) return;
      localStorage.setItem(seenKey, '1');
    } catch (error) {
      // Browsers with storage disabled can still read the notice and finish setup.
      if (error.name !== 'SecurityError' && error.name !== 'QuotaExceededError') throw error;
    }
    shownInPage = true;
    view.insertAdjacentHTML('beforeend', `
    <div class="notice-shade" aria-hidden="true"></div>
    <dialog class="first-notice" aria-labelledby="notice-title">
      <div class="notice-reading" tabindex="0" aria-label="使用须知正文">
        <h2 id="notice-title" tabindex="-1" autofocus>使用须知</h2>
        <p class="notice-intro"><span>在使用屁屁机前，</span><span>请先确保自身满足以下条件：</span></p>
        <ol class="notice-conditions">
          <li>我已经满18岁成年</li>
          <li>我是单身并无对象</li>
          <li>我确保不会过度沉迷</li>
        </ol>
        <div class="notice-letter">
          <p>屁屁机是一个短暂的落脚点，但不是终点。</p>
          <p>不要过度沉迷虚拟，请把生活的重心放在现实还有提升自己上面。</p>
          <p>现实中没有王子爱上灰姑娘的桥段，但是我们可以自己成为自己的公主。</p>
          <p class="notice-wish">屁屁祝大家来日之路光明璀璨</p>
        </div>
      </div>
      <div class="notice-actions"><button type="button" id="dismiss-notice">我知道了</button></div>
    </dialog>
    `);
    const notice = view.querySelector('.first-notice');
    const shade = view.querySelector('.notice-shade');
    const heading = view.querySelector('h1');
    let closing = false;
    let startedOutside = false;

    function finish() {
      if (!notice.isConnected) return;
      notice.close();
      shade.remove();
      notice.remove();
      heading.focus({ preventScroll: true });
    }

    function dismiss() {
      if (closing) return;
      closing = true;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
      }
      const timing = { duration: 160, easing: 'ease-out', fill: 'forwards' };
      const cardFade = notice.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(4px)' }
      ], timing);
      const shadeFade = shade.animate([{ opacity: 1 }, { opacity: 0 }], timing);
      Promise.allSettled([cardFade.finished, shadeFade.finished]).then(finish);
    }

    function outside(event) {
      const box = notice.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom;
    }

    notice.querySelector('#dismiss-notice').addEventListener('click', dismiss);
    notice.addEventListener('cancel', event => {
      event.preventDefault();
      dismiss();
    });
    notice.addEventListener('pointerdown', event => { startedOutside = outside(event); });
    notice.addEventListener('click', event => {
      if (startedOutside && outside(event)) dismiss();
      startedOutside = false;
    });
    notice.showModal();
  }

  window.PipiFirstUseNotice = { show };
})();
