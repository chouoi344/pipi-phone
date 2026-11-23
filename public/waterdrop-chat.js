/* SPDX-License-Identifier: AGPL-3.0-only
 * Chat-only waterdrop decoration. Requests, drafts and message actions remain
 * owned by app.js; the real engine progress is the only typing signal.
 */
(() => {
  'use strict';
  const arrivals = new Map();
  const waiting = new Map();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let connected = true;
  const enabled = view => document.documentElement.dataset.skin === 'waterdrop' && view.dataset.route === 'chat';

  function observeState(previous, next, view) {
    for (const [id, arrival] of arrivals) if (arrival.until < Date.now()) arrivals.delete(id);
    for (const id of waiting.keys()) if (!next.messages.some(message => message.id === id && message.status === 'pending')) waiting.delete(id);
    if (enabled(view)) paintWaiting(view, window.PipiEngine.isTyping(view.dataset.chatRole));
    if (!previous || !enabled(view) || !connected || document.hidden) return;
    const known = new Map(previous.messages.map(message => [message.id, message]));
    for (const message of next.messages) {
      if (message.roleId !== view.dataset.chatRole) continue;
      if (message.sender === 'user' && message.status === 'pending' && known.get(message.id)?.status !== 'pending') waiting.set(message.id, message.roleId);
      if (message.sender !== 'system' && !known.has(message.id) && !motion.matches) {
        arrivals.set(message.id, {roleId: message.roleId, until: Date.now() + 1200});
      }
    }
  }

  function paintWaiting(view, typing) {
    for (const label of view.querySelectorAll('.waterdrop-waiting')) label.remove();
    if (typing || !connected) return;
    const rows = [...view.querySelectorAll('.message-row[data-message]')];
    const row = rows.findLast(item => waiting.get(item.dataset.message) === view.dataset.chatRole);
    if (!row) return;
    const label = document.createElement('span');
    label.className = 'waterdrop-waiting';
    label.setAttribute('role', 'status');
    label.textContent = '等待回复';
    row.querySelector('.message-body').append(label);
  }

  function updateTyping(view) {
    if (!enabled(view)) return;
    const title = view.querySelector(':scope > .topbar h2');
    const typing = window.PipiEngine.isTyping(view.dataset.chatRole);
    if (typing) for (const [id, roleId] of waiting) if (roleId === view.dataset.chatRole) waiting.delete(id);
    if (title) title.classList.toggle('waterdrop-awaiting', typing);
    paintWaiting(view, typing);
  }

  function decorate(view) {
    if (!enabled(view)) {
      arrivals.clear();
      waiting.clear();
      if (view.dataset.route === 'chat') {
        view.querySelector('.waterdrop-waiting')?.remove();
        view.querySelector('.waterdrop-awaiting')?.classList.remove('waterdrop-awaiting');
        view.style.removeProperty('--waterdrop-chat-wallpaper');
        view.classList.remove('has-custom-wallpaper');
      }
      return;
    }
    for (const [id, roleId] of waiting) if (roleId !== view.dataset.chatRole) waiting.delete(id);
    for (const [id, arrival] of arrivals) if (arrival.roleId !== view.dataset.chatRole) arrivals.delete(id);
    const list = view.querySelector('#chat-messages');
    if (!list) return;
    // app.js has already validated this image at the rendering boundary. A
    // single wallpaper behind the entire chat keeps the glass areas continuous.
    const hasCustomWallpaper = Boolean(list.style.backgroundImage);
    view.classList.toggle('has-custom-wallpaper', hasCustomWallpaper);
    if (hasCustomWallpaper) view.style.setProperty('--waterdrop-chat-wallpaper', list.style.backgroundImage);
    else view.style.removeProperty('--waterdrop-chat-wallpaper');
    updateTyping(view);
    let order = 0;
    for (const row of list.querySelectorAll('.message-row[data-message]')) {
      const arrival = arrivals.get(row.dataset.message);
      if (!arrival) continue;
      arrivals.delete(row.dataset.message);
      if (arrival.roleId !== view.dataset.chatRole || arrival.until < Date.now() || motion.matches) continue;
      row.animate([
        {opacity: .65, transform: 'translateY(7px) scale(.992)'},
        {opacity: 1, transform: 'translateY(0) scale(1)'}
      ], {duration: 180, delay: Math.min(order++ * 35, 140), easing: 'cubic-bezier(.22,1,.36,1)'});
    }
  }

  function setConnected(value) {
    connected = value;
    if (!value) { waiting.clear(); arrivals.clear(); }
    const view = document.querySelector('#view');
    if (view) updateTyping(view);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    waiting.clear(); arrivals.clear();
    const view = document.querySelector('#view');
    if (view) paintWaiting(view, false);
  });
  window.addEventListener('pagehide', () => { waiting.clear(); arrivals.clear(); });
  window.WaterdropChat = {observeState, decorate, updateTyping, setConnected};
})();
