const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const os = require('os');

// Fix black screen on virtual machines and systems without GPU
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

// SFTP
ipcMain.handle('sftp:list', (_, { id, remotePath }) => {
  return new Promise((resolve, reject) => {
    const s = sessions.get(id);
    if (!s) return reject('Not connected');
    s.conn.sftp((err, sftp) => {
      if (err) return reject(err.message);
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
    });
  });
});

ipcMain.handle('sftp:download', async (_, { id, remotePath }) => {
  const { filePath } = await dialog.showSaveDialog({ defaultPath: path.basename(remotePath) });
  if (!filePath) return { cancelled: true };
  return new Promise((resolve, reject) => {
    const s = sessions.get(id);
    s.conn.sftp((err, sftp) => {
      if (err) return reject(err.message);
      sftp.fastGet(remotePath, filePath, err => err ? reject(err.message) : resolve({ ok: true }));
    });
  });
});

ipcMain.handle('sftp:upload', async (_, { id, remotePath }) => {
  const { filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (!filePaths?.length) return { cancelled: true };
  const localFile = filePaths[0];
  const remoteFile = remotePath.replace(/\/$/, '') + '/' + path.basename(localFile);
  return new Promise((resolve, reject) => {
    const s = sessions.get(id);
    s.conn.sftp((err, sftp) => {
      if (err) return reject(err.message);
      sftp.fastPut(localFile, remoteFile, err => err ? reject(err.message) : resolve({ ok: true }));
    });
  });
});

ipcMain.handle('sftp:delete', (_, { id, remotePath }) => {
  return new Promise((resolve, reject) => {
    const s = sessions.get(id);
    s.conn.sftp((err, sftp) => {
      if (err) return reject(err.message);
      sftp.unlink(remotePath, err => err ? reject(err.message) : resolve({ ok: true }));
    });
  });
});

ipcMain.handle('sftp:mkdir', (_, { id, remotePath }) => {
  return new Promise((resolve, reject) => {
    const s = sessions.get(id);
    s.conn.sftp((err, sftp) => {
      if (err) return reject(err.message);
      sftp.mkdir(remotePath, err => err ? reject(err.message) : resolve({ ok: true }));
    });
  });
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
