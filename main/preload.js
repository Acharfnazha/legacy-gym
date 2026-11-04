const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  all: (sql, params) => ipcRenderer.invoke('db:all', sql, params),
  run: (sql, params) => ipcRenderer.invoke('db:run', sql, params),
  login: (u, p) => ipcRenderer.invoke('auth:login', u, p),
  logout: () => ipcRenderer.invoke('auth:logout'),
  cashbox: (day) => ipcRenderer.invoke('cashbox:get', day),
  createUser: (u, p, role, extra) => ipcRenderer.invoke('auth:createUser', u, p, role, extra),
  setPassword: (id, p) => ipcRenderer.invoke('auth:setPassword', id, p),
  changeOwnPassword: (id, current, next) => ipcRenderer.invoke('auth:changeOwnPassword', id, current, next),
  setUsername: (id, username) => ipcRenderer.invoke('auth:setUsername', id, username),
  updateProfile: (id, profile) => ipcRenderer.invoke('auth:updateProfile', id, profile),
  setRole: (id, role) => ipcRenderer.invoke('auth:setRole', id, role),
  setActive: (id, active) => ipcRenderer.invoke('auth:setActive', id, active),
  deleteUser: (id) => ipcRenderer.invoke('auth:deleteUser', id),
  clockWarning: () => ipcRenderer.invoke('app:clockWarning'),
  version: () => ipcRenderer.invoke('app:version'),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  licenseActivate: (code) => ipcRenderer.invoke('license:activate', code),
  licenseRemoteStatus: () => ipcRenderer.invoke('license:remoteStatus'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupChooseDir: () => ipcRenderer.invoke('backup:chooseDir'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (file) => ipcRenderer.invoke('backup:restore', file),
  backupOpenDir: () => ipcRenderer.invoke('backup:openDir'),
  exportCsv: (name, content) => ipcRenderer.invoke('export:csv', name, content),
  exportPdf: (name) => ipcRenderer.invoke('export:pdf', name)
});
