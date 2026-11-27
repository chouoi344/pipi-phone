(() => {
  'use strict';

  // Add installed skins here. Scope their styles to html[data-skin] and
  // their picker samples to [data-preview-skin] so all samples can coexist.
  const installed = [
    { id: 'classic', name: '微信经典版' },
    { id: 'waterdrop', name: '原图纯净水滴', wallpaper: '晴空樱花' }
  ];
  const key = 'pipi.appearance.skin';
  const root = document.documentElement;
  let active = installed[0];
  let appearance = null;

  const glassChoices = [
    {value:'auto', label:'自动'}, {value:'full', label:'完整'}, {value:'lite', label:'流畅'}
  ];
  const glassKey = 'pipi.appearance.glass', slowKey = 'pipi.appearance.slowGlass';
  let glassChoice = 'auto', slowScrolling = false;

  function applyGlass() {
    const webview = /(?:; wv\)|PipiPhoneAndroid\/)/.test(navigator.userAgent) &&
      /Chrome\/(\d+)/.exec(navigator.userAgent);
    const lowPower = navigator.deviceMemory <= 4 || navigator.hardwareConcurrency <= 4 ||
      (webview && Number(webview[1]) < 100);
    root.dataset.glass = glassChoice === 'auto' ? (slowScrolling || lowPower ? 'lite' : 'full') : glassChoice;
  }

  function restoreGlass() {
    try {
      const value = localStorage.getItem(glassKey);
      glassChoice = glassChoices.some(choice => choice.value === value) ? value : 'auto';
      slowScrolling = localStorage.getItem(slowKey) === '1';
    } catch (error) {
      if (error.name !== 'SecurityError') throw error;
    }
    applyGlass();
  }

  function selectGlass(value) {
    if (!glassChoices.some(choice => choice.value === value)) return;
    glassChoice = value;
    applyGlass();
    try { localStorage.setItem(glassKey, value); }
    catch (error) { if (!['SecurityError','QuotaExceededError'].includes(error.name)) throw error; }
  }

  // Measure only frames in a continuously scrolling waterdrop conversation.
  // Two consecutive slow windows avoid a permanent switch for one busy frame.
  let sampling = false, lastScroll = 0;
  document.addEventListener('scroll', event => {
    if (event.target.id !== 'chat-messages' || root.dataset.skin !== 'waterdrop' ||
        glassChoice !== 'auto' || root.dataset.glass !== 'full') return;
    lastScroll = performance.now();
    if (sampling) return;
    sampling = true;
    let previous = 0, slowWindows = 0, samples = [];
    const list = event.target;
    function frame(now) {
      if (document.hidden || !list.isConnected || now - lastScroll > 120 ||
          glassChoice !== 'auto' || root.dataset.glass !== 'full' || root.dataset.skin !== 'waterdrop') {
        sampling = false;
        return;
      }
      if (previous) samples.push(now - previous);
      previous = now;
      if (samples.length === 17) {
        samples.sort((a,b) => a-b);
        slowWindows = samples[8] > 24 ? slowWindows + 1 : 0;
        samples = [];
        if (slowWindows === 2) {
          sampling = false;
          slowScrolling = true;
          applyGlass();
          try { localStorage.setItem(slowKey, '1'); }
          catch (error) { if (!['SecurityError','QuotaExceededError'].includes(error.name)) throw error; }
          return;
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }, {capture:true, passive:true});

  function apply(id) {
    if (id === 'waterdrop' && !appearance?.waterdropActivated) id = 'classic';
    active = installed.find(skin => skin.id === id) || installed[0];
    root.dataset.skin = active.id;
    for (const name of document.querySelectorAll('[data-skin-wallpaper-name]')) {
      name.textContent = active.wallpaper || '经典浅灰';
    }
    for (const radio of document.querySelectorAll('#view input[name="appearance-skin"]')) {
      radio.checked = radio.value === root.dataset.skin;
    }
  }

  function restore() {
    try {
      apply((()=>{try{return localStorage.getItem(key);}catch{return null;}})());
    } catch (error) {
      if (error.name !== 'SecurityError') throw error;
      apply('classic');
    }
  }

  function configure(next) {
    const activationChanged = Boolean(appearance?.waterdropActivated) !== Boolean(next?.waterdropActivated);
    appearance = next;
    if (activationChanged) restore();
    return activationChanged;
  }

  function select(id) {
    if (id === 'waterdrop' && !appearance?.waterdropActivated) return;
    apply(id);
    try { localStorage.setItem(key, id); } catch {}
  }

  restore();
  restoreGlass();
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) restore();
    if (event.key === glassKey || event.key === slowKey || event.key === null) restoreGlass();
  });
  window.PipiSkins = {
    installed, configure, select, glassChoices, selectGlass,
    get glassChoice() { return glassChoice; },
    get appearance() { return appearance; },
    get wallpaperName() { return active.wallpaper || '经典浅灰'; }
  };
})();
