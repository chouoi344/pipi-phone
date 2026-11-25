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
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) restore();
  });
  window.PipiSkins = {
    installed, configure, select,
    get appearance() { return appearance; },
    get wallpaperName() { return active.wallpaper || '经典浅灰'; }
  };
})();
