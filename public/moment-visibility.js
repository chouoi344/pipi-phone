// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  function allows(visibility, id) {
    return visibility === undefined || visibility === 'all' || (Array.isArray(visibility)
      ? visibility.includes(id)
      : Array.isArray(visibility?.exclude) && !visibility.exclude.includes(id));
  }

  function forRole(moment, role) {
    return !role.permissions?.blocked && !role.permissions?.onlyChat && (moment.authorId === role.id ||
      moment.authorId === 'me' && !role.permissions?.hideMyMoments && allows(moment.visibility, role.id));
  }

  if (typeof module === 'object') module.exports = { allows, forRole };
  else globalThis.PipiMomentVisibility = { allows, forRole };
})();
