// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const maxZoom = 4;

  // Animated PNG declares acTL before its first IDAT. Animated WebP sets the VP8X flag.
  async function mayAnimate(file, type) {
    if (type === 'image/gif') return true;
    if (type === 'image/webp') {
      const header = new Uint8Array(await file.slice(0, 21).arrayBuffer());
      return header[12] === 86 && header[15] === 88 && !!(header[20] & 2);
    }
    if (type !== 'image/png') return false;
    const data = new DataView(await file.arrayBuffer());
    for (let offset = 8; offset + 12 <= data.byteLength; offset += data.getUint32(offset) + 12) {
      const type = data.getUint32(offset + 4);
      if (type === 0x6163544c) return true;
      if (type === 0x49444154) break;
    }
    return false;
  }

  async function pick(file, key, {isCurrent = () => true, parent, cardGuide = true} = {}) {
    const app = window.Pipi;
    const cover = key === 'cover';
    const original = await app.readProfileImage(file);
    const img = new Image();
    img.src = original;
    try { await img.decode(); }
    catch { throw new Error('这张图片无法读取，请重新选图'); }
    const moving = await mayAnimate(file, original.slice(5, original.indexOf(';')));
    if (!isCurrent()) return null;
    // Match the cover viewport in features.css. Avatars remain square.
    const ratio = cover ? 6 / 5 : 1;
    const showGuide = cover && cardGuide;
    const title = cover ? '调整朋友圈背景图' : '调整头像';
    const body = `<header class="life-crop-header"><button type="button" data-crop-cancel>取消</button><h3>${title}</h3><button type="button" data-crop-confirm>确定</button></header><div class="life-crop">
      <div class="life-crop-frame${cover ? ' life-crop-cover' : ''}${showGuide ? ' life-crop-card-guide' : ''}">
        <canvas tabindex="0" aria-label="图片取景区域，方向键可移动图片"></canvas>
      </div>
      <p>拖动图片调整位置，双指或滑块缩放。${showGuide ? '两条横线之间是名片封面的显示范围。' : ''}</p>
      <label class="life-crop-zoom"><span>缩放</span><input type="range" min="1" max="${maxZoom}" step="0.01" value="1" aria-label="图片缩放"><output>100%</output></label>
      ${moving ? '<div class="life-crop-animation"><span>裁切会保存为静态图片。</span><button type="button">保留原图动画</button></div>' : ''}
    </div>`;
    return new Promise(resolve => {
      let result = null;
      const dialog = document.createElement('dialog');
      dialog.className = 'life-crop-dialog';
      dialog.setAttribute('aria-label', title);
      dialog.innerHTML = body;
      const finish = () => {
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(result);
      };
      const close = parent ? () => app.closeChildDialog() : () => app.closeModal();
      dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
      const outside = event => {
        if (event.target !== dialog) return false;
        const {left, right, top, bottom} = dialog.getBoundingClientRect();
        return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
      };
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', event => { pressedOutside = outside(event); });
      dialog.addEventListener('click', event => { if (pressedOutside && outside(event)) close(); });
      dialog.querySelector('[data-crop-cancel]').onclick = close;
      dialog.querySelector('[data-crop-confirm]').onclick = () => {
        result = zoom === 1 && fitWidth === img.naturalWidth && fitHeight === img.naturalHeight
          ? original : canvas.toDataURL('image/webp', 0.94);
        close();
      };
      const root = dialog.querySelector('.life-crop');
      const canvas = root.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const range = root.querySelector('input');
      const output = root.querySelector('output');
      const fitWidth = Math.min(img.naturalWidth, img.naturalHeight * ratio);
      const fitHeight = fitWidth / ratio;
      canvas.width = Math.max(1, Math.round(Math.min(cover ? 1280 : 640, fitWidth)));
      canvas.height = Math.max(1, Math.round(canvas.width / ratio));
      let centerX = img.naturalWidth / 2, centerY = img.naturalHeight / 2, zoom = 1;

      function paint() {
        const w = fitWidth / zoom, h = fitHeight / zoom;
        centerX = clamp(centerX, w / 2, img.naturalWidth - w / 2);
        centerY = clamp(centerY, h / 2, img.naturalHeight - h / 2);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, centerX - w / 2, centerY - h / 2, w, h, 0, 0, canvas.width, canvas.height);
        range.value = String(zoom);
        output.value = Math.round(zoom * 100) + '%';
      }
      paint();
      range.oninput = () => { zoom = Number(range.value); paint(); };
      if (moving) root.querySelector('button').onclick = () => { result = original; close(); };
      const pointers = new Map();
      function gesture() {
        const [a, b] = pointers.values();
        return b ? {x:(a.x + b.x) / 2, y:(a.y + b.y) / 2, distance:Math.hypot(a.x - b.x, a.y - b.y)} : a;
      }
      canvas.onpointerdown = event => {
        if (event.button !== 0 || pointers.size >= 2) return;
        pointers.set(event.pointerId, {x:event.clientX, y:event.clientY});
        canvas.setPointerCapture(event.pointerId);
      };
      canvas.onpointermove = event => {
        if (!pointers.has(event.pointerId)) return;
        const before = gesture(), oldZoom = zoom;
        pointers.set(event.pointerId, {x:event.clientX, y:event.clientY});
        const after = gesture(), rect = canvas.getBoundingClientRect();
        if (before.distance > 0) zoom = clamp(zoom * after.distance / before.distance, 1, maxZoom);
        // Keep the same source pixel under the drag or pinch midpoint.
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        centerX += ((before.x - x) / oldZoom - (after.x - x) / zoom) * fitWidth / rect.width;
        centerY += ((before.y - y) / oldZoom - (after.y - y) / zoom) * fitHeight / rect.height;
        paint();
      };
      canvas.onpointerup = event => pointers.delete(event.pointerId);
      canvas.onpointercancel = event => pointers.delete(event.pointerId);
      canvas.onlostpointercapture = event => pointers.delete(event.pointerId);
      canvas.onkeydown = event => {
        const delta = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[event.key];
        if (!delta) return;
        event.preventDefault();
        centerX -= delta[0] * fitWidth / zoom / 40;
        centerY -= delta[1] * fitHeight / zoom / 40;
        paint();
      };
      if (parent) {
        parent.append(dialog);
        dialog.addEventListener('close', finish, {once:true});
        if (!app.openChildDialog(dialog)) finish();
      } else {
        app.openModal(title, '', null, undefined, finish);
        document.querySelector('#overlay .modal-sheet').remove();
        document.querySelector('#overlay').append(dialog);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.showModal();
      }
    });
  }
  window.PipiLifeCrop = {pick};
})();
