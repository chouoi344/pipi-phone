// SPDX-License-Identifier: GPL-3.0-only
(function () {
  'use strict';

  const ui = { month: todayMonth(), category: 'all', flow: 'all', farmTimer: null, momentRole: 'all', albumTab: 'photos', albumStatusTimer: null, favoriteQuery: '', favoriteKind: 'all', favoriteSelection: null, favoriteScroll: 0 };
  function todayMonth() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
  const categories = ['餐饮', '购物', '交通', '居家', '娱乐', '医疗', '学习', '工资', '其他'];
  const crops = { carrot: { name: '胡萝卜', emoji: '🥕' }, tomato: { name: '番茄', emoji: '🍅' } };
  const P = () => window.Pipi;
  const state = () => P().getState() || {};
  const esc = value => P().esc(value == null ? '' : String(value));
  const icon = name => (P().icons && P().icons[name]) || '';
  // Original pencil mark for the custom ledger's writing action.
  const ledgerWriteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.8 4.2 5 5M4 20l1.5-5.8L16.6 3.1a1.8 1.8 0 0 1 2.5 0l1.8 1.8a1.8 1.8 0 0 1 0 2.5L9.8 18.5 4 20Z"/></svg>';
  const momentPrivatePublishIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7 9V6a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1Zm3 0h4V6a2 2 0 0 0-4 0v3Zm2 4a2 2 0 0 0-1 3.73V19h2v-2.27A2 2 0 0 0 12 13Z"/></svg>';
  // Vanilla-DOM adaptation of LiangNiang/fake-world, GPL-3.0-only.
  // Source revision: de336cfc469772bccdf00ef1f91bfbf8d3953d08.
  // Layout sources: moments/{Layout,TopAvatar,Feed/index,Feed/Likes,
  // Feed/Comments/index,Feed/Comments/CommentItem}.tsx, wallet/Balance.tsx,
  // service/index.tsx. Original API/state and permission boundaries are retained.
  const nativeIcon = name => `<span class="fw-feature-icon" aria-hidden="true" style="--fw-icon:url('/vendor/fake-world/masks/${name}.svg')"></span>`;
  const money = cents => (Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
  const utcToday = () => new Date().toISOString().slice(0, 10);
  const roles = () => state().roles || [];
  const person = id => id === 'me' ? { ...state().profile, name: state().profile?.name || '我' } : roles().find(r => r.id === id) || { name: '已删除的角色' };
  const label = id => person(id).remark || person(id).name || '未命名';
  const avatar = (id, size) => P().avatar(person(id), size || 40);
  const dateText = raw => { const date = new Date(raw); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const empty = (emoji, title, sub) => `<div class="feature-empty"><strong>${esc(title)}</strong>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;
  const field = (name, title, input) => `<label class="feature-field"><span>${esc(title)}</span>${input}</label>`;
  const selected = (a, b) => a === b ? ' selected' : '';
  const requestId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeImage = value => (/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\r\n]+$/i.test(String(value || '')) || /^\/api\/media\/[a-f\d]{32,64}\.(png|jpg|jpeg|webp|gif)$/i.test(String(value || '').trim())) ? String(value).trim() : '';
  const safeAudio = value => /^data:audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac)(;codecs=[a-z\d.,-]+)?;base64,[a-z\d+/=\s]+$/i.test(String(value || '')) ? String(value) : '';
  const page = (title, html, submit, action) => P().openPage(title, html, submit, action);
  const closePage = notify => P().closePage(notify);
  // Navigation is declared by the page API, never patched into a Cancel button.
  function detailPage(title, html, back) {
    P().openPage(title, html, null, undefined, back);
  }
  function detailHeaderAction(selector) {
    const button = document.querySelector(selector), header = document.querySelector('.page-editor .modal-header');
    if (!button || !header) return;
    const wrapper = button.parentElement;
    button.classList.add('feature-header-action');
    header.lastElementChild.replaceWith(button);
    if (wrapper.classList.contains('favorite-detail-toolbar')) wrapper.remove();
  }
  const unavailable = text => P().toast(text || '此功能暂未开放', true);
  function momentTime(raw) {
    const elapsed = Date.now() - new Date(raw).getTime();
    if (elapsed >= 0 && elapsed < 60000) return '刚刚';
    if (elapsed >= 0 && elapsed < 3600000) return `${Math.floor(elapsed / 60000)}分钟前`;
    if (elapsed >= 0 && elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}小时前`;
    return dateText(raw);
  }
  function centsFromInput(value) {
    const text = String(value || '').trim();
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) throw new Error('请输入正确金额，最多保留两位小数');
    const [whole, decimal = ''] = text.split('.');
    const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('金额必须大于 0');
    return cents;
  }
  function on(selector, event, callback, root = document) {
    root.querySelectorAll(selector).forEach(el => el.addEventListener(event, callback));
  }
  async function run(task) {
    try { return await task(); } catch (error) { P().toast(error.message || '操作失败，请稍后重试'); }
  }
  async function mutation(type, payload) {
    await P().act(type, payload);
    P().refresh();
  }
  function confirmDelete(title, description, action) {
    if (P().confirmDialog) return P().confirmDialog(title, description, action, '删除');
    P().openModal(title, `<p class="feature-modal-copy">${esc(description)}</p>`, async () => { await action(); P().closeModal(); }, '确认删除');
  }
  function fileData(file, maxMB = 5) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('请选择 PNG、JPG、WebP 或 GIF 图片'));
      if (file.size > maxMB * 1024 * 1024) return reject(new Error(`图片请小于 ${maxMB} MB`));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
      reader.readAsDataURL(file);
    });
  }

  // Layout measured from CoderMikeHe/WeChat (MIT), MHConstant.m,
  // MHMomentProfileView.m and MHMomentCommentToolView.m, master 52e0aad5.
  // Reference photographs, avatars and fonts are not bundled.
  const momentImages = item => (item.images || (item.image ? [item.image] : [])).filter(safeImage);
  const momentNotices = () => (state().momentNotifications || []).filter(item => { const permissions = person(item.actorId).permissions || {}; return !permissions.blocked && !permissions.onlyChat && !permissions.hideTheirMoments; });
  function visibleMoment(item, viewer = 'me') {
    if (viewer === 'me') {
      if (item.authorId === 'me') return true;
      const permissions = person(item.authorId).permissions || {};
      return !permissions.blocked && !permissions.onlyChat && !permissions.hideTheirMoments;
    }
    const permissions = person(viewer).permissions || {};
    if (permissions.blocked || permissions.onlyChat) return false;
    return item.authorId === viewer || item.authorId === 'me' && !permissions.hideMyMoments && (item.visibility === 'all' || item.visibility.includes(viewer));
  }
  function renderMomentAlbum() {
    if (ui.albumTab === 'status') {
      const saved = state().profile?.status, current = saved?.expiresAt > Date.now() ? saved : null, history = state().statusHistory || [];
      return `<div class="feature-page moment-media-album moment-status-album">${current ? `<button class="moment-status-current" id="moment-current-status"><strong>当前状态</strong><span>${esc(current.description || '查看我的状态')}</span>${icon('chevron')}</button>` : ''}${history.length ? `<button class="moment-status-current" id="moment-status-history"><strong>历史状态</strong><span>${history.length}条</span>${icon('chevron')}</button>` : !current ? `<div class="moment-album-empty"><p>暂无状态</p><button type="button" id="moment-set-status">设个状态 ${icon('chevron')}</button></div>` : ''}</div>`;
    }
    const photos = [...(state().moments || [])].filter(item => item.authorId === 'me').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).flatMap(item => momentImages(item).map((image, index) => ({ item, image, index })));
    return `<div class="feature-page moment-media-album">${photos.length ? `<div class="moment-media-grid">${photos.map(({ item, image, index }) => `<button type="button" data-album-photo="${esc(item.id)}" data-album-index="${index}" aria-label="查看${esc(dateText(item.createdAt))}的第${index + 1}张照片"><img src="${esc(image)}" alt="我的朋友圈照片" loading="lazy"></button>`).join('')}</div><button type="button" class="moment-album-link" id="moment-album-timeline">前往朋友圈 ${icon('chevron')}</button>` : '<div class="moment-album-empty"><p>暂无视频和图片</p><button type="button" id="moment-album-timeline">前往朋友圈 ' + icon('chevron') + '</button></div>'}</div>`;
  }
  function bindMomentAlbum() {
    const title = document.querySelector('.topbar h2');
    title.innerHTML = `<span class="moment-album-tabs" role="tablist" aria-label="我的朋友圈"><button type="button" role="tab" data-album-tab="photos" aria-selected="${ui.albumTab === 'photos'}">朋友圈相册</button><button type="button" role="tab" data-album-tab="status" aria-selected="${ui.albumTab === 'status'}">状态</button></span>`;
    title.classList.add('moment-album-title');
    on('[data-album-tab]', 'click', event => { ui.albumTab = event.currentTarget.dataset.albumTab; P().refresh({resetScroll:true}); });
    on('#moment-album-timeline', 'click', () => P().showView('moments', { roleId: 'me' }));
    on('#moment-current-status', 'click', () => P().showView('status'));
    on('#moment-status-history', 'click', () => run(async () => { const page = document.querySelector('.moment-status-album'), result = await P().api('/api/state'); P().setState(result.state || result); if (page?.isConnected) P().showView('status-history'); }));
    on('#moment-set-status', 'click', () => P().showView('status-picker'));
    on('[data-album-photo]', 'click', event => {
      const item = state().moments.find(entry => entry.id === event.currentTarget.dataset.albumPhoto), images = momentImages(item), index = Number(event.currentTarget.dataset.albumIndex);
      P().openPhoto(images[index], '我的朋友圈照片', { images, index });
    });
    const current = state().profile?.status;
    if (ui.albumTab === 'status' && current?.expiresAt > Date.now()) ui.albumStatusTimer = setTimeout(() => run(async () => {
      const album = document.querySelector('.moment-status-album'), result = await P().api('/api/state');
      P().setState(result.state || result); if (album?.isConnected) P().refresh();
    }), current.expiresAt - Date.now() + 30);
  }
  function renderOwnTimeline(list) {
    const groups = new Map(), todayKey = today();
    groups.set(todayKey, []);
    list.forEach(item => { const date = new Date(item.createdAt), key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
    return `<div class="moment-own-timeline">${[...groups].map(([key, items]) => `<section class="moment-timeline-day"><time>${key === todayKey ? '<strong>今天</strong>' : `<strong>${Number(key.slice(8))}</strong><span>${Number(key.slice(5, 7))}月${key.slice(0, 4) === todayKey.slice(0, 4) ? '' : ` ${key.slice(0, 4)}`}</span>`}</time><div class="moment-timeline-items">${key === todayKey ? `<div class="moment-publish-tiles"><button type="button" id="moment-publish-public">${nativeIcon('camera-filled')}<span>发表</span></button><button type="button" id="moment-publish-private">${momentPrivatePublishIcon}<span>私密发表</span></button></div>${list.length ? '' : '<p class="moment-timeline-empty">发一条朋友圈<br>开始记录你的生活</p>'}` : ''}${items.map(item => { const images = momentImages(item); return `<button type="button" class="moment-timeline-entry" data-album-moment="${esc(item.id)}">${images.length ? `<span class="moment-timeline-photo"><img src="${esc(images[0])}" alt="朋友圈照片" loading="lazy">${images.length > 1 ? `<small>共${images.length}张</small>` : ''}</span>` : ''}<span>${esc(item.content || '[图片]')}${Array.isArray(item.visibility) && !item.visibility.length ? `<small class="moment-timeline-private">${momentPrivacyIcon('self')}私密</small>` : ''}</span></button>`; }).join('')}</div></section>`).join('')}</div>`;
  }
  function searchOwnMoments() {
    const own = [...(state().moments || [])].filter(item => item.authorId === 'me').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    detailPage('搜索朋友圈', `<div class="moment-own-search"><label class="moment-picker-search">${nativeIcon('search-outlined')}<input id="moment-own-query" type="search" placeholder="搜索我的朋友圈" aria-label="搜索我的朋友圈"></label><div id="moment-own-results"></div></div>`);
    const form = document.querySelector('#overlay > .page-editor .modal-form'), results = form.querySelector('#moment-own-results');
    const draw = query => {
      const list = own.filter(item => `${item.content} ${item.location || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
      results.innerHTML = list.map(item => `<button type="button" class="moment-search-result" data-own-result="${esc(item.id)}"><span>${esc(item.content || '[图片]')}</span><small>${esc(dateText(item.createdAt))}</small></button>`).join('') || '<p class="moment-selection-empty">没有符合条件的朋友圈</p>';
      on('[data-own-result]', 'click', event => momentDetail(event.currentTarget.dataset.ownResult), results);
    };
    on('#moment-own-query', 'input', event => draw(event.currentTarget.value), form); draw('');
  }
  function renderMoments(arg) {
    ui.momentArg = arg;
    const friend = arg?.roleId && roles().find(role => role.id === arg.roleId);
    const ownAlbum = arg?.roleId === 'me';
    const profile = friend || state().profile || {};
    const all = [...(state().moments || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const list = all.filter(item => visibleMoment(item, friend || ownAlbum || ui.momentRole === 'all' ? 'me' : ui.momentRole)).filter(item => ownAlbum ? item.authorId === 'me' : friend ? item.authorId === friend.id : true);
    const cover = safeImage(profile.cover);
    const coverImage = cover ? `<img src="${esc(cover)}" alt="${esc(friend ? label(friend.id) : '我')}的朋友圈封面">` : '';
    const unread = !friend && !ownAlbum ? momentNotices().filter(item => !item.read) : [];
    const noticeBanner = unread.length ? `<div class="moment-unread-wrap"><button type="button" class="moment-unread-pill" id="moment-unread-pill">${avatar(unread[0].actorId, 28)}<span>${unread.length} 条新消息</span>${icon('chevron')}</button></div>` : '';
    const album = ownAlbum ? renderOwnTimeline(list) : `<div class="moment-list">${list.length ? list.map(renderMomentCard).join('') : empty('', friend ? '朋友还没有发表动态' : '暂无动态', '')}</div>`;
    return `<div class="feature-page moments-page${friend ? ' friend-moments-page' : ''}${ownAlbum ? ' own-album-page' : ''}"><div class="moments-cover${cover ? ' has-photo' : ''}"><button class="moments-cover-photo" id="moment-cover" aria-label="查看朋友圈封面" data-cover-owner="${friend ? esc(friend.id) : 'me'}">${coverImage}</button><div class="moments-profile"><strong>${esc(friend ? label(friend.id) : profile.name || '我')}</strong>${P().avatar(profile, 72)}</div></div>${noticeBanner}${album}</div>`;
  }
  function renderMomentCard(item) {
    const likes = item.likes || [], comments = item.comments || [], liked = likes.includes('me');
    const long = String(item.content || '').length > 180;
    const privacy = item.authorId === 'me' && Array.isArray(item.visibility) ? `<span class="moment-privacy" aria-label="${item.visibility.length ? '部分角色可见' : '私密'}" title="${item.visibility.length ? '部分角色可见' : '私密'}">${item.visibility.length ? nativeIcon('people-outlined') : '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 7V4.5a3 3 0 0 1 6 0V7M4 7h8v7H4z" stroke="currentColor" stroke-width="1.2"/></svg>'}</span>` : '';
    const photos = momentImages(item);
    return `<article class="moment-card" data-moment-id="${esc(item.id)}">${avatar(item.authorId, 44)}<div class="moment-main"><strong class="moment-author">${esc(label(item.authorId))}</strong><p class="moment-content${long ? ' is-collapsed' : ''}">${esc(item.content)}</p>${long ? '<button class="moment-expand" aria-expanded="false">全文</button>' : ''}${photos.length ? `<div class="moment-photo-grid${photos.length === 1 ? ' single-photo' : ''}${photos.length === 4 ? ' four-photos' : ''}">${photos.map((image, index) => `<button class="moment-photo-btn" data-photo="${esc(item.id)}" data-photo-index="${index}" aria-label="查看朋友圈第${index + 1}张图片"><img class="moment-photo" src="${esc(image)}" alt="朋友圈配图${index + 1}" loading="lazy"></button>`).join('')}</div>` : ''}${item.location ? `<p class="moment-location-label">${esc(item.location)}</p>` : ''}${item.authorId === 'me' && item.mentions?.length ? `<p class="moment-mentions-label">提醒了 ${item.mentions.map(id => esc(label(id))).join('、')}</p>` : ''}<div class="moment-meta"><span class="moment-time">${esc(momentTime(item.createdAt))}${privacy}</span>${item.authorId === 'me' ? `<button class="moment-delete" data-delete-moment="${esc(item.id)}" aria-label="删除动态">删除</button>` : ''}<details class="moment-actions"><summary aria-label="赞或评论">${nativeIcon('more-filled')}</summary><div class="moment-action-menu"><button data-like="${esc(item.id)}" aria-pressed="${liked}" aria-label="${liked ? '取消赞' : '赞'}">${nativeIcon('like-outlined')}<span>${liked ? '取消' : '赞'}</span></button><button data-comment="${esc(item.id)}" aria-label="评论">${nativeIcon('comment-outlined')}<span>评论</span></button></div></details></div>${likes.length || comments.length ? `<div class="moment-reactions">${likes.length ? `<div class="moment-likes">${nativeIcon('like-outlined')}<span>${likes.map(id => esc(label(id))).join('、')}</span></div>` : ''}${comments.length ? `<div class="moment-comments">${comments.map(comment => `<button class="moment-comment" data-comment="${esc(item.id)}" data-reply-to="${esc(comment.id)}" data-comment-author="${esc(comment.authorId)}" aria-label="回复${esc(label(comment.authorId))}"><strong>${esc(label(comment.authorId))}</strong>${comment.replyToAuthorId ? `回复<strong>${esc(label(comment.replyToAuthorId))}</strong>` : ''}：${esc(comment.content)}</button>`).join('')}</div>` : ''}</div>` : ''}</div></article>`;
  }

  function openMomentCamera() {
    P().actionSheet('', [
      { label: '拍摄', run: () => chooseMomentPhoto(true) },
      { label: '从手机相册中选择', run: () => chooseMomentPhoto(false) }
    ]);
  }
  function chooseMomentPhoto(camera) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif'; input.multiple = !camera;
    if (camera) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => run(async () => {
      if (!input.files.length) return;
      if (input.files.length > 9) throw new Error('每条朋友圈最多 9 张照片');
      composeMoment({ images: await Promise.all([...input.files].map(file => fileData(file))) });
    }), { once: true });
    input.click();
  }
  const momentPrivacyOptions = [
    ['all', '公开', '所有朋友可见'], ['self', '私密', '仅自己可见'],
    ['some', '部分可见', '选中的朋友可见'], ['exclude', '不给谁看', '选中的朋友不可见']
  ];
  const momentFriends = () => roles().filter(role => !role.permissions?.blocked && !role.permissions?.onlyChat && !role.permissions?.hideMyMoments);
  // Original line icons for the audience controls; no native WeChat assets used.
  function momentPrivacyIcon(mode) {
    const paths = {
      all: '<circle cx="12" cy="12" r="8.4"/><ellipse cx="12" cy="12" rx="3.7" ry="8.4"/><path d="M3.6 12h16.8M5.2 7.2h13.6M5.2 16.8h13.6"/>',
      self: '<rect x="5.5" y="10" width="13" height="10" rx="1.3"/><path d="M8.1 10V6.8a3.9 3.9 0 0 1 7.8 0V10M12 14v2.8"/>',
      some: '<circle cx="9" cy="7.2" r="3.1"/><path d="M2.9 19v-2.4a6.1 6.1 0 0 1 12.2 0V19M16 4.4a3 3 0 0 1 0 5.8M17.5 12.2a5.3 5.3 0 0 1 3.6 5V19"/>',
      exclude: '<circle cx="9" cy="7.2" r="3.1"/><path d="M2.9 19v-2.4a6.1 6.1 0 0 1 12.2 0V19M16 4.4a3 3 0 0 1 0 5.8M17 15h5"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[mode]}</svg>`;
  }
  function momentVisibility(privacy, friends = momentFriends()) {
    if (privacy.mode === 'all') return 'all';
    if (privacy.mode === 'self') return [];
    const ids = privacy[privacy.mode].filter(id => friends.some(friend => friend.id === id));
    if (!ids.length) throw new Error(privacy.mode === 'some' ? '请选择至少一位可见的朋友' : '请选择不给谁看的朋友');
    const visible = privacy.mode === 'some' ? ids : friends.filter(friend => !ids.includes(friend.id)).map(friend => friend.id);
    if (visible.length > 200) throw new Error('本次可见朋友超过 200 人，请用“部分可见”选择');
    return visible;
  }
  function momentSelectionPage(title, html, submit, cancel = false) {
    P().openNestedPage(title, `<div class="moment-selection">${html}</div>`, submit, '完成');
    const section = document.querySelector('#overlay > .page-editor');
    section.classList.add('moment-selection-page');
    if (cancel) {
      section.dataset.navigation = 'cancel';
      const button = section.querySelector('.modal-close');
      button.classList.remove('modal-back'); button.textContent = '取消'; button.setAttribute('aria-label', '取消');
    }
    return section.querySelector('.modal-form');
  }
  function momentTagGroups(friends) {
    const groups = new Map();
    friends.forEach(friend => (friend.tags || []).forEach(tag => {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(friend.id);
    }));
    return [...groups].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  }
  function pickMomentTags(friends, initial, done) {
    const chosen = new Set(initial), groups = momentTagGroups(friends);
    const form = momentSelectionPage('选择标签', `<div class="moment-tag-list">${groups.map(([tag, ids], index) => `<label class="moment-picker-row"><span class="moment-tag-symbol" aria-hidden="true">${icon('tag') || nativeIcon('people-outlined')}</span><span><strong>${esc(tag)}</strong><small>${ids.length}位朋友</small></span><input type="checkbox" data-moment-tag="${index}" aria-label="${esc(tag)}"></label>`).join('') || '<p class="moment-selection-empty">暂无标签，可在通讯录的朋友资料中添加标签</p>'}</div>`, () => { done([...chosen]); closePage(); });
    const sync = () => {
      form.querySelectorAll('[data-moment-tag]').forEach(input => {
        const ids = groups[Number(input.dataset.momentTag)][1], count = ids.filter(id => chosen.has(id)).length;
        input.checked = count === ids.length; input.indeterminate = count > 0 && count < ids.length;
      });
      form.querySelector('.modal-submit').textContent = chosen.size ? `完成(${chosen.size})` : '完成';
    };
    on('[data-moment-tag]', 'change', event => {
      const input = event.currentTarget, ids = groups[Number(input.dataset.momentTag)][1];
      const next = new Set(chosen);
      ids.forEach(id => input.checked ? next.add(id) : next.delete(id));
      if (next.size > 200) { P().toast('每次最多选择 200 位朋友'); sync(); return; }
      chosen.clear(); next.forEach(id => chosen.add(id)); sync();
    }, form);
    sync();
  }
  function pickMomentFriends(title, friends, initial, done, cancel = true) {
    const chosen = new Set(initial.filter(id => friends.some(friend => friend.id === id)));
    const form = momentSelectionPage(title, `<label class="moment-picker-search">${nativeIcon('search-outlined')}<input type="search" id="moment-picker-query" placeholder="搜索" aria-label="搜索朋友"></label><button type="button" class="moment-picker-tag-entry" id="moment-picker-tags"><span>按标签选择</span>${icon('chevron')}</button><div class="moment-friend-list">${friends.map(friend => `<label class="moment-picker-row" data-moment-friend="${esc(friend.id)}">${P().avatar(friend, 36)}<span>${esc(friend.remark || friend.name)}</span><input type="checkbox" data-moment-choice="${esc(friend.id)}" aria-label="选择${esc(friend.remark || friend.name)}"></label>`).join('') || '<p class="moment-selection-empty">暂无可选择的朋友</p>'}</div>`, () => { done([...chosen]); closePage(); }, cancel);
    const sync = () => {
      form.querySelectorAll('[data-moment-choice]').forEach(input => { input.checked = chosen.has(input.dataset.momentChoice); });
      form.querySelector('.modal-submit').textContent = chosen.size ? `完成(${chosen.size})` : '完成';
    };
    on('[data-moment-choice]', 'change', event => {
      const input = event.currentTarget;
      if (input.checked && chosen.size === 200) { input.checked = false; P().toast('每次最多选择 200 位朋友'); return; }
      if (input.checked) chosen.add(input.dataset.momentChoice); else chosen.delete(input.dataset.momentChoice);
      sync();
    }, form);
    on('#moment-picker-query', 'input', event => {
      const query = event.currentTarget.value.trim().toLocaleLowerCase();
      form.querySelectorAll('[data-moment-friend]').forEach(row => {
        const friend = friends.find(entry => entry.id === row.dataset.momentFriend);
        row.hidden = ![friend.name, friend.remark, ...(friend.tags || [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
      });
    }, form);
    on('#moment-picker-tags', 'click', () => pickMomentTags(friends, [...chosen], ids => { chosen.clear(); ids.forEach(id => chosen.add(id)); sync(); }), form);
    sync();
  }
  function pickMomentPrivacy(current, done) {
    const draft = { mode: current.mode, some: [...current.some], exclude: [...current.exclude] };
    const form = momentSelectionPage('谁可以看', `<div class="moment-privacy-options" role="radiogroup" aria-label="谁可以看">${momentPrivacyOptions.map(([mode, title, note]) => `<button type="button" class="moment-privacy-option" data-moment-privacy="${mode}" role="radio" aria-checked="${mode === draft.mode}">${momentPrivacyIcon(mode)}<span><strong>${title}</strong><small>${note}</small></span><span class="moment-privacy-check" aria-hidden="true">✓</span></button>`).join('')}</div><div class="moment-privacy-people" id="moment-privacy-people" hidden><button type="button" id="moment-privacy-contacts"><span>从通讯录选择</span>${icon('chevron')}</button><button type="button" id="moment-privacy-tags"><span>选择标签</span>${icon('chevron')}</button><p id="moment-privacy-summary"></p></div>`, () => { momentVisibility(draft); done(draft); closePage(); }, true);
    const sync = () => {
      form.querySelectorAll('[data-moment-privacy]').forEach(button => { button.setAttribute('aria-checked', String(button.dataset.momentPrivacy === draft.mode)); });
      const custom = draft.mode === 'some' || draft.mode === 'exclude';
      form.querySelector('#moment-privacy-people').hidden = !custom;
      form.querySelector('#moment-privacy-summary').textContent = custom && draft[draft.mode].length ? `已选择：${draft[draft.mode].map(label).join('、')}` : '尚未选择朋友';
    };
    const select = ids => { draft[draft.mode] = ids; sync(); };
    on('[data-moment-privacy]', 'click', event => { draft.mode = event.currentTarget.dataset.momentPrivacy; sync(); }, form);
    on('#moment-privacy-contacts', 'click', () => pickMomentFriends(draft.mode === 'some' ? '部分可见' : '不给谁看', momentFriends(), draft[draft.mode], select, false), form);
    on('#moment-privacy-tags', 'click', () => pickMomentTags(momentFriends(), draft[draft.mode], select), form);
    sync();
  }
  function composeMoment(options = {}) {
    const images = [...(options.images || (options.image ? [options.image] : []))];
    let privacy = { mode: options.visibility === 'self' ? 'self' : 'all', some: [], exclude: [] }, mentions = [];
    const privatePost = options.visibility === 'self';
    P().openModal(privatePost ? '私密发表' : '发表朋友圈', `<div class="moment-compose"><textarea name="content" class="moment-compose-text" rows="4" maxlength="3000" placeholder="这一刻的想法…" aria-label="动态内容"></textarea><div class="moment-compose-photos"${options.textOnly ? ' hidden' : ''}><div id="moment-photo-items" class="compose-photo-grid"></div><label class="moment-add-photo" aria-label="添加照片"><span aria-hidden="true">＋</span><input id="moment-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple></label></div><div class="moment-compose-cells"><label class="moment-compose-cell">${icon('location')}<span>所在位置</span><input name="location" id="moment-location" maxlength="120" placeholder="不显示" aria-label="所在位置文字标签"></label><button type="button" class="moment-compose-cell" id="moment-visibility" aria-haspopup="dialog">${momentPrivacyIcon(privacy.mode)}<span>谁可以看</span><small>${privacy.mode === 'all' ? '公开' : '私密'}</small>${icon('chevron')}</button><button type="button" id="moment-mention" class="moment-compose-cell" aria-haspopup="dialog"><span class="moment-mention-mark" aria-hidden="true">@</span><span>提醒谁看</span><small>未选择</small>${icon('chevron')}</button></div></div>`, async form => {
      const data = new FormData(form), content = String(data.get('content') || '').trim();
      if (!content && !images.length) throw new Error('写点什么，或添加照片');
      const visibility = momentVisibility(privacy);
      const available = momentFriends().map(friend => friend.id);
      mentions = mentions.filter(id => available.includes(id));
      if (mentions.some(id => visibility !== 'all' && !visibility.includes(id))) throw new Error('提醒的朋友需要在可见范围内');
      await mutation('moment.create', { content, images, visibility, location: String(data.get('location') || '').trim(), mentions });
      if (form.isConnected) closePage();
    }, privatePost ? '私密发表' : '发表');
    const form = document.querySelector('#overlay > .page-editor .modal-form');
    const drawImages = () => {
      form.querySelector('#moment-photo-items').innerHTML = images.map((image, index) => `<div class="compose-photo-item"><button type="button" data-preview-image="${index}" aria-label="预览第${index + 1}张照片"><img src="${esc(image)}" alt="待发布照片${index + 1}"></button><button type="button" data-remove-image="${index}" class="compose-photo-remove" aria-label="移除第${index + 1}张照片">×</button><div class="compose-photo-order"><button type="button" data-move-image="${index}" data-step="-1"${index ? '' : ' disabled'} aria-label="第${index + 1}张照片前移">‹</button><span>${index + 1}</span><button type="button" data-move-image="${index}" data-step="1"${index === images.length - 1 ? ' disabled' : ''} aria-label="第${index + 1}张照片后移">›</button></div></div>`).join('');
      form.querySelector('.moment-add-photo').hidden = images.length === 9;
      on('[data-preview-image]', 'click', e => { const index = Number(e.currentTarget.dataset.previewImage); P().openPhoto(images[index], '待发布照片', { images, index }); }, form);
      on('[data-remove-image]', 'click', e => { images.splice(Number(e.currentTarget.dataset.removeImage), 1); drawImages(); }, form);
      on('[data-move-image]', 'click', e => { const index = Number(e.currentTarget.dataset.moveImage), next = index + Number(e.currentTarget.dataset.step); [images[index], images[next]] = [images[next], images[index]]; drawImages(); }, form);
    };
    drawImages();
    on('#moment-image-input', 'change', e => run(async () => {
      const input = e.target, files = [...input.files];
      if (images.length + files.length > 9) { input.value = ''; throw new Error('每条朋友圈最多 9 张照片'); }
      const additions = await Promise.all(files.map(file => fileData(file)));
      if (form.isConnected) { images.push(...additions); drawImages(); input.value = ''; }
    }), form);
    const updateMentions = () => {
      form.querySelector('#moment-mention').hidden = privacy.mode === 'self';
      form.querySelector('#moment-mention small').textContent = mentions.length ? mentions.map(label).join('、') : '未选择';
    };
    updateMentions();
    on('#moment-visibility', 'click', () => pickMomentPrivacy(privacy, next => {
      privacy = next;
      const visibility = momentVisibility(privacy), previous = mentions.length;
      mentions = mentions.filter(id => visibility === 'all' || visibility.includes(id));
      const option = momentPrivacyOptions.find(([mode]) => mode === privacy.mode);
      form.querySelector('#moment-visibility').innerHTML = `${momentPrivacyIcon(privacy.mode)}<span>谁可以看</span><small>${option[1]}</small>${icon('chevron')}`;
      if (privatePost) {
        form.querySelector('.modal-header h3').textContent = privacy.mode === 'self' ? '私密发表' : '发表朋友圈';
        form.querySelector('.modal-submit').textContent = privacy.mode === 'self' ? '私密发表' : '发表';
      }
      updateMentions();
      if (mentions.length < previous) P().toast('已移除不在可见范围内的提醒朋友');
    }), form);
    on('#moment-mention', 'click', () => {
      const visibility = momentVisibility(privacy), friends = momentFriends().filter(friend => visibility === 'all' || visibility.includes(friend.id));
      pickMomentFriends('提醒谁看', friends, mentions, ids => { mentions = ids; updateMentions(); });
    }, form);
  }
  function generateMoment() {
    if (!roles().length) return P().toast('请先在“通讯录 → 新的朋友”添加朋友');
    P().openModal('邀请角色发动态', `${field('roleId', '选择角色', `<select name="roleId">${roles().map(r => `<option value="${esc(r.id)}">${esc(r.remark || r.name)}</option>`).join('')}</select>`)}<div class="feature-callout">将真实调用当前配置的聊天模型，可能产生模型用量。未配置模型时无法生成。</div><p class="feature-note">使用该角色的人设和独立会话上下文，不读取现实账本。</p>`, async form => {
      const result = await P().api('/api/moments/generate', { roleId: new FormData(form).get('roleId') });
      if (result.state) P().setState(result.state);
      if (form.isConnected) P().closeModal(); P().refresh();
      P().toast('新动态已发布');
    }, '生成', manageMoments);
    document.querySelector('.page-editor .modal-submit')?.setAttribute('aria-label', '调用模型并生成角色动态');
  }
  function manageMoments() {
    page('朋友圈管理', `<div class="moment-management"><label class="feature-field"><span>查看动态</span><select id="moment-role-filter" aria-label="朋友圈视角"><option value="all">我的朋友圈</option>${roles().map(r => `<option value="${esc(r.id)}"${selected(r.id, ui.momentRole)}>${esc(r.remark || r.name)}的可见动态</option>`).join('')}</select></label><button type="button" class="moment-management-cell" id="moment-generate"><span>邀请角色发动态</span>${icon('chevron')}</button></div>`, null);
    on('#moment-role-filter', 'change', e => { ui.momentRole = e.target.value; closePage(); P().showView('moments'); });
    on('#moment-generate', 'click', generateMoment);
  }
  const savingMomentCovers = new Set();
  function previewCover(ownerId = 'me', pickImmediately = false) {
    detailPage('朋友圈封面', '<div class="moment-cover-detail"><div class="moment-cover-display"></div><button type="button" id="moment-cover-change">更换相册封面</button></div>');
    const detail = document.querySelector('.moment-cover-detail');
    const display = detail.querySelector('.moment-cover-display');
    const change = detail.querySelector('#moment-cover-change');
    let selection = 0;
    function updatePreview() {
      const cover = safeImage(person(ownerId).cover);
      display.innerHTML = cover ? `<button type="button" id="moment-cover-full"><img class="feature-full-image" src="${esc(cover)}" alt="朋友圈封面"></button>` : '<div class="moment-cover-empty">尚未设置封面</div>';
      on('#moment-cover-full', 'click', () => P().openPhoto(cover, '朋友圈封面'), display);
    }
    updatePreview();
    change.onclick = () => {
      if (savingMomentCovers.has(ownerId)) return P().toast('正在保存朋友圈封面，请稍候');
      const current = ++selection;
      const isCurrent = () => detail.isConnected && !detail.closest('[inert]') && current === selection;
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.bmp,.avif';
      input.addEventListener('change', () => run(async () => {
        const file = input.files[0];
        if (!file || !isCurrent()) return;
        const cover = await window.PipiLifeCrop.pick(file, 'cover', {isCurrent, parent:detail, cardGuide:false});
        if (!cover || !isCurrent() || savingMomentCovers.has(ownerId)) return;
        savingMomentCovers.add(ownerId);
        change.disabled = true;
        try {
          await mutation(ownerId === 'me' ? 'profile.save' : 'role.save', ownerId === 'me' ? { cover } : { id: ownerId, cover });
          if (isCurrent()) updatePreview();
          P().toast('朋友圈封面已更换');
        } finally {
          savingMomentCovers.delete(ownerId);
          change.disabled = false;
        }
      }), { once: true });
      input.click();
    };
    if (pickImmediately) change.click();
  }
  function momentDetail(id) {
    const item = state().moments.find(entry => entry.id === id);
    if (!item || !visibleMoment(item)) return P().toast('这条朋友圈已无法查看');
    const open = document.querySelector('.page-editor') ? P().openNestedPage : P().openPage;
    open('详情', `<div class="moment-detail" data-detail-moment="${esc(id)}">${renderMomentCard(item)}</div>`, null, undefined, () => closeComment());
    bindMomentCards(document.querySelector('.moment-detail'));
  }
  function refreshMomentDetail(id) {
    const detail = document.querySelector('.moment-detail');
    if (!detail || detail.dataset.detailMoment !== id) return;
    const item = state().moments.find(entry => entry.id === id);
    const expanded = captureMomentExpansion(detail);
    detail.innerHTML = item ? renderMomentCard(item) : '<p class="feature-empty">这条朋友圈已删除</p>';
    restoreMomentExpansion(detail, expanded);
    bindMomentCards(detail);
  }
  function momentNotifications() {
    const notifications = [...momentNotices()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    detailPage('消息', `<div class="moment-notifications">${notifications.map(item => { const moment = state().moments.find(entry => entry.id === item.momentId), photos = moment && momentImages(moment); return `<button type="button" class="moment-notification${item.read ? '' : ' is-unread'}" data-notification-moment="${esc(item.momentId)}">${avatar(item.actorId, 40)}<span><strong>${esc(label(item.actorId))}</strong><span>${esc(item.type === 'like' ? '赞了这条朋友圈' : item.type === 'mention' ? '提醒你看朋友圈' : item.content || '评论了朋友圈')}</span><small>${esc(dateText(item.createdAt))}</small></span>${photos?.length ? `<img src="${esc(photos[0])}" alt="朋友圈照片">` : `<span class="notification-content">${esc(moment?.content || '朋友圈已删除')}</span>`}</button>`; }).join('') || empty('', '暂无消息', '真实发生的赞、评论和提醒会保存在这里')}</div>`);
    on('[data-notification-moment]', 'click', e => momentDetail(e.currentTarget.dataset.notificationMoment));
    const ids = notifications.filter(item => !item.read).map(item => item.id);
    if (ids.length) run(async () => { for (let index = 0; index < ids.length; index += 100) await P().act('moment.notifications.read', { ids: ids.slice(index, index + 100) }); P().refresh(); });
  }
  let closeComment = () => {};
  function commentMoment(id, replyTo) {
    closeComment();
    const moment = (state().moments || []).find(item => item.id === id);
    if (!moment) return;
    const reply = replyTo && (moment.comments || []).find(item => item.id === replyTo);
    const area = document.querySelector('#overlay > .page-editor .moment-detail') || document.querySelector('#view .moments-page');
    const target = [...(area?.querySelectorAll('[data-moment-id]') || [])].find(el => el.dataset.momentId === id);
    const returnFocus = reply ? [...(target?.querySelectorAll('[data-reply-to]') || [])].find(el => el.dataset.replyTo === reply.id) : target?.querySelector('.moment-actions summary');
    const bar = document.createElement('form');
    bar.className = 'moment-comment-bar';
    bar.setAttribute('aria-label', reply ? `回复${label(reply.authorId)}` : '评论');
    bar.innerHTML = `<textarea name="content" rows="1" maxlength="1000" enterkeyhint="send" placeholder="${esc(reply ? `回复${label(reply.authorId)}：` : '评论')}" aria-label="评论内容" required></textarea><button type="submit" disabled>发送</button>`;
    (document.querySelector('.phone-shell') || document.body).appendChild(bar);
    const input = bar.querySelector('textarea'), send = bar.querySelector('button');
    const controller = new AbortController(), signal = controller.signal;
    const position = () => {
      if (!area?.isConnected) return closeComment();
      const rect = area.getBoundingClientRect(), viewport = window.visualViewport;
      const shell = document.querySelector('.phone-shell'), shellRect = shell?.getBoundingClientRect();
      const shellStyle = shell && getComputedStyle(shell);
      for (const name of ['--safe-bottom', '--safe-left', '--safe-right']) {
        const value = shellStyle?.getPropertyValue(name).trim();
        if (value) bar.style.setProperty(name, value);
      }
      bar.style.left = `${Math.max(0, rect.left)}px`;
      bar.style.width = `${Math.min(rect.width, window.innerWidth)}px`;
      bar.style.bottom = `${Math.max(0, shellRect ? window.innerHeight - shellRect.bottom : 0, window.innerHeight - (viewport ? viewport.height + viewport.offsetTop : window.innerHeight))}px`;
      bar.classList.toggle('keyboard-open', Boolean(viewport && window.innerHeight - viewport.height > 120));
    };
    closeComment = () => { controller.abort(); bar.remove(); closeComment = () => {}; };
    window.visualViewport?.addEventListener('resize', position, { signal });
    window.visualViewport?.addEventListener('scroll', position, { signal });
    window.addEventListener('resize', position, { signal });
    window.addEventListener('pipi:phone-frame', position, { signal });
    document.addEventListener('pointerdown', event => { if (!bar.contains(event.target) && !event.target.closest('[data-comment]')) closeComment(); }, { signal });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(100, input.scrollHeight)}px`; send.disabled = !input.value.trim(); }, { signal });
    bar.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeComment();
        returnFocus?.focus({preventScroll:true});
      } else if (event.key === 'Tab' && ((event.target === input && !event.shiftKey && !send.disabled) || (event.target === send && event.shiftKey))) {
        // The floating composer lives beside the modal. Let Tab move inside it.
        event.stopPropagation();
      } else if (event.target === input && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault(); if (!send.disabled) bar.requestSubmit();
      }
    }, { signal });
    let sending = false;
    bar.addEventListener('submit', event => {
      event.preventDefault();
      if (sending || !input.value.trim()) return;
      sending = true; send.disabled = true;
      run(async () => {
        try {
          await P().act('moment.comment', { id, content: input.value.trim(), ...(reply ? { replyTo: reply.id } : {}) });
          closeComment(); P().refresh(); refreshMomentDetail(id);
        } finally { sending = false; if (bar.isConnected) send.disabled = !input.value.trim(); }
      });
    }, { signal });
    position(); input.focus();
    if (target) setTimeout(() => { if (bar.isConnected) target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 180);
  }
  let momentHandlers;
  function bindMoments() {
    momentHandlers?.abort(); momentHandlers = new AbortController();
    const camera = document.querySelector('[data-action="compose-moment"]');
    if (camera) {
      let timer, origin, suppress = false;
      const stop = () => { clearTimeout(timer); timer = null; };
      camera.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        stop(); suppress = false; origin = { x: event.clientX, y: event.clientY };
        timer = setTimeout(() => { timer = null; suppress = true; composeMoment({ textOnly: true }); }, 550);
      }, { signal: momentHandlers.signal });
      camera.addEventListener('pointermove', event => {
        if (timer && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) { suppress = true; stop(); }
      }, { signal: momentHandlers.signal });
      camera.addEventListener('pointerup', stop, { signal: momentHandlers.signal });
      camera.addEventListener('pointercancel', () => { suppress = true; stop(); }, { signal: momentHandlers.signal });
      camera.addEventListener('pointerleave', () => { if (timer) { suppress = true; stop(); } }, { signal: momentHandlers.signal });
      camera.addEventListener('touchend', event => { if (suppress && event.cancelable) event.preventDefault(); }, { passive: false, signal: momentHandlers.signal });
      camera.addEventListener('contextmenu', event => event.preventDefault(), { signal: momentHandlers.signal });
      camera.addEventListener('click', event => { if (suppress && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); suppress = false; } }, { capture: true, signal: momentHandlers.signal });
      momentHandlers.signal.addEventListener('abort', stop, { once: true });
    }
    const content = document.querySelector('.moments-content'), topbar = document.querySelector('.moments-topbar');
    const updateHeader = () => topbar?.classList.toggle('is-scrolled', (content?.scrollTop || 0) > Math.max(80, (document.querySelector('.moments-cover')?.offsetHeight || 250) - (topbar?.offsetHeight || 88)));
    content?.addEventListener('scroll', updateHeader, { passive: true, signal: momentHandlers.signal });
    updateHeader();
    if (ui.momentArg?.roleId === 'me') {
      topbar.classList.add('moment-own-topbar');
      document.querySelector('.topbar .header-actions').innerHTML = `<button type="button" class="icon-btn" id="moment-own-search" aria-label="搜索我的朋友圈">${icon('search')}</button><button type="button" class="icon-btn" id="moment-own-more" aria-label="更多">${icon('more')}</button>`;
      on('#moment-own-search', 'click', searchOwnMoments);
      on('#moment-own-more', 'click', () => P().actionSheet('', [
        { label: '更换朋友圈封面', run: () => previewCover('me', true) },
        { label: '消息', run: momentNotifications },
        { label: '朋友圈相册', run: () => { ui.albumTab = 'photos'; P().showView('moment-album'); } }
      ]));
      on('#moment-publish-public', 'click', () => composeMoment({ visibility: 'all' }));
      on('#moment-publish-private', 'click', () => composeMoment({ visibility: 'self' }));
    }
    content?.addEventListener('scroll', () => document.querySelectorAll('.moment-actions[open]').forEach(menu => { menu.open = false; }), { passive: true, signal: momentHandlers.signal });
    document.addEventListener('pointerdown', event => {
      document.querySelectorAll('.moment-actions[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    }, { signal: momentHandlers.signal });
    on('#moment-cover', 'click', e => previewCover(e.currentTarget.dataset.coverOwner));
    on('#moment-unread-pill', 'click', momentNotifications);
    const profile = document.querySelector('.moments-profile > .avatar');
    if (profile) {
      profile.tabIndex = 0; profile.setAttribute('role', 'link'); profile.style.pointerEvents = 'auto';
      const openProfile = () => { const id = ui.momentArg?.roleId; P().showView(id && id !== 'me' ? 'role' : 'profile', id && id !== 'me' ? id : undefined); };
      profile.addEventListener('click', openProfile);
      profile.addEventListener('keydown', event => { if (event.key === 'Enter') openProfile(); });
    }
    on('[data-album-moment]', 'click', e => momentDetail(e.currentTarget.dataset.albumMoment));
    bindMomentCards(document.querySelector('.moments-page'));
  }
  function setMomentExpanded(button, expanded) {
    button.previousElementSibling.classList.toggle('is-collapsed', !expanded);
    button.textContent = expanded ? '收起' : '全文';
    button.setAttribute('aria-expanded', String(expanded));
  }
  function captureMomentExpansion(root) {
    return Array.from(root.querySelectorAll('.moment-expand[aria-expanded="true"]'), button => button.closest('.moment-card').dataset.momentId);
  }
  function restoreMomentExpansion(root, ids) {
    if (!ids.length) return;
    const expanded = new Set(ids);
    root.querySelectorAll('.moment-expand').forEach(button => {
      if (expanded.has(button.closest('.moment-card').dataset.momentId)) setMomentExpanded(button, true);
    });
  }
  function bindMomentCards(root) {
    root.querySelectorAll('.moment-card').forEach(card => {
      const item = state().moments.find(entry => entry.id === card.dataset.momentId);
      [card.querySelector(':scope > .avatar'), card.querySelector('.moment-author')].forEach(node => {
        node.tabIndex = 0; node.setAttribute('role', 'link'); node.setAttribute('aria-label', `查看${label(item.authorId)}的资料`);
        let timer, start, suppress = false;
        const stop = () => { clearTimeout(timer); timer = null; };
        const permissions = () => { if (item.authorId !== 'me') { suppress = true; P().showView('contact-permissions', item.authorId); } };
        node.addEventListener('pointerdown', event => { if (event.button !== 0 || !event.isPrimary) return; suppress = false; start = {x:event.clientX,y:event.clientY}; timer = setTimeout(permissions, 550); });
        node.addEventListener('pointermove', event => { if (timer && Math.hypot(event.clientX-start.x,event.clientY-start.y)>10) { suppress = true; stop(); } });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, stop);
        node.addEventListener('contextmenu', event => { event.preventDefault(); stop(); permissions(); });
        node.addEventListener('click', event => { if (suppress && event.detail > 0) { suppress = false; return; } P().showView(item.authorId === 'me' ? 'profile' : 'role', item.authorId === 'me' ? undefined : item.authorId); });
        node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); } });
        momentHandlers?.signal.addEventListener('abort', stop, { once: true });
      });
    });
    on('.moment-expand', 'click', e => setMomentExpanded(e.currentTarget, e.currentTarget.getAttribute('aria-expanded') !== 'true'), root);
    on('.moment-actions', 'toggle', e => { if (e.currentTarget.open) document.querySelectorAll('.moment-actions[open]').forEach(menu => { if (menu !== e.currentTarget) menu.open = false; }); }, root);
    on('[data-like]', 'click', e => run(async () => { const button = e.currentTarget, id = button.dataset.like; button.disabled = true; button.closest('details').open = false; try { await mutation('moment.like', { id }); refreshMomentDetail(id); } finally { button.disabled = false; } }), root);
    on('[data-comment]', 'click', e => {
      const button = e.currentTarget; button.closest('details')?.removeAttribute('open');
      if (button.dataset.commentAuthor === 'me') return P().actionSheet('', [
        { label: '回复', run: () => commentMoment(button.dataset.comment, button.dataset.replyTo) },
        { label: '删除', danger: true, run: () => confirmDelete('删除评论', '删除这条评论？', async () => { await mutation('moment.comment.delete', { id: button.dataset.comment, commentId: button.dataset.replyTo }); refreshMomentDetail(button.dataset.comment); }) }
      ]);
      commentMoment(button.dataset.comment, button.dataset.replyTo);
    }, root);
    on('[data-delete-moment]', 'click', e => { const id = e.currentTarget.dataset.deleteMoment; confirmDelete('删除朋友圈', '删除这条朋友圈？', () => mutation('moment.delete', { id })); }, root);
    on('[data-photo]', 'click', e => { const item = state().moments.find(m => m.id === e.currentTarget.dataset.photo), images = momentImages(item), index = Number(e.currentTarget.dataset.photoIndex); P().openPhoto(images[index], '朋友圈照片', { images, index }); }, root);
  }

  function ledgerRows() {
    return (state().ledger || []).filter(item => String(item.date || '').slice(0, 7) === ui.month && (ui.category === 'all' || item.category === ui.category) && (ui.flow === 'all' || item.type === ui.flow)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  function renderLedger() {
    const monthly = (state().ledger || []).filter(item => String(item.date || '').slice(0, 7) === ui.month);
    const income = monthly.filter(e => e.type === 'income').reduce((sum, item) => sum + Number(item.amountCents), 0);
    const expense = monthly.filter(e => e.type === 'expense').reduce((sum, item) => sum + Number(item.amountCents), 0);
    const entries = ledgerRows();
    let previous = '';
    return `<div class="feature-page ledger-page"><div class="ledger-summary"><label class="month-picker"><input id="ledger-month" type="month" value="${esc(ui.month)}" aria-label="账本月份"></label><p>本月支出</p><div class="ledger-total"><small>¥</small>${money(expense)}</div><div class="ledger-subtotals"><span>收入 <strong>¥ ${money(income)}</strong></span><span>结余 <strong>¥ ${money(income - expense)}</strong></span></div></div><div class="ledger-quick-actions"><button id="ledger-add">${ledgerWriteIcon} 记一笔</button><button id="ledger-recognize">${icon('camera')} 拍照记账</button></div><div class="ledger-filter"><select id="ledger-flow" aria-label="收支筛选"><option value="all"${selected(ui.flow, 'all')}>全部收支</option><option value="expense"${selected(ui.flow, 'expense')}>支出</option><option value="income"${selected(ui.flow, 'income')}>收入</option></select><select id="ledger-category" aria-label="分类筛选"><option value="all">全部分类</option>${[...new Set([...categories, ...(state().ledger || []).map(x => x.category)])].map(c => `<option${selected(c, ui.category)} value="${esc(c)}">${esc(c)}</option>`).join('')}</select><span>${entries.length} 笔</span></div><div class="ledger-entries">${entries.length ? entries.map(item => { const day = item.date !== previous ? `<div class="ledger-day">${esc(item.date)}</div>` : ''; previous = item.date; return `${day}<button class="ledger-entry" data-ledger="${esc(item.id)}"><span class="ledger-category-icon">${icon('book')}</span><span class="ledger-entry-text"><strong>${esc(item.merchant || item.category || '未分类')}</strong><small>${esc(item.category)}${item.note ? ` · ${esc(item.note)}` : ''}</small></span><strong class="ledger-entry-amount ${item.type === 'income' ? 'income' : ''}">${item.type === 'income' ? '+' : '−'}${money(item.amountCents)}</strong></button>`; }).join('') : empty('', '暂无账单', '')}</div><div class="feature-bottom-note">现实账本仅你可见 · 与虚拟钱包独立</div></div>`;
  }
  function ledgerFields(item = {}, suffix = '') {
    const category = item.category || '餐饮';
    return `<div class="ledger-edit-fields">${field('type', '收支', `<select name="type${suffix}"><option value="expense"${selected(item.type || 'expense', 'expense')}>支出</option><option value="income"${selected(item.type, 'income')}>收入</option></select>`)}${field('amount', '金额（元）', `<input name="amount${suffix}" type="text" inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value="${item.amountCents ? esc((item.amountCents / 100).toFixed(2)) : ''}" placeholder="0.00" required maxlength="12">`)}${field('category', '分类', `<select name="category${suffix}">${[...new Set([...categories, category])].map(c => `<option value="${esc(c)}"${selected(c, category)}>${esc(c)}</option>`).join('')}</select>`)}${field('merchant', '商户 / 名称', `<input name="merchant${suffix}" value="${esc(item.merchant || '')}" placeholder="例如：街角早餐店" maxlength="100">`)}${field('date', '日期', `<input type="date" name="date${suffix}" value="${esc(item.date || today())}" required>`)}${field('note', '备注', `<input name="note${suffix}" value="${esc(item.note || '')}" placeholder="可选" maxlength="500">`)}</div>`;
  }
  function ledgerPayload(data, suffix = '') {
    const date = String(data.get(`date${suffix}`) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期');
    return { amountCents: centsFromInput(data.get(`amount${suffix}`)), type: data.get(`type${suffix}`), category: data.get(`category${suffix}`), merchant: String(data.get(`merchant${suffix}`) || '').trim(), date, note: String(data.get(`note${suffix}`) || '').trim() };
  }
  function editLedger(id) {
    const item = (state().ledger || []).find(entry => entry.id === id) || {};
    P().openModal(id ? '编辑账目' : '记一笔', `${ledgerFields(item)}${id ? '<button type="button" id="ledger-delete" class="feature-delete">删除这笔账目</button>' : ''}`, async form => { const payload = ledgerPayload(new FormData(form)); if (id) payload.id = id; await mutation('ledger.save', payload); if (form.isConnected) P().closeModal(); }, '保存账目');
    on('#ledger-delete', 'click', () => confirmDelete('删除账目', '删除后，这笔记录将从月度汇总中移除。', () => mutation('ledger.delete', { id })));
  }
  function recognizeLedger() {
    let drafts = [];
    let saving = false;
    P().openModal('拍照记账', `<div id="receipt-upload-stage"><div class="receipt-upload-illustration">${icon('camera')}</div><p class="feature-modal-copy">上传小票、账单或支付截图</p><p class="feature-note">将把所选图片发送给当前视觉模型，可能产生模型用量。识别结果只生成草稿，确认后才会入账。</p><label class="receipt-file-label">选择一张图片<input id="receipt-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><div id="receipt-status" role="status"></div></div><div id="receipt-drafts"></div>`, async form => {
      if (saving) return;
      if (!drafts.length) throw new Error('请先选择图片并完成识别');
      const data = new FormData(form);
      const included = drafts.map((item, index) => ({ index, item })).filter(({ index, item }) => !item._saved && data.get(`include-${index}`));
      if (!included.length) throw new Error('请至少选择一条草稿');
      const payloads = included.map(({ index }) => ({ index, payload: ledgerPayload(data, `-${index}`) }));
      saving = true;
      const fileInput = form.querySelector('#receipt-file');
      if (fileInput) fileInput.disabled = true;
      try {
        for (const { index, payload } of payloads) {
          if (!form.isConnected) break;
          if (drafts[index]._saved) continue;
          await P().act('ledger.save', payload);
          drafts[index]._saved = true;
          const card = form.querySelector(`[data-draft-index="${index}"]`);
          if (card) { card.querySelectorAll('input,select').forEach(el => { el.disabled = true; }); card.insertAdjacentHTML('beforeend', '<p class="receipt-saved">已入账</p>'); }
        }
        if (form.isConnected) P().closeModal(); P().refresh(); P().toast(`已确认 ${drafts.filter(item => item._saved).length} 笔账目`);
      } finally { saving = false; if (fileInput) fileInput.disabled = false; }
    }, '确认入账');
    document.querySelector('.page-editor .modal-submit')?.setAttribute('aria-label', '确认选中草稿并入账');
    on('#receipt-file', 'change', e => run(async () => {
      const input = e.target, form = input.closest('form'), status = form.querySelector('#receipt-status'), container = form.querySelector('#receipt-drafts');
      if (saving) return;
      if (!input.files[0]) return;
      drafts = []; container.innerHTML = '';
      input.disabled = true; status.textContent = '正在读取图片并调用视觉模型…';
      try {
        const image = await fileData(input.files[0]);
        if (!form.isConnected) return;
        const result = await P().api('/api/ledger/recognize', { image });
        if (!form.isConnected) return;
        drafts = Array.isArray(result.drafts) ? result.drafts.slice(0, 30) : [];
        status.textContent = drafts.length ? `识别到 ${drafts.length} 笔草稿，请核对金额、收支、日期和分类。` : '没有识别到账目。请换一张清晰图片，或手动记账。';
        container.innerHTML = drafts.map((item, index) => `<section class="receipt-draft" data-draft-index="${index}"><label class="receipt-draft-title"><input type="checkbox" name="include-${index}" checked> 第 ${index + 1} 笔草稿</label><fieldset>${ledgerFields(item, `-${index}`)}</fieldset></section>`).join('');
        container.querySelectorAll('[name^="include-"]').forEach(checkbox => checkbox.addEventListener('change', () => { checkbox.closest('.receipt-draft').querySelector('fieldset').disabled = !checkbox.checked; }));
      } catch (error) { if (form.isConnected) status.textContent = error.message || '识别失败，请检查视觉模型配置'; }
      finally { input.disabled = false; input.value = ''; }
    }));
  }
  function bindLedger() {
    on('#ledger-add', 'click', () => editLedger()); on('#ledger-recognize', 'click', recognizeLedger);
    on('[data-ledger]', 'click', e => editLedger(e.currentTarget.dataset.ledger));
    on('#ledger-month', 'change', e => { if (e.target.value) ui.month = e.target.value; P().refresh({resetScroll:true}); });
    on('#ledger-category', 'change', e => { ui.category = e.target.value; P().refresh({resetScroll:true}); });
    on('#ledger-flow', 'change', e => { ui.flow = e.target.value; P().refresh({resetScroll:true}); });
  }

  function renderWallet() {
    const wallet = state().wallet || { balanceCents: 0, transactions: [] };
    // Native wallet > balance hierarchy, adapted from fake-world/wallet/index.
    const row = (glyph, title, action, value, color) => `<button class="wallet-index-row" ${action} style="--wallet-icon-color:${color}">${nativeIcon(glyph)}<span>${title}</span>${value ? `<small>${value}</small>` : ''}${icon('chevron')}</button>`;
    return `<div class="feature-page wallet-index-page"><div class="wallet-index-group">${row('coin-outlined', '零钱', 'id="wallet-balance"', `¥${money(wallet.balanceCents)}`, '#ffc300')}${row('pay-mini-fund-outlined', '零钱通', 'data-coming="零钱通暂未开放"', '', '#ffc300')}${row('pay-cards-outlined', '银行卡', 'data-coming="银行卡暂未开放，不支持绑定真实银行卡"', '', '#2a7fcb')}${row('pay-relative-cards', '亲属卡', 'data-coming="亲属卡暂未开放"', '', '#fa9d3b')}</div><div class="wallet-footer"><span>虚拟钱包 · 无充值、提现或真实支付</span></div></div>`;
  }
  function walletBalance() {
    detailPage('零钱', `<div class="wallet-page wallet-balance-page"><button type="button" id="wallet-details" class="wallet-detail-link">零钱明细</button><div class="wallet-balance-card"><div class="wallet-coin">${nativeIcon('coin-filled')}</div><h2>我的零钱</h2><p class="wallet-balance${money(state().wallet?.balanceCents).length > 10 ? ' wallet-large-amount' : ''}"><span>¥</span>${money(state().wallet?.balanceCents)}</p><p class="wallet-balance-caption">虚拟余额</p><div class="wallet-actions"><button type="button" id="wallet-transfer">转账</button><button type="button" id="wallet-redpacket">发红包</button></div></div><div class="wallet-footer"><span>用于与好友互动 · 不涉及真实资金</span></div></div>`);
    detailHeaderAction('#wallet-details');
    on('#wallet-details', 'click', () => walletBills(walletBalance));
    on('#wallet-transfer', 'click', () => walletTransfer('transfer', undefined, { returnTo: walletBalance }));
    on('#wallet-redpacket', 'click', () => walletTransfer('redpacket', undefined, { returnTo: walletBalance }));
  }
  function walletBills(back) {
    const transactions = [...(state().wallet?.transactions || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let previous = '';
    detailPage('零钱明细', `<div class="wallet-bills-page"><div class="wallet-transactions">${transactions.length ? transactions.map(item => {
      const date = new Date(item.createdAt), month = Number.isNaN(date.getTime()) ? '未知日期' : `${date.getFullYear()}年${date.getMonth() + 1}月`;
      const heading = month !== previous ? `<div class="wallet-bill-month">${esc(month)}</div>` : ''; previous = month;
      const status = item.status || 'received', statusText = status === 'returned' ? '已退还' : status === 'pending' ? (item.direction === 'in' ? '待领取' : '待对方领取') : item.type === 'redpacket' ? '已领取' : item.direction === 'in' ? '已收款' : '已被接收';
      return `${heading}<button type="button" class="wallet-transaction" data-wallet-transaction="${esc(item.id)}" data-payment-status="${esc(status)}"><span class="wallet-transaction-icon ${item.type === 'redpacket' ? 'redpacket' : ''}">${nativeIcon(item.type === 'redpacket' ? 'pay-reward-outlined' : 'transfer2-outlined')}</span><div><strong>${item.type === 'redpacket' ? '红包' : '转账'}${item.direction === 'in' ? ' - 来自' : ' - 给'}${esc(label(item.roleId))}</strong><small>${esc(dateText(item.createdAt))}<span class="wallet-bill-status">${statusText}</span></small></div><strong class="${item.direction === 'in' ? 'income' : ''}">${item.direction === 'in' ? '+' : '−'}${money(item.amountCents)}</strong></button>`;
    }).join('') : empty('', '暂无零钱明细', '')}</div><div class="feature-bottom-note">仅记录虚拟钱包收支</div></div>`, back);
    on('[data-wallet-transaction]', 'click', event => walletTransaction(event.currentTarget.dataset.walletTransaction, () => walletBills(back)));
  }
  function walletTransaction(id, back, options = {}) {
    const item = state().wallet?.transactions?.find(entry => entry.id === id);
    if (!item) return P().toast('这笔交易记录不存在');
    const redpacket = item.type === 'redpacket', incoming = item.direction === 'in';
    const paymentStatus=item.status||'received',statusLabel=paymentStatus==='returned'?'已退还':paymentStatus==='pending'?(incoming?'待领取':'待对方领取'):redpacket?'已领取':incoming?'已收款':'已被接收';
    if (options.fromChat) {
      const status = statusLabel;
      const amount = money(item.amountCents);
      const sender = incoming ? item.roleId : 'me';
      const summary = redpacket
        ? `<div class="payment-detail-cover" aria-hidden="true"></div><div class="wallet-detail-person">${avatar(sender, 22)}<span>${esc(label(sender))}的红包</span></div><p class="wallet-detail-note">${esc(item.note || '恭喜发财，大吉大利')}</p>${item.stickerImage ? `<img class="redpacket-detail-sticker" src="${esc(item.stickerImage)}" alt="红包表情">` : ''}<p class="payment-detail-value"><span class="wallet-detail-amount">${amount}</span><span class="payment-detail-unit">元</span></p><p class="wallet-detail-status">${status}</p>`
        : `<div class="payment-detail-symbol" aria-hidden="true">${icon('transfer')}</div><p class="wallet-detail-status">${status}</p><p class="payment-detail-value"><span class="payment-detail-currency">¥</span><span class="wallet-detail-amount${amount.length > 9 ? ' wallet-large-amount' : ''}">${amount}</span></p>${item.note ? `<p class="wallet-detail-note">${esc(item.note)}</p>` : ''}<p class="payment-detail-recipient">${incoming ? '来自' : '转账给'}${esc(label(item.roleId))}</p>`;
      const actions=incoming&&paymentStatus==='pending'?'<div class="payment-handle-actions"><button type="button" class="primary-btn weui-btn weui-btn_primary" data-payment-handle="receive">领取</button><button type="button" class="secondary-btn" data-payment-handle="return">退还</button></div>':'';
      detailPage(redpacket ? '红包详情' : '转账详情', `<div class="wallet-transaction-detail payment-message-detail ${redpacket ? 'is-redpacket-detail' : 'is-transfer-detail'}" data-payment-status="${esc(paymentStatus)}"><div class="payment-detail-summary">${summary}</div>${actions}<div class="payment-detail-record"><span>${incoming ? '收到时间' : '发送时间'}</span><time>${esc(new Date(item.createdAt).toLocaleString('zh-CN'))}</time></div><button type="button" class="payment-detail-bill" id="payment-detail-bill">查看零钱明细${icon('chevron')}</button><p class="feature-bottom-note">虚拟互动记录，不涉及真实支付</p></div>`, back);
      on('#payment-detail-bill', 'click', () => walletTransaction(id, () => walletTransaction(id, back, options)));
      on('[data-payment-handle]','click',event=>run(async()=>{const button=event.currentTarget;button.disabled=true;try{await P().act('wallet.handle',{id,action:button.dataset.paymentHandle});walletTransaction(id,back,options);P().refresh();}finally{if(button.isConnected)button.disabled=false;}}));
      return;
    }
    const row = (title, value) => `<div class="wallet-detail-row"><span>${title}</span><strong>${esc(value)}</strong></div>`;
    detailPage(redpacket ? '红包详情' : '转账详情', `<div class="wallet-transaction-detail${redpacket ? ' is-redpacket-detail' : ' is-transfer-detail'}" data-payment-status="${esc(paymentStatus)}"><div class="wallet-detail-summary"><div class="wallet-detail-person">${avatar(item.roleId, 42)}<span>${esc(label(item.roleId))}</span></div><p class="wallet-detail-kind">${redpacket ? '红包' : '转账'}${incoming ? '收入' : '支出'}</p><p class="wallet-detail-amount${money(item.amountCents).length > 9 ? ' wallet-large-amount' : ''}">${incoming ? '+' : '−'}${money(item.amountCents)}</p><p class="wallet-detail-status">${statusLabel}</p>${item.note ? `<p class="wallet-detail-note">${esc(item.note)}</p>` : ''}${item.stickerImage ? `<img class="redpacket-detail-sticker" src="${esc(item.stickerImage)}" alt="红包表情">` : ''}</div><div class="wallet-detail-fields">${row(incoming ? '付款方' : '收款方', label(item.roleId))}${row('交易时间', new Date(item.createdAt).toLocaleString('zh-CN'))}${item.updatedAt ? row(paymentStatus === 'returned' ? '退还时间' : '领取时间', new Date(item.updatedAt).toLocaleString('zh-CN')) : ''}${row('支付方式', '虚拟零钱')}${row('交易单号', item.id)}</div><p class="feature-bottom-note">虚拟互动记录，不涉及真实支付</p></div>`, back);
  }
  function walletTransfer(type, initialRoleId, options = {}) {
    if (!roles().length) return P().toast('先去通讯录添加一个角色');
    const recipient = roles().find(role => role.id === initialRoleId);
    if (!recipient) {
      detailPage('选择朋友', `<div class="wallet-recipients">${roles().map(role => `<button type="button" class="wallet-recipient" data-wallet-person="${esc(role.id)}">${P().avatar(role, 44)}<span>${esc(role.remark || role.name)}</span>${icon('chevron')}</button>`).join('')}</div>`, options.returnTo);
      on('[data-wallet-person]', 'click', event => walletTransfer(type, event.currentTarget.dataset.walletPerson, { ...options, chooseRecipient: true }));
      return;
    }
    const id = requestId(), isRedpacket = type === 'redpacket';
    let sending = false, stickerImage = '';
    const onClose = options.fromChat ? () => P().goBack() : options.chooseRecipient ? () => walletTransfer(type, undefined, { ...options, chooseRecipient: false }) : options.returnTo;
    const amount = `<span class="pay-amount-text" aria-live="polite"></span><i class="pay-caret" aria-hidden="true"></i><input type="hidden" name="amount" aria-label="${isRedpacket ? '红包金额' : '转账金额'}">`;
    const key = (value, label = value, cls = '') => `<button type="button" class="pay-key ${cls}" data-pay-key="${value}" aria-label="${label}">${value === 'back' ? '<svg viewBox="0 0 28 20" width="28" height="20" aria-hidden="true"><path d="M9.300 1h15.700a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9.300a2 2 0 0 1-1.500-.700L1 10l6.800-8.300A2 2 0 0 1 9.300 1Z" fill="#1a1a1a"/><path d="m13.500 6.500 7 7m0-7-7 7" stroke="#fff" stroke-width="1.800" stroke-linecap="round"/></svg>' : value}</button>`;
    const keypad = `<div class="pay-keypad" role="group" aria-label="数字键盘">${key('1')}${key('2')}${key('3')}${key('back', '删除')}${key('4')}${key('5')}${key('6')}${isRedpacket ? '<button type="button" class="pay-key pay-key-action" data-pay-key="done">确定</button>' : '<button type="submit" class="pay-key pay-key-action wallet-pay-confirm" disabled>转账</button>'}${key('7')}${key('8')}${key('9')}${key('0', '0', 'pay-key-zero')}${key('.', '小数点')}</div>`;
    const transferNote = `<input type="hidden" name="note"><button type="button" class="wallet-pay-note" id="transfer-note-editor">添加转账说明</button><dialog class="transfer-note-dialog" aria-labelledby="transfer-note-title"><h3 id="transfer-note-title">添加转账说明</h3><input id="transfer-note-draft" maxlength="100" autocomplete="off" aria-label="转账说明" placeholder="转账说明"><div class="transfer-note-actions"><button type="button" data-note-cancel>取消</button><button type="button" id="transfer-note-save">确定</button></div></dialog>`;
    // Historical/secondary references, not an 8.0.80 screenshot match:
    // Youzan cover manual (2021), the accepted Android simulator and the public
    // 2025 transfer-note crop. See docs/PAYMENTS-VISUAL-REVIEW.md.
    const content = isRedpacket
      ? `<div class="wallet-pay-page is-redpacket" aria-label="发红包给${esc(label(recipient.id))}"><div class="redpacket-form"><div class="redpacket-amount-row" data-pay-focus role="button" tabindex="0" aria-label="输入红包金额"><span>金额</span><div class="pay-amount"><b>¥</b>${amount}</div></div><div class="redpacket-blessing"><input name="note" maxlength="100" placeholder="恭喜发财，大吉大利" aria-label="红包祝福语"><button type="button" id="redpacket-emoji" aria-label="选择红包表情">${nativeIcon('sticker-outlined')}<span aria-hidden="true">＋</span></button><div class="redpacket-selected-sticker" hidden><img alt="红包表情"><button type="button" aria-label="移除红包表情">×</button></div></div><button type="button" class="redpacket-cover-row" id="redpacket-cover"><span>红包封面</span>${icon('chevron')}</button></div><div class="redpacket-total" aria-label="红包金额汇总"><span>¥</span><strong id="redpacket-total">0.00</strong></div><button type="submit" class="wallet-pay-confirm" disabled>塞钱进红包</button>${keypad}<section class="redpacket-sticker-panel" aria-label="红包表情面板" hidden><div class="redpacket-sticker-tabs" role="tablist" aria-label="红包表情分类"><button type="button" role="tab" data-packet-tab="search" aria-selected="false" aria-label="搜索表情">${icon('search')}</button><button type="button" role="tab" data-packet-tab="favorites" aria-selected="true" aria-label="收藏表情">${icon('heart')}</button><button type="button" role="tab" data-packet-tab="selfie" aria-selected="false" aria-label="自拍表情"><img src="/vendor/fake-world/selfie-expression.png" alt=""></button><button type="button" data-packet-collapse aria-label="收起表情面板">${icon('chevron')}</button></div><div class="redpacket-sticker-content"></div><input type="file" data-packet-upload multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.bmp,.avif" hidden></section></div>`
      : `<div class="wallet-pay-page is-transfer"><div class="transfer-head"><div class="transfer-to"><strong>转账给 ${esc(label(recipient.id))}</strong><span>微信号：${esc(recipient.wechatId || '未设置')}</span></div>${P().avatar(recipient, 44)}</div><div class="transfer-sheet"><span class="transfer-label">转账金额</span><div class="pay-amount"><b>¥</b>${amount}</div>${transferNote}</div>${keypad}</div>`;
    P().openPage(isRedpacket ? '发红包' : '转账', content, async form => {
      if (sending) return;
      const data = new FormData(form), amountCents = centsFromInput(data.get('amount'));
      if (amountCents > Number(state().wallet?.balanceCents || 0)) throw new Error('虚拟余额不足');
      const note = String(data.get('note') || '').trim() || (isRedpacket ? '恭喜发财，大吉大利' : '');
      sending = true;
      const button = form.querySelector('.wallet-pay-confirm');
      button.disabled = true; button.textContent = '发送中…';
      try {
        await P().act('wallet.transfer', { roleId: recipient.id, amountCents, type: isRedpacket ? 'redpacket' : 'transfer', requestId: id, note, ...(stickerImage ? { stickerImage } : {}) });
        if (options.fromChat) P().scrollChatToBottom?.(recipient.id);
        if (form.isConnected) {
          closePage(false);
          if (options.fromChat) P().goBack();
          else options.returnTo?.();
        }
        if (!options.fromChat) P().refresh();

      } finally {
        sending = false;
        if (button.isConnected) { button.disabled = false; button.textContent = isRedpacket ? '塞钱进红包' : '转账'; }
      }
    }, isRedpacket ? '塞钱进红包' : '转账', onClose);
    const form = document.querySelector('#overlay > .page-editor .modal-form');
    const noteDialog = form.querySelector('.transfer-note-dialog');
    if (noteDialog) {
      const draft = noteDialog.querySelector('#transfer-note-draft');
      const editor = form.querySelector('#transfer-note-editor');
      on('#transfer-note-editor', 'click', () => {
        draft.value = form.elements.note.value;
        if(!P().openChildDialog(noteDialog))return;
        draft.focus(); draft.setSelectionRange(draft.value.length, draft.value.length);
      }, form);
      on('[data-note-cancel]', 'click', () => P().closeChildDialog(), noteDialog);
      on('#transfer-note-save', 'click', () => {
        form.elements.note.value = draft.value.trim();
        editor.textContent = form.elements.note.value || '添加转账说明';
        editor.classList.toggle('has-note', !!form.elements.note.value);
        P().closeChildDialog();
      }, noteDialog);
      // A note confirmation must not submit a transfer. Native dialog focus and
      // Escape stay in this layer, leaving the recipient and amount untouched.
      noteDialog.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); noteDialog.querySelector('#transfer-note-save').click(); }
        if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); P().closeChildDialog(); }
        event.stopPropagation();
      });
    }
    const updateAmount = () => {
      let cents = 0;
      try { cents = centsFromInput(form.elements.amount.value); } catch { /* incomplete amount */ }
      form.querySelectorAll('[type="submit"]').forEach(button => { button.disabled = sending || !cents; });
      const total = form.querySelector('#redpacket-total'); if (total) total.textContent = money(cents);
      const shown = form.querySelector('.pay-amount-text');
      if (shown) { shown.textContent = isRedpacket && !form.elements.amount.value ? '0.00' : form.elements.amount.value; shown.classList.toggle('pay-amount-long', form.elements.amount.value.length > 8); }
      form.querySelector('.pay-amount')?.classList.toggle('is-empty', !form.elements.amount.value);
    };
    form?.elements.amount.addEventListener('input', updateAmount);
    const pad = form.querySelector('.pay-keypad');
    const stickerPanel = form.querySelector('.redpacket-sticker-panel');
    const setInputMode = mode => {
      if (isRedpacket && mode !== 'note') form.elements.note.blur();
      pad.hidden = mode !== 'amount';
      form.classList.toggle('keypad-open', mode === 'amount');
      if (stickerPanel) stickerPanel.hidden = mode !== 'stickers';
      form.dataset.payInput = mode;
    };
    pad.addEventListener('click', event => {
      const button = event.target.closest('[data-pay-key]'); if (!button) return;
      const input = form.elements.amount, value = input.value, k = button.dataset.payKey;
      if (k === 'done') { setInputMode('none'); return; }
      let next = value;
      if (k === 'back') next = value.slice(0, -1);
      else if (k === '.') next = value.includes('.') ? value : (value || '0') + '.';
      else if (value === '0') next = k;
      else next = value + k;
      if (!/^\d{0,7}(\.\d{0,2})?$/.test(next)) return;
      input.value = next; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    setInputMode(isRedpacket ? 'none' : 'amount');
    on('[data-pay-focus]', 'click', () => setInputMode('amount'), form);
    updateAmount();
    on('#redpacket-cover', 'click', () => unavailable('当前使用默认红包封面，自定义封面暂未开放'));
    if (!isRedpacket) return;
    form.querySelector('.modal-header').insertAdjacentHTML('beforeend', `<span class="redpacket-header-more" aria-hidden="true">${icon('more')}</span>`);
    form.elements.note.addEventListener('focus', () => setInputMode('note'));
    form.addEventListener('keydown', event => {
      if (event.target === form.elements.note && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); setInputMode('none'); }
      if (event.target.matches('[data-pay-focus]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); setInputMode('amount'); }
      if (form.dataset.payInput === 'amount' && (/^[0-9.]$/.test(event.key) || event.key === 'Backspace')) { event.preventDefault(); pad.querySelector(`[data-pay-key="${event.key === 'Backspace' ? 'back' : event.key}"]`).click(); }
    });
    form.querySelector('.wallet-pay-page').addEventListener('click', event => {
      if (!event.target.closest('button,input,[data-pay-focus],.redpacket-sticker-panel')) setInputMode('none');
    });
    const preview = form.querySelector('.redpacket-selected-sticker');
    const selectSticker = value => {
      stickerImage = value; preview.hidden = !value;
      if (value) preview.querySelector('img').src = value;
      setInputMode('none');
    };
    preview.querySelector('button').addEventListener('click', () => selectSticker(''));
    const contentBox = stickerPanel.querySelector('.redpacket-sticker-content');
    let stickerTab = 'favorites';
    const drawStickers = () => {
      stickerPanel.querySelectorAll('[data-packet-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.packetTab === stickerTab)));
      if (stickerTab === 'favorites') contentBox.innerHTML = `<div class="redpacket-panel-handle" aria-hidden="true"></div><h3>表情库</h3><div class="sticker-grid"><button type="button" class="add-sticker" data-packet-add aria-label="添加收藏表情"><span aria-hidden="true">＋</span></button>${(state().stickers || []).map(sticker => `<button type="button" data-packet-sticker="${esc(sticker.id)}" aria-label="选择收藏表情"><img src="${esc(sticker.image)}" alt="收藏表情"></button>`).join('')}</div>`;
      if (stickerTab === 'selfie') contentBox.innerHTML = `<div class="emoji-unavailable">${icon('camera')}<p>自拍表情暂未开放</p></div>`;
      if (stickerTab === 'search') {
        contentBox.innerHTML = '<label class="redpacket-emoji-search"><input type="search" placeholder="搜索表情" aria-label="搜索红包表情"></label><div class="emoji-grid"></div>';
        const drawResults = query => {
          const matches = (window.PipiEmoji || []).filter(emoji => emoji.label.includes(query) || emoji.token.includes(query));
          contentBox.querySelector('.emoji-grid').innerHTML = matches.map(emoji => `<button type="button" data-packet-emoji="${esc(emoji.token)}" aria-label="${esc(emoji.label)}"><span class="wechat-emoji" style="background-position:${emoji.x}px ${emoji.y}px" aria-hidden="true"></span></button>`).join('') || '<p>没有找到表情</p>';
        };
        contentBox.querySelector('input').addEventListener('input', event => drawResults(event.target.value.trim())); drawResults('');
      }
    };
    on('#redpacket-emoji', 'click', () => { drawStickers(); setInputMode('stickers'); }, form);
    stickerPanel.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-packet-collapse')) { setInputMode('none'); return; }
      if (button.dataset.packetTab) { stickerTab = button.dataset.packetTab; drawStickers(); return; }
      if (button.hasAttribute('data-packet-add')) { stickerPanel.querySelector('[data-packet-upload]').click(); return; }
      if (button.dataset.packetSticker) selectSticker(state().stickers.find(sticker => sticker.id === button.dataset.packetSticker).image);
      if (button.dataset.packetEmoji) {
        const input = form.elements.note, next = input.value + button.dataset.packetEmoji;
        if (next.length > input.maxLength) { P().toast('祝福语最多100字'); return; }
        input.value = next; setInputMode('none');
      }
    });
    on('[data-packet-upload]', 'change', event => run(async () => {
      const fileInput = event.currentTarget, files = [...fileInput.files]; fileInput.value = ''; if (!files.length) return;
      const images=[];
      for(const file of files)images.push(await P().readImage(file,true));
      await P().act('sticker.add', { images, names:files.map(file=>file.name.replace(/\.[^.]+$/,'').slice(0,100)) });
      if (form.isConnected) { stickerTab = 'favorites'; drawStickers(); }
    }), stickerPanel);
  }
  function bindWallet(arg) {
    on('#wallet-balance', 'click', walletBalance);
    if (arg?.mode && arg?.roleId) walletTransfer(arg.mode, arg.roleId, { fromChat: true });
  }

  function remaining(raw) {
    const seconds = Math.max(0, Math.ceil((new Date(raw).getTime() - Date.now()) / 1000));
    if (!seconds) return '可以收获了';
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
    return hours ? `${hours}时${minutes}分` : minutes ? `${minutes}分${rest}秒` : `${rest}秒`;
  }
  function renderFarm(arg) {
    const roleId = arg?.roleId, root = state().farm || { coins: 0, seeds: 0, plots: [] };
    const farm = roleId ? root.friends?.[roleId] : root;
    if (!farm) return empty('', '找不到这个农场', '');
    const plots = farm.plots || [], config = root.cropConfig || {};
    const visited = (root.visits || []).some(v => v.roleId === roleId && v.date === utcToday());
    return `<div class="feature-page farm-page" data-farm-role="${esc(roleId || '')}">${roleId ? `<div class="farm-owner">${avatar(roleId, 44)}<strong>${esc(label(roleId))}的农场</strong></div>` : ''}<div class="farm-info"><span>农场币 <b>${esc(farm.coins)}</b></span><span>种子 <b>${esc(farm.seeds)}</b></span></div><div class="farm-board">${plots.map((plot, index) => {
      const crop = crops[plot.crop], ready = crop && new Date(plot.readyAt).getTime() <= Date.now();
      return `<button class="farm-plot ${crop ? ready ? 'is-ready' : 'is-growing' : 'is-empty'}" data-plot="${esc(plot.id)}"><span class="plot-label">${index + 1} 号地</span><span class="plot-soil"><span class="crop-sprout">${crop ? ready ? crop.emoji : '🌱' : '＋'}</span></span><strong>${crop ? esc(crop.name) : '空闲地块'}</strong><small ${crop && !ready ? `data-ready-at="${esc(plot.readyAt)}"` : ''}>${crop ? ready ? '点击收获' : esc(remaining(plot.readyAt)) : '点击播种'}</small></button>`;
    }).join('')}</div><div class="farm-help-note">胡萝卜约 ${Math.round((config.carrot?.durationMs || 300000) / 60000)} 分钟 · 番茄约 ${Math.round((config.tomato?.durationMs || 600000) / 60000)} 分钟成熟<br>每次收获返还 2 颗种子${roleId ? `<br>可代为管理本地好友农场；种子和奖励归该好友。${visited ? '今日已互助。' : '点生长中的地块浇水，缩短 1 分钟，每日一次。'}` : ''}</div>${roleId ? '' : `<div class="feature-section-label">好友农场</div><div class="farm-friends">${roles().filter(role => !role.permissions?.blocked).map(role => { const friend = root.friends?.[role.id], growing = friend?.plots.filter(plot => plot.crop).length || 0; return `<div class="farm-friend">${P().avatar(role, 38)}<div><strong>${esc(role.remark || role.name)}</strong><small>${growing ? `${growing} 块地已种植` : '空闲农场'}</small></div><button type="button" data-visit-farm="${esc(role.id)}">去看看</button></div>`; }).join('') || empty('', '暂无农场好友', '')}</div>`}<div class="feature-bottom-note">农场币独立于钱包 · 好友地块独立保存</div></div>`;
  }
  function bindFarm(arg) {
    const roleId = arg?.roleId, root = state().farm;
    if (roleId) document.querySelector('.topbar h2').textContent = `${label(roleId)}的农场`;
    const farm = roleId ? root.friends?.[roleId] : root;
    on('[data-visit-farm]', 'click', e => P().showView('farm', { roleId: e.currentTarget.dataset.visitFarm }));
    on('[data-plot]', 'click', e => {
      const button = e.currentTarget, plot = farm.plots.find(item => String(item.id) === button.dataset.plot);
      if (plot.crop) {
        if (new Date(plot.readyAt).getTime() > Date.now()) {
          if (!roleId) return P().toast(`还需 ${remaining(plot.readyAt)}`);
          const visited = (root.visits || []).some(v => v.roleId === roleId && v.date === utcToday());
          if (visited) return P().toast(`今日已互助，还需 ${remaining(plot.readyAt)}`);
          return P().actionSheet(`${crops[plot.crop].name} · 还需${remaining(plot.readyAt)}`, [{ label: '浇水互助', run: async () => { await mutation('farm.water', { roleId, plotId: plot.id }); P().toast('已浇水，生长时间缩短 1 分钟，获得 5 农场币'); } }]);
        }
        button.disabled = true;
        return run(async () => { try { await mutation('farm.harvest', { plotId: plot.id, ...(roleId ? {roleId} : {}) }); P().toast(roleId ? '奖励已存入好友农场' : '收获成功，奖励已存入农场'); } finally { if (button.isConnected) button.disabled = false; } });
      }
      const config = root.cropConfig || {};
      P().openModal(roleId ? `帮${label(roleId)}播种` : '播下一颗种子', `<div class="farm-seed-options">${Object.entries(crops).map(([key, crop], index) => `<label><input type="radio" name="crop" value="${key}"${index === 0 ? ' checked' : ''}><span>${crop.emoji}</span><strong>${crop.name}</strong><small>${Math.round((config[key]?.durationMs || (key === 'carrot' ? 300000 : 600000)) / 60000)} 分钟 · ${esc(config[key]?.reward || (key === 'carrot' ? 20 : 35))} 农场币</small></label>`).join('')}</div><p class="feature-note">每次消耗该农场 1 颗种子，收获返还 2 颗。现有 ${esc(farm.seeds)} 颗。</p>`, async form => { await mutation('farm.plant', { plotId: plot.id, crop: new FormData(form).get('crop'), ...(roleId ? {roleId} : {}) }); if (form.isConnected) P().closeModal(); }, '开始种植');
    });
    ui.farmTimer = setInterval(() => {
      if (!document.querySelector('.farm-page')) { clearInterval(ui.farmTimer); ui.farmTimer = null; return; }
      let refresh = false;
      document.querySelectorAll('[data-ready-at]').forEach(el => { const readyAt = Number(el.dataset.readyAt); if (readyAt <= Date.now()) refresh = true; else el.textContent = remaining(readyAt); });
      if (refresh) P().refresh();
    }, 1000);
  }

  function favoriteBody(item) {
    const image = item.type === 'image' && safeImage(item.content), voice = item.type === 'voice';
    const audio = voice && safeAudio(item.meta?.audio), images = (item.meta?.images || []).filter(safeImage);
    const seconds = Math.max(0, Math.round(item.meta?.durationMs ? Number(item.meta.durationMs) / 1000 : Number(item.meta?.duration || 0)));
    if (image) return `<button class="favorite-image-button" aria-label="查看收藏图片"><img class="favorite-image" src="${esc(image)}" alt="收藏的图片" loading="lazy"></button>`;
    if (voice) return `<div class="favorite-voice-content">${audio ? `<button class="favorite-voice" data-favorite-audio aria-label="播放收藏语音" aria-pressed="false">${nativeIcon('voice-outlined')}<span>语音</span><small>${seconds ? `${seconds}″` : ''}</small></button><audio class="favorite-audio" preload="none" src="${esc(audio)}"></audio>` : '<p class="favorite-voice-unavailable">语音不可用</p>'}${item.meta?.transcript ? `<p class="favorite-transcript">${esc(item.meta.transcript)}</p>${item.meta.transcriptSource === 'demo' ? '<small class="transcript-demo">演示预设文字，非真实识别结果</small>' : ''}` : ''}</div>`;
    return `<p class="favorite-content">${esc(item.content)}</p>${item.type === 'note' ? `<div class="favorite-note-images">${images.map((image, index) => `<button class="favorite-image-button" data-note-photo-index="${index}" aria-label="查看笔记第${index + 1}张图片"><img class="favorite-image" src="${esc(image)}" alt="笔记图片" loading="lazy"></button>`).join('')}</div><ul class="favorite-todos">${(item.meta?.todos || []).map(todo => `<li class="${todo.done ? 'is-done' : ''}"><span aria-hidden="true">${todo.done ? '☑' : '☐'}</span><span>${esc(todo.text)}</span></li>`).join('')}</ul>` : ''}`;
  }
  function renderFavorites() {
    const items = [...(state().favorites || [])].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return `<div class="feature-page favorites-page${ui.favoriteSelection ? ' is-selecting' : ''}"><div class="favorites-search"><label>${nativeIcon('search-outlined')}<input id="favorite-search" type="search" placeholder="搜索" value="${esc(ui.favoriteQuery)}" aria-label="搜索收藏"></label></div><div class="favorites-tabs" role="group" aria-label="收藏类型">${[['all', '全部'], ['text', '文字'], ['image', '图片'], ['voice', '语音'], ['note', '笔记']].map(([kind, title]) => `<button data-favorite-kind="${kind}" aria-pressed="${ui.favoriteKind === kind}">${title}</button>`).join('')}</div><div class="favorites-heading"><span>全部收藏 · ${items.length} 条</span>${items.length && !ui.favoriteSelection ? '<button id="favorite-select" type="button">多选</button>' : ''}</div>${items.length ? `<div class="favorite-list">${items.map(item => {
      const message = (state().messages || []).find(m => m.id === item.messageId);
      const description = item.type === 'image' ? '图片' : item.type === 'voice' ? '语音' : (item.content || '笔记').slice(0,48);
      const selectionAttrs = ui.favoriteSelection
        ? `role="checkbox" aria-checked="${ui.favoriteSelection.has(item.id)}" aria-label="选择收藏，${esc(description)}"`
        : 'role="button" aria-label="查看收藏详情"';
      return `<article class="favorite-card" data-favorite-id="${esc(item.id)}" data-favorite-type="${esc(item.type)}" tabindex="0" ${selectionAttrs}>${ui.favoriteSelection ? `<input class="favorite-check" type="checkbox" tabindex="-1" aria-hidden="true"${ui.favoriteSelection.has(item.id) ? ' checked' : ''}>` : ''}<div class="favorite-card-body"${ui.favoriteSelection ? ' inert' : ''}>${favoriteBody(item)}<div class="favorite-source">${message ? avatar(message.roleId, 22) : `<span class="favorite-star">${nativeIcon('favorites')}</span>`}<span>${message ? esc(label(message.roleId)) : item.type === 'note' ? '我的笔记' : '我的收藏'}</span><small>${esc(dateText(item.updatedAt || item.createdAt))}</small></div></div></article>`;
    }).join('')}</div><div id="favorite-no-results" class="feature-empty" hidden>没有找到相关收藏</div>` : empty('', '暂无收藏', '')}${ui.favoriteSelection ? `<div class="favorite-selection-bar"><button type="button" id="favorite-select-all">全选</button><span id="favorite-selected-count">已选 ${ui.favoriteSelection.size} 条</span><button type="button" id="favorite-delete-selected"${ui.favoriteSelection.size ? '' : ' disabled'}>删除</button></div>` : ''}</div>`;
  }

  function stopFavoriteAudio(root = document, except) {
    root.querySelectorAll('.favorite-audio').forEach(audio => {
      if (audio !== except) { audio.pause(); audio.currentTime = 0; }
    });
  }
  function bindFavoriteMedia(root = document) {
    on('[data-favorite-audio]', 'click', event => run(async () => {
      const button = event.currentTarget, audio = button.nextElementSibling;
      if (!audio.paused) { audio.pause(); audio.currentTime = 0; return; }
      stopFavoriteAudio(document, audio);
      try { await audio.play(); }
      catch { throw new Error('语音暂时无法播放，请检查音频格式或稍后重试'); }
    }), root);
    root.querySelectorAll('.favorite-audio').forEach(audio => {
      const button = audio.previousElementSibling;
      const playing = value => { button.setAttribute('aria-pressed', String(value)); button.setAttribute('aria-label', value ? '停止播放收藏语音' : '播放收藏语音'); button.querySelector('span:not(.fw-feature-icon)').textContent = value ? '正在播放' : '语音'; };
      playing(!audio.paused);
      audio.addEventListener('play', () => playing(true));
      audio.addEventListener('pause', () => playing(false));
      audio.addEventListener('ended', () => playing(false));
      audio.addEventListener('error', () => { playing(false); });
    });
    on('.favorite-image-button', 'click', e => { const button = e.currentTarget, container = button.closest('.favorite-card, .favorite-detail'), buttons = [...container.querySelectorAll('.favorite-image-button')], images = buttons.map(item => item.querySelector('img').getAttribute('src')), index = buttons.indexOf(button); P().openPhoto(images[index], '收藏的图片', { images, index }); }, root);
  }
  function favoriteDetail(id) {
    const item = state().favorites.find(entry => entry.id === id);
    if (!item) return P().toast('这条收藏已删除');
    stopFavoriteAudio();
    const open = document.querySelector('.page-editor') ? P().openNestedPage : P().openPage;
    let detail;
    open('收藏详情', `<div class="favorite-detail" data-favorite-detail="${esc(id)}"></div>`, null, undefined, () => { if (detail) stopFavoriteAudio(detail); });
    detail = paintFavoriteDetail(id);
  }
  function paintFavoriteDetail(id) {
    const detail = document.querySelector(`[data-favorite-detail="${id}"]`), item = state().favorites.find(entry => entry.id === id);
    if (!detail || !item) return;
    stopFavoriteAudio(detail);
    const message = state().messages.find(entry => entry.id === item.messageId);
    detail.innerHTML = `${favoriteBody(item)}<div class="favorite-source"><span>${esc(item.type === 'note' ? '我的笔记' : message ? label(message.roleId) : '我的收藏')}</span><small>${esc(dateText(item.updatedAt || item.createdAt))}</small></div>`;
    const header = detail.closest('.page-editor').querySelector('.modal-header');
    const button = document.createElement('button'); button.type = 'button'; button.id = 'favorite-more'; button.className = 'feature-header-action'; button.setAttribute('aria-label', '更多'); button.innerHTML = nativeIcon('more-filled');
    header.lastElementChild.replaceWith(button);
    bindFavoriteMedia(detail);
    button.onclick = () => {
      stopFavoriteAudio(detail);
      P().actionSheet('', [
      ...(item.type === 'note' ? [{ label: '编辑笔记', run: () => editFavorite(id) }] : [{ label: '查看来源', run: () => { if (!message) return P().toast('原消息已删除，收藏内容仍然保留'); closePage(false); P().openChatMessage(message.roleId, message.id); } }]),
      { label: '删除', danger: true, run: () => confirmDelete('删除收藏', '只删除这条收藏，原始聊天消息会保留。', () => mutation('favorite.delete', { id })) }
      ]);
    };
    return detail;
  }
  function editFavorite(id) {
    const item = id ? state().favorites.find(entry => entry.id === id) : null;
    const images = [...(item?.meta?.images || [])];
    const open = document.querySelector('.page-editor') ? P().openNestedPage : P().openModal;
    open(id ? '编辑笔记' : '新建笔记', `<div class="favorite-note-editor"><textarea name="content" maxlength="10000" rows="8" placeholder="记录此刻的想法" aria-label="笔记正文">${esc(item?.content || '')}</textarea><div id="note-images" class="note-image-editor"></div><div class="note-todo-editor" id="note-todos">${(item?.meta?.todos || []).map(todo => `<div data-note-todo="${esc(todo.id)}"><input type="checkbox" aria-label="已完成"${todo.done ? ' checked' : ''}><input type="text" value="${esc(todo.text)}" maxlength="500" aria-label="待办内容"><button type="button" data-remove-todo aria-label="移除待办">×</button></div>`).join('')}</div><div class="note-editor-tools"><label>添加图片<input id="note-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple></label><button type="button" id="note-add-todo">添加待办</button></div></div>`, async form => {
      const content = String(new FormData(form).get('content') || '').trim();
      const todos = [...form.querySelectorAll('[data-note-todo]')].map(row => ({ id: row.dataset.noteTodo, text: row.querySelector('input[type=text]').value.trim(), done: row.querySelector('input[type=checkbox]').checked }));
      if (todos.some(todo => !todo.text)) throw new Error('请填写待办内容，或移除空待办');
      if (!content && !images.length && !todos.length) throw new Error('请添加文字、图片或待办');
      await mutation('favorite.save', { ...(id ? {id} : {}), content, images, todos });
      if (form.isConnected) { closePage(); if (id) paintFavoriteDetail(id); }
    }, '保存');
    const form = document.querySelector('#overlay > .page-editor .modal-form');
    const drawImages = () => {
      form.querySelector('#note-images').innerHTML = images.map((image, index) => `<div class="note-image-item"><button type="button" data-note-preview="${index}" aria-label="预览笔记图片${index + 1}"><img src="${esc(image)}" alt="笔记图片${index + 1}"></button><button type="button" data-note-remove="${index}" aria-label="移除笔记图片${index + 1}">×</button></div>`).join('');
      on('[data-note-preview]', 'click', e => { const index = Number(e.currentTarget.dataset.notePreview); P().openPhoto(images[index], '笔记图片', { images, index }); }, form);
      on('[data-note-remove]', 'click', e => { images.splice(Number(e.currentTarget.dataset.noteRemove), 1); drawImages(); }, form);
      form.querySelector('.note-editor-tools > label').hidden = images.length === 9;
    };
    drawImages();
    on('#note-image-input', 'change', e => run(async () => { const files = [...e.target.files]; if (images.length + files.length > 9) { e.target.value = ''; throw new Error('每篇笔记最多 9 张图片'); } const additions = await Promise.all(files.map(file => fileData(file))); if (form.isConnected) { images.push(...additions); e.target.value = ''; drawImages(); } }), form);
    on('#note-add-todo', 'click', () => { const row = document.createElement('div'); row.dataset.noteTodo = requestId(); row.innerHTML = '<input type="checkbox" aria-label="已完成"><input type="text" maxlength="500" aria-label="待办内容" placeholder="待办事项"><button type="button" data-remove-todo aria-label="移除待办">×</button>'; form.querySelector('#note-todos').append(row); row.querySelector('input[type=text]').focus(); }, form);
    form.querySelector('#note-todos').addEventListener('click', event => { if (event.target.closest('[data-remove-todo]')) event.target.closest('[data-note-todo]').remove(); });
  }
  function selectFavorites(initialId) {
    ui.favoriteScroll = document.querySelector('.feature-content').scrollTop;
    ui.favoriteSelection = new Set(initialId ? [initialId] : []);
    history.pushState({ ...history.state, featureSelection: 'favorites' }, '');
    P().refresh();
  }
  function favoriteSelectionBack(source) {
    if (ui.favoriteSelectionFinished) {
      if (source === 'history' && history.state?.featureSelection === 'favorites') { history.back(); return true; }
      ui.favoriteSelectionFinished = false; ui.favoriteSelection = null; P().refresh(); return true;
    }
    if (!ui.favoriteSelection) return false;
    if (source === 'button') { history.back(); return true; }
    if (history.state?.featureSelection === 'favorites') return false;
    ui.favoriteSelection = null; P().refresh(); return true;
  }
  let favoriteHandlers;
  function bindFavorites() {
    favoriteHandlers?.abort(); favoriteHandlers = new AbortController();
    const content = document.querySelector('.feature-content');
    content.scrollTop = ui.favoriteScroll;
    content.addEventListener('scroll', () => { ui.favoriteScroll = content.scrollTop; }, { passive: true, signal: favoriteHandlers.signal });
    const header = document.querySelector('.topbar'), selecting = Boolean(ui.favoriteSelection);
    if (selecting) {
      const back = header.querySelector('.back-btn'); back.textContent = '取消'; back.setAttribute('aria-label', '取消选择');
      const bar = document.querySelector('.favorite-selection-bar'); document.querySelector('.phone-shell').append(bar);
    } else {
      const add = document.createElement('button'); add.id = 'favorite-new'; add.className = 'nav-text'; add.textContent = '＋'; add.setAttribute('aria-label', '新建笔记'); header.querySelector('.header-actions').append(add); add.onclick = () => editFavorite();
      bindFavoriteMedia(document.querySelector('.favorites-page'));
    }
    const updateSelected = () => {
      if (!ui.favoriteSelection) return;
      const count = ui.favoriteSelection.size; header.querySelector('h2').textContent = count ? `已选择 ${count} 项` : '选择收藏';
      document.querySelector('#favorite-selected-count').textContent = `已选 ${count} 条`; document.querySelector('#favorite-delete-selected').disabled = !count;
      content.querySelectorAll('.favorite-card').forEach(card => {
        const checked = ui.favoriteSelection.has(card.dataset.favoriteId);
        card.setAttribute('aria-checked', String(checked));
        card.querySelector('.favorite-check').checked = checked;
        card.classList.toggle('is-selected', checked);
      });
    };
    const toggle = id => { if (ui.favoriteSelection.has(id)) ui.favoriteSelection.delete(id); else { if (ui.favoriteSelection.size >= 100) return P().toast('每次最多选择 100 条'); ui.favoriteSelection.add(id); } updateSelected(); };
    on('#favorite-select', 'click', () => selectFavorites());
    on('#favorite-select-all', 'click', () => { const ids = [...document.querySelectorAll('.favorite-card:not([hidden])')].map(card => card.dataset.favoriteId); if (ids.length > 100) return P().toast('每次最多选择 100 条，请缩小筛选范围'); const all = ids.every(id => ui.favoriteSelection.has(id)); ids.forEach(id => all ? ui.favoriteSelection.delete(id) : ui.favoriteSelection.add(id)); updateSelected(); });
    on('#favorite-delete-selected', 'click', () => { const ids = [...ui.favoriteSelection]; confirmDelete('删除收藏', `删除选中的 ${ids.length} 条收藏？原始聊天消息会保留。`, async () => { await P().act('favorite.deleteMany', { ids }); ui.favoriteSelection = null; ui.favoriteSelectionFinished = true; }); });
    document.querySelectorAll('.favorite-card').forEach(card => {
      const id = card.dataset.favoriteId;
      if (selecting) { card.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); toggle(id); }, true); return; }
      let timer, origin, suppress = false;
      const stop = () => { clearTimeout(timer); timer = null; };
      const menu = () => { stop(); suppress = true; P().actionSheet('', [
        ...(state().favorites.find(item => item.id === id).type === 'note' ? [{ label: '编辑笔记', run: () => editFavorite(id) }] : []),
        { label: '多选', run: () => selectFavorites(id) },
        { label: '删除', danger: true, run: () => confirmDelete('删除收藏', '只删除这条收藏，原始聊天消息会保留。', () => mutation('favorite.delete', { id })) }
      ]); };
      card.addEventListener('pointerdown', event => { if (event.button !== 0 || !event.isPrimary) return; stop(); suppress = false; origin = { x: event.clientX, y: event.clientY }; timer = setTimeout(menu, 550); });
      card.addEventListener('pointermove', event => { if (timer && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) { suppress = true; stop(); } });
      card.addEventListener('pointerup', stop);
      card.addEventListener('pointercancel', () => { suppress = true; stop(); });
      card.addEventListener('pointerleave', () => { if (timer) { suppress = true; stop(); } });
      // A touch release can generate a click on the sheet that just opened.
      card.addEventListener('touchend', event => { if (suppress && event.cancelable) event.preventDefault(); }, { passive: false });
      card.addEventListener('contextmenu', event => { event.preventDefault(); menu(); });
      card.addEventListener('click', event => { if (suppress && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); suppress = false; } }, true);
      card.addEventListener('click', event => { if (!event.target.closest('button,audio')) favoriteDetail(id); });
      favoriteHandlers.signal.addEventListener('abort', stop, { once: true });
    });
    on('.favorite-card', 'keydown', event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selecting ? toggle(event.currentTarget.dataset.favoriteId) : favoriteDetail(event.currentTarget.dataset.favoriteId); } });
    const filter = () => {
      let count = 0;
      document.querySelectorAll('.favorite-card').forEach(card => { card.hidden = (ui.favoriteKind !== 'all' && card.dataset.favoriteType !== ui.favoriteKind) || !card.textContent.toLocaleLowerCase().includes(ui.favoriteQuery.trim().toLocaleLowerCase()); if (!card.hidden) count++; });
      const noResults = document.querySelector('#favorite-no-results'); if (noResults) noResults.hidden = count > 0;
      document.querySelectorAll('[data-favorite-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.favoriteKind === ui.favoriteKind)));
    };
    on('#favorite-search', 'input', e => { ui.favoriteQuery = e.target.value; filter(); });
    on('[data-favorite-kind]', 'click', e => { ui.favoriteKind = e.currentTarget.dataset.favoriteKind; filter(); });
    filter(); updateSelected();
  }
  function renderServices() {
    const wallet = state().wallet || {};
    const pending = (glyph, title, color) => `<button class="service-entry" data-coming="${title}暂未开放" style="--service-color:${color}"><span>${nativeIcon(glyph)}</span><strong>${title}</strong></button>`;
    return `<div class="feature-page services-page"><div class="services-wallet"><button data-coming="收付款暂未接入，不能进行真实收付款"><span class="services-pay-icon">${nativeIcon('pay-vendor')}</span><strong>收付款</strong></button><button data-feature-view="wallet"><span class="services-pay-icon">${nativeIcon('wallet-outlined')}</span><strong>钱包</strong><small>¥ ${money(wallet.balanceCents)}</small></button></div><div class="services-group"><h3>金融理财</h3><div class="services-grid"><button class="service-entry" data-feature-view="ledger" style="--service-color:#eda131"><span>${icon('book')}</span><strong>现实账本</strong></button>${pending('pay-cards-outlined', '信用卡还款', '#e7a13c')}${pending('pay-mini-fund-outlined', '理财通', '#e7a13c')}</div></div><div class="services-group"><h3>生活服务</h3><div class="services-grid">${pending('display-mobile-outlined', '手机充值', '#289ee8')}${pending('coin-outlined', '生活缴费', '#34ae7e')}${pending('mini-program-2-outlined', '城市服务', '#429dda')}</div></div><p class="feature-bottom-note">钱包内为虚拟余额 · 现实账本独立记录收支</p></div>`;
  }

  function bindCommon() {
    on('[data-feature-view]', 'click', e => P().showView(e.currentTarget.dataset.featureView));
    on('[data-coming]', 'click', e => unavailable(e.currentTarget.dataset.coming));
  }
  window.PipiFeatures = {
    render(name, arg) {
      clearTimeout(ui.albumStatusTimer); ui.albumStatusTimer = null;
      if (name !== 'favorites') { ui.favoriteSelection = null; ui.favoriteSelectionFinished = false; }
      if (ui.farmTimer) { clearInterval(ui.farmTimer); ui.farmTimer = null; }
      closeComment();
      momentHandlers?.abort();
      favoriteHandlers?.abort();
      const views = { moments: renderMoments, 'moment-album': renderMomentAlbum, ledger: renderLedger, wallet: renderWallet, farm: renderFarm, favorites: renderFavorites, services: renderServices };
      return views[name] ? views[name](arg) : empty('🌱', '即将相遇', '这个功能暂未开放。');
    },
    bind(name, arg) {
      bindCommon();
      ({ moments: bindMoments, 'moment-album': bindMomentAlbum, ledger: bindLedger, wallet: bindWallet, farm: bindFarm, favorites: bindFavorites })[name]?.(arg);
    },
    transfer: walletTransfer,
    walletTransaction,
    walletBills,
    cleanup() { closeComment(); clearTimeout(ui.albumStatusTimer); ui.albumStatusTimer = null; momentHandlers?.abort(); favoriteHandlers?.abort(); document.querySelector('.favorite-selection-bar')?.remove(); if (ui.farmTimer) { clearInterval(ui.farmTimer); ui.farmTimer = null; } stopFavoriteAudio(); },
    handleBack: favoriteSelectionBack,
    captureMomentExpansion,
    restoreMomentExpansion,
    composeMoment,
    openMomentCamera,
    manageMoments
  };
})();
