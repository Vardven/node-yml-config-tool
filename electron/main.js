// Electron 主进程：打开 www/index.html，数据由页面自己的 localStorage 保存
const { app, BrowserWindow, Menu, shell, ipcMain, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// 页面「解析订阅」拉取订阅链接用：主进程发请求不受浏览器跨域限制，也能带 User-Agent
ipcMain.handle('fetch-text', async (event, url, headers) => {
  const res = await net.fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
});

// ---------------------------------------------------------------------------
// mihomo 内核（节点测速用）：内核二进制随安装包放在 resources/core/ 里，
// 页面把临时测速配置传进来，主进程写盘后拉起内核，等它的控制 API 就绪再返回。
// ---------------------------------------------------------------------------
let coreProc = null;
function coreBinaryPath() {
  const name = process.platform === 'win32'
    ? 'mihomo-windows-' + process.arch + '.exe'
    : 'mihomo-darwin-' + process.arch;
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return path.join(base, 'core', name);
}
function stopCoreProc() {
  if (coreProc) { try { coreProc.kill(); } catch (e) { /* 忽略 */ } coreProc = null; }
}
ipcMain.handle('core-start', async (event, args) => {
  stopCoreProc();
  const bin = coreBinaryPath();
  if (!fs.existsSync(bin)) throw new Error('core binary missing');
  if (process.platform !== 'win32') { try { fs.chmodSync(bin, 0o755); } catch (e) { /* 忽略 */ } }
  const dir = path.join(app.getPath('userData'), 'coretest');
  fs.mkdirSync(dir, { recursive: true });
  const cfgPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(cfgPath, String((args && args.config) || ''), 'utf8');
  const out = fs.openSync(path.join(dir, 'core.log'), 'a');
  coreProc = spawn(bin, ['-d', dir, '-f', cfgPath], { stdio: ['ignore', out, out] });
  coreProc.on('exit', () => { coreProc = null; });
  const apiBase = 'http://127.0.0.1:' + (args && args.apiPort);
  for (let i = 0; i < 45; i++) {
    try {
      const r = await net.fetch(apiBase + '/version');
      if (r.ok) return { ok: true };
    } catch (e) { /* 内核还没起来 */ }
    await new Promise((res) => setTimeout(res, 200));
  }
  stopCoreProc();
  throw new Error('core start timeout');
});
ipcMain.handle('core-stop', async () => { stopCoreProc(); return { ok: true }; });
// 经测速内核的混合端口发请求（测出口国家时取 Cloudflare trace 用）
ipcMain.handle('fetch-via-proxy', async (event, args) => {
  const ses = session.fromPartition('core-test');
  await ses.setProxy({ proxyRules: 'http://127.0.0.1:' + (args && args.port) });
  const res = await ses.fetch(String((args && args.url) || ''), { headers: { 'User-Agent': 'clash.meta' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return { text: await res.text() };
});

// ---------------------------------------------------------------------------
// 软件内更新：下载新版安装包到临时目录并打开安装程序（exe 打开后退出本应用让安装继续）
// ---------------------------------------------------------------------------
ipcMain.handle('download-update', async (event, url, filename) => {
  const safe = path.basename(String(filename || 'update.bin'));
  const dest = path.join(os.tmpdir(), safe);
  const res = await net.fetch(String(url));
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const file = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    got += chunk.value.length;
    file.write(Buffer.from(chunk.value));
    event.sender.send('update-progress', total > 0 ? Math.floor((got / total) * 100) : -1);
  }
  await new Promise((resolve, reject) => { file.end((err) => (err ? reject(err) : resolve())); });
  await shell.openPath(dest);
  if (safe.endsWith('.exe')) setTimeout(() => app.quit(), 1500);
  return { ok: true };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 360,
    minHeight: 560,
    title: 'Clash YML 配置工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  Menu.setApplicationMenu(null);
  // 页面里的 GitHub 等外链用系统浏览器打开，不在软件窗口里跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopCoreProc);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
