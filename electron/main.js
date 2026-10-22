const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const smokeOutput = argument('smoke-test');
const customUserData = argument('gsd-user-data');
if (customUserData) app.setPath('userData', path.resolve(customUserData));
app.setName('GSD');

let backend;
let mainWindow;
let quitting = false;
const destinations = new Map();

function toolPaths() {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'binaries') : path.join(__dirname, '..', 'backend', 'binaries');
  return {
    ytDlp: app.isPackaged ? path.join(root, 'yt-dlp.exe') : process.env.GSD_YTDLP_PATH || path.join(root, 'yt-dlp.exe'),
    ffmpeg: app.isPackaged ? path.join(root, 'ffmpeg.exe') : process.env.GSD_FFMPEG_PATH || path.join(root, 'ffmpeg.exe'),
    ffprobe: app.isPackaged ? path.join(root, 'ffprobe.exe') : process.env.GSD_FFPROBE_PATH || path.join(root, 'ffprobe.exe'),
    node: app.isPackaged ? path.join(root, 'node.exe') : process.env.GSD_NODE_PATH || path.join(root, 'node.exe'),
  };
}

async function verifyTools(tools) {
  const results = await Promise.all(Object.entries(tools).map(async ([name, executable]) => {
    try {
      await fs.access(executable);
      const args = name === 'ffmpeg' || name === 'ffprobe' ? ['-version'] : ['--version'];
      const { stdout } = await runFile(executable, args, { windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024 });
      return [name, stdout.split(/\r?\n/)[0].trim()];
    } catch (error) {
      throw new Error(`${name} could not start (${executable}). ${app.isPackaged ? 'Reinstall GSD to restore its bundled media tools.' : 'Run npm run prepare:tools before starting the desktop app.'} ${error.message}`);
    }
  }));
  return Object.fromEntries(results);
}

function trustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('This action is only available in the GSD window.');
  }
  const senderUrl = new URL(event.senderFrame.url);
  if (senderUrl.origin !== new URL(backend.url).origin) throw new Error('Untrusted window origin.');
}

function registerDesktopActions() {
  ipcMain.handle('gsd:choose-directory', async (event) => {
    trustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Save GSD downloads to',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const directory = await fs.realpath(result.filePaths[0]);
    const token = crypto.randomUUID();
    destinations.set(token, directory);
    return { token, label: directory };
  });
  ipcMain.handle('gsd:reveal-file', async (event, jobId) => {
    trustedSender(event);
    if (typeof jobId !== 'string' || jobId.length > 100) throw new Error('Invalid download.');
    const job = backend.manager.get(jobId);
    if (!job || job.status !== 'completed' || !job.savedPath) throw new Error('The saved file is unavailable.');
    const file = await fs.realpath(job.savedPath);
    const allowed = [...destinations.values()].some((directory) => {
      const relative = path.relative(directory, file);
      return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
    });
    if (!allowed) throw new Error('This file was not saved to a folder selected in GSD.');
    await fs.access(file);
    shell.showItemInFolder(file);
  });
}

async function createWindow({ visible = true } = {}) {
  const window = new BrowserWindow({
    title: 'GSD', width: 1180, height: 840, minWidth: 400, minHeight: 560,
    backgroundColor: '#f4f5ef', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(backend.url).origin) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined; });
  await window.loadURL(backend.url);
  if (visible) window.show();
  return window;
}

async function writeSmokeResult(result) {
  if (!smokeOutput) return;
  await fs.mkdir(path.dirname(path.resolve(smokeOutput)), { recursive: true });
  await fs.writeFile(path.resolve(smokeOutput), `${JSON.stringify(result, null, 2)}\n`);
}

async function shutdown(exitCode = 0) {
  if (quitting) return;
  quitting = true;
  // Stop renderer fetches and reconnecting EventSource connections before draining HTTP.
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  try { await backend?.close(); }
  catch (error) { console.error('GSD shutdown failed:', error); exitCode = 1; }
  finally { destinations.clear(); app.exit(exitCode); }
}

async function start() {
  const tools = toolPaths();
  const versions = await verifyTools(tools);
  const tempRoot = path.join(app.getPath('userData'), 'jobs');
  await fs.mkdir(tempRoot, { recursive: true });
  const { startServer } = require('../backend/server');
  backend = await startServer({
    host: '127.0.0.1', port: 0, tempRoot, tools,
    availability: Object.fromEntries(Object.keys(tools).map((name) => [name, true])),
    resolveDestination: (token) => destinations.get(token) || null,
  });
  const healthResponse = await fetch(`${backend.url}/api/health`, { signal: AbortSignal.timeout(10_000) });
  if (!healthResponse.ok) throw new Error(`GSD backend health check failed (${healthResponse.status}).`);
  const health = await healthResponse.json();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerDesktopActions();
  const window = await createWindow({ visible: !smokeOutput });
  if (smokeOutput) {
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        const ready = document.querySelector('.connection-status')?.textContent?.includes('Desktop is ready');
        const loading = document.body.innerText.includes('Loading your downloads');
        const error = document.querySelector('[role="alert"]')?.textContent;
        if (error) return reject(new Error('The desktop interface reported an error: ' + error));
        if (ready && !loading) return resolve(true);
        if (Date.now() >= deadline) return reject(new Error('The desktop interface did not finish connecting within 10 seconds.'));
        setTimeout(check, 50);
      };
      check();
    })`);
    const renderer = await window.webContents.executeJavaScript(`({ title: document.title, bridge: typeof window.gsd?.chooseDirectory === 'function' && typeof window.gsd?.revealFile === 'function', text: document.body.innerText.slice(0, 600) })`);
    if (!renderer.bridge || !renderer.text.includes('GSD')) throw new Error('The packaged interface or desktop bridge did not load.');
    const screenshots = [];
    if (process.argv.includes('--smoke-capture')) {
      for (const [name, width, height] of [['desktop', 1180, 840], ['narrow', 400, 760]]) {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const screenshot = path.join(path.dirname(path.resolve(smokeOutput)), `${name}.png`);
        await fs.writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
        screenshots.push(screenshot);
      }
    }
    await writeSmokeResult({ ok: true, packaged: app.isPackaged, platform: process.platform, arch: process.arch, appVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, tools: versions, health, renderer, screenshots, address: backend.url, tempRoot, date: new Date().toISOString() });
    await shutdown();
  }
}

const hasLock = smokeOutput || app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on('window-all-closed', () => { void shutdown(); });
  app.on('before-quit', (event) => {
    if (!quitting && backend) { event.preventDefault(); void shutdown(); }
  });
  app.whenReady().then(start).catch(async (error) => {
    console.error('GSD failed to start:', error);
    await writeSmokeResult({ ok: false, error: error.stack || error.message, date: new Date().toISOString() }).catch(console.error);
    if (!smokeOutput) dialog.showErrorBox('GSD could not start', error.message);
    await shutdown(1);
  });
}
