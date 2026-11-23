// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Keep the bundled UI usable on Android System WebView 83. Native implementations
// are left intact on current browsers; this file must load before the UI scripts.
(() => {
  const legacyLayout = document.getElementById('legacy-layout');
  if (legacyLayout && !CSS.supports('selector(:is(*))')) legacyLayout.href = legacyLayout.dataset.href;
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true, value: function at(index) {
      const offset = Math.trunc(Number(index)) || 0;
      const position = offset < 0 ? this.length + offset : offset;
      return position >= 0 && position < this.length ? this[position] : undefined;
    }
  });
  if (!Array.prototype.findLast) Object.defineProperty(Array.prototype, 'findLast', {
    configurable: true, writable: true, value: function findLast(predicate, thisArg) {
      if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
      for (let index = this.length - 1; index >= 0; index--) {
        const value = this[index];
        if (predicate.call(thisArg, value, index, this)) return value;
      }
    }
  });
  if (!Object.hasOwn) Object.defineProperty(Object, 'hasOwn', {
    configurable: true, writable: true,
    value: (object, key) => Object.prototype.hasOwnProperty.call(object, key)
  });
  if (!crypto.randomUUID) crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  if (!Element.prototype.replaceChildren) Object.defineProperty(Element.prototype, 'replaceChildren', {
    configurable: true, writable: true, value: function replaceChildren(...nodes) {
      // Move retained children first, matching replaceChildren when reordering.
      const fragment = document.createDocumentFragment();
      fragment.append(...nodes);
      this.textContent = '';
      this.append(fragment);
    }
  });
  if (!('inert' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'inert', {
      configurable: true,
      get() { return this.hasAttribute('inert'); },
      set(value) {
        this.toggleAttribute('inert', Boolean(value));
        if (value && this.contains(document.activeElement)) document.activeElement.blur();
      }
    });
    // Existing modal Tab handling already skips [inert]. Also reject a direct
    // focus attempt while a form is saving or a parent editor is underneath.
    document.addEventListener('focusin', event => {
      if (event.target.closest('[inert]')) event.target.blur();
    }, true);
  }

  // WebView 83 accepts options.signal without removing the listener on abort.
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const probe = new EventTarget(), controller = new AbortController();
  let signalSupported = true;
  add.call(probe, 'pipi-probe', () => { signalSupported = false; }, {signal: controller.signal});
  controller.abort();
  probe.dispatchEvent(new Event('pipi-probe'));
  if (signalSupported) return;

  const registrations = new WeakMap();
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (!listener) return add.call(this, type, listener, options);
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const signal = typeof options === 'object' && options?.signal;
    if (signal?.aborted) return;
    let entries = registrations.get(this);
    if (!entries) { entries = new Set(); registrations.set(this, entries); }
    for (const entry of entries) if (entry.type === type && entry.listener === listener && entry.capture === capture) return;
    const target = this;
    const entry = {type, listener, capture, wrapped, cleanup};
    function cleanup() {
      remove.call(target, type, wrapped, capture);
      if (signal) remove.call(signal, 'abort', cleanup);
      entries.delete(entry);
    }
    function wrapped(event) {
      if (options?.once) cleanup();
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    }
    add.call(this, type, wrapped, options);
    entries.add(entry);
    if (signal) add.call(signal, 'abort', cleanup, {once: true});
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const entries = registrations.get(this);
    if (entries) for (const entry of entries) {
      if (entry.type === type && entry.listener === listener && entry.capture === capture) { entry.cleanup(); return; }
    }
    remove.call(this, type, listener, options);
  };
})();
