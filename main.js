const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const os = require('os');
const crypto = require('crypto');

// Fix black screen on virtual machines and systems without GPU
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('in-process-gpu');

const sessions = new Map();

// ── Secret encryption at rest ───────────────────────────────────────────────────
// Two schemes:
//   enc:v1:  Windows DPAPI via Electron safeStorage (user-account bound; default).
//   enc:v2:  master-password vault — scrypt-derived key + AES-256-GCM (opt-in).
// When the vault is enabled and unlocked, secrets are written as v2; otherwise v1.
const ENC_PREFIX   = 'enc:v1:';
const VAULT_PREFIX = 'enc:v2:';
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };

let vaultEnabled = false;   // mirrors vault.json { enabled }
let vaultKey = null;        // derived key Buffer, held only while unlocked

function vaultFile() { return path.join(app.getPath('userData'), 'vault.json'); }
function loadVaultMeta() { try { return JSON.parse(fs.readFileSync(vaultFile(), 'utf8')); } catch { return null; } }
function saveVaultMeta(m) { fs.writeFileSync(vaultFile(), JSON.stringify(m, null, 2)); }

function deriveKey(password, saltB64) {
  return crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), SCRYPT.keyLen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
}
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

function isEncrypted(s) { return typeof s === 'string' && (s.startsWith(ENC_PREFIX) || s.startsWith(VAULT_PREFIX)); }

function encryptSecret(s) {
  if (!s || typeof s !== 'string' || isEncrypted(s)) return s;
  if (vaultKey) return VAULT_PREFIX + gcmEncrypt(vaultKey, s);
  try {
    if (safeStorage.isEncryptionAvailable())
      return ENC_PREFIX + safeStorage.encryptString(s).toString('base64');
  } catch {}
  return s;
}
function decryptSecret(s) {
  if (typeof s !== 'string') return s;
  if (s.startsWith(VAULT_PREFIX)) {
    if (!vaultKey) return '';
    try { return gcmDecrypt(vaultKey, s.slice(VAULT_PREFIX.length)); } catch { return ''; }
  }
  if (s.startsWith(ENC_PREFIX)) {
    try { return safeStorage.decryptString(Buffer.from(s.slice(ENC_PREFIX.length), 'base64')); } catch { return ''; }
  }
  return s;
}

// ── Known hosts (TOFU host key pinning) ─────────────────────────────────────────
function knownHostsFile() { return path.join(app.getPath('userData'), 'known_hosts.json'); }
function loadKnownHosts() { try { return JSON.parse(fs.readFileSync(knownHostsFile(), 'utf8')); } catch { return {}; } }
function saveKnownHosts(kh) { try { fs.writeFileSync(knownHostsFile(), JSON.stringify(kh, null, 2)); } catch {} }
function keyFingerprint(key) { return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, ''); }

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 900, minHeight: 600,
    frame: false,
    show: false,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      enableBlinkFeatures: 'Clipboard',
      webviewTag: true,
    }
  });
  win.loadFile('renderer/index.html');
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  const m = loadVaultMeta();
  vaultEnabled = !!(m && m.enabled);
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// SSH Connect
ipcMain.handle('ssh:connect', (event, { id, host, port, username, password, privateKey }) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const connOpts = { host, port: port || 22, username };
    if (privateKey) connOpts.privateKey = fs.readFileSync(privateKey);
    else {
      connOpts.password = password;
      connOpts.tryKeyboard = true;
    }

    // Host key verification (TOFU / accept-new): trust the key on first connect,
    // refuse if a previously-seen host later presents a different key (possible MITM).
    const hostId = `${host}:${port || 22}`;
    let hostKeyStatus = null; // 'new' | 'ok' | 'changed'
    let hostKeyFp = null;
    connOpts.hostVerifier = (key, cb) => {
      hostKeyFp = keyFingerprint(key);
      const kh = loadKnownHosts();
      const known = kh[hostId];
      if (!known) { kh[hostId] = hostKeyFp; saveKnownHosts(kh); hostKeyStatus = 'new'; return cb(true); }
      if (known === hostKeyFp) { hostKeyStatus = 'ok'; return cb(true); }
      hostKeyStatus = 'changed'; return cb(false);
    };

    conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      // Respond to each prompt (usually just password) with the saved password
      finish(prompts.map(() => password));
    });

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) return reject(err.message);
        sessions.set(id, { conn, stream });
        if (hostKeyStatus === 'new')
          event.sender.send(`ssh:data:${id}`, `\x1b[33m[AOSSH] New host key for ${hostId} pinned: ${hostKeyFp}\x1b[0m\r\n`);
        stream.on('data', d => event.sender.send(`ssh:data:${id}`, d.toString()));
        stream.stderr.on('data', d => event.sender.send(`ssh:data:${id}`, d.toString()));
        stream.on('close', () => {
          event.sender.send(`ssh:closed:${id}`);
          sessions.delete(id);
        });
        resolve({ ok: true });
      });
    });
    conn.on('error', err => {
      if (hostKeyStatus === 'changed')
        return reject(`Host key for ${hostId} has CHANGED — possible man-in-the-middle attack. Connection refused. If this change is expected, remove the host from known_hosts.json and reconnect. Presented key: ${hostKeyFp}`);
      reject(err.message);
    });
    conn.connect(connOpts);
  });
});

ipcMain.handle('ssh:write', (_, { id, data }) => {
  sessions.get(id)?.stream?.write(data);
});

ipcMain.handle('ssh:resize', (_, { id, cols, rows }) => {
  sessions.get(id)?.stream?.setWindow(rows, cols, 0, 0);
});

ipcMain.handle('ssh:disconnect', (_, { id }) => {
  const s = sessions.get(id);
  s?.conn?.end();
  sessions.delete(id);
});

// SFTP — shared subsystem per session
function clearSftp(id) {
  const s = sessions.get(id);
  if (s) s.sftp = null;
}

function getSftp(id) {
  return new Promise((resolve, reject) => {
    const s = sessions.get(id);
    if (!s) return reject('Not connected');
    if (s.sftp) return resolve(s.sftp);
    s.conn.sftp((err, sftp) => {
      if (err) return reject(err.message);
      s.sftp = sftp;
      sftp.on('end',   () => clearSftp(id));
      sftp.on('close', () => clearSftp(id));
      sftp.on('error', () => clearSftp(id));
      resolve(sftp);
    });
  });
}

function fastPutSmart(sftp, src, dest, step) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(src, dest, { concurrency: 64, chunkSize: 65536, step }, err => {
      if (!err) return resolve();
      if (!String(err).toLowerCase().includes('failure')) return reject(err.message);
      sftp.fastPut(src, dest, { concurrency: 4, step }, err2 => err2 ? reject(err2.message) : resolve());
    });
  });
}

// Run fn(sftp), retry once with a fresh channel unless error is definitively non-transient
async function withSftp(id, fn) {
  try {
    return await fn(await getSftp(id));
  } catch (err) {
    const msg = String(err).toLowerCase();
    if (msg.includes('permission denied') || msg.includes('no such file')) throw err;
    clearSftp(id);
    return fn(await getSftp(id));
  }
}

ipcMain.handle('sftp:list', (_, { id, remotePath }) =>
  withSftp(id, sftp => new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return reject(err.message);
      resolve(list.map(f => ({
        name: f.filename,
        type: f.attrs.isDirectory() ? 'dir' : 'file',
        size: f.attrs.size,
        modified: new Date(f.attrs.mtime * 1000).toLocaleString(),
      })).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }));
    });
  }))
);

ipcMain.handle('sftp:download', async (event, { id, remotePath }) => {
  const { filePath } = await dialog.showSaveDialog({ defaultPath: path.basename(remotePath) });
  if (!filePath) return { cancelled: true };
  const name = path.basename(remotePath);
  return withSftp(id, sftp => new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, filePath, {
      step: (transferred, chunk, total) =>
        event.sender.send(`sftp:progress:${id}`, { name, transferred, total }),
    }, err => {
      event.sender.send(`sftp:progress:${id}`, null);
      err ? reject(err.message) : resolve({ ok: true });
    });
  }));
});

ipcMain.handle('sftp:downloadDir', async (event, { id, remotePath }) => {
  const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!filePaths?.length) return { cancelled: true };
  const localBase = path.join(filePaths[0], path.basename(remotePath));
  return withSftp(id, async sftp => {
    let done = 0;
    async function downloadRecursive(remPath, localPath) {
      await fs.promises.mkdir(localPath, { recursive: true });
      const list = await new Promise((resolve, reject) =>
        sftp.readdir(remPath, (err, l) => err ? reject(err.message) : resolve(l))
      );
      const baseResolved = path.resolve(localBase);
      for (const item of list) {
        const fn = item.filename;
        // Guard against path traversal / zip-slip from a malicious server:
        // reject names with separators, dot-segments or NUL, and verify the
        // resolved local path stays inside the chosen destination folder.
        if (fn === '.' || fn === '..' || fn.includes('/') || fn.includes('\\') || fn.includes('\0')) continue;
        const rItem = remPath.replace(/\/$/, '') + '/' + fn;
        const lItem = path.join(localPath, fn);
        const resolved = path.resolve(lItem);
        if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) continue;
        if (item.attrs.isDirectory()) {
          await downloadRecursive(rItem, lItem);
        } else {
          event.sender.send(`sftp:progress:${id}`, { name: fn, transferred: done, total: null });
          await new Promise((resolve, reject) =>
            sftp.fastGet(rItem, lItem, {
              step: (transferred, chunk, total) =>
                event.sender.send(`sftp:progress:${id}`, { name: fn, transferred, total }),
            }, err => err ? reject(err.message) : resolve())
          );
          done++;
        }
      }
    }
    await downloadRecursive(remotePath, localBase);
    event.sender.send(`sftp:progress:${id}`, null);
    return { ok: true };
  });
});

ipcMain.handle('sftp:upload', async (event, { id, remotePath }) => {
  const { filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (!filePaths?.length) return { cancelled: true };
  const remote = remotePath.replace(/\/$/, '');
  return withSftp(id, sftp => Promise.all(filePaths.map(localFile => {
    const name = path.basename(localFile);
    return fastPutSmart(sftp, localFile, remote + '/' + name,
      (transferred, chunk, total) => event.sender.send(`sftp:progress:${id}`, { name, transferred, total }));
  })).then(() => {
    event.sender.send(`sftp:progress:${id}`, null);
    return { ok: true, count: filePaths.length };
  }));
});

ipcMain.handle('sftp:cancelUpload', (_, { id }) => { clearSftp(id); return { ok: true }; });

ipcMain.handle('sftp:delete', (_, { id, remotePath }) =>
  withSftp(id, sftp => new Promise((resolve, reject) => {
    sftp.unlink(remotePath, err => err ? reject(err.message) : resolve({ ok: true }));
  }))
);

ipcMain.handle('sftp:deleteDir', (_, { id, remotePath }) =>
  withSftp(id, async sftp => {
    async function rmrf(p) {
      const list = await new Promise((res, rej) =>
        sftp.readdir(p, (err, l) => err ? rej(err.message) : res(l))
      );
      for (const item of list) {
        const fn = item.filename;
        // Ignore any name a malicious server returns that could escape the target dir
        if (fn === '.' || fn === '..' || fn.includes('/') || fn.includes('\\') || fn.includes('\0')) continue;
        const full = p.replace(/\/$/, '') + '/' + fn;
        if (item.attrs.isDirectory()) await rmrf(full);
        else await new Promise((res, rej) =>
          sftp.unlink(full, err => err ? rej(err.message) : res())
        );
      }
      await new Promise((res, rej) =>
        sftp.rmdir(p, err => err ? rej(err.message) : res())
      );
    }
    await rmrf(remotePath);
    return { ok: true };
  })
);

ipcMain.handle('sftp:mkdir', (_, { id, remotePath }) =>
  withSftp(id, sftp => new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, err => err ? reject(err.message) : resolve({ ok: true }));
  }))
);

ipcMain.handle('sftp:rename', (_, { id, oldPath, newPath }) =>
  withSftp(id, sftp => new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, err => err ? reject(err.message) : resolve({ ok: true }));
  }))
);

ipcMain.handle('sftp:readFile', (_, { id, remotePath }) =>
  withSftp(id, sftp => new Promise((resolve, reject) => {
    const chunks = [];
    const stream = sftp.createReadStream(remotePath);
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve({ content: Buffer.concat(chunks).toString('utf8') }));
    stream.on('error', err => reject(err.message));
  }))
);

ipcMain.handle('sftp:writeFile', (_, { id, remotePath, content }) =>
  withSftp(id, sftp => new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.on('close', () => resolve({ ok: true }));
    stream.on('error', err => reject(err.message));
    stream.end(content);
  }))
);

ipcMain.handle('sftp:uploadFiles', (event, { id, remotePath, localPaths }) => {
  const remote = remotePath.replace(/\/$/, '');
  return withSftp(id, sftp => Promise.all(localPaths.map(localFile => {
    const name = path.basename(localFile);
    return fastPutSmart(sftp, localFile, remote + '/' + name,
      (transferred, chunk, total) => event.sender.send(`sftp:progress:${id}`, { name, transferred, total }));
  })).then(() => {
    event.sender.send(`sftp:progress:${id}`, null);
    return { ok: true, count: localPaths.length };
  }));
});

// Clipboard
ipcMain.handle('clipboard:read', () => {
  const { clipboard } = require('electron');
  return clipboard.readText();
});
ipcMain.handle('clipboard:write', (_, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
});
const configPath = path.join(app.getPath('userData'), 'connections.json');

ipcMain.handle('config:load', () => {
  if (vaultEnabled && !vaultKey) return [];   // locked — renderer must unlock first
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const arr = Array.isArray(raw) ? raw : [];
    // One-time migration: if any secret is still plaintext (from before encryption
    // was added, or an imported file), re-encrypt the whole store on disk now.
    const hasPlaintext = arr.some(c => c && typeof c.password === 'string' && c.password && !isEncrypted(c.password));
    if (hasPlaintext && (vaultKey || safeStorage.isEncryptionAvailable())) {
      try { fs.writeFileSync(configPath, JSON.stringify(arr.map(c => ({ ...c, password: encryptSecret(c.password) })), null, 2)); } catch {}
    }
    return arr.map(c => ({ ...c, password: decryptSecret(c.password) }));
  } catch { return []; }
});

ipcMain.handle('config:save', (_, data) => {
  if (vaultEnabled && !vaultKey) return { ok: false, error: 'Vault locked' };
  const toStore = (Array.isArray(data) ? data : []).map(c => ({ ...c, password: encryptSecret(c.password) }));
  fs.writeFileSync(configPath, JSON.stringify(toStore, null, 2));
  return { ok: true };
});

ipcMain.handle('dialog:browse', async (_, opts) => {
  const { filePaths } = await dialog.showOpenDialog({
    title: opts?.title || 'Select File',
    filters: opts?.filters || [{ name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  return filePaths?.[0] || null;
});

ipcMain.handle('config:export', async () => {
  const warn = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Export anyway'],
    defaultId: 0,
    cancelId: 0,
    title: 'Export Connections',
    message: 'The exported file will contain your passwords in readable form.',
    detail: 'This is required so the file can be imported on another machine. Keep it somewhere safe and do not share it — anyone who opens it can read your saved passwords.',
  });
  if (warn.response !== 1) return { cancelled: true };
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Connections',
    defaultPath: 'aossh-connections.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!filePath) return { cancelled: true };
  let data = [];
  try { data = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  const plain = (Array.isArray(data) ? data : []).map(c => ({ ...c, password: decryptSecret(c.password) }));
  fs.writeFileSync(filePath, JSON.stringify(plain, null, 2));
  return { ok: true };
});

ipcMain.handle('config:import:mobaxterm', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Import from MobaXterm',
    filters: [{ name: 'MobaXterm Sessions', extensions: ['mxtsessions'] }],
    properties: ['openFile'],
  });
  if (!filePaths?.length) return { cancelled: true };
  try {
    const text = fs.readFileSync(filePaths[0], 'utf8');
    const lines = text.split(/\r?\n/);
    const connections = [];
    let currentGroup = 'Imported';
    let currentSubgroup = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Section header
      if (line.startsWith('[Bookmarks')) {
        // Look ahead for SubRep
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const next = lines[j].trim();
          if (next.startsWith('SubRep=')) {
            const subRep = next.slice(7).trim();
            if (subRep.includes('\\')) {
              const parts = subRep.split('\\');
              currentGroup    = parts[0];
              currentSubgroup = parts[1] || null;
            } else {
              currentGroup    = subRep || 'Imported';
              currentSubgroup = null;
            }
            break;
          }
        }
        continue;
      }

      // Skip service lines
      if (line.startsWith('SubRep=') || line.startsWith('ImgNum=')) continue;

      // Parse connection: name=#109#0%host%port%username%password%...
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const name = line.slice(0, eqIdx).trim();
      const val  = line.slice(eqIdx + 1).trim();

      // Must be SSH type (#109#)
      if (!val.includes('#109#')) continue;

      // Extract the data part after #109#
      const dataMatch = val.match(/#109#0%([^#]+)/);
      if (!dataMatch) continue;

      const parts    = dataMatch[1].split('%');
      const host     = parts[0] || '';
      const port     = parseInt(parts[1]) || 22;
      const username = parts[2] || 'root';
      const password = parts[3] || '';

      if (!host) continue;

      connections.push({
        id: Date.now() + Math.random(),
        name, host, port, username,
        password: password || '',
        authType: 'password',
        privateKey: null,
        group:    currentGroup,
        subgroup: currentSubgroup,
        status:   'offline',
      });
    }

    return { ok: true, data: connections };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('config:import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Import Connections',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (!filePaths?.length) return { cancelled: true };
  try {
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!Array.isArray(data)) return { error: 'Invalid format' };
    return { ok: true, data };
  } catch(e) { return { error: 'Invalid file: ' + e.message }; }
});

// Check for updates via GitHub releases
ipcMain.handle('app:checkUpdate', () => {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get({
      hostname: 'api.github.com',
      path: '/repos/casper237/aossh/releases/latest',
      headers: { 'User-Agent': 'AOSSH' },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const latestRaw = (json.tag_name || '').replace(/^v/, '');
          const currentVersion = app.getVersion();
          const hasUpdate = isNewerVersion(currentVersion, latestRaw);
          resolve({ currentVersion, latestVersion: latestRaw, url: json.html_url || '', hasUpdate });
        } catch { resolve({ hasUpdate: false }); }
      });
    });
    req.on('error', () => resolve({ hasUpdate: false }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ hasUpdate: false }); });
  });
});

function isNewerVersion(current, latest) {
  const parse = v => v.replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
  const a = parse(current), b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
}

ipcMain.handle('app:openExternal', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
  return false;
});
ipcMain.handle('app:getVersion', () => app.getVersion());

// ── Master-password vault ───────────────────────────────────────────────────────
// Re-encrypt every stored secret from one key/scheme to another, in one pass.
function reencryptStore(mapSecret) {
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  arr = Array.isArray(arr) ? arr : [];
  fs.writeFileSync(configPath, JSON.stringify(arr.map(c => ({ ...c, password: mapSecret(c.password) })), null, 2));
}

ipcMain.handle('vault:status', () => ({ enabled: vaultEnabled, unlocked: !!vaultKey }));

ipcMain.handle('vault:unlock', (_, password) => {
  const m = loadVaultMeta();
  if (!m || !m.enabled) return { ok: false, error: 'Vault not enabled' };
  try {
    const key = deriveKey(password, m.salt);
    gcmDecrypt(key, m.verifier);   // throws on wrong password (GCM auth fails)
    vaultKey = key;
    return { ok: true };
  } catch { return { ok: false, error: 'Wrong password' }; }
});

ipcMain.handle('vault:lock', () => { vaultKey = null; return { ok: true }; });

ipcMain.handle('vault:enable', (_, password) => {
  if (vaultEnabled) return { ok: false, error: 'Already enabled' };
  if (!password || String(password).length < 6) return { ok: false, error: 'Password too short' };
  try {
    const salt = crypto.randomBytes(16).toString('base64');
    const key = deriveKey(password, salt);
    const verifier = gcmEncrypt(key, 'AOSSH-VAULT-OK');
    // Decrypt each secret with the CURRENT scheme (DPAPI/plaintext), then re-encrypt
    // with the vault key. vaultKey is still null here, so decryptSecret uses v1/plain.
    reencryptStore(pw => { const plain = decryptSecret(pw); return plain ? VAULT_PREFIX + gcmEncrypt(key, plain) : plain; });
    saveVaultMeta({ enabled: true, kdf: 'scrypt', salt, N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keyLen: SCRYPT.keyLen, verifier });
    vaultKey = key;
    vaultEnabled = true;
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('vault:disable', (_, password) => {
  const m = loadVaultMeta();
  if (!m || !m.enabled) return { ok: false, error: 'Not enabled' };
  let key;
  try { key = deriveKey(password, m.salt); gcmDecrypt(key, m.verifier); }
  catch { return { ok: false, error: 'Wrong password' }; }
  try {
    // Decrypt v2 with the vault key, then re-encrypt with DPAPI (or leave plaintext).
    reencryptStore(pw => {
      let plain = pw;
      if (typeof pw === 'string' && pw.startsWith(VAULT_PREFIX)) { try { plain = gcmDecrypt(key, pw.slice(VAULT_PREFIX.length)); } catch { plain = ''; } }
      if (!plain || isEncrypted(plain)) return plain;
      try { if (safeStorage.isEncryptionAvailable()) return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64'); } catch {}
      return plain;
    });
    try { fs.unlinkSync(vaultFile()); } catch {}
    vaultKey = null; vaultEnabled = false;
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('vault:change', (_, { oldPassword, newPassword }) => {
  const m = loadVaultMeta();
  if (!m || !m.enabled) return { ok: false, error: 'Not enabled' };
  if (!newPassword || String(newPassword).length < 6) return { ok: false, error: 'Password too short' };
  let oldKey;
  try { oldKey = deriveKey(oldPassword, m.salt); gcmDecrypt(oldKey, m.verifier); }
  catch { return { ok: false, error: 'Wrong current password' }; }
  try {
    const salt = crypto.randomBytes(16).toString('base64');
    const newKey = deriveKey(newPassword, salt);
    const verifier = gcmEncrypt(newKey, 'AOSSH-VAULT-OK');
    reencryptStore(pw => {
      let plain = pw;
      if (typeof pw === 'string' && pw.startsWith(VAULT_PREFIX)) { try { plain = gcmDecrypt(oldKey, pw.slice(VAULT_PREFIX.length)); } catch { plain = ''; } }
      return plain ? VAULT_PREFIX + gcmEncrypt(newKey, plain) : plain;
    });
    saveVaultMeta({ ...m, salt, verifier });
    vaultKey = newKey;
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('vault:secretCount', () => {
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  arr = Array.isArray(arr) ? arr : [];
  return arr.filter(c => c && typeof c.password === 'string' && c.password.length > 0).length;
});

ipcMain.handle('vault:reset', () => {
  // Forgotten password: wipe saved passwords (unrecoverable), keep connections, disable vault.
  try { reencryptStore(() => ''); } catch {}
  try { fs.unlinkSync(vaultFile()); } catch {}
  vaultKey = null; vaultEnabled = false;
  return { ok: true };
});

// Window controls
ipcMain.on('win:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('win:maximize', () => {
  const w = BrowserWindow.getFocusedWindow();
  w?.isMaximized() ? w.unmaximize() : w?.maximize();
});
ipcMain.on('win:close', () => BrowserWindow.getFocusedWindow()?.close());
