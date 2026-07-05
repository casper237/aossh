const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  connect:    o => ipcRenderer.invoke('ssh:connect', o),
  write:      o => ipcRenderer.invoke('ssh:write', o),
  resize:     o => ipcRenderer.invoke('ssh:resize', o),
  disconnect: o => ipcRenderer.invoke('ssh:disconnect', o),
  onData:          (id, cb) => ipcRenderer.on(`ssh:data:${id}`, (_, d) => cb(d)),
  onClosed:        (id, cb) => ipcRenderer.on(`ssh:closed:${id}`, cb),
  removeListeners: id => {
    ipcRenderer.removeAllListeners(`ssh:data:${id}`);
    ipcRenderer.removeAllListeners(`ssh:closed:${id}`);
  },
  onSftpProgress:  (id, cb) => ipcRenderer.on(`sftp:progress:${id}`, (_, d) => cb(d)),

  sftpList:        o => ipcRenderer.invoke('sftp:list', o),
  sftpGet:         o => ipcRenderer.invoke('sftp:download', o),
  sftpPut:         o => ipcRenderer.invoke('sftp:upload', o),
  sftpCancelUpload: o => ipcRenderer.invoke('sftp:cancelUpload', o),
  sftpDelete:      o => ipcRenderer.invoke('sftp:delete', o),
  sftpDeleteDir:   o => ipcRenderer.invoke('sftp:deleteDir', o),
  sftpMkdir:       o => ipcRenderer.invoke('sftp:mkdir', o),
  sftpRename:      o => ipcRenderer.invoke('sftp:rename', o),
  sftpDownloadDir: o => ipcRenderer.invoke('sftp:downloadDir', o),
  sftpReadFile:    o => ipcRenderer.invoke('sftp:readFile', o),
  sftpWriteFile:   o => ipcRenderer.invoke('sftp:writeFile', o),
  sftpUploadFiles: o => ipcRenderer.invoke('sftp:uploadFiles', o),

  clipboardRead:  () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: t  => ipcRenderer.invoke('clipboard:write', t),

  browseFile: o => ipcRenderer.invoke('dialog:browse', o),

  // Electron 32+ removed File.path; this is the supported way to get a dropped
  // file's absolute path for SFTP upload.
  getPathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return file?.path || ''; } },

  exportConnections: () => ipcRenderer.invoke('config:export'),
  exportConnectionsEncrypted: pw => ipcRenderer.invoke('config:exportEncrypted', pw),
  importConnections: () => ipcRenderer.invoke('config:import'),
  importDecrypt: pw => ipcRenderer.invoke('config:importDecrypt', pw),
  importMobaXterm:   () => ipcRenderer.invoke('config:import:mobaxterm'),

  loadConnections: () => ipcRenderer.invoke('config:load'),
  saveConnections: d  => ipcRenderer.invoke('config:save', d),

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close:    () => ipcRenderer.send('win:close'),

  checkUpdate:  ()    => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: url   => ipcRenderer.invoke('app:openExternal', url),
  getVersion:   ()    => ipcRenderer.invoke('app:getVersion'),

  vaultStatus:  () => ipcRenderer.invoke('vault:status'),
  vaultUnlock:  pw => ipcRenderer.invoke('vault:unlock', pw),
  vaultLock:    () => ipcRenderer.invoke('vault:lock'),
  vaultEnable:  pw => ipcRenderer.invoke('vault:enable', pw),
  vaultDisable: pw => ipcRenderer.invoke('vault:disable', pw),
  vaultChange:  o  => ipcRenderer.invoke('vault:change', o),
  vaultReset:      () => ipcRenderer.invoke('vault:reset'),
  vaultSecretCount:() => ipcRenderer.invoke('vault:secretCount'),
});
