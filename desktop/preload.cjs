const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glean', {
  config: () => ipcRenderer.invoke('glean:config'),
  chooseVault: () => ipcRenderer.invoke('glean:choose-vault'),
  revealNote: id => ipcRenderer.invoke('glean:reveal-note', id),
  openRepository: () => ipcRenderer.invoke('glean:open-repository'),
});
