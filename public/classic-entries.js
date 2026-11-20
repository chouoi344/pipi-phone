/* SPDX-License-Identifier: AGPL-3.0-only */
(() => {
  'use strict';
  const P = () => window.Pipi;
  const name = friend => friend.remark || friend.name;
  const esc = value => P().esc(value);

  function sheet(title, html, nested = false, onClose) {
    if (nested) P().openNestedPage(title, html, null, undefined, onClose);
    else P().openModal(title, html, null);
    const root = document.querySelector('#overlay > .page-editor');
    root.classList.add('classic-entry-sheet');
    const backdrop = document.createElement('div');
    backdrop.className = 'classic-entry-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    let pressed = false;
    backdrop.onpointerdown = event => { pressed = event.target === backdrop; };
    backdrop.onpointercancel = () => { pressed = false; };
    backdrop.onclick = event => { if (pressed && event.target === backdrop) P().closeModal(); pressed = false; };
    root.before(backdrop);
    return root;
  }

  function identity(friend) {
    return `<div class="classic-entry-identity">${P().avatar(friend, 56)}<div><strong>${esc(name(friend))}</strong><span>微信号：${esc(friend.wechatId || '未设置')}</span></div></div>`;
  }

  function card(friend, title, nested = false, onClose) {
    const root = sheet(title, identity(friend) + '<p class="classic-entry-note">可以复制资料，自行粘贴分享。</p><button type="button" class="classic-entry-primary" data-entry-copy>复制名片</button><p class="classic-entry-status" role="status" aria-live="polite"></p>', nested, onClose);
    const copy = root.querySelector('[data-entry-copy]');
    copy.onclick = async () => {
      copy.disabled = true;
      const status = root.querySelector('.classic-entry-status');
      try {
        await navigator.clipboard.writeText('姓名：' + name(friend) + '\n微信号：' + (friend.wechatId || '未设置'));
        status.textContent = '名片已复制';
      } catch {
        status.textContent = '复制失败，请选中上方资料手动复制。';
      } finally { copy.disabled = false; }
    };
  }

  function cards(friends, title) {
    const root = sheet(title, '<p class="classic-entry-note">选择一位已有朋友，查看并复制名片。</p><div class="classic-entry-people">' + friends.map(friend => `<button type="button" class="classic-entry-person" data-entry-friend="${esc(friend.id)}">${P().avatar(friend, 40)}<span><strong>${esc(name(friend))}</strong><small>微信号：${esc(friend.wechatId || '未设置')}</small></span>${P().icons.chevron}</button>`).join('') + '</div>' + (friends.length ? '' : '<p class="classic-entry-note">暂无朋友，可先在通讯录添加。</p>'));
    for (const button of root.querySelectorAll('[data-entry-friend]')) {
      button.onclick = () => {
        const friend = friends.find(item => item.id === button.dataset.entryFriend);
        const body = root.querySelector('.modal-body'), position = body.scrollTop;
        card(friend, title, true, () => { body.scrollTop = position; });
      };
    }
  }

  const titles = {
    'coming-report':'投诉', 'coming-contact-card':'个人名片', 'coming-call':'音视频通话',
    'coming-video':'视频通话', 'coming-group':'群聊', 'coming-camera':'拍摄',
    'coming-location':'位置', 'coming-file':'文件', 'coming-cards':'卡券',
    'coming-music':'音乐', 'coming-gift':'礼物', 'coming-scan':'扫一扫',
    'coming-pay':'收付款', 'coming-radar':'雷达加朋友', 'coming-phone-contacts':'手机联系人',
    'coming-work-contacts':'企业微信联系人'
  };

  window.ClassicEntries = {
    open(action, { route, state, trigger }) {
      if (!document.body.classList.contains('wechat-classic')) return false;
      const title = trigger?.getAttribute('aria-label') || trigger?.querySelector('.cell-title')?.textContent.trim() || trigger?.textContent.trim() || titles[action] || '功能说明';
      const friend = state.roles.find(item => item.id === route.arg);
      if (action === 'coming-contact-card') {
        if (friend && route.name !== 'chat') card(friend, title);
        else cards(state.roles, title);
        return true;
      }
      let content;
      if (action === 'coming-report') {
        content = (friend ? identity(friend) : '') + '<p class="classic-entry-note">投诉受理服务尚未接入。' + (friend ? '你可以在朋友权限里设置仅聊天或加入黑名单。' : '') + '</p>' + (friend ? '<button type="button" class="classic-entry-primary" data-entry-permissions>朋友权限</button>' : '');
      } else if (action === 'coming-call' || action === 'coming-video') {
        content = (friend ? identity(friend) : '') + '<p class="classic-entry-note">当前尚未接入音视频通话服务。</p>';
      } else if (action === 'coming-camera') {
        content = '<p class="classic-entry-note">拍摄暂未开放。你可以使用聊天更多里的“照片”选择已有图片。</p>';
      } else {
        content = '<p class="classic-entry-note">' + esc(title) + '暂未开放。</p>';
      }
      const root = sheet(title, content);
      const permissions = root.querySelector('[data-entry-permissions]');
      if (permissions) permissions.onclick = () => { P().closeModal(); P().showView('contact-permissions', friend.id); };
      return true;
    }
  };
})();
