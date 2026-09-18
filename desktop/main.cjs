const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
let backend, window, config;
const root = path.join(__dirname, '..');

function freePort() {
  return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
}
async function start() {
  const port = await freePort();
  const token = randomBytes(32).toString('hex');
  const dataDir = app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(root, '.glean');
  config = { token, baseUrl: `http://127.0.0.1:${port}` };
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'glean-backend.exe' : 'glean-backend') : path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const args = app.isPackaged ? [] : [path.join(root, 'backend', 'entry.py')];
  backend = spawn(executable, args, { cwd: app.isPackaged ? app.getPath('userData') : root, env: { ...process.env, GLEAN_TOKEN: token, GLEAN_PORT: String(port), GLEAN_DATA_DIR: dataDir, GLEAN_UI_DIR: app.isPackaged ? path.join(process.resourcesPath, 'ui') : path.join(root, 'dist') }, stdio: 'ignore' });
  backend.on('error', () => { dialog.showErrorBox('拾知无法启动', '请先安装后端依赖，详见项目 README。'); app.quit(); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(`${config.baseUrl}/api/health`, { headers: { 'X-Glean-Token': token } }); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) { dialog.showErrorBox('拾知无法启动', '本地服务启动超时，请检查 Python 环境或重新启动应用。'); app.quit(); return; }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"] } }));
  createWindow();
}
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 700, title: '拾知 Glean', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#f5f7f5', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 22 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== config.baseUrl) event.preventDefault(); });
  window.loadURL(config.baseUrl);
}
function trusted(event) { if (!event.senderFrame || new URL(event.senderFrame.url).origin !== config.baseUrl) throw new Error('不受信任的窗口'); }
ipcMain.handle('glean:config', event => { trusted(event); return config; });
ipcMain.handle('glean:choose-vault', async event => { trusted(event); const result = await dialog.showOpenDialog(window, { title: '选择 Obsidian 仓库', properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle('glean:open-obsidian', (event, file) => { trusted(event); if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file) !== '.md') return; return shell.openExternal(`obsidian://open?path=${encodeURIComponent(file)}`); });
app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { backend?.kill('SIGKILL'); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && config) createWindow(); });
