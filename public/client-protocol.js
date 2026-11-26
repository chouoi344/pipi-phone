// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  async function validate(status) {
    const protocol = status.clientProtocol;
    const token = document.querySelector('meta[name="pipi-recording"]')?.content;
    const nativeBridge = token && document.querySelector('meta[name="pipi-client-compat"]')?.content === '1' && /\bPipiPhoneAndroid\/1(?:\.|\b)/.test(navigator.userAgent);
    if (protocol !== undefined) {
      if (protocol?.name !== 'pipi-phone' || protocol.version !== 1 || !Array.isArray(protocol.features) || !protocol.features.every(feature => typeof feature === 'string') || !['state-v1','chat-progress-v1'].every(feature => protocol.features.includes(feature))) {
        throw new Error('App 与服务器的版本暂不兼容，请更新 App 或服务器后重新连接。');
      }
      // New native shells recheck a previously offline connection in the
      // background. Older APKs do not expose this prompt command.
      if (nativeBridge) window.prompt('pipi-client-compat:' + token, 'get');
      return;
    }
    if (!token || !/\bPipiPhoneAndroid\/1(?:\.|\b)/.test(navigator.userAgent)) return;
    for (let attempt = 0; attempt < 51; attempt++) {
      let compatibility;
      try { compatibility = JSON.parse(window.prompt('pipi-client-compat:' + token, 'get')); }
      catch (cause) { throw new Error('无法确认 App 与服务器是否兼容，请更新 App 后重新连接。', {cause}); }
      if (compatibility?.state === 'legacy-audited' && compatibility.legacyAllowed === true) return;
      if (compatibility?.state !== 'checking') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('这台服务器的旧版本尚未与当前 App 验证兼容，请更新服务器后重新连接。');
  }
  window.PipiClientProtocol = Object.freeze({validate});
})();
