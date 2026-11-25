// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const maxZoom = 4;

  function presetConfig(key, cardGuide) {
    if (key === 'cover') {
      return {
        title: '调整朋友圈背景图',
        ratio: 6 / 5,
        exportMaxW: 1280,
        exportMaxH: 1067,
        circleGuide: false,
        cardGuide: Boolean(cardGuide),
        hint: cardGuide ? '拖动或双指缩放，两条虚线之间为名片封面显示范围' : '拖动图片调整位置，双指或滑块缩放',
      };
    }
    if (key === 'chatBackground') {
      const shell = document.querySelector('.phone-shell');
      const rect = shell?.getBoundingClientRect();
      const vw = rect && rect.width > 200 ? rect.width : window.innerWidth || 390;
      const vh = rect && rect.height > 300 ? rect.height : window.innerHeight || 844;
      const ratio = clamp(vw / vh, 9 / 19.5, 9 / 14);
      return {
        title: '调整聊天背景',
        ratio,
        exportMaxW: 1080,
        exportMaxH: 1920,
        circleGuide: false,
        cardGuide: false,
        hint: '拖动和缩放，选取聊天界面显示的背景区域',
      };
    }
    const isWaterdrop = document.documentElement.dataset.skin === 'waterdrop';
    return {
      title: '调整头像',
      ratio: 1,
      exportMaxW: 640,
      exportMaxH: 640,
      circleGuide: isWaterdrop,
      cardGuide: false,
      hint: '拖动图片调整位置，双指或滑块缩放',
    };
  }

  async function pick(file, key, {isCurrent = () => true, parent, cardGuide = true} = {}) {
    const app = window.Pipi;
    const blob = await app.readProfileImage(file, true);
    if (!isCurrent()) return null;
    const moving = app.detectAnimatedImage ? await app.detectAnimatedImage(blob, blob.type) : blob.type === 'image/gif';
    let decoded;
    try {
      decoded = app.decodeImageSource
        ? await app.decodeImageSource(blob)
        : await (async () => {
            const img = new Image();
            img.src = await app.readBlobData(blob);
            await img.decode();
            return { source: img, width: img.naturalWidth || 1, height: img.naturalHeight || 1, close() {} };
          })();
    } catch {
      throw new Error('这张图片无法读取，请重新选图');
    }
    if (!isCurrent()) {
      decoded.close();
      return null;
    }
    if (parent && app.afterOverlayBack) {
      await app.afterOverlayBack();
      if (!isCurrent()) {
        decoded.close();
        return null;
      }
    }
    const img = decoded.source;

    const cfg = presetConfig(key, cardGuide);
    const body = `<div class="life-crop-shell">
      <header class="life-crop-header">
        <h3>${cfg.title}</h3>
        ${moving ? '<button type="button" class="life-crop-keep-anim" data-crop-original>保留原图动画</button>' : ''}
      </header>
      <div class="life-crop-stage">
        <canvas tabindex="0" aria-label="${cfg.title}，拖动调整位置，双指或滑块缩放，方向键可微调"></canvas>
      </div>
      <footer class="life-crop-footer">
        <p class="life-crop-hint">${cfg.hint}${moving ? '（裁切将保存为静态图）' : ''}</p>
        <label class="life-crop-zoom">
          <span>缩放</span>
          <input type="range" min="1" max="${maxZoom}" step="0.01" value="1" aria-label="图片缩放">
          <output>100%</output>
        </label>
        <div class="life-crop-actions">
          <button type="button" class="life-crop-btn" data-crop-cancel>取消</button>
          <button type="button" class="life-crop-btn life-crop-reset" data-crop-reset disabled>还原</button>
          <button type="button" class="life-crop-btn life-crop-confirm" data-crop-confirm>完成</button>
        </div>
      </footer>
    </div>`;

    return new Promise(resolve => {
      let result = null;
      let exporting = false;
      let cleaned = false;
      const dialog = document.createElement('dialog');
      dialog.className = 'life-crop-dialog';
      dialog.setAttribute('aria-label', cfg.title);
      dialog.innerHTML = body;

      const stage = dialog.querySelector('.life-crop-stage');
      const canvas = stage.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const range = dialog.querySelector('.life-crop-zoom input');
      const output = dialog.querySelector('.life-crop-zoom output');
      const resetBtn = dialog.querySelector('[data-crop-reset]');
      const confirmBtn = dialog.querySelector('[data-crop-confirm]');
      const cancelBtn = dialog.querySelector('[data-crop-cancel]');
      const originalBtn = dialog.querySelector('[data-crop-original]');

      const natW = Math.max(1, decoded.width);
      const natH = Math.max(1, decoded.height);
      const ratio = cfg.ratio;
      // Cover-fit source window at zoom = 1: largest rectangle with `ratio` inside image.
      const fitWidth = Math.min(natW, natH * ratio);
      const fitHeight = fitWidth / ratio;
      let centerX = natW / 2;
      let centerY = natH / 2;
      let zoom = 1;
      let interacting = false;
      let idleTimer = 0;

      // Computed stage geometry (in CSS pixels relative to canvas).
      let stageW = 320, stageH = 420, dpr = 1;
      let boxX = 28, boxY = 40, boxW = 264, boxH = 264;

      function measureStage() {
        const rect = stage.getBoundingClientRect();
        stageW = Math.max(220, Math.round(rect.width || window.innerWidth || 360));
        stageH = Math.max(220, Math.round(rect.height || Math.round((window.innerHeight || 640) * 0.65)));
        dpr = Math.min(window.devicePixelRatio || 1, 3);
        const padX = Math.max(28, Math.round(stageW * 0.075));
        const padY = Math.max(20, Math.round(stageH * 0.055));
        const availW = Math.max(140, stageW - padX * 2);
        const availH = Math.max(140, stageH - padY * 2);
        if (availW / availH > ratio) {
          boxH = availH;
          boxW = boxH * ratio;
        } else {
          boxW = availW;
          boxH = boxW / ratio;
        }
        boxX = (stageW - boxW) / 2;
        boxY = (stageH - boxH) / 2;
        const targetW = Math.round(stageW * dpr);
        const targetH = Math.round(stageH * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
      }

      function clampCenter() {
        const w = fitWidth / zoom;
        const h = fitHeight / zoom;
        centerX = clamp(centerX, w / 2, natW - w / 2);
        centerY = clamp(centerY, h / 2, natH - h / 2);
        return { w, h };
      }

      function isDefaultState() {
        return Math.abs(zoom - 1) < 0.005 && Math.abs(centerX - natW / 2) < 1 && Math.abs(centerY - natH / 2) < 1;
      }

      function paint() {
        const { w, h } = clampCenter();
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, stageW, stageH);

        // Draw full image across stage so user sees surrounding context under scrim.
        const scale = boxW / w; // CSS px per source px
        const drawW = natW * scale;
        const drawH = natH * scale;
        const drawX = boxX + boxW / 2 - centerX * scale;
        const drawY = boxY + boxH / 2 - centerY * scale;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        // Dim outside the crop frame with translucent scrim.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
        ctx.beginPath();
        ctx.rect(0, 0, stageW, stageH);
        ctx.rect(boxX, boxY, boxW, boxH);
        ctx.fill('evenodd');

        // Optional circular avatar preview ring (Waterdrop skin).
        if (cfg.circleGuide) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(boxX + boxW / 2, boxY + boxH / 2, Math.min(boxW, boxH) / 2 - 1, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Optional compact profile card 2.4:1 band inside 6:5 cover.
        if (cfg.cardGuide) {
          const y1 = boxY + boxH * 0.25;
          const y2 = boxY + boxH * 0.75;
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(boxX, y1); ctx.lineTo(boxX + boxW, y1);
          ctx.moveTo(boxX, y2); ctx.lineTo(boxX + boxW, y2);
          ctx.stroke();
          ctx.restore();
        }

        // 3x3 rule-of-thirds grid (crisper while actively moving/zooming).
        ctx.strokeStyle = interacting ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        for (let i = 1; i <= 2; i++) {
          const gx = boxX + (boxW * i) / 3;
          const gy = boxY + (boxH * i) / 3;
          ctx.moveTo(gx, boxY); ctx.lineTo(gx, boxY + boxH);
          ctx.moveTo(boxX, gy); ctx.lineTo(boxX + boxW, gy);
        }
        ctx.stroke();

        // Crisp 1px crop frame border.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

        // WeChat-style white corner L-brackets.
        const arm = Math.min(20, Math.round(Math.min(boxW, boxH) * 0.14));
        const thick = 3;
        ctx.fillStyle = '#fff';
        // Top-left
        ctx.fillRect(boxX - 1, boxY - 1, arm, thick);
        ctx.fillRect(boxX - 1, boxY - 1, thick, arm);
        // Top-right
        ctx.fillRect(boxX + boxW + 1 - arm, boxY - 1, arm, thick);
        ctx.fillRect(boxX + boxW + 1 - thick, boxY - 1, thick, arm);
        // Bottom-left
        ctx.fillRect(boxX - 1, boxY + boxH + 1 - thick, arm, thick);
        ctx.fillRect(boxX - 1, boxY + boxH + 1 - arm, thick, arm);
        // Bottom-right
        ctx.fillRect(boxX + boxW + 1 - arm, boxY + boxH + 1 - thick, arm, thick);
        ctx.fillRect(boxX + boxW + 1 - thick, boxY + boxH + 1 - arm, thick, arm);

        ctx.restore();

        range.value = String(zoom);
        output.value = Math.round(zoom * 100) + '%';
        resetBtn.disabled = isDefaultState();
      }

      function bumpInteracting() {
        interacting = true;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { interacting = false; if (dialog.isConnected) paint(); }, 220);
      }

      function zoomAt(nextZoom, clientX, clientY) {
        const oldZoom = zoom;
        zoom = clamp(nextZoom, 1, maxZoom);
        if (Math.abs(zoom - oldZoom) < 0.0001) return;
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
          const rect = canvas.getBoundingClientRect();
          const cx = rect.left + boxX + boxW / 2;
          const cy = rect.top + boxY + boxH / 2;
          centerX += ((clientX - cx) / oldZoom - (clientX - cx) / zoom) * (fitWidth / boxW);
          centerY += ((clientY - cy) / oldZoom - (clientY - cy) / zoom) * (fitHeight / boxH);
        }
        bumpInteracting();
        paint();
      }

      async function exportCropped() {
        const { w, h } = clampCenter();
        const unchangedRatio = Math.abs(fitWidth - natW) < 1 && Math.abs(fitHeight - natH) < 1;
        if (!moving && isDefaultState() && unchangedRatio && natW <= cfg.exportMaxW && natH <= cfg.exportMaxH && blob.size <= 2 * 1024 * 1024) {
          return app.readBlobData(blob);
        }
        const scaleDown = Math.min(1, cfg.exportMaxW / w, cfg.exportMaxH / h);
        const outW = Math.max(1, Math.round(w * scaleDown));
        const outH = Math.max(1, Math.round(h * scaleDown));
        const out = document.createElement('canvas');
        out.width = outW;
        out.height = outH;
        const outCtx = out.getContext('2d');
        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = 'high';
        outCtx.drawImage(img, centerX - w / 2, centerY - h / 2, w, h, 0, 0, outW, outH);
        const alpha = blob.type === 'image/png' || blob.type === 'image/webp';
        const encoded = app.encodeCanvas
          ? await app.encodeCanvas(out, { quality: 0.92, preferWebp: true, alpha })
          : await new Promise(res => out.toBlob(res, 'image/jpeg', 0.92));
        if (!encoded) throw new Error('裁切图片保存失败，请重试');
        return app.readBlobData(encoded);
      }

      const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => { if (dialog.isConnected) { measureStage(); paint(); } })
        : null;
      const onResize = () => { if (dialog.isConnected) { measureStage(); paint(); } };

      const finish = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(idleTimer);
        resizeObserver?.disconnect();
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        decoded.close();
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(result);
      };
      const close = parent ? () => app.closeChildDialog() : () => app.closeModal();
      const onVisibilityChange = () => {
        if (document.hidden && !exporting) close();
      };

      dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
      cancelBtn.onclick = () => { if (!exporting) close(); };
      resetBtn.onclick = () => {
        if (exporting) return;
        centerX = natW / 2;
        centerY = natH / 2;
        zoom = 1;
        bumpInteracting();
        paint();
      };
      confirmBtn.onclick = async () => {
        if (exporting) return;
        exporting = true;
        confirmBtn.disabled = cancelBtn.disabled = resetBtn.disabled = true;
        if (originalBtn) originalBtn.disabled = true;
        try {
          result = await exportCropped();
          close();
        } catch (error) {
          exporting = false;
          confirmBtn.disabled = cancelBtn.disabled = false;
          resetBtn.disabled = isDefaultState();
          if (originalBtn) originalBtn.disabled = false;
          app.toast(error.message || '图片处理失败');
        }
      };
      if (originalBtn) {
        originalBtn.onclick = async () => {
          if (exporting) return;
          exporting = true;
          confirmBtn.disabled = cancelBtn.disabled = originalBtn.disabled = true;
          try {
            result = await app.readBlobData(blob);
            close();
          } catch (error) {
            exporting = false;
            confirmBtn.disabled = cancelBtn.disabled = originalBtn.disabled = false;
            app.toast(error.message || '图片读取失败');
          }
        };
      }

      range.oninput = () => {
        zoom = clamp(Number(range.value) || 1, 1, maxZoom);
        bumpInteracting();
        paint();
      };

      const pointers = new Map();
      let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
      let downX = 0, downY = 0, moved = false;

      function gesture() {
        const [a, b] = pointers.values();
        return b
          ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
          : { x: a.x, y: a.y, distance: 0 };
      }

      canvas.onpointerdown = event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (pointers.size >= 2) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 1) {
          downX = event.clientX;
          downY = event.clientY;
          moved = false;
        } else {
          moved = true;
        }
        try { canvas.setPointerCapture(event.pointerId); } catch {}
        bumpInteracting();
        paint();
      };

      canvas.onpointermove = event => {
        if (!pointers.has(event.pointerId)) return;
        const before = gesture();
        const oldZoom = zoom;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = gesture();
        if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) moved = true;
        if (pointers.size === 2 && before.distance >= 4 && after.distance >= 4) {
          zoom = clamp(zoom * (after.distance / before.distance), 1, maxZoom);
        }
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + boxX + boxW / 2;
        const cy = rect.top + boxY + boxH / 2;
        centerX += ((before.x - cx) / oldZoom - (after.x - cx) / zoom) * (fitWidth / boxW);
        centerY += ((before.y - cy) / oldZoom - (after.y - cy) / zoom) * (fitHeight / boxH);
        bumpInteracting();
        paint();
      };

      const endPointer = event => {
        if (!pointers.has(event.pointerId)) return;
        const wasSingle = pointers.size === 1;
        pointers.delete(event.pointerId);
        if (wasSingle && !moved && event.type === 'pointerup') {
          const now = Date.now();
          if (now - lastTapTime < 300 && Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) < 32) {
            lastTapTime = 0;
            zoomAt(zoom > 1.25 ? 1 : 2, event.clientX, event.clientY);
          } else {
            lastTapTime = now;
            lastTapX = event.clientX;
            lastTapY = event.clientY;
          }
        }
        if (!pointers.size) {
          clearTimeout(idleTimer);
          interacting = false;
          if (dialog.isConnected) paint();
        }
      };
      canvas.onpointerup = endPointer;
      canvas.onpointercancel = endPointer;
      canvas.onlostpointercapture = endPointer;

      canvas.addEventListener('wheel', event => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(zoom * factor, event.clientX, event.clientY);
      }, { passive: false });

      canvas.onkeydown = event => {
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (delta) {
          event.preventDefault();
          centerX -= (delta[0] * fitWidth) / zoom / 40;
          centerY -= (delta[1] * fitHeight) / zoom / 40;
          bumpInteracting();
          paint();
          return;
        }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(zoom + 0.2); }
        else if (event.key === '-') { event.preventDefault(); zoomAt(zoom - 0.2); }
        else if (event.key === '0') { event.preventDefault(); resetBtn.click(); }
      };

      if (parent) {
        parent.append(dialog);
        dialog.addEventListener('close', finish, { once: true });
        if (!app.openChildDialog(dialog)) { finish(); return; }
      } else {
        app.openModal(cfg.title, '', null, undefined, finish);
        document.querySelector('#overlay .modal-sheet')?.remove();
        document.querySelector('#overlay').append(dialog);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.showModal();
      }
      resizeObserver?.observe(stage);
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVisibilityChange);
      requestAnimationFrame(() => {
        if (!dialog.isConnected) return;
        measureStage();
        paint();
        canvas.focus({ preventScroll: true });
      });
    });
  }

  window.PipiLifeCrop = { pick };
})();
