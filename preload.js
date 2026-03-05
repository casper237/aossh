const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  connect:    o => ipcRenderer.invoke('ssh:connect', o),
  write:      o => ipcRenderer.invoke('ssh:write', o),
  resize:     o => ipcRenderer.invoke('ssh:resize', o),
  disconnect: o => ipcRenderer.invoke('ssh:disconnect', o),
  onData:     (id, cb) => ipcRenderer.on(`ssh:data:${id}`, (_, d) => cb(d)),
  onClosed:   (id, cb) => ipcRenderer.on(`ssh:closed:${id}`, cb),

  sftpList:   o => ipcRenderer.invoke('sftp:list', o),
  sftpGet:    o => ipcRenderer.invoke('sftp:download', o),
  sftpPut:    o => ipcRenderer.invoke('sftp:upload', o),
  sftpDelete: o => ipcRenderer.invoke('sftp:delete', o),
  sftpMkdir:  o => ipcRenderer.invoke('sftp:mkdir', o),

  clipboardRead:  () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: t  => ipcRenderer.invoke('clipboard:write', t),

  browseFile: o => ipcRenderer.invoke('dialog:browse', o),

  exportConnections: () => ipcRenderer.invoke('config:export'),
  importConnections: () => ipcRenderer.invoke('config:import'),
  importMobaXterm:   () => ipcRenderer.invoke('config:import:mobaxterm'),

  loadConnections: () => ipcRenderer.invoke('config:load'),
  saveConnections: d  => ipcRenderer.invoke('config:save', d),

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close:    () => ipcRenderer.send('win:close'),

  checkUpdate:  ()    => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: url   => ipcRenderer.invoke('app:openExternal', url),
});
