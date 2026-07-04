const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { deriveKey, gcmEncrypt, gcmDecrypt, isEncrypted, keyFingerprint, SCRYPT, ENC_PREFIX, VAULT_PREFIX } = require('../../lib/crypto');

test('gcm round-trip preserves data (incl. unicode)', () => {
  const key = crypto.randomBytes(32);
  const secret = 'p@ss—wörd—пароль';
  assert.strictEqual(gcmDecrypt(key, gcmEncrypt(key, secret)), secret);
});

test('gcm decrypt with wrong key throws (auth failure)', () => {
  const blob = gcmEncrypt(crypto.randomBytes(32), 'secret');
  assert.throws(() => gcmDecrypt(crypto.randomBytes(32), blob));
});

test('deriveKey deterministic for same password+salt, differs otherwise', () => {
  const salt = crypto.randomBytes(16).toString('base64');
  assert.deepStrictEqual(deriveKey('hunter2', salt), deriveKey('hunter2', salt));
  assert.notDeepStrictEqual(deriveKey('hunter2', salt), deriveKey('hunter3', salt));
  assert.strictEqual(deriveKey('hunter2', salt).length, 32);
});

test('vault verifier: correct password verifies, wrong rejected', () => {
  const salt = crypto.randomBytes(16).toString('base64');
  const verifier = gcmEncrypt(deriveKey('master', salt), 'AOSSH-VAULT-OK');
  assert.strictEqual(gcmDecrypt(deriveKey('master', salt), verifier), 'AOSSH-VAULT-OK');
  assert.throws(() => gcmDecrypt(deriveKey('wrong', salt), verifier));
});

test('encrypted export round-trips with KDF params read from file', () => {
  const conns = [{ name: 'srv', host: '10.0.0.1', password: 'secret' }];
  const salt = crypto.randomBytes(16).toString('base64');
  const file = { aossh_encrypted: 1, N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt, data: gcmEncrypt(deriveKey('exp-pass', salt), JSON.stringify(conns)) };
  const key2 = deriveKey('exp-pass', file.salt, { N: file.N, r: file.r, p: file.p });
  assert.deepStrictEqual(JSON.parse(gcmDecrypt(key2, file.data)), conns);
  assert.throws(() => gcmDecrypt(deriveKey('nope', file.salt, file), file.data));
});

test('isEncrypted recognizes both schemes, not plaintext', () => {
  assert.ok(isEncrypted(ENC_PREFIX + 'x'));
  assert.ok(isEncrypted(VAULT_PREFIX + 'x'));
  assert.ok(!isEncrypted('plaintext'));
  assert.ok(!isEncrypted(''));
  assert.ok(!isEncrypted(null));
});

test('keyFingerprint has SHA256:base64 form without padding', () => {
  const fp = keyFingerprint(Buffer.from('some-host-key'));
  assert.match(fp, /^SHA256:[A-Za-z0-9+/]+$/);
  assert.ok(!fp.endsWith('='));
});
