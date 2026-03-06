const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const os = require('os');

// Fix black screen on virtual machines and systems without GPU
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('in-process-gpu');

const sessions = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 900, minHeight: 600,
    frame: false,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableBlinkFeatures: 'Clipboard',
    }
  });
  win.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// SSH Connect
ipcMain.handle('ssh:connect', (event, { id, host, port, username, password, privateKey }) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const connOpts = { host, port: port || 22, username };
    if (privateKey) connOpts.privateKey = fs.readFileSync(privateKey);
    else connOpts.password = password;

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) return reject(err.message);
        sessions.set(id, { conn, stream });
        stream.on('data', d => event.sender.send(`ssh:data:${id}`, d.toString()));
        stream.stderr.on('data', d => event.sender.send(`ssh:data:${id}`, d.toString()));
        stream.on('close', () => {
          event.sender.send(`ssh:closed:${id}`);
          sessions.delete(id);
        });
        resolve({ ok: true });
      });
    });
    conn.on('error', err => reject(err.message));
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

// Run fn(sftp), retry once with a fresh channel if it fails
async function withSftp(id, fn) {
  try {
    return await fn(await getSftp(id));
  } catch (err) {
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

ipcMain.handle('sftp:download', async (_, { id, remotePath }) => {
  const { filePath } = await dialog.showSaveDialog({ defaultPath: path.basename(remotePath) });
  if (!filePath) return { cancelled: true };
  return withSftp(id, sftp => new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, filePath, err => err ? reject(err.message) : resolve({ ok: true }));
  }));
});

ipcMain.handle('sftp:downloadDir', async (_, { id, remotePath }) => {
  const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!filePaths?.length) return { cancelled: true };
  const localBase = path.join(filePaths[0], path.basename(remotePath));
  return withSftp(id, async sftp => {
    async function downloadRecursive(remPath, localPath) {
      await fs.promises.mkdir(localPath, { recursive: true });
      const list = await new Promise((resolve, reject) =>
        sftp.readdir(remPath, (err, l) => err ? reject(err.message) : resolve(l))
      );
      for (const item of list) {
        const rItem = remPath.replace(/\/$/, '') + '/' + item.filename;
        const lItem = path.join(localPath, item.filename);
        if (item.attrs.isDirectory()) {
          await downloadRecursive(rItem, lItem);
        } else {
          await new Promise((resolve, reject) =>
            sftp.fastGet(rItem, lItem, err => err ? reject(err.message) : resolve())
          );
        }
      }
    }
    await downloadRecursive(remotePath, localBase);
    return { ok: true };
  });
});

ipcMain.handle('sftp:upload', async (_, { id, remotePath }) => {
  const { filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (!filePaths?.length) return { cancelled: true };
  const remote = remotePath.replace(/\/$/, '');
  return withSftp(id, sftp => Promise.all(filePaths.map(localFile =>
    new Promise((resolve, reject) => {
      sftp.fastPut(localFile, remote + '/' + path.basename(localFile),
        err => err ? reject(err.message) : resolve());
    })
  )).then(() => ({ ok: true, count: filePaths.length })));
});

ipcMain.handle('sftp:delete', (_, { id, remotePath }) =>
  withSftp(id, sftp => new Promise((resolve, reject) => {
    sftp.unlink(remotePath, err => err ? reject(err.message) : resolve({ ok: true }));
  }))
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

ipcMain.handle('sftp:uploadFiles', (_, { id, remotePath, localPaths }) => {
  const remote = remotePath.replace(/\/$/, '');
  return withSftp(id, sftp => Promise.all(localPaths.map(localFile =>
    new Promise((resolve, reject) => {
      sftp.fastPut(localFile, remote + '/' + path.basename(localFile),
        err => err ? reject(err.message) : resolve());
    })
  )).then(() => ({ ok: true, count: localPaths.length })));
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
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return []; }
});

ipcMain.handle('config:save', (_, data) => {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
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
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Connections',
    defaultPath: 'aossh-connections.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!filePath) return { cancelled: true };
  fs.copyFileSync(configPath, filePath);
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

ipcMain.handle('app:openExternal', (_, url) => shell.openExternal(url));
ipcMain.handle('app:getVersion', () => app.getVersion());

// Window controls
ipcMain.on('win:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('win:maximize', () => {
  const w = BrowserWindow.getFocusedWindow();
  w?.isMaximized() ? w.unmaximize() : w?.maximize();
});
ipcMain.on('win:close', () => BrowserWindow.getFocusedWindow()?.close());
