/* SPDX-License-Identifier: AGPL-3.0-only
 * Native 60fps Motion & Micro-Interaction Engine (WebView 83 compatible).
 * Strictly GPU-composited (transform + opacity only). Pure visual presentation:
 * never mutates app history stacks, drafts, send queues or network state.
 */
(() => {
  'use strict';

  const PRIMARY_TABS = ['chats', 'contacts', 'discover', 'me'];
  const BOTTOM_SHEET_CLASSES = [
    'sheet-actions',
    'pt-settings-sheet',
    'model-sheet',
    'usage-sheet',
    'classic-entry-sheet',
    'contact-remark-editor',
    'chat-background-editor',
    'skin-activation-sheet'
  ];
  const BACKDROP_CLASSES = ['overlay-mask', 'menu-dismiss', 'classic-entry-backdrop'];
  const EASE_NAV = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const EASE_SPRING = 'cubic-bezier(0.32, 1.25, 0.36, 1)';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let activeAnimations = [];
  let activeCleanup = null;
  let exitStage = null;
  let exitAnimations = [];
  let exitCreatedAt = 0;
  let skipNextBackTransition = false;
  let skipNextOverlayExit = false;

  const classicArrivals = new Map();
  let lastAnimatedPanelKey = '';

  function isWaterdrop() {
    return document.documentElement.dataset.skin === 'waterdrop';
  }

  function isAndroidApp() {
    return /\bPipiPhoneAndroid\/1(?:\.|\b)/.test(navigator.userAgent)
      || document.documentElement.dataset.pipiAndroid === 'true';
  }

  function isBackdropNode(node) {
    if (!node || !node.classList) return false;
    return BACKDROP_CLASSES.some(cls => node.classList.contains(cls));
  }

  function isBottomSheetNode(node, shellHeight) {
    if (!node || !node.classList) return false;
    if (BOTTOM_SHEET_CLASSES.some(cls => node.classList.contains(cls))) return true;
    if (node.classList.contains('modal-sheet') && !node.classList.contains('page-editor')) return true;
    if (shellHeight > 0) {
      const rect = node.getBoundingClientRect();
      if (rect.height > 0 && rect.height < shellHeight * 0.92 && rect.bottom >= shellHeight - 24) return true;
    }
    return false;
  }

  function cancelPageTransition() {
    const anims = activeAnimations;
    activeAnimations = [];
    for (const anim of anims) {
      try { anim.cancel(); } catch {}
    }
    if (activeCleanup) {
      const fn = activeCleanup;
      activeCleanup = null;
      fn();
    }
  }

  function cancelOverlayExit() {
    const anims = exitAnimations;
    exitAnimations = [];
    for (const anim of anims) {
      try { anim.cancel(); } catch {}
    }
    if (exitStage) {
      exitStage.remove();
      exitStage = null;
    }
  }

  function runSafeAnimate(element, keyframes, options) {
    if (!element || typeof element.animate !== 'function') return null;
    try {
      return element.animate(keyframes, options);
    } catch {
      return null;
    }
  }

  function preparePageTransition(view, route, name, nextArg, fromBack) {
    cancelPageTransition();
    view.classList.remove('navigation-entering', 'ui-nav-push-top', 'ui-nav-pop-top', 'ui-nav-animating');
    view.style.transform = '';

    if (skipNextBackTransition) {
      skipNextBackTransition = false;
      return null;
    }
    if (!view.dataset.route || (route.name === name && route.arg === nextArg)) return null;
    if (reduceMotion.matches || typeof view.animate !== 'function') return null;

    // 1. Primary bottom-tab switch: ultra-clean subtle content fade + active tab icon micro-bounce.
    if (!fromBack && PRIMARY_TABS.includes(route.name) && PRIMARY_TABS.includes(name)) {
      return () => {
        const content = view.querySelector(':scope > .content');
        if (content) {
          runSafeAnimate(content, [
            { opacity: 0.88 },
            { opacity: 1 }
          ], { duration: 115, easing: 'ease-out' });
        }
        const activeIcon = view.querySelector(':scope > .bottom-tabs .tab.active > .icon');
        if (activeIcon) {
          runSafeAnimate(activeIcon, [
            { transform: 'scale(1)' },
            { transform: 'scale(0.88)', offset: 0.34 },
            { transform: 'scale(1.06)', offset: 0.72 },
            { transform: 'scale(1)' }
          ], { duration: 230, easing: EASE_SPRING });
        }
      };
    }

    // 2. Auth unlock -> home reveal ceremony
    if (view.dataset.route === 'auth' && name !== 'auth') {
      const snapshot = view.cloneNode(true);
      snapshot.removeAttribute('id');
      snapshot.removeAttribute('aria-live');
      snapshot.setAttribute('aria-hidden', 'true');
      snapshot.inert = true;
      snapshot.classList.add('navigation-snapshot', 'ui-nav-animating', 'ui-nav-auth-out');
      snapshot.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      view.after(snapshot);

      return () => {
        const outAnim = runSafeAnimate(snapshot, [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(1.03)' }
        ], { duration: 240, easing: EASE_NAV });
        const inAnim = runSafeAnimate(view, [
          { opacity: 0.4, transform: 'scale(0.98)' },
          { opacity: 1, transform: 'scale(1)' }
        ], { duration: 260, easing: EASE_NAV });
        activeAnimations = [outAnim, inAnim].filter(Boolean);
        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          const anims = activeAnimations;
          activeAnimations = [];
          for (const a of anims) { try { a.cancel(); } catch {} }
          snapshot.remove();
          view.classList.remove('ui-nav-animating');
          view.style.transform = '';
          if (activeCleanup === cleanup) activeCleanup = null;
        };
        activeCleanup = cleanup;
        const finishTarget = inAnim || outAnim;
        if (finishTarget) {
          finishTarget.onfinish = cleanup;
          finishTarget.oncancel = cleanup;
        } else {
          cleanup();
        }
      };
    }

    // 3. Native Dual-Layer Parallax Push / Pop (iOS / WeChat Navigation Feel)
    const scrollSelector = '.content,.chat-messages,.emoji-scroll';
    const scrolls = [...view.querySelectorAll(scrollSelector)].map(el => ({
      top: el.scrollTop,
      left: el.scrollLeft
    }));

    let conversationHeights;
    if (view.dataset.route === 'chats' && 'contentVisibility' in view.style && 'containIntrinsicBlockSize' in view.style) {
      const rows = view.querySelectorAll('.conversation-wrap:not([hidden])');
      const scroller = view.querySelector('.content');
      if (rows.length && scroller) {
        const bounds = scroller.getBoundingClientRect();
        conversationHeights = [...rows].map(row => {
          const rect = row.getBoundingClientRect();
          return rect.height && (rect.bottom < bounds.top - 128 || rect.top > bounds.bottom + 128) ? rect.height : 0;
        });
      }
    }

    const snapshot = view.cloneNode(true);
    snapshot.removeAttribute('id');
    snapshot.removeAttribute('aria-live');
    snapshot.setAttribute('aria-hidden', 'true');
    snapshot.inert = true;
    snapshot.classList.add('navigation-snapshot', 'ui-nav-animating');
    snapshot.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    const snapshotScrolls = snapshot.querySelectorAll(scrollSelector);

    if (conversationHeights) {
      snapshot.querySelectorAll('.conversation-wrap:not([hidden])').forEach((row, index) => {
        const height = conversationHeights[index];
        if (height) {
          row.style.contentVisibility = 'hidden';
          row.style.containIntrinsicBlockSize = height + 'px';
        }
      });
    }

    const scrim = document.createElement('div');
    scrim.className = 'ui-nav-scrim';
    scrim.setAttribute('aria-hidden', 'true');

    view.after(snapshot);
    snapshot.after(scrim);

    if (fromBack) {
      snapshot.classList.add('ui-nav-pop-top');
      view.classList.add('ui-nav-animating');
    } else {
      view.classList.add('navigation-entering', 'ui-nav-push-top', 'ui-nav-animating');
    }

    return () => {
      snapshotScrolls.forEach((el, index) => {
        const pos = scrolls[index];
        if (!pos) return;
        if (pos.top) el.scrollTop = pos.top;
        if (pos.left) el.scrollLeft = pos.left;
      });

      const duration = fromBack ? 235 : 260;
      const scrimOpacity = isWaterdrop() ? 0.08 : 0.13;
      const timing = { duration, easing: EASE_NAV, fill: 'none' };

      let topAnim, bottomAnim, scrimAnim;
      if (fromBack) {
        topAnim = runSafeAnimate(snapshot, [
          { transform: 'translate3d(0, 0, 0)' },
          { transform: 'translate3d(100%, 0, 0)' }
        ], timing);
        bottomAnim = runSafeAnimate(view, [
          { transform: 'translate3d(-24%, 0, 0)' },
          { transform: 'translate3d(0, 0, 0)' }
        ], timing);
        scrimAnim = runSafeAnimate(scrim, [
          { opacity: scrimOpacity },
          { opacity: 0 }
        ], timing);
      } else {
        topAnim = runSafeAnimate(view, [
          { transform: 'translate3d(100%, 0, 0)' },
          { transform: 'translate3d(0, 0, 0)' }
        ], timing);
        bottomAnim = runSafeAnimate(snapshot, [
          { transform: 'translate3d(0, 0, 0)' },
          { transform: 'translate3d(-24%, 0, 0)' }
        ], timing);
        scrimAnim = runSafeAnimate(scrim, [
          { opacity: 0 },
          { opacity: scrimOpacity }
        ], timing);
      }

      activeAnimations = [topAnim, bottomAnim, scrimAnim].filter(Boolean);
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        const anims = activeAnimations;
        activeAnimations = [];
        for (const a of anims) { try { a.cancel(); } catch {} }
        snapshot.remove();
        scrim.remove();
        view.classList.remove('navigation-entering', 'ui-nav-push-top', 'ui-nav-pop-top', 'ui-nav-animating');
        view.style.transform = '';
        if (activeCleanup === cleanup) activeCleanup = null;
      };
      activeCleanup = cleanup;
      if (topAnim) {
        topAnim.onfinish = cleanup;
        topAnim.oncancel = cleanup;
      } else {
        cleanup();
      }
    };
  }

  // Zero-blocking GPU exit animations for modals, sheets, menus, dialogs & lightboxes.
  // Cloned nodes have CSS animations strictly suppressed via .ui-exit-stage * { animation: none !important }
  // so dismissing NEVER replays entrance keyframes.
  function captureOverlayExit(overlay) {
    cancelOverlayExit();
    if (skipNextOverlayExit) {
      skipNextOverlayExit = false;
      return;
    }
    if (!overlay || !overlay.children.length || reduceMotion.matches) return;
    const shell = overlay.parentElement;
    if (!shell) return;
    const shellHeight = shell.getBoundingClientRect().height || 0;

    // Measure live children BEFORE cloning so sheet-vs-page detection uses true rendered geometry.
    const items = [];
    for (const child of [...overlay.children]) {
      if (child.classList.contains('modal-parent-underlay')) continue;
      let kind = 'sheet';
      if (isBackdropNode(child)) kind = 'backdrop';
      else if (child.classList.contains('lightbox') || child.classList.contains('image-viewer')) kind = 'lightbox';
      else if (child.classList.contains('alert-dialog') || child.classList.contains('confirm-dialog')) kind = 'dialog';
      else if (child.classList.contains('top-menu') || child.classList.contains('bubble-menu')) kind = 'menu';
      else if (child.classList.contains('page-editor') && !isBottomSheetNode(child, shellHeight)) kind = 'page';
      items.push({ child, kind });
    }
    if (!items.length) return;

    const stage = document.createElement('div');
    stage.className = 'ui-exit-stage overlay-root';
    if (overlay.classList.contains('pt-settings-overlay')) stage.classList.add('pt-settings-overlay');
    if (overlay.classList.contains('has-contact-remark')) stage.classList.add('has-contact-remark');
    if (overlay.classList.contains('has-chat-background')) stage.classList.add('has-chat-background');
    stage.setAttribute('aria-hidden', 'true');
    stage.inert = true;

    const animEntries = [];
    for (const { child, kind } of items) {
      const clone = child.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      stage.append(clone);
      animEntries.push({ node: clone, kind });
    }

    overlay.after(stage);
    exitStage = stage;
    exitCreatedAt = performance.now();

    // Fade overlay-level backdrop dimming cleanly when overlay itself carried background dimming
    const overlayBg = getComputedStyle(overlay).backgroundColor;
    const anims = [];
    if (overlayBg && overlayBg !== 'transparent' && overlayBg !== 'rgba(0, 0, 0, 0)') {
      stage.style.backgroundColor = overlayBg;
      anims.push(runSafeAnimate(stage, [{ opacity: 1 }, { opacity: 0 }], {
        duration: 175, easing: 'ease-out', fill: 'forwards'
      }));
    }

    for (const { node, kind } of animEntries) {
      if (kind === 'backdrop') {
        anims.push(runSafeAnimate(node, [{ opacity: 1 }, { opacity: 0 }], {
          duration: 165, easing: 'ease-out', fill: 'forwards'
        }));
      } else if (kind === 'lightbox') {
        anims.push(runSafeAnimate(node, [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.955)' }
        ], { duration: 180, easing: EASE_OUT, fill: 'forwards' }));
      } else if (kind === 'dialog') {
        anims.push(runSafeAnimate(node, [
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.94)' }
        ], { duration: 150, easing: 'ease-out', fill: 'forwards' }));
      } else if (kind === 'menu') {
        anims.push(runSafeAnimate(node, [
          { opacity: 1, transform: 'scale(1) translate3d(0, 0, 0)' },
          { opacity: 0, transform: 'scale(0.93) translate3d(0, -4px, 0)' }
        ], { duration: 130, easing: 'ease-out', fill: 'forwards' }));
      } else if (kind === 'page') {
        anims.push(runSafeAnimate(node, [
          { transform: 'translate3d(0, 0, 0)' },
          { transform: 'translate3d(100%, 0, 0)' }
        ], { duration: 235, easing: EASE_NAV, fill: 'forwards' }));
      } else {
        anims.push(runSafeAnimate(node, [
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          { opacity: 0, transform: 'translate3d(0, 40px, 0)' }
        ], { duration: 210, easing: EASE_NAV, fill: 'forwards' }));
      }
    }

    exitAnimations = anims.filter(Boolean);
    if (!exitAnimations.length) {
      cancelOverlayExit();
      return;
    }
    const longest = exitAnimations[exitAnimations.length - 1];
    const finish = () => {
      if (exitStage === stage) cancelOverlayExit();
      else stage.remove();
    };
    longest.onfinish = finish;
    longest.oncancel = finish;
  }

  // Track newly arrived / sent chat messages for Classic skin (Waterdrop has waterdrop-chat.js)
  function observeChatState(previous, next, view) {
    const now = Date.now();
    for (const [id, item] of classicArrivals) {
      if (item.until < now) classicArrivals.delete(id);
    }
    if (!previous || !view || view.dataset.route !== 'chat' || document.hidden || reduceMotion.matches) return;
    if (isWaterdrop()) return;
    const roleId = view.dataset.chatRole;
    if (!roleId) return;
    const known = new Set((previous.messages || []).map(m => m.id));
    for (const msg of (next.messages || [])) {
      if (msg.roleId !== roleId || msg.sender === 'system' || known.has(msg.id)) continue;
      classicArrivals.set(msg.id, { roleId, until: now + 1200, mine: msg.sender === 'user' || msg.meta?.author === 'me' });
    }
  }

  function animateClassicChatArrivals(view) {
    if (view.dataset.route !== 'chat' || isWaterdrop() || reduceMotion.matches) {
      classicArrivals.clear();
      return;
    }
    const list = view.querySelector('#chat-messages');
    if (!list) return;
    const roleId = view.dataset.chatRole;
    let order = 0;
    const now = Date.now();
    for (const row of list.querySelectorAll('.message-row[data-message]')) {
      const arrival = classicArrivals.get(row.dataset.message);
      if (!arrival) continue;
      classicArrivals.delete(row.dataset.message);
      if (arrival.roleId !== roleId || arrival.until < now) continue;
      const dx = arrival.mine ? 0 : -5;
      runSafeAnimate(row, [
        { opacity: 0.35, transform: 'translate3d(' + dx + 'px, 10px, 0) scale(0.975)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
      ], {
        duration: 210,
        delay: Math.min(order++ * 32, 128),
        easing: EASE_OUT
      });
    }
  }

  function animateComposerTools(view) {
    if (view.dataset.route !== 'chat' || reduceMotion.matches) {
      lastAnimatedPanelKey = '';
      return;
    }
    const panel = view.querySelector('.compose-panel');
    if (!panel) {
      lastAnimatedPanelKey = '';
      return;
    }
    const activeDot = view.querySelector('.panel-dots button.active');
    const key = (activeDot ? activeDot.dataset.action : '0') + ':' + panel.children.length;
    if (key === lastAnimatedPanelKey) return;
    lastAnimatedPanelKey = key;
    const buttons = [...panel.children];
    buttons.forEach((btn, i) => {
      runSafeAnimate(btn, [
        { opacity: 0.35, transform: 'translate3d(0, 8px, 0) scale(0.95)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
      ], {
        duration: 185,
        delay: Math.min(i * 15, 105),
        easing: EASE_OUT,
        fill: 'backwards'
      });
    });
  }

  function syncScrollElevation(view) {
    if (!view) return;
    const scroller = view.querySelector(':scope > .content, :scope > #chat-messages');
    const top = scroller ? Math.max(0, scroller.scrollTop) : 0;
    view.classList.toggle('is-content-scrolled', top > 2);
    const fade = top > 2 ? Math.min(32, Math.round(top * 0.9)) : 0;
    view.style.setProperty('--scroll-fade', fade + 'px');
  }

  function decorateView(view, route) {
    if (!view) return;
    syncScrollElevation(view);
    if (route?.name === 'chat') {
      animateClassicChatArrivals(view);
      animateComposerTools(view);
    } else {
      lastAnimatedPanelKey = '';
    }
  }

  // Interactive left-edge swipe-back gesture for #view subpages and true full-screen .page-editor overlays.
  // Automatically yields to Android's native predictive-back / edge-swipe system inside PipiPhoneAndroid.
  function bindEdgeSwipeBack() {
    if (isAndroidApp()) return;
    const shell = document.querySelector('.phone-shell');
    const view = document.getElementById('view');
    const overlay = document.getElementById('overlay');
    if (!shell || !view || !overlay) return;

    let indicator = null;
    let swipe = null;
    let rafId = 0;

    function ensureIndicator() {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'ui-swipe-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        indicator.innerHTML = '<svg viewBox="0 0 10 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 2 9l6 7"/></svg>';
        shell.append(indicator);
      }
      return indicator;
    }

    function hideIndicator() {
      if (indicator) {
        indicator.classList.remove('active', 'ready');
        indicator.style.transform = '';
        indicator.style.opacity = '';
      }
    }

    function findSwipeTarget(shellHeight) {
      if (overlay.children.length) {
        const editor = overlay.querySelector(':scope > .page-editor:not(.confirm-dialog)');
        if (!editor || isBottomSheetNode(editor, shellHeight)) return null;
        const closeBtn = editor.querySelector('.modal-header [data-close]');
        if (closeBtn && !closeBtn.disabled) {
          return { el: editor, trigger: closeBtn, isOverlay: true };
        }
        return null;
      }
      const backBtn = view.querySelector(':scope > .topbar .back-btn');
      if (backBtn && !backBtn.disabled && !backBtn.hidden) {
        return { el: view, trigger: backBtn, isOverlay: false };
      }
      return null;
    }

    function paintDrag() {
      rafId = 0;
      if (!swipe || !swipe.locked) return;
      const dx = Math.max(0, swipe.dx);
      const progress = Math.min(1, dx / Math.max(120, swipe.width * 0.34));
      swipe.target.el.style.transform = 'translate3d(' + dx + 'px, 0, 0)';
      const ind = ensureIndicator();
      ind.classList.add('active');
      ind.classList.toggle('ready', progress >= 1);
      ind.style.opacity = String(Math.min(1, progress * 1.15));
      ind.style.transform = 'translate3d(' + Math.round(Math.min(20, dx * 0.16)) + 'px, -50%, 0) scale(' + (0.82 + progress * 0.22).toFixed(3) + ')';
    }

    shell.addEventListener('pointerdown', event => {
      if (isAndroidApp() || reduceMotion.matches || !event.isPrimary || event.button !== 0) return;
      if (event.target && event.target.closest('input, textarea, [contenteditable="true"], [data-record], .image-stage')) return;
      const rect = shell.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      if (localX < 0 || localX > 24) return;
      const target = findSwipeTarget(rect.height);
      if (!target) return;
      swipe = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastTime: performance.now(),
        velocity: 0,
        dx: 0,
        width: rect.width || 360,
        locked: false,
        target
      };
    }, { passive: true });

    shell.addEventListener('pointermove', event => {
      if (!swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.startX;
      const dy = event.clientY - swipe.startY;
      if (!swipe.locked) {
        if (Math.abs(dy) > 14 && Math.abs(dy) >= dx) {
          swipe = null;
          return;
        }
        if (dx > 10 && dx > Math.abs(dy) * 1.35) {
          swipe.locked = true;
          swipe.target.el.classList.add('ui-swipe-dragging');
          try { shell.setPointerCapture(event.pointerId); } catch {}
        } else {
          return;
        }
      }
      const now = performance.now();
      const dt = Math.max(1, now - swipe.lastTime);
      swipe.velocity = (event.clientX - swipe.lastX) / dt;
      swipe.lastX = event.clientX;
      swipe.lastTime = now;
      swipe.dx = Math.max(0, dx);
      if (!rafId) rafId = requestAnimationFrame(paintDrag);
    }, { passive: true });

    function finishSwipe(cancelled) {
      if (!swipe) return;
      const current = swipe;
      swipe = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      hideIndicator();
      if (!current.locked) return;

      const el = current.target.el;
      const shouldCommit = !cancelled && (current.dx > current.width * 0.32 || (current.velocity > 0.45 && current.dx > 34));
      if (shouldCommit) {
        const anim = runSafeAnimate(el, [
          { transform: 'translate3d(' + current.dx + 'px, 0, 0)' },
          { transform: 'translate3d(100%, 0, 0)' }
        ], { duration: 165, easing: EASE_OUT, fill: 'forwards' });
        const complete = () => {
          el.classList.remove('ui-swipe-dragging');
          el.style.transform = '';
          if (anim) { try { anim.cancel(); } catch {} }
          if (current.target.isOverlay) skipNextOverlayExit = true;
          else skipNextBackTransition = true;
          if (current.target.trigger.isConnected) current.target.trigger.click();
        };
        if (anim) {
          anim.onfinish = complete;
          anim.oncancel = complete;
        } else {
          complete();
        }
      } else {
        const anim = runSafeAnimate(el, [
          { transform: 'translate3d(' + current.dx + 'px, 0, 0)' },
          { transform: 'translate3d(0, 0, 0)' }
        ], { duration: 220, easing: EASE_NAV });
        const reset = () => {
          el.classList.remove('ui-swipe-dragging');
          el.style.transform = '';
        };
        if (anim) {
          anim.onfinish = reset;
          anim.oncancel = reset;
        } else {
          reset();
        }
      }
    }

    shell.addEventListener('pointerup', event => { if (swipe && event.pointerId === swipe.id) finishSwipe(false); });
    shell.addEventListener('pointercancel', event => { if (swipe && event.pointerId === swipe.id) finishSwipe(true); });
  }

  function bindScrollAndOverlayObservers() {
    const view = document.getElementById('view');
    const overlay = document.getElementById('overlay');
    let scrollRaf = 0;

    if (view) {
      view.addEventListener('scroll', event => {
        const target = event.target;
        if (!target || (target !== view.querySelector(':scope > .content') && target.id !== 'chat-messages')) return;
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          syncScrollElevation(view);
        });
      }, { capture: true, passive: true });
    }

    if (overlay) {
      // Cancel any ghost exit animation if a brand-new modal opens asynchronously
      new MutationObserver(() => {
        if (overlay.children.length && exitStage && performance.now() - exitCreatedAt > 24) cancelOverlayExit();
      }).observe(overlay, { childList: true });

      overlay.addEventListener('scroll', event => {
        const target = event.target;
        if (!target || !target.classList || !target.classList.contains('modal-body')) return;
        const sheet = target.closest('.modal-sheet, .page-editor');
        if (sheet) sheet.classList.toggle('is-body-scrolled', target.scrollTop > 8);
      }, { capture: true, passive: true });
    }
  }

  function init() {
    bindEdgeSwipeBack();
    bindScrollAndOverlayObservers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.PipiMotion = {
    preparePageTransition,
    cancelPageTransition,
    captureOverlayExit,
    cancelOverlayExit,
    observeChatState,
    decorateView
  };
})();
