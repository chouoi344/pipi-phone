/* SPDX-License-Identifier: GPL-3.0-only
 * The device owns system chrome. Real devices use their reported safe areas;
 * a mouse-only desktop preview reserves empty iPhone-style top/bottom space.
 */
(() => {
  'use strict';
  const shell = document.querySelector('.phone-shell');
  const view = document.getElementById('view');
  const overlay = document.getElementById('overlay');
  if (!shell || !view || !overlay) return;
  const probe = document.createElement('span');
  probe.className = 'phone-safe-probe';
  probe.setAttribute('aria-hidden', 'true');
  document.body.append(probe);
  const desktopPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let scheduled = false, lastLayout = '', lastTheme = '', keyboardCovered = false;
  function background(element, fallback = '#ededed') {
    for (let node = element; node && node !== shell; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
    }
    return fallback;
  }
  function rgb(hex) {
    return hex.startsWith('#') ? `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})` : hex;
  }
  function refresh() {
    scheduled = false;
    const actual = getComputedStyle(probe);
    const insets = {
      top: parseFloat(actual.paddingTop) || 0,
      right: parseFloat(actual.paddingRight) || 0,
      bottom: parseFloat(actual.paddingBottom) || 0,
      left: parseFloat(actual.paddingLeft) || 0,
    };
    // Touch-capable devices keep their real browser insets, including zero.
    // A tablet with a mouse can report a fine pointer, so check touch as well.
    const desktopPreview = desktopPointer.matches && navigator.maxTouchPoints === 0 && Object.values(insets).every(value => value === 0);
    if (desktopPreview) { insets.top = 47; insets.bottom = 34; }
    const active = document.activeElement, viewport = window.visualViewport;
    const editing = active && !active.disabled && !active.readOnly && active.getAttribute('aria-disabled') !== 'true' && (
      active.isContentEditable || active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && /^(text|search|email|tel|url|password|number)$/.test(active.type))
    );
    // iOS can keep its home inset while the keyboard shrinks the visual
    // viewport. Retain this state during blur/keyboard-dismiss animation.
    // Compare unzoomed heights so a pinch alone is not a keyboard, while a
    // keyboard still removes the covered inset when the user has zoomed in.
    const reduced = viewport && window.innerHeight - viewport.height * viewport.scale > 120;
    keyboardCovered = Boolean(reduced && (editing || keyboardCovered));
    if (keyboardCovered) insets.bottom = 0;
    // Bottom bars already consume the inset. Plain leaf pages need it once.
    const leaf = !view.querySelector(':scope > .bottom-tabs, :scope > .chat-composer, :scope > .message-selection-toolbar, .status-editor-surface, .feature-page');
    const layout = JSON.stringify([insets, leaf, desktopPreview]);
    if (layout !== lastLayout) {
      const update = () => {
        for (const [side, value] of Object.entries(insets)) shell.style.setProperty(`--safe-${side}`, `${value}px`);
        shell.classList.toggle('phone-desktop-preview', desktopPreview);
        view.classList.toggle('phone-frame-leaf', leaf);
      };
      if (window.Pipi?.preserveChatLayout) window.Pipi.preserveChatLayout(update); else update();
      lastLayout = layout;
      window.dispatchEvent(new CustomEvent('pipi:phone-frame'));
    }
    const statusPicker = view.querySelector('.status-picker-surface');
    const statusEditor = view.querySelector('.status-editor-surface');
    const photoHeader = view.querySelector('.moments-topbar:not(.is-scrolled)');
    let top = rgb('#ededed'), bottom = top;
    if (statusPicker) {
      top = rgb('#283a4c'); bottom = rgb('#31251c');
    } else if (statusEditor) {
      top = rgb(getComputedStyle(statusEditor).getPropertyValue('--status-theme').trim() || '#56796a');
      bottom = rgb('#78998c');
      view.style.setProperty('--frame-status-theme', top);
    } else {
      top = photoHeader ? background(view.querySelector('.moments-cover'), rgb('#8b918f')) : background(view.querySelector(':scope > .topbar, .me-topspace'), rgb('#ededed'));
      const bottomSurface = view.querySelector(':scope > .bottom-tabs') || view.querySelector(':scope > .chat-composer, :scope > .message-selection-toolbar') || view.querySelector('.feature-page') || view.querySelector(':scope > .content');
      bottom = background(bottomSurface, top);
    }
    // Nested dialogs retain their parent editor. Extend its real surface
    // colors into the reserved top/bottom space; the overlay dims it itself.
    const editors = [...overlay.querySelectorAll('.page-editor')];
    const editor = editors.at(-1);
    if (editor) {
      editor.style.backgroundColor = background(editor.querySelector('.modal-header'));
      editor.style.setProperty('--frame-editor-bottom-bg', background(editor.querySelector('.modal-body')));
    }
    const theme = JSON.stringify([top, bottom]);
    if (theme !== lastTheme) {
      view.style.setProperty('--frame-top-bg', top);
      view.style.setProperty('--frame-bottom-bg', bottom);
      lastTheme = theme;
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); }
  }
  // Only the page edges determine system-area colors. Changes inside message
  // bubbles, form values and list rows do not require another layout read.
  const pageEdges = records => {
    if (records.some(({target, type}) => target === view ||
      type === 'attributes' && target.parentElement === view && target.matches('.topbar,.status-picker-surface,.status-editor-surface'))) schedule();
  };
  const overlayEdges = records => {
    if (records.some(({target, type}) => target === overlay || type === 'attributes' && target.parentElement === overlay)) schedule();
  };
  new MutationObserver(pageEdges).observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-route', 'class'] });
  new MutationObserver(overlayEdges).observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-skin'] });
  new ResizeObserver(schedule).observe(probe, { box: 'border-box' });
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  desktopPointer.addEventListener('change', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  window.PipiPhoneFrame = Object.freeze({ refresh });
  refresh();
})();
