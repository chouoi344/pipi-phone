/* SPDX-License-Identifier: AGPL-3.0-only */
(() => {
  const sendIcon = '<svg class="icon classic-send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4 18-7Z"/></svg>';

  function decorateComposer(view) {
    const footer = view.querySelector(':scope > .chat-composer');
    const form = footer?.querySelector('#compose-form');
    if (!form || form.classList.contains('classic-compose-row')) return;
    form.classList.add('classic-compose-row');

    const trailing = form.querySelector('.compose-trailing');
    const more = trailing.querySelector('[data-action="toggle-panel"]');
    let field = form.querySelector('.compose-field');
    if (!field) {
      field = document.createElement('div');
      field.className = 'classic-voice-field';
      const record = form.querySelector('[data-record]');
      record.before(field);
      field.append(record);
    }
    // Move the existing controls before app.js binds them. Drafts, selection,
    // microphone sessions and all send eligibility checks stay owned by app.js.
    more.classList.add('classic-inline-more');
    more.title = '更多功能';
    more.setAttribute('aria-label', '展开更多功能');
    field.append(more);

    // syncComposerControls owns disabled, .has-draft and emoji-panel visibility.
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'classic-chat-send';
    submit.title = '发送';
    submit.setAttribute('aria-label', '发送消息');
    submit.innerHTML = sendIcon;
    trailing.append(submit);

    const editor = form.querySelector('#compose-text');
    if (editor) {
      editor.dataset.placeholder = '发消息…';
      editor.setAttribute('aria-placeholder', '发消息…');
    }
  }

  // Run on the freshly rendered chat before bindMain/bindComposer. It is also
  // safe to call twice on one view; navigation snapshots clone the same markup.
  window.ClassicChat = {
    decorate(view) {
      if (!document.body.classList.contains('wechat-classic') || view.dataset.route !== 'chat') return;
      decorateComposer(view);
    }
  };
})();
