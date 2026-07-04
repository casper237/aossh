// Pure crypto helpers shared by the main process and unit tests.
// No Electron dependency — safe to require from Node test runners.
const crypto = require('crypto');

const ENC_PREFIX   = 'enc:v1:';   // DPAPI (Electron safeStorage) — handled in main.js
const VAULT_PREFIX = 'enc:v2:';   // master-password vault (scrypt + AES-256-GCM)
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };

// Derive a 256-bit key from a password + salt. `opts` (N/r/p) lets import read
// the KDF parameters stored in an encrypted export file; defaults to SCRYPT.
function deriveKey(password, saltB64, opts) {
  const o = opts || SCRYPT;
  return crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), SCRYPT.keyLen,
    { N: o.N || SCRYPT.N, r: o.r || SCRYPT.r, p: o.p || SCRYPT.p, maxmem: SCRYPT.maxmem });
}

// AES-256-GCM. Output layout: base64(iv[12] || tag[16] || ciphertext).
function gcmEncrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}
function gcmDecrypt(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

function isEncrypted(s) {
  return typeof s === 'string' && (s.startsWith(ENC_PREFIX) || s.startsWith(VAULT_PREFIX));
}

// SSH host key fingerprint in the SHA256:base64 form OpenSSH prints.
function keyFingerprint(key) {
  return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

module.exports = { ENC_PREFIX, VAULT_PREFIX, SCRYPT, deriveKey, gcmEncrypt, gcmDecrypt, isEncrypted, keyFingerprint };
