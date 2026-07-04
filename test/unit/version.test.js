const test = require('node:test');
const assert = require('node:assert');
const { isNewerVersion } = require('../../lib/version');

test('detects newer versions', () => {
  assert.ok(isNewerVersion('1.3.5', '1.3.6'));
  assert.ok(isNewerVersion('1.3.5', '1.4.0'));
  assert.ok(isNewerVersion('1.3.5', '2.0.0'));
  assert.ok(isNewerVersion('1.3.9', '1.3.10'));   // numeric, not lexical
});

test('not newer for equal or older', () => {
  assert.ok(!isNewerVersion('1.3.6', '1.3.6'));
  assert.ok(!isNewerVersion('1.3.6', '1.3.5'));
  assert.ok(!isNewerVersion('2.0.0', '1.9.9'));
});

test('tolerates a v prefix', () => {
  assert.ok(isNewerVersion('v1.3.5', 'v1.3.6'));
  assert.ok(!isNewerVersion('v1.3.6', 'v1.3.6'));
});
