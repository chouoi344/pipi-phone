/* SPDX-License-Identifier: AGPL-3.0-only */
/* Keep the existing records, routes and controls; only group their presentation. */
(() => {
  'use strict';
  let currentPage, previousTab = 0;
  const rootTabs = ['chats', 'contacts', 'discover', 'me'];

  function groupConversations(view) {
    const list = view.querySelector('.conversation-list');
    if (list.dataset.waterdropGrouped) return;
    list.dataset.waterdropGrouped = 'true';
    const rows = [...list.querySelectorAll('.conversation-wrap')];
    for (const pinned of [true, false]) {
      const selected = rows.filter(row => row.querySelector('.conversation').classList.contains('pinned') === pinned);
      if (!selected.length) continue;
      const group = document.createElement('section');
      group.className = 'waterdrop-conversation-group';
      group.setAttribute('aria-label', pinned ? '置顶聊天' : '其他聊天');
      list.insertBefore(group, list.querySelector('.classic-filter-empty'));
      group.append(...selected);
      group.hidden = !group.querySelector('.conversation-wrap:not([hidden])');
    }
  }

  function groupContacts(view) {
    const list = view.querySelector('.content.contacts');
    if (list.dataset.waterdropGrouped) return;
    list.dataset.waterdropGrouped = 'true';
    let group;
    for (const node of [...list.children]) {
      if (node.classList.contains('contacts-index')) { group = null; continue; }
      if (!node.classList.contains('cell')) continue;
      if (!group) {
        group = document.createElement('section');
        group.className = 'waterdrop-contact-group';
        list.insertBefore(group, node);
      }
      group.append(node);
    }
  }

  function dock(view, route) {
    const index = rootTabs.indexOf(route.name);
    if (index < 0) return;
    const nav = view.querySelector(':scope > .bottom-tabs');
    const existing = nav.querySelector('.waterdrop-dock-slider');
    if (existing) {
      existing.style.transform = `translateX(${index * 100}%)`;
      previousTab = index;
      return;
    }
    const slider = document.createElement('span');
    slider.className = 'waterdrop-dock-slider';
    slider.setAttribute('aria-hidden', 'true');
    slider.style.transform = `translateX(${previousTab * 100}%)`;
    nav.prepend(slider);
    // Two frames retain a painted starting point even when the route was replaced.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (slider.isConnected) slider.style.transform = `translateX(${index * 100}%)`;
    }));
    previousTab = index;
  }

  function decorate(view, route) {
    currentPage = {view, route: {...route}};
    if (document.documentElement.dataset.skin !== 'waterdrop') {
      view.querySelector('.waterdrop-dock-slider')?.remove();
      for (const group of view.querySelectorAll('.waterdrop-conversation-group,.waterdrop-contact-group')) group.replaceWith(...group.childNodes);
      for (const list of view.querySelectorAll('[data-waterdrop-grouped]')) delete list.dataset.waterdropGrouped;
      return;
    }
    if (route.name === 'chats') groupConversations(view);
    if (route.name === 'contacts') groupContacts(view);
    for (const value of view.querySelectorAll('.cell-value')) value.classList.toggle('waterdrop-empty-value', ['未填写', '未设置', '未配置'].includes(value.textContent.trim()));
    dock(view, route);
  }

  new MutationObserver(() => {
    if (!currentPage || currentPage.view.dataset.route !== currentPage.route.name) return;
    decorate(currentPage.view, currentPage.route);
    if (currentPage.route.name === 'chat') window.WaterdropChat?.decorate(currentPage.view);
  }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-skin']});
  window.WaterdropShell = {decorate};
})();
