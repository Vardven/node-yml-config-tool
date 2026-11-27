// Electron 主进程：打开 www/index.html，数据由页面自己的 localStorage 保存
const { app, BrowserWindow, Menu, shell, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 页面「解析订阅」拉取订阅链接用：主进程发请求不受浏览器跨域限制，也能带 User-Agent
ipcMain.handle('fetch-text', async (event, url, headers) => {
  const res = await net.fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
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
  if (process.platform === 'win32' && safe.endsWith('.exe')) {
    // 安装程序延迟约 2 秒再启动、本应用先退出：否则安装程序启动太快、
    // 本应用还没退干净时它去结束进程会失败，弹「无法关闭本应用」让用户手动关。
    // 安装版（setup）同时提权：应用本身不是管理员启动时，安装程序以管理员方式
    // 拉起（弹 UAC），保证有权限写入安装目录；免安装版只延迟普通启动。
    launchInstaller(dest, /setup\.exe$/i.test(safe));
    setTimeout(() => app.quit(), 800);
  } else {
    await shell.openPath(dest);
    if (safe.endsWith('.exe')) setTimeout(() => app.quit(), 1500);
  }
  return { ok: true };
});

// 延迟启动安装程序（与本应用进程脱离，本应用退出后它仍会执行）；
// elevate=true 时经 PowerShell 的 Start-Process -Verb RunAs 提权，失败逐级退回普通延迟启动 / 直接打开
function launchInstaller(filePath, elevate) {
  if (!elevate) { launchDelayedPlain(filePath); return; }
  try {
    const { spawn } = require('child_process');
    const psPath = "'" + String(filePath).replace(/'/g, "''") + "'";
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2; Start-Process -FilePath ' + psPath + ' -Verb RunAs'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { launchDelayedPlain(filePath); });
    child.unref();
  } catch (e) {
    launchDelayedPlain(filePath);
  }
}

// 用 cmd + ping 做约 2 秒延迟后普通启动（timeout 命令在输入被重定向时会报错，故用 ping 计时）
function launchDelayedPlain(filePath) {
  try {
    const { spawn } = require('child_process');
    const child = spawn('cmd.exe', ['/c', 'ping -n 3 127.0.0.1 >nul & start "" "' + String(filePath) + '"'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { shell.openPath(filePath); });
    child.unref();
  } catch (e) {
    shell.openPath(filePath);
  }
}

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
