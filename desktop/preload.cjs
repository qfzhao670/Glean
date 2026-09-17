const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glean', {
  config: () => ipcRenderer.invoke('glean:config'),
  chooseVault: () => ipcRenderer.invoke('glean:choose-vault'),
  openObsidian: path => ipcRenderer.invoke('glean:open-obsidian', path),
});
