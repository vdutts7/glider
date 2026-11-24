'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isBrowserInternalUrl,
  BROWSER_LEVEL_COMMANDS,
  isBrowserLevelCommand,
} = require('../browser-guards.js');

test('isBrowserInternalUrl treats empty and about: as internal', () => {
  assert.equal(isBrowserInternalUrl(''), true);
  assert.equal(isBrowserInternalUrl(null), true);
  assert.equal(isBrowserInternalUrl(undefined), true);
  assert.equal(isBrowserInternalUrl('about:blank'), true);
});

test('isBrowserInternalUrl matches Chromium-fork schemes', () => {
  for (const u of [
    'chrome://settings',
    'chrome-extension://abcdef/page.html',
    'edge://flags',
    'brave://settings',
    'opera://settings',
    'vivaldi://settings',
    'arc://settings',
  ]) {
    assert.equal(isBrowserInternalUrl(u), true, u);
  }
});

test('isBrowserInternalUrl allows normal http(s) pages', () => {
  assert.equal(isBrowserInternalUrl('https://example.com/'), false);
  assert.equal(isBrowserInternalUrl('http://localhost:3000/'), false);
  assert.equal(isBrowserInternalUrl('https://outlook.live.com/mail/'), false);
});

test('BROWSER_LEVEL_COMMANDS lists Target browser-scope methods', () => {
  assert.deepEqual([...BROWSER_LEVEL_COMMANDS].sort(), [
    'Target.activateTarget',
    'Target.attachToTarget',
    'Target.closeTarget',
    'Target.createTarget',
    'Target.getTargets',
  ]);
});

test('isBrowserLevelCommand gates session-less CDP methods', () => {
  assert.equal(isBrowserLevelCommand('Target.getTargets'), true);
  assert.equal(isBrowserLevelCommand('Runtime.evaluate'), false);
  assert.equal(isBrowserLevelCommand('Page.navigate'), false);
});
