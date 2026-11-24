'use strict';

// Pure synthetic-target helpers. Loaded by background.js via importScripts;
// node tests require() the same file.
// IIFE: importScripts shares SW global scope; bare function decls collide with
// `const { syntheticTargetInfo } = ...` in background.js (Status code 15).

(function (root) {
  function syntheticTargetInfo(tabId) {
    return {
      targetId: `tab-${tabId}`,
      url: '',
      type: 'page',
      synthetic: true,
    };
  }

  function tryUpgradeSyntheticFromPageAttach(info, ti, tabId) {
    if (!info || info.synthetic !== true) return null;
    if (!ti || ti.type !== 'page' || !ti.targetId) return null;
    return {
      session: {
        sessionId: info.sessionId,
        targetId: ti.targetId,
        synthetic: false,
      },
      changedParams: {
        tabId,
        targetInfo: {
          ...ti,
          attached: true,
          synthetic: false,
          tabId,
        },
      },
    };
  }

  const api = { syntheticTargetInfo, tryUpgradeSyntheticFromPageAttach };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GliderTargetIdentity = api;
  }
})(typeof self !== 'undefined' ? self : this);
