/* SPDX-License-Identifier: AGPL-3.0-only */
(() => {
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
    // microphone sessions and all tool actions stay owned by the chat app.
    more.classList.add('classic-inline-more');
    more.title = '更多功能';
    more.setAttribute('aria-label', '展开更多功能');
    field.append(more);

    // The original form submits it; syncComposerControls applies the app's
    // sending, composition and recording locks to this real submit button.
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'classic-chat-send';
    submit.title = '发送';
    submit.setAttribute('aria-label', '发送消息');
    submit.innerHTML = '<span aria-hidden="true">➤</span>';
    trailing.append(submit);

    if (!form.querySelector('[data-record]')) {
      form.querySelector('[data-action="toggle-voice"]').innerHTML = '<span aria-hidden="true">🎙️</span>';
    }
    const emoji = form.querySelector('[data-action="toggle-emoji"]');
    if (emoji.getAttribute('aria-label') === '选择表情') emoji.innerHTML = '<span aria-hidden="true">😊</span>';
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
      for (const glyph of view.querySelectorAll('.voice-message svg.voice-signal')) {
        const mark = document.createElement('span');
        mark.className = 'classic-voice-glyph';
        mark.setAttribute('aria-hidden', 'true');
        mark.innerHTML = glyph.parentElement.classList.contains('voice-mine')
          ? '<span class="wave-far">(</span><span class="wave-middle">(</span>•'
          : '•<span class="wave-middle">)</span><span class="wave-far">)</span>';
        const duration = glyph.nextElementSibling;
        duration.textContent = duration.textContent.replace('″', '"');
        glyph.replaceWith(mark);
      }
      const moreIcon = view.querySelector(':scope > .topbar [data-action="chat-details"] > .icon');
      if (moreIcon) moreIcon.replaceWith('•••');
      decorateComposer(view);
    }
  };
})();
