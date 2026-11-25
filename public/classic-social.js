// The classic edition uses the normal app's routes, records and action buttons.
(() => {
  'use strict';
  if (document.body.classList.contains('wx-classic-preview')) return;
  let chatFilter = 'all';

  function conversations(view, state) {
    const list = view.querySelector('.conversation-list');
    const rows = Array.from(list.querySelectorAll('.conversation-wrap'));
    const friends = new Map(state.roles.map(friend => [friend.id, friend]));
    const filters = [
      {
        key: 'all', label: '全部', matches: () => true,
        badge: items => items.reduce((sum, {friend}) => sum + (friend && !friend.muted ? Number(friend.unread) || 0 : 0), 0),
        describe: n => n > 0 ? '全部，' + (n > 99 ? '99 条以上' : n + ' 条') + '未读消息' : '全部'
      },
      {
        key: 'unread', label: '未读', matches: friend => friend.unread > 0,
        badge: items => items.filter(({friend}) => friend.unread > 0).length,
        describe: n => n > 0 ? '未读，' + (n > 99 ? '99 个以上' : n + ' 个') + '未读会话' : '未读'
      },
      {
        key: 'pinned', label: '置顶', matches: friend => friend.pinned,
        badge: items => items.filter(({friend}) => friend.pinned && friend.unread > 0).length,
        describe: n => n > 0 ? '置顶，' + (n > 99 ? '99 个以上' : n + ' 个') + '未读置顶会话' : '置顶'
      }
    ];
    view.querySelector('.topbar h2').textContent = 'WeChat';
    const bar = document.createElement('nav');
    bar.className = 'classic-chat-filters';
    bar.setAttribute('aria-label', '筛选聊天');
    list.parentElement.before(bar);
    const empty = document.createElement('p');
    empty.className = 'classic-filter-empty';
    empty.setAttribute('role', 'status');
    list.append(empty);
    const visibleRows = rows.map(row => {
      const conv = row.querySelector('[data-open-chat]');
      const friend = friends.get(conv.dataset.openChat);
      if (friend?.muted || row.querySelector('.conversation-muted')) conv.classList.add('is-muted');
      return {row, friend};
    });
    function selectFilter(filter) {
      chatFilter = filter.key;
      for (const {row, friend} of visibleRows) row.hidden = !filter.matches(friend);
      for (const group of list.querySelectorAll('.waterdrop-conversation-group')) {
        group.hidden = !group.querySelector('.conversation-wrap:not([hidden])');
      }
      for (const button of bar.children) button.setAttribute('aria-pressed', String(button.dataset.filter === chatFilter));
      empty.textContent = filter.key === 'unread' ? '暂时没有未读消息' : '还没有置顶聊天';
      empty.hidden = !rows.length || visibleRows.some(({row}) => !row.hidden);
    }
    for (const filter of filters) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.filter = filter.key;
      const label = document.createElement('span');
      label.className = 'filter-label';
      label.textContent = filter.label;
      const badgeCount = filter.badge(visibleRows);
      const description = filter.describe(badgeCount);
      button.setAttribute('aria-label', description);
      button.title = description;
      const count = document.createElement('small');
      count.className = 'filter-badge';
      count.setAttribute('aria-hidden', 'true');
      if (badgeCount > 0) {
        count.textContent = badgeCount > 99 ? '99+' : String(badgeCount);
      } else {
        count.hidden = true;
      }
      label.append(count);
      button.append(label);
      button.onclick = () => { selectFilter(filter); list.parentElement.scrollTop = 0; };
      bar.append(button);
    }
    selectFilter(filters.find(filter => filter.key === chatFilter));
  }

  function contact(view, route, state) {
    const friend = state.roles.find(item => item.id === route.arg);
    if (!friend) return;
    if (route.name === 'role') {
      const copy = view.querySelector('.role-hero > div');
      if (friend.bio) {
        const bio = document.createElement('p');
        bio.className = 'classic-friend-bio';
        bio.textContent = friend.bio;
        copy.append(bio);
      }
      if (!friend.remark && !friend.tags.length) view.querySelector('.friend-profile-cell .cell-desc').textContent = '未填写';
    }
    if (route.name === 'friend-profile' || route.name === 'contact-settings') {
      for (const row of view.querySelectorAll('[data-action="contact-remark"]')) {
        if (row.querySelector('.cell-value')) continue;
        const value = document.createElement('span');
        const remark = route.name === 'contact-settings' ? friend.remark : '';
        value.className = 'cell-value' + (remark ? '' : ' classic-empty-value');
        value.textContent = remark || '未填写';
        row.querySelector('.cell-body').after(value);
      }
    }
    if (route.name === 'contact-more') {
      const fields = [friend.region, friend.bio];
      for (const [index, row] of Array.from(view.querySelectorAll('.contact-more-info .info-line')).entries()) {
        row.querySelector('p').classList.toggle('classic-empty-value', index < fields.length && !fields[index]);
      }
    }
    if (route.name === 'chat-info') {
      const title = view.querySelector('[data-action="chat-background"] .cell-body');
      const value = document.createElement('span');
      value.className = 'cell-value';
      if (!friend.chatBackground) value.dataset.skinWallpaperName = '';
      value.textContent = friend.chatBackground ? '自选图片' : window.PipiSkins?.wallpaperName || '经典浅灰';
      title.after(value);
    }
  }
  window.ClassicSocial = { decorate(view, route, state) {
    if (route.name === 'chats') conversations(view, state);
    if (['role','friend-profile','contact-settings','contact-more','chat-info'].includes(route.name)) contact(view, route, state);
    window.WaterdropShell?.decorate(view, route);
  } };
})();
