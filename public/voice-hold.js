(() => {
  'use strict';

  const labels = {voice: '松开 发送', cancel: '松开 取消', text: '松开 转文字'};
  const barHeights = [3, 4, 7, 11, 5, 15, 10, 6, 18, 12, 5, 9, 4, 3, 2];

  function buildSurface(host) {
    const surface = document.createElement('div');
    surface.className = 'vg-surface';
    surface.dataset.mode = 'voice';
    surface.innerHTML = `
      <div class="vg-stage">
        <div class="vg-bubble" aria-hidden="true"><div class="vg-wave"></div></div>
        <div class="vg-targets" aria-hidden="true">
          <div class="vg-target" data-mode="cancel"><span>取消</span><i class="vg-cancel-icon"></i></div>
          <div class="vg-target" data-mode="text"><span>转文字 发送</span><i>文</i></div>
        </div>
        <div class="vg-send-area">
          <span class="vg-release-hint" role="status" aria-live="polite">松开 发送</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 10a3 3 0 0 1 0 4m3-7a8 8 0 0 1 0 10m3-13a12 12 0 0 1 0 16"/></svg>
        </div>
      </div>`;
    const wave = surface.querySelector('.vg-wave');
    barHeights.forEach((height, index) => {
      const bar = document.createElement('i');
      bar.style.height = height + 'px';
      bar.style.animationDelay = (-index * 0.13) + 's';
      wave.append(bar);
    });
    host.append(surface);
    return surface;
  }

  function bind({button, host, begin, onError}) {
    let active = null;
    let finishing = false;
    button.classList.add('vg-hold');
    button.setAttribute('aria-pressed', 'false');

    function select(session, mode) {
      if (session.mode === mode) return;
      session.mode = mode;
      session.surface.dataset.mode = mode;
      session.hint.textContent = labels[mode];
    }

    function modeAt(session, x, y) {
      const bounds = host.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return 'cancel';
      const actions = session.targets.getBoundingClientRect();
      if (y > actions.bottom + 12 || session.startY - y < 24) return 'voice';
      const fraction = (x - bounds.left) / bounds.width;
      if (fraction <= 0.39) return 'cancel';
      if (fraction >= 0.61) return 'text';
      return 'voice';
    }

    function dismiss(session) {
      if (active !== session) return;
      active = null;
      clearTimeout(session.permissionHint);
      cancelAnimationFrame(session.frame);
      session.surface.remove();
      session.events.abort();
      button.setAttribute('aria-pressed', 'false');
      if (session.id !== 'keyboard' && button.hasPointerCapture(session.id)) {
        button.releasePointerCapture(session.id);
      }
    }

    function cancel() {
      if (!active) return;
      const session = active;
      dismiss(session);
      session.abort.abort();
    }

    async function start(id, y) {
      if (active || finishing || button.disabled) return;
      const surface = buildSurface(host);
      const session = {
        id, startY: y, mode: 'voice', surface, abort: new AbortController(), events: new AbortController(), frame: 0,
        targets: surface.querySelector('.vg-targets'), hint: surface.querySelector('.vg-release-hint'),
      };
      active = session;
      window.addEventListener('blur', cancel, {signal:session.events.signal});
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
      }, {capture:true,signal:session.events.signal});
      button.setAttribute('aria-pressed', 'true');
      try {
        if (id !== 'keyboard') button.setPointerCapture(id);
        session.permissionHint = setTimeout(() => {
          if (session.mode === 'voice') session.hint.textContent = '正在开启麦克风…';
        }, 400);
        const recorder = await begin({signal:session.abort.signal, dismiss:()=>dismiss(session),
          capped:()=>{session.hint.textContent='已录满 60 秒，松手选择发送';}});
        if (active !== session) return;
        if (!recorder) { cancel(); return; }
        clearTimeout(session.permissionHint);
        session.hint.textContent = labels[session.mode];
        session.recorder = recorder;
        if (recorder.level) {
          const wave = surface.querySelector('.vg-wave');
          wave.classList.add('vg-wave-live');
          const animate = () => {
            wave.style.setProperty('--vg-volume', String(0.15 + 0.85 * Math.min(1, Math.max(0, recorder.level()))));
            session.frame = requestAnimationFrame(animate);
          };
          animate();
        }
      } catch (error) {
        if (active === session) {
          cancel();
          onError(error);
        }
      }
    }

    async function finish() {
      const session = active;
      if (!session) return;
      if (session.mode === 'cancel' || !session.recorder) {
        cancel();
        return;
      }
      dismiss(session);
      finishing = true;
      try {
        await session.recorder.stop(session.mode);
      } catch (error) {
        onError(error);
      } finally {
        finishing = false;
      }
    }

    button.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      start(event.pointerId, event.clientY);
    });
    button.addEventListener('pointermove', event => {
      if (active?.id === event.pointerId) select(active, modeAt(active, event.clientX, event.clientY));
    });
    button.addEventListener('pointerup', event => {
      if (active?.id !== event.pointerId) return;
      select(active, modeAt(active, event.clientX, event.clientY));
      finish();
    });
    for (const type of ['pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => { if (active?.id === event.pointerId) cancel(); });
    }
    button.addEventListener('contextmenu', event => event.preventDefault());
    button.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) start('keyboard', 0);
      } else if (active?.id === 'keyboard') {
        const mode = {ArrowLeft:'cancel', ArrowRight:'text', ArrowDown:'voice'}[event.key];
        if (mode) { event.preventDefault(); select(active, mode); }
      }
    });
    button.addEventListener('keyup', event => {
      if (active?.id === 'keyboard' && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        finish();
      }
    });
  }
  window.PipiVoiceHold = {bind};
})();
