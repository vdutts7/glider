'use strict';

// Pure attach/CDP guard helpers. Loaded by background.js via importScripts;
// node tests require() the same file.
// IIFE: importScripts shares SW global scope; bare decls collide with
// `const { … } = …` in background.js.

(function (root) {
  // Vendor-agnostic: Chromium forks each ship their own scheme plus about:.
  // chrome.debugger.attach on these throws; skip via one predicate.
  function isBrowserInternalUrl(u) {
    if (!u) return true;
    if (u.startsWith('about:')) return true;
    return /^(chrome|chrome-extension|edge|brave|opera|vivaldi|arc):\/\//.test(u);
  }

  // Browser-level CDP methods that do not need a tab session.
  const BROWSER_LEVEL_COMMANDS = Object.freeze([
    'Target.createTarget',
    'Target.closeTarget',
    'Target.activateTarget',
    'Target.getTargets',
    'Target.attachToTarget',
  ]);

  function isBrowserLevelCommand(method) {
    return BROWSER_LEVEL_COMMANDS.includes(method);
  }

  const api = {
    isBrowserInternalUrl,
    BROWSER_LEVEL_COMMANDS,
    isBrowserLevelCommand,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GliderBrowserGuards = api;
  }
})(typeof self !== 'undefined' ? self : this);
