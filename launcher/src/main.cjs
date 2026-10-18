const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let window;
let sessionProcess;
let session = { status: 'idle', serial: '', fps: null, pid: null };
let settings = { adbPath: '', scrcpyPath: '' };

function isExecutable(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findExecutable(name, configuredPath, extraPaths = []) {
  const executableName = process.platform === 'win32' && !name.endsWith('.exe')
    ? `${name}.exe`
    : name;
  const candidates = [
    configuredPath,
    ...extraPaths,
    ...((process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, executableName))),
  ].filter(Boolean);
  return candidates.find(isExecutable) || '';
}

function resolveAdbPath() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const sdkAdb = path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
  return findExecutable('adb', settings.adbPath, [sdkAdb]);
}

function resolveScrcpyPath() {
  const projectRoot = path.resolve(__dirname, '../..');
  return findExecutable('scrcpy', settings.scrcpyPath, [
    path.join(projectRoot, 'scrcpy.exe'),
    path.join(projectRoot, 'build', 'scrcpy.exe'),
    path.join(projectRoot, 'out', 'scrcpy.exe'),
  ]);
}

async function loadDevices() {
  const adbPath = resolveAdbPath();
  if (!adbPath) {
    return { adbPath: '', devices: [], error: 'Không tìm thấy adb.exe. Hãy chọn file trong Android SDK.' };
  }

  try {
    const { stdout } = await execFileAsync(adbPath, ['devices', '-l'], { windowsHide: true });
    const devices = stdout.split(/\r?\n/).slice(1).filter(Boolean).map(line => {
      const [serial, status, ...metadata] = line.trim().split(/\s+/);
      const values = Object.fromEntries(metadata.map(item => {
        const separator = item.indexOf(':');
        return separator < 0 ? [item, ''] : [item.slice(0, separator), item.slice(separator + 1)];
      }));
      const model = (values.model || values.product || serial || 'Thiết bị Android').replace(/_/g, ' ');
      return { serial, status, model, product: values.product || '' };
    });
    return { adbPath, devices, error: '' };
  } catch (error) {
    return { adbPath, devices: [], error: error.message };
  }
}

function emitSession(update = {}) {
  session = { ...session, ...update };
  if (window && !window.isDestroyed()) {
    window.webContents.send('session:update', session);
  }
}

function addLog(text, stream = 'info') {
  const fpsMatch = text.match(/\b(\d+)\s+fps\b/i);
  if (fpsMatch) {
    emitSession({ fps: Number(fpsMatch[1]) });
  }
  if (window && !window.isDestroyed()) {
    window.webContents.send('session:log', { text, stream, time: new Date().toLocaleTimeString() });
  }
}

function consumeOutput(stream, kind) {
  let pending = '';
  stream.on('data', chunk => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    lines.filter(Boolean).forEach(line => addLog(line, kind));
  });
  stream.on('end', () => {
    if (pending) addLog(pending, kind);
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 650,
    backgroundColor: '#f2f2ed',
    title: 'scrcpy // LINK DECK',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(() => {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    // First launch or no saved settings yet.
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (sessionProcess && !sessionProcess.killed) sessionProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:bootstrap', async () => {
  const adb = await loadDevices();
  return {
    ...adb,
    scrcpyPath: resolveScrcpyPath(),
    session,
    platform: os.platform(),
  };
});

ipcMain.handle('devices:refresh', loadDevices);

ipcMain.handle('path:choose', async (_event, kind) => {
  const isAdb = kind === 'adb';
  const result = await dialog.showOpenDialog(window, {
    title: isAdb ? 'Chọn adb.exe' : 'Chọn scrcpy.exe',
    properties: ['openFile'],
    filters: [{ name: 'Windows executable', extensions: ['exe'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  if (isAdb) settings.adbPath = result.filePaths[0];
  else settings.scrcpyPath = result.filePaths[0];
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  return result.filePaths[0];
});

ipcMain.handle('session:start', async (_event, options) => {
  if (sessionProcess && !sessionProcess.killed) {
    throw new Error('Phiên scrcpy hiện tại vẫn đang chạy.');
  }
  const adbPath = resolveAdbPath();
  const scrcpyPath = resolveScrcpyPath();
  if (!adbPath) throw new Error('Chưa tìm thấy adb.exe.');
  if (!scrcpyPath) throw new Error('Chưa chọn scrcpy.exe. Hãy dùng nút Chọn scrcpy.exe.');
  if (!options || !options.serial) throw new Error('Hãy chọn thiết bị Android trước.');

  const args = ['--serial', options.serial];
  const maxSize = Number(options.maxSize);
  if (Number.isInteger(maxSize) && maxSize > 0) args.push('--max-size', String(maxSize));
  for (const [option, value] of [
    ['--window-width', options.windowWidth],
    ['--window-height', options.windowHeight],
  ]) {
    if (value == null || value === '') continue;
    const dimension = Number(value);
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 0xFFFF) {
      throw new Error('Chiều rộng và chiều cao cửa sổ phải là số nguyên từ 1 đến 65535.');
    }
    args.push(option, String(dimension));
  }
  if (options.printFps) args.push('--print-fps');

  const child = spawn(scrcpyPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  sessionProcess = child;
  emitSession({ status: 'starting', serial: options.serial, fps: null, pid: child.pid || null });
  consumeOutput(child.stdout, 'stdout');
  consumeOutput(child.stderr, 'stderr');
  child.once('spawn', () => emitSession({ status: 'running', pid: child.pid || null }));
  child.once('error', error => {
    addLog(error.message, 'error');
    emitSession({ status: 'error', pid: null });
    sessionProcess = null;
  });
  child.once('close', code => {
    addLog(`scrcpy đã kết thúc (mã ${code ?? 'không xác định'}).`);
    emitSession({ status: 'idle', pid: null });
    sessionProcess = null;
  });
  return { started: true };
});

ipcMain.handle('session:stop', () => {
  if (sessionProcess && !sessionProcess.killed) sessionProcess.kill();
  return { stopped: true };
});