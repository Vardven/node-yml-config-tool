// 预加载脚本：向页面暴露主进程的原生能力
// - nativeFetch：「解析订阅」拉订阅链接（绕过跨域限制）
// - nativeUpdate / onUpdateProgress / nativePlatform：软件内更新
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeFetch', function (url, headers) {
  return ipcRenderer.invoke('fetch-text', url, headers);
});

contextBridge.exposeInMainWorld('nativeUpdate', function (url, filename) {
  return ipcRenderer.invoke('download-update', url, filename);
});
contextBridge.exposeInMainWorld('onUpdateProgress', function (cb) {
  ipcRenderer.on('update-progress', function (event, pct) { cb(pct); });
});
contextBridge.exposeInMainWorld('nativePlatform', {
  platform: process.platform,
  arch: process.arch,
  isPortable: !!process.env.PORTABLE_EXECUTABLE_PATH
});
