// Brücke zwischen der Moonify-Oberfläche und dem Main-Prozess.
const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, callback) {
  const handler = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('moonify', {
  info: () => ipcRenderer.invoke('moonify:info'),
  loginStatus: () => ipcRenderer.invoke('moonify:login-status'),
  logout: (id) => ipcRenderer.invoke('moonify:logout', String(id)),
  openExternal: (url) => ipcRenderer.invoke('moonify:open-external', String(url)),

  engines: {
    start: (id, options) => ipcRenderer.invoke('engine:start', String(id), options || {}),
    stop: (id) => ipcRenderer.invoke('engine:stop', String(id)),
    show: (id, options) => ipcRenderer.invoke('engine:show', String(id), options || {}),
    home: (id, options) => ipcRenderer.invoke('engine:home', String(id), options || {}),
    command: (id, command) => ipcRenderer.invoke('engine:command', String(id), command),
    request: (id, req) => ipcRenderer.invoke('engine:request', String(id), req),
    onState: (callback) => listen('engine:state', callback),
    onLogin: (callback) => listen('engine:login', callback),
    onReady: (callback) => listen('engine:ready', callback),
    onError: (callback) => listen('engine:error', callback),
    onWindow: (callback) => listen('engine:window', callback),
    onNotice: (callback) => listen('engine:notice', callback),
  },

  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    status: () => ipcRenderer.invoke('update:status'),
    onStatus: (callback) => listen('update:status', callback),
  },
});
