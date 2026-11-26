// 预加载脚本：向页面暴露主进程拉取文本的能力（「解析订阅」拉订阅链接用，绕过跨域限制）
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeFetch', function (url, headers) {
  return ipcRenderer.invoke('fetch-text', url, headers);
});
