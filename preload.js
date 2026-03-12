const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAll:         ()              => ipcRenderer.invoke('db:getAll'),
  addEntry:       (entry)         => ipcRenderer.invoke('db:add', entry),
  updateEntry:    (entry)         => ipcRenderer.invoke('db:update', entry),
  deleteEntry:    (id)            => ipcRenderer.invoke('db:delete', id),
  openImage:      ()              => ipcRenderer.invoke('dialog:openImage'),
  savePoster:     (srcPath, showId) => ipcRenderer.invoke('poster:save', { srcPath, showId }),
  getPosterData:  (filePath)      => ipcRenderer.invoke('poster:getDataUrl', filePath),
  downloadPoster: (url, showId)   => ipcRenderer.invoke('poster:downloadFromUrl', { url, showId }),
});
