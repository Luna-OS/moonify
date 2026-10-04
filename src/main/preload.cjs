// Brücke zwischen der Moonify-Oberfläche und dem Main-Prozess.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moonify', {
  info: () => ipcRenderer.invoke('moonify:info'),
  loginStatus: () => ipcRenderer.invoke('moonify:login-status'),
  logout: (id) => ipcRenderer.invoke('moonify:logout', String(id)),
  openExternal: (url) => ipcRenderer.invoke('moonify:open-external', String(url)),
});
