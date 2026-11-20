// SPDX-License-Identifier: AGPL-3.0-only
// Classic settings only rearrange existing controls. Their loaders and handlers stay native.
(() => {
  'use strict';

  const overlay = document.getElementById('overlay');
  const frame = document.querySelector('.phone-shell');
  const settingsRoutes = new Set([
    'engine-home', 'providers', 'engine-functions', 'engine-module', 'engine-usage',
    'role-config', 'life-workbench', 'role-stickers', 'role-reminders', 'role-references',
    'role-schedule', 'memories', 'role-personas', 'role-persona-detail', 'stickers'
  ]);
  let resizeObserver;
  let contentObserver;
  let categoryObserver;
  let outsideTarget;
  let placeVoice;
  let updateFrame;

  function section(title, className = '') {
    const node = document.createElement('section');
    node.className = 'pt-settings-group ' + className;
    const heading = document.createElement('h3');
    heading.className = 'pt-group-title';
    heading.textContent = title;
    node.append(heading);
    return node;
  }

  function reflectEmpty(root) {
    for (const preview of root.querySelectorAll('.life-archive-preview, [data-voice-name], .caption-prompt-preview, .preference-value')) {
      const text = preview.textContent.trim();
      preview.classList.toggle('is-empty', !text || ['待补充', '选择音色', '未选择', '未设置', '未填写', '点击填写转述要求'].includes(text));
    }
  }

  function decorateSheets() {
    if (!document.body.classList.contains('wechat-classic')) return;
    const view = document.getElementById('view');
    const active = view.classList.contains('pt-settings-view');
    overlay.classList.toggle('pt-settings-overlay', active);
    if (!active) return;
    for (const dialog of overlay.querySelectorAll('dialog.schedule-wardrobe-dialog, dialog.rp-replace-dialog')) {
      if (dialog.dataset.classicOutside) continue;
      dialog.dataset.classicOutside = 'true';
      let pressedOutside = false;
      const outside = event => {
        if (event.target !== dialog) return false;
        const bounds = dialog.getBoundingClientRect();
        return event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom;
      };
      dialog.addEventListener('pointerdown', event => { pressedOutside = outside(event); });
      dialog.addEventListener('pointercancel', () => { pressedOutside = false; });
      dialog.addEventListener('click', event => {
        if (!pressedOutside || !outside(event) || dialog.querySelector('[type="submit"]:disabled')) return;
        pressedOutside = false;
        if (!window.Pipi.closeChildDialog()) dialog.close();
      });
    }
    const sheet = overlay.querySelector(':scope > .page-editor, :scope > .sheet-actions, :scope > .alert-dialog');
    if (!sheet) return;
    sheet.classList.add('pt-settings-sheet');
    const voiceChoice = sheet.querySelector('[name="voice-model"]');
    if (voiceChoice && !sheet.classList.contains('pt-voice-model-sheet')) {
      sheet.classList.add('pt-voice-model-sheet');
      const body = sheet.querySelector('.modal-body');
      const grid = document.createElement('div');
      grid.className = 'pt-model-grid';
      for (const option of body.querySelectorAll('.choice-row')) {
        const copy = option.querySelector(':scope > span');
        const detail = copy.querySelector('small');
        const title = document.createElement('strong');
        title.textContent = copy.firstChild.textContent;
        copy.replaceChildren(title);
        if (detail) copy.append(detail);
        option.classList.add('pt-model-option');
        grid.append(option);
      }
      body.prepend(grid);
    }
  }

  // Model sheets already close through app.js. Other setting editors share the
  // same outside gesture, without adding a second mask or dismissing a parent.
  overlay.addEventListener('pointerdown', event => {
    outsideTarget = event.target === overlay || event.target.matches('.overlay-mask') ? event.target : null;
  }, true);
  overlay.addEventListener('pointercancel', () => { outsideTarget = null; }, true);
  overlay.addEventListener('click', event => {
    if (!overlay.classList.contains('pt-settings-overlay')) return;
    const target = event.target;
    const outside = target === overlay || target.matches('.overlay-mask');
    if (!outside) return;
    const sheet = overlay.querySelector(':scope > .pt-settings-sheet');
    const valid = outsideTarget === target;
    outsideTarget = null;
    if (!valid || sheet?.querySelector('[data-close]:disabled, .modal-form[aria-busy="true"]')) {
      event.stopImmediatePropagation();
      return;
    }
    if (target === overlay && sheet && !sheet.matches('.model-sheet, .usage-sheet')) {
      event.stopImmediatePropagation();
      window.Pipi.closeModal();
    }
  }, true);
  new MutationObserver(decorateSheets).observe(overlay, { childList: true, subtree: true });

  function decorateBasic(view, root) {
    root.classList.add('pt-basic-root');
    view.querySelector('.topbar h2').textContent = '好友配置';
    const navigation = root.querySelector('.life-navigation');
    navigation.classList.add('pt-category-group');
    const categoryMarks = {
      basic: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
      schedule: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M7.5 3v4m9-4v4m-13 3.5h17M8 15h4"/>',
      interaction: '<path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5 9.7 9.7 0 0 1-3.8-.8L3.5 21l1.4-4.4a8.5 8.5 0 1 1 15.6-5.1Z"/><path d="M8 11.5h.01m4 0h.01m4 0h.01"/>',
      memory: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4m3-10h6m-6 5h6m-6 5h4"/>',
      stickers: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5a4.5 4.5 0 0 0 8 0M8.5 9h.01m7 0h.01"/>',
      photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 17 5-4 4 3 4-5 5 6"/>',
      wardrobe: '<path d="M10 6a2 2 0 1 1 3.2 1.6c-.8.5-1.2.9-1.2 1.9v.5L3 16a1.5 1.5 0 0 0 .8 2.8h16.4A1.5 1.5 0 0 0 21 16l-9-6"/>',
      moments: '<circle cx="12" cy="12" r="9"/><path d="m14.3 8 5.7 9.9M9.7 8h11.4M7.4 12l5.7-9.9M9.7 16 4 6.1M14.3 16H2.9M16.6 12l-5.7 9.9"/>'
    };
    for (const button of navigation.querySelectorAll('[data-life-category]')) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'icon');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.7');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = categoryMarks[button.dataset.lifeCategory];
      button.querySelector('.icon').replaceWith(icon);
    }
    for (const input of root.querySelectorAll('.life-card-heading > input[role="switch"]')) {
      const target = document.createElement('label');
      target.className = 'pt-switch-target';
      input.before(target);
      target.append(input);
    }
    const title = document.createElement('h3');
    title.className = 'pt-group-title';
    title.textContent = '角色配置';
    navigation.prepend(title);
    const reflect = () => {
      root.dataset.ptCategory = navigation.querySelector('[aria-pressed="true"]').dataset.lifeCategory;
    };
    reflect();
    categoryObserver = new MutationObserver(reflect);
    categoryObserver.observe(navigation, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });

    const save = view.querySelector('[data-life-action="saveAll"]');
    const footer = document.createElement('footer');
    footer.className = 'pt-settings-save';
    save.type = 'button';
    save.textContent = save.textContent.includes('保存中') ? '保存中…' : '保存好友配置';
    footer.append(save);
    view.append(footer);

    // The navigation and disabled save are also shown before the real data loads.
    const card = root.querySelector('.lb-profile-card');
    if (!card) return;
    card.classList.add('pt-profile');
    const head = card.querySelector('.lb-card-head');
    const fields = card.querySelector('.lb-card-fields');
    const name = fields.querySelector('[data-life-field="name"]');
    const id = fields.querySelector('[data-life-field="wechatId"]');
    const identity = document.createElement('div');
    identity.className = 'pt-identity';
    identity.innerHTML = '<strong></strong><span></span>';
    head.append(identity);
    const reflectIdentity = () => {
      const heading = identity.querySelector('strong');
      heading.textContent = name.value || '未填写名字';
      heading.classList.toggle('is-empty', !name.value);
      const subline = identity.querySelector('span');
      subline.textContent = id.value ? '微信号：' + id.value : '微信号未填写';
      subline.classList.toggle('is-empty', !id.value);
    };
    reflectIdentity();
    card.addEventListener('input', event => {
      if (event.target === name || event.target === id) reflectIdentity();
    });

    const basics = section('1. 基础资料', 'pt-basics');
    const grid = document.createElement('div');
    grid.className = 'pt-field-grid';
    grid.append(name.closest('.lb-field'), id.closest('.lb-field'));
    basics.append(head, grid);
    const voice = section('2. 发语音', 'pt-friend-voice');
    voice.append(fields.querySelector('[data-basic-voice-toggle]').closest('label'), fields.querySelector('.lb-voice-row'));
    const hint = fields.querySelector('.lb-voice-hint');
    if (hint) voice.append(hint);
    const location = section('3. 生活地点');
    location.append(fields.querySelector('.lb-region'));
    const contact = section('4. 联系与互动');
    const outreach = fields.querySelector('.lb-outreach');
    const descriptions = { schedule: '按照 TA 的日程联系', custom: '使用设定的联系频率' };
    for (const option of outreach.querySelectorAll('.lb-outreach-modes label')) {
      const copy = option.querySelector('span');
      const heading = document.createElement('strong');
      heading.textContent = copy.textContent;
      const detail = document.createElement('small');
      detail.textContent = descriptions[option.querySelector('input').value];
      copy.replaceChildren(heading, detail);
    }
    const habits = document.createElement('div');
    habits.className = 'pt-habits';
    habits.append(fields.querySelector('[data-life-field="bio"]').closest('.lb-field'), fields.querySelector('[data-life-field="patText"]').closest('.lb-field'));
    contact.append(outreach, habits);
    fields.replaceChildren(basics, voice, location, contact);

    const menu = voice.querySelector('.lb-voice-menu');
    const place = () => {
      const outer = frame.getBoundingClientRect();
      const bounds = new DOMRect(outer.left + frame.clientLeft, outer.top + frame.clientTop, frame.clientWidth, frame.clientHeight);
      menu.style.setProperty('--pt-sheet-left', bounds.left + 'px');
      menu.style.setProperty('--pt-sheet-right', innerWidth - bounds.right + 'px');
      menu.style.setProperty('--pt-sheet-bottom', innerHeight - bounds.bottom + 'px');
      menu.style.setProperty('--pt-sheet-top', bounds.top + 'px');
      menu.style.setProperty('--pt-sheet-width', bounds.width + 'px');
      menu.style.setProperty('--pt-sheet-height', bounds.height * .7 + 'px');
    };
    placeVoice = place;
    menu.addEventListener('toggle', place);
    place();
  }

  function decorateVoice(form) {
    form.parentElement.classList.add('pt-voice-content');
    form.classList.add('pt-voice-form');
    const fieldset = form.querySelector('fieldset');
    const control = section('1. 功能开关');
    const toggle = fieldset.querySelector('label.model-preference-row');
    toggle.classList.add('pt-voice-toggle');
    control.append(toggle);
    const modelGroup = section('2. 语音模型');
    const model = fieldset.querySelector('[data-model-pref="voice-model"]');
    model.classList.add('pt-current-model');
    const value = model.querySelector('.preference-value');
    const fullName = value.textContent;
    const empty = fullName === '未选择';
    model.classList.toggle('has-model', !empty);
    model.querySelector('.preference-copy strong').textContent = empty ? '选择语音合成模型' : '当前模型';
    const identity = document.createElement('span');
    identity.className = 'pt-model-identity';
    identity.append(value);
    const divider = fullName.indexOf(' · ');
    if (divider !== -1) {
      value.textContent = fullName.slice(divider + 3);
      const source = document.createElement('small');
      source.textContent = fullName.slice(0, divider);
      identity.append(source);
    }
    model.insertBefore(identity, model.querySelector(':scope > svg, :scope > .chevron'));
    modelGroup.append(model);
    fieldset.append(control, modelGroup);
  }

  function decorate(view, route) {
    resizeObserver?.disconnect();
    contentObserver?.disconnect();
    categoryObserver?.disconnect();
    placeVoice = null;
    updateFrame = null;
    const routeName = typeof route === 'string' ? route : route.name;
    const root = view.querySelector('[data-life-root]');
    const voice = view.querySelector('#engine-module-form[data-module="voice"]');
    const settings = Boolean(root || settingsRoutes.has(routeName));
    view.classList.toggle('pt-settings-view', settings);
    view.classList.toggle('pt-basic-view', Boolean(root));
    view.classList.toggle('pt-voice-view', Boolean(voice));
    if (root && !root.classList.contains('pt-basic-root')) decorateBasic(view, root);
    if (voice && !voice.classList.contains('pt-voice-form')) decorateVoice(voice);
    if (settings) {
      updateFrame = () => {
        const outer = frame.getBoundingClientRect();
        const bounds = new DOMRect(outer.left + frame.clientLeft, outer.top + frame.clientTop, frame.clientWidth, frame.clientHeight);
        const style = document.body.style;
        style.setProperty('--pt-dialog-left', bounds.left + 'px');
        style.setProperty('--pt-dialog-top', bounds.top + 'px');
        style.setProperty('--pt-dialog-right', innerWidth - bounds.right + 'px');
        style.setProperty('--pt-dialog-bottom', innerHeight - bounds.bottom + 'px');
        style.setProperty('--pt-dialog-width', bounds.width + 'px');
        style.setProperty('--pt-dialog-height', bounds.height + 'px');
        placeVoice?.();
      };
      resizeObserver = new ResizeObserver(updateFrame);
      resizeObserver.observe(frame);
      updateFrame();
      view.querySelector('.content')?.classList.add('pt-config-content');
      for (const input of view.querySelectorAll('#engine-module-form .check-row input[type="checkbox"], #schedule-settings .check-row input[type="checkbox"]')) {
        input.classList.add('switch');
        input.setAttribute('role', 'switch');
      }
      reflectEmpty(view);
      contentObserver = new MutationObserver(() => reflectEmpty(view));
      contentObserver.observe(view, { childList: true, subtree: true, characterData: true });
    }
    decorateSheets();
  }

  window.addEventListener('resize', () => updateFrame?.());
  window.ClassicSettings = { decorate };
})();
