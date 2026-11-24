'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  syntheticTargetInfo,
  tryUpgradeSyntheticFromPageAttach,
} = require('../target-identity.js');

test('syntheticTargetInfo marks temporary tab-<id> identity', () => {
  assert.deepEqual(syntheticTargetInfo(42), {
    targetId: 'tab-42',
    url: '',
    type: 'page',
    synthetic: true,
  });
});

test('tryUpgradeSyntheticFromPageAttach upgrades synthetic session in place', () => {
  const info = { sessionId: 'session-1', targetId: 'tab-42', synthetic: true };
  const ti = {
    targetId: 'REAL-TARGET',
    type: 'page',
    title: 'Outlook',
    url: 'https://outlook.example/',
  };
  const upgraded = tryUpgradeSyntheticFromPageAttach(info, ti, 42);
  assert.deepEqual(upgraded.session, {
    sessionId: 'session-1',
    targetId: 'REAL-TARGET',
    synthetic: false,
  });
  assert.equal(upgraded.changedParams.tabId, 42);
  assert.equal(upgraded.changedParams.targetInfo.targetId, 'REAL-TARGET');
  assert.equal(upgraded.changedParams.targetInfo.synthetic, false);
  assert.equal(upgraded.changedParams.targetInfo.attached, true);
});

test('tryUpgradeSyntheticFromPageAttach ignores non-synthetic and non-page attaches', () => {
  assert.equal(
    tryUpgradeSyntheticFromPageAttach(
      { sessionId: 's', targetId: 'REAL', synthetic: false },
      { targetId: 'X', type: 'page' },
      1,
    ),
    null,
  );
  assert.equal(
    tryUpgradeSyntheticFromPageAttach(
      { sessionId: 's', targetId: 'tab-1', synthetic: true },
      { targetId: 'W1', type: 'worker' },
      1,
    ),
    null,
  );
});
