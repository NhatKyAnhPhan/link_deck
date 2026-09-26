const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scrcpyLauncher', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  refreshDevices: () => ipcRenderer.invoke('devices:refresh'),
  choosePath: kind => ipcRenderer.invoke('path:choose', kind),
  startSession: options => ipcRenderer.invoke('session:start', options),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  onSessionUpdate: callback => ipcRenderer.on('session:update', (_event, state) => callback(state)),
  onSessionLog: callback => ipcRenderer.on('session:log', (_event, entry) => callback(entry)),
});