// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Foreground notices share the existing authenticated state feed in web and App.
(() => {
  let adapter, notification, noticeTimer, latestAt = 0, seeded = false;
  const seen = new Set();
  const incoming = message => message.status === 'sent' && (message.sender === 'assistant' || message.sender === 'system' && message.meta?.kind === 'pat' && message.meta.author === message.roleId);
  function remember(state) { for (const message of state.messages) { latestAt = Math.max(latestAt, message.createdAt); if (incoming(message)) seen.add(message.id); } seeded = true; }
  function dismiss() { notification?.remove(); notification = null; clearTimeout(noticeTimer); }
  function clear() { dismiss(); seen.clear(); latestAt = 0; seeded = false; }
  function rebase(state) { clear(); remember(state); }
  function quiet(state, at = Date.now()) {
    const settings = state.settings?.modules?.outreach;
    if (!settings?.quietHoursEnabled) return false;
    const values = [settings.quietStart, settings.quietEnd];
    if (!values.every(value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) return false;
    const parts = new Intl.DateTimeFormat('en-GB', {timeZone:state.settings.timezone || 'UTC', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(at);
    const minute = Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
    const [start, end] = values.map(value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)));
    return start < end ? minute >= start && minute < end : start > end && (minute >= start || minute < end);
  }
  function observeState(previous, next, candidates = next.messages) {
    if (!previous) { rebase(next); return; }
    if (!seeded) remember(previous);
    const after = latestAt;
    const roles = new Map(next.roles.map(role => [role.id, role]));
    const silent = document.hidden || quiet(next), showing = notification && roles.get(notification.dataset.roleId);
    if (notification && (silent || !showing || !(showing.unread > 0) || showing.muted || showing.deleted || showing.permissions?.blocked || adapter.visibleChat(showing.id))) dismiss();
    let message;
    for (const candidate of candidates) {
      latestAt = Math.max(latestAt, candidate.createdAt);
      if (!incoming(candidate) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const role = roles.get(candidate.roleId);
      if (candidate.createdAt < after || !role || !(role.unread > 0) || role.muted || role.deleted || role.permissions?.blocked || adapter.visibleChat(candidate.roleId)) continue;
      message = candidate;
    }
    if (!message || silent) return;
    const role = roles.get(message.roleId);
    if (notification?.isConnected && notification.classList.contains('android-notice-dragging')) return;
    notification?.remove(); clearTimeout(noticeTimer);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'android-chat-notice'; button.dataset.roleId = role.id;
    const title = document.createElement('strong'), preview = document.createElement('span');
    title.textContent = role.remark || role.name; preview.textContent = message.type === 'text' ? message.content.slice(0, 120) : message.type === 'image' && message.meta?.stickerId ? '[表情]' : ({voice:'[语音]', image:'[图片]', transfer:'[转账]', redpacket:'[红包]', forward:'[聊天记录]'})[message.type] || '收到新消息';
    const previousFocus = document.activeElement;
    let pointer = null, moved = false, suppressClick = false;
    const dismissButton = () => {
      button.remove();
      if (notification === button) { notification = null; clearTimeout(noticeTimer); }
    };
    button.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0) return;
      clearTimeout(noticeTimer); pointer = {id:event.pointerId, x:event.clientX, y:event.clientY}; moved = false; suppressClick = false;
      button.classList.add('android-notice-dragging'); button.setPointerCapture(event.pointerId);
    };
    button.onpointermove = event => {
      if (pointer?.id !== event.pointerId) return;
      const x = event.clientX - pointer.x, y = event.clientY - pointer.y;
      moved = moved || Math.abs(x) > 8 || Math.abs(y) > 8;
      button.style.setProperty('--android-notice-shift', `${y < 0 && -y > Math.abs(x) ? y : 0}px`);
    };
    button.addEventListener('touchmove', event => {
      if (!pointer) return;
      const touch = event.changedTouches[0], x = touch.clientX - pointer.x, y = touch.clientY - pointer.y;
      if (event.cancelable && Math.abs(y) > 8 && Math.abs(y) > Math.abs(x)) event.preventDefault();
    }, {passive:false});
    const finish = event => {
      if (pointer?.id !== event.pointerId) return;
      const x = event.clientX - pointer.x, y = event.clientY - pointer.y, cancelled = event.type !== 'pointerup';
      moved = moved || Math.abs(x) > 8 || Math.abs(y) > 8;
      pointer = null; suppressClick = cancelled || moved;
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      button.classList.remove('android-notice-dragging'); button.style.removeProperty('--android-notice-shift');
      // Keep the original hit target through the release/click sequence, so the swipe cannot hit the page underneath.
      if (!cancelled && moved && y <= -32 && -y > Math.abs(x) * 1.25) requestAnimationFrame(dismissButton);
      else noticeTimer = setTimeout(dismissButton, 5000);
    };
    button.onpointerup = finish; button.onpointercancel = finish; button.onlostpointercapture = finish;
    button.append(title, preview); button.setAttribute('aria-label', `打开${title.textContent}的聊天`);
    button.onclick = event => { if (suppressClick && event?.detail !== 0) { event.preventDefault(); event.stopPropagation(); return; } if (adapter.openChat(role.id)) dismissButton(); };
    button.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true}); dismissButton(); } };
    document.querySelector('.phone-shell').append(button); notification = button;
    noticeTimer = setTimeout(dismissButton, 5000);
  }
  function navigated() { if (notification && adapter.visibleChat(notification.dataset.roleId)) dismiss(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) dismiss(); });
  window.PipiChatNotice = Object.freeze({observeState, navigated, clear, rebase, dismiss, connect(value) { adapter = value; }});
})();
(() => {
  if (!/\bPipiPhoneAndroid\/1(?:\.|\b)/.test(navigator.userAgent)) return;
  document.documentElement.dataset.pipiAndroid = 'true';
  const storageKey = 'pipi.android-page.v1', maxAge = 7 * 86400000;
  const pageNames = new Set(['chats', 'chat', 'contacts', 'discover', 'me']);
  const snapshots = new Map();
  let adapter, scope = '', saved = null, restored = false, gesture = null, saveTimer, storageWarned = false;
  let pendingChat = '', offlineRole = '', offline = false, pickedPhoto = null;
  const view = () => document.getElementById('view');
  const pageKey = page => JSON.stringify([page.name, page.arg]);
  const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
  function cleanPage(page) {
    if (!pageNames.has(page?.name)) return {name:'chats', arg:null};
    return page.name === 'chat' && typeof page.arg === 'string' && page.arg.length <= 200
      ? {name:'chat', arg:page.arg} : {name:page.name === 'chat' ? 'chats' : page.name, arg:null};
  }
  // This is the only persistent-cache input boundary. Never spread app state,
  // model drafts, attachments, auth tokens or arbitrary route arguments here.
  function cleanCheckpoint(input) {
    const output = {route:cleanPage(input?.route), stack:[], drafts:[], chats:[], contacts:[], chatsTop:number(input?.chatsTop), contactsTop:number(input?.contactsTop)};
    output.contacts = (Array.isArray(input?.contacts) ? input.contacts : []).slice(0, 200)
      .filter(contact => typeof contact?.roleId === 'string' && contact.roleId.length <= 200)
      .map(contact => ({roleId:contact.roleId, name:text(contact.name, 120)}));
    output.stack = (Array.isArray(input?.stack) ? input.stack : []).slice(-12).filter(page => pageNames.has(page?.name)).map(cleanPage);
    for (const draft of (Array.isArray(input?.drafts) ? input.drafts : []).slice(-200)) {
      if (typeof draft?.roleId !== 'string' || draft.roleId.length > 200) continue;
      const value = text(draft.text, 20000);
      if (value) output.drafts.push({roleId:draft.roleId, text:value});
    }
    let messageBudget = 600000;
    for (const chat of (Array.isArray(input?.chats) ? input.chats : []).slice(-8)) {
      if (typeof chat?.roleId !== 'string' || chat.roleId.length > 200) continue;
      output.chats.push({roleId:chat.roleId, name:text(chat.name, 120), top:number(chat.top), bottom:chat.bottom === true,
        anchor:text(chat.anchor, 200), afterAnchor:text(chat.afterAnchor, 200), offset:Number.isFinite(chat.offset) ? chat.offset : 0,
        limit:Number.isSafeInteger(chat.limit) ? Math.min(10000, Math.max(120, chat.limit)) : 120,
        endId:text(chat.endId, 200), messages:(Array.isArray(chat.messages) ? chat.messages : []).slice(-100)
          .filter(message => typeof message?.id === 'string' && typeof message.content === 'string')
          .map(message => {
            const content = message.content.length <= Math.min(20000, messageBudget) ? message.content : '这条消息请联网后查看';
            messageBudget -= content.length;
            return {id:message.id.slice(0, 200), sender:message.sender === 'user' ? 'user' : 'assistant', content};
          })});
    }
    return output;
  }
  function readCache() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      const cache = JSON.parse(raw);
      if (cache.version !== 1 || !/^[a-f0-9]{64}$/.test(cache.scope) || !Number.isFinite(cache.at) || cache.at > Date.now() + 60000) {
        localStorage.removeItem(storageKey); return null;
      }
      const result = {...cleanCheckpoint(cache), version:1, scope:cache.scope, at:cache.at};
      if (Date.now() - cache.at > maxAge) { result.chats = []; result.contacts = []; }
      return result;
    } catch (error) {
      console.warn('App 文字恢复副本已损坏，已清理。', error);
      localStorage.removeItem(storageKey); return null;
    }
  }
  function forgetDeviceCache() {
    clearTimeout(saveTimer); endGesture(); window.PipiChatNotice.clear();
    localStorage.removeItem(storageKey); snapshots.clear(); pickedPhoto = null; saved = null; scope = ''; restored = false; pendingChat = ''; offline = false;
    adapter?.clear();
    return true;
  }
  function beginSession(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) { forgetDeviceCache(); return; }
    const cache = readCache();
    if (scope && scope !== value || cache && cache.scope !== value) clearSession();
    scope = value; saved = cache?.scope === value ? cache : null; offline = false;
    if (window.__pipiSessionResume) {
      const token = document.querySelector('meta[name="pipi-recording"]')?.content;
      if (token) window.prompt('pipi-session:' + token, 'begin');
    }
  }
  function clearSession() {
    const requestedChat = pendingChat; forgetDeviceCache(); pendingChat = requestedChat;
  }
  function checkpoint() {
    clearTimeout(saveTimer);
    if (!scope || !adapter?.ready() || offline) return;
    saved = {version:1, scope, at:Date.now(), ...cleanCheckpoint(adapter.capture(saved))};
    persistSaved();
  }
  function persistSaved() {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); }
    catch (error) {
      console.error('App 文字草稿保存失败', error);
      if (!storageWarned) { storageWarned = true; adapter.warn('本机空间不足，文字草稿暂时只能保留到关闭 App 前。'); }
    }
  }
  function scheduleCheckpoint() {
    clearTimeout(saveTimer); saveTimer = setTimeout(checkpoint, 220);
  }
  function updateReadings(readings,delta){
    if(!delta||!readings.size)return;
    const deleted=new Set(delta.deletedIds),updated=new Map((delta.upserts||[]).map(m=>[m.id,m]));
    if(!delta.reset&&!deleted.size&&!updated.size)return;
    for(const [roleId,chat] of readings){
      if(!delta.reset&&!chat.messages.some(m=>deleted.has(m.id)||updated.has(m.id)))continue;
      const messages=[];
      for(const old of chat.messages){
        if(deleted.has(old.id))continue;
        const m=updated.get(old.id);
        if(m){if(m.type==='text'&&['user','assistant'].includes(m.sender))messages.push({id:m.id,sender:m.sender,content:m.content});}
        else if(!delta.reset)messages.push(old);
      }
      readings.set(roleId,{...chat,messages});
    }
    scheduleCheckpoint();
  }
  function restore() {
    if (restored || !scope) return null;
    restored = true; return saved ? cleanCheckpoint(saved) : null;
  }
  function clonePage(root) {
    const clone = root.cloneNode(true);
    clone.removeAttribute('id'); clone.removeAttribute('aria-live'); clone.setAttribute('aria-hidden', 'true'); clone.inert = true;
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    const selector = '.content,.chat-messages,.emoji-scroll', scrolls = [...root.querySelectorAll(selector)].map(element => [element.scrollTop, element.scrollLeft]);
    return {node:clone, scrolls, selector};
  }
  function mountSnapshot(snapshot) {
    const clone = snapshot.node.cloneNode(true); clone.classList.add('android-back-preview');
    view().before(clone);
    clone.querySelectorAll(snapshot.selector).forEach((element, index) => { element.scrollTop = snapshot.scrolls[index][0]; element.scrollLeft = snapshot.scrolls[index][1]; });
    return clone;
  }
  function leaving(page) {
    if (!adapter?.ready() || offline || !view().dataset.route || view().dataset.route !== page.name) return;
    snapshots.set(pageKey(page), clonePage(view()));
    if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value);
    checkpoint();
  }
  function endGesture() {
    if (!gesture) return;
    gesture.target.style.removeProperty('--android-back-shift'); gesture.target.classList.remove('android-back-moving');
    gesture.preview?.remove(); gesture = null;
  }
  function back(stage, progress = 0, edge = 'left') {
    if (!['start','progress','cancel','commit'].includes(stage)) return false;
    if (stage === 'cancel') { endGesture(); return true; }
    if (stage === 'commit') {
      const consumed = offline ? offlineRole !== '' : adapter?.canBack() === true;
      endGesture();
      if (!consumed) return false;
      if (offline) { offlineRole = ''; showOffline(); } else adapter.back();
      return true;
    }
    if (stage === 'start') {
      endGesture();
      if (offline || !adapter?.canBack()) return false;
      const target = adapter.previewTarget(), previous = adapter.previous();
      let snapshot = previous && snapshots.get(pageKey(previous));
      if (!snapshot && target === view()) { const preview = adapter.previewPage(previous); if (preview) snapshot = clonePage(preview); }
      gesture = {target, preview:target === view() && snapshot ? mountSnapshot(snapshot) : null, direction:edge === 'right' ? -1 : 1};
      target.classList.add('android-back-moving');
    }
    if (!gesture) return false;
    gesture.target.style.setProperty('--android-back-shift', `${Math.max(0, Math.min(1, Number(progress) || 0)) * gesture.direction * 92}%`);
    return true;
  }
  function openChat(roleId) {
    if (typeof roleId !== 'string' || !roleId || roleId.length > 200) return false;
    if (offline) {
      if (saved?.contacts.some(contact => contact.roleId === roleId) || saved?.chats.some(chat => chat.roleId === roleId) || saved?.drafts.some(draft => draft.roleId === roleId)) { offlineRole = roleId; showOffline(); return true; }
      pendingChat = roleId; return false;
    }
    if (!adapter?.ready()) { pendingChat = roleId; return false; }
    const opened = adapter.openChat(roleId);
    if (opened) window.PipiChatNotice.dismiss();
    return opened;
  }
  function pickerTarget() {
    const input = document.querySelector('input[data-android-chat-photo]'), roleId = input?.dataset.androidChatPhoto;
    if (!roleId || !scope || !adapter?.visibleChat(roleId)) return null;
    checkpoint();
    return {scope,roleId};
  }
  async function finishPickedPhoto() {
    if (!pickedPhoto || !restored || offline || !adapter?.ready()) return;
    const photo = pickedPhoto;
    pickedPhoto = null;
    const stillHere = () => scope === photo.scope && adapter.visibleChat(photo.roleId);
    try {
      if (!stillHere()) throw new Error('已离开原聊天，照片没有发送');
      const response = await fetch(photo.path,{cache:'no-store'});
      if (!response.ok) throw new Error('所选照片已失效，请重新选择');
      const blob = await response.blob();
      if (!stillHere()) throw new Error('已离开原聊天，照片没有发送');
      await adapter.restorePickedFile(blob);
    } catch (error) { adapter.warn(error.message); }
  }
  function receivePickedPhoto(originalScope,roleId,path) {
    if (!/^\/__android\/picked-photo\/[a-f0-9-]{36}\.photo$/.test(path) || !/^[a-f0-9]{64}$/.test(originalScope)
        || typeof roleId !== 'string' || !roleId || roleId.length > 200) return false;
    pickedPhoto = {scope:originalScope,roleId,path};
    void finishPickedPhoto();
    return true;
  }
  function ready() {
    restored = true;
    if (pendingChat) { const roleId = pendingChat; pendingChat = ''; openChat(roleId); }
    void finishPickedPhoto();
    scheduleCheckpoint();
  }
  function navigated() {
    window.PipiChatNotice.navigated();
    scheduleCheckpoint();
  }
  function showOffline(reason = '', connecting = false) {
    const cache = saved || readCache();
    if (!cache || (!cache.chats.length && !cache.drafts.length && !cache.contacts.length)) return false;
    saved = cache; offline = true; restored = false;
    const root = view(); root.replaceChildren(); root.dataset.route = 'android-offline';
    const page = document.createElement('section'); page.className = 'android-offline-page';
    const heading = document.createElement('h2'); heading.textContent = connecting ? '正在连接' : '离线聊天';
    const note = document.createElement('p'); note.className = 'android-offline-note'; note.textContent = '正在显示本机保存的联系人和文字。可以继续写草稿，联网后由你点击发送；这里不会自动发送。';
    const retry = document.createElement('button'); retry.className = 'primary-btn'; retry.textContent = '重新连接'; retry.onclick = () => adapter.retry();
    const settings = document.createElement('button'); settings.className = 'secondary-btn'; settings.textContent = 'App 连接设置'; settings.onclick = () => { location.href = '/__android/settings'; };
    page.append(heading, note, retry, settings);
    if (reason) { const error = document.createElement('p'); error.className = 'android-offline-note'; error.textContent = reason; page.append(error); }
    const roles = new Map(cache.chats.map(chat => [chat.roleId, chat]));
    for (const contact of cache.contacts) if (!roles.has(contact.roleId)) roles.set(contact.roleId, {...contact, messages:[]});
    for (const draft of cache.drafts) if (!roles.has(draft.roleId)) roles.set(draft.roleId, {roleId:draft.roleId, name:'聊天草稿', messages:[]});
    if (offlineRole && roles.has(offlineRole)) {
      const chat = roles.get(offlineRole), title = document.createElement('h3'); title.textContent = chat.name; page.append(title);
      const backButton = document.createElement('button'); backButton.className = 'secondary-btn'; backButton.textContent = '返回离线列表'; backButton.onclick = () => { offlineRole = ''; showOffline(); }; page.append(backButton);
      for (const message of chat.messages) { const line = document.createElement('p'); line.className = `android-offline-message ${message.sender}`; line.textContent = message.content; page.append(line); }
      const draft = cache.drafts.find(draft => draft.roleId === offlineRole);
      const label = document.createElement('h3'); label.textContent = '尚未发送的草稿';
      const value = document.createElement('textarea'); value.value = draft?.text || ''; value.maxLength = 20000; value.setAttribute('aria-label', '尚未发送的文字草稿');
      value.oninput = () => {
        const roleId = offlineRole;
        cache.drafts = cache.drafts.filter(item => item.roleId !== roleId);
        if (value.value) cache.drafts.push({roleId, text:value.value});
        saved = {...cleanCheckpoint(cache), version:1, scope:cache.scope, at:cache.at};
        cache.drafts = saved.drafts;
        persistSaved();
      };
      page.append(label, value);
    } else {
      for (const chat of roles.values()) { const button = document.createElement('button'); button.className = 'android-offline-chat'; button.textContent = chat.name || '聊天'; button.onclick = () => { offlineRole = chat.roleId; showOffline(); }; page.append(button); }
    }
    root.append(page); return true;
  }
  document.addEventListener('input', scheduleCheckpoint, true);
  document.addEventListener('scroll', scheduleCheckpoint, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { checkpoint(); endGesture(); } });
  window.addEventListener('pagehide', checkpoint);
  window.addEventListener('online', () => { if (offline) adapter.retry(); });
  window.PipiAndroidPage = Object.freeze({back, checkpoint, updateReadings, pickerTarget, receivePickedPhoto, openChat, forgetDeviceCache, clearSession, beginSession, restore, leaving, ready, navigated, observeState:window.PipiChatNotice.observeState, showOffline, connect(value) { adapter = value; window.PipiChatNotice.connect(value); }});
})();
