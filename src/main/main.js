import { app, BrowserWindow, Menu, ipcMain, net, protocol, session } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getProvider } from '../shared/providers.js';
import { EngineManager, openExternal } from './engines.js';
import { createUpdater } from './updater.js';

// `components` gibt es nur in der Widevine-Version von Electron (castLabs).
const require = createRequire(import.meta.url);
const { components } = require('electron');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '..');
const SERVED_DIRS = [path.join(SRC_DIR, 'renderer'), path.join(SRC_DIR, 'shared')];
const MAIN_PRELOAD = path.join(HERE, 'preload.cjs');
const ENGINE_PRELOAD = path.join(HERE, 'engine-preload.cjs');
const ICON = path.join(SRC_DIR, '..', 'assets', 'icon.png');
const APP_URL = 'moonify://app/renderer/index.html';
const BACKGROUND = '#070818';

let mainWindow = null;
let widevineReady = false;
let engines = null;
let updater = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'moonify', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

app.on('before-quit', () => {
  if (engines) engines.quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (app.isReady() && !mainWindow) createWindow();
});

function sendToUi(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

async function start() {
  if (components) {
    try {
      await components.whenReady();
      widevineReady = true;
    } catch (err) {
      console.error('Widevine konnte nicht geladen werden:', err);
    }
  }

  const nativeUserAgent = session.defaultSession.getUserAgent();
  const userAgent = cleanUserAgent(nativeUserAgent);
  app.userAgentFallback = userAgent;

  engines = new EngineManager({ preload: ENGINE_PRELOAD, icon: ICON, send: sendToUi, nativeUserAgent });
  engines.prepareSessions(userAgent);
  updater = createUpdater((status) => sendToUi('update:status', status));

  registerAppProtocol();
  registerIpc();
  setupMenu();
  createWindow();
}

function cleanUserAgent(ua) {
  return ua
    .replace(/\s+Electron\/\S+/i, '')
    .replace(/\s+moonify\/\S+/i, '')
    .trim();
}

function registerAppProtocol() {
  protocol.handle('moonify', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const target = path.normalize(path.join(SRC_DIR, decodeURIComponent(url.pathname)));
    const allowed = SERVED_DIRS.some((dir) => target.startsWith(dir + path.sep));
    if (!allowed) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    title: 'Moonify',
    backgroundColor: BACKGROUND,
    show: false,
    icon: ICON,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarOverlay: { color: '#0b0c22', symbolColor: '#cfd3ff', height: 48 } }),
    webPreferences: {
      preload: MAIN_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (url !== APP_URL) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Ohne Hauptfenster brauchen wir auch die Player im Hintergrund nicht mehr
    engines.stopAll();
    engines.quitting = false;
    if (process.platform !== 'darwin') app.quit();
  });
  mainWindow.loadURL(APP_URL);
}

function fromMainWindow(event) {
  return mainWindow && event.sender === mainWindow.webContents;
}

function engineOptions(options) {
  return { amazonRegion: typeof options?.amazonRegion === 'string' ? options.amazonRegion : undefined };
}

function registerIpc() {
  ipcMain.handle('moonify:info', (event) => {
    if (!fromMainWindow(event)) return null;
    return {
      platform: process.platform,
      version: app.getVersion(),
      packaged: app.isPackaged,
      widevine: Boolean(components),
      widevineReady,
    };
  });

  ipcMain.handle('moonify:login-status', (event) => (fromMainWindow(event) ? engines.loginStatus() : {}));

  ipcMain.handle('moonify:logout', (event, id) => (fromMainWindow(event) ? engines.logout(String(id)) : false));

  ipcMain.handle('moonify:open-external', (event, url) => {
    if (fromMainWindow(event)) openExternal(url);
  });

  // Unsichtbare Anbieter-Player
  ipcMain.handle('engine:start', (event, id, options) => fromMainWindow(event) && engines.start(String(id), engineOptions(options)));
  ipcMain.handle('engine:stop', (event, id) => {
    if (fromMainWindow(event)) engines.stop(String(id));
  });
  ipcMain.handle('engine:show', (event, id, options) => fromMainWindow(event) && engines.show(String(id), { login: Boolean(options?.login) }));
  ipcMain.handle('engine:home', (event, id, options) => {
    if (!fromMainWindow(event) || !getProvider(String(id))) return false;
    return engines.load(String(id), getProvider(String(id)).home(engineOptions(options)));
  });
  ipcMain.handle('engine:command', (event, id, command) => {
    if (!fromMainWindow(event) || !command || typeof command.type !== 'string' || command.type === 'request') return false;
    return engines.command(String(id), command);
  });
  ipcMain.handle('engine:request', (event, id, req) => {
    if (!fromMainWindow(event) || !req || typeof req.type !== 'string') return { ok: false, error: 'Ungültige Anfrage' };
    return engines.request(String(id), req);
  });

  // Nachrichten aus den Playern weiterreichen
  ipcMain.on('engine:state', (event, json) => {
    const id = engines.idForSender(event.sender);
    if (id && typeof json === 'string') sendToUi('engine:state', id, json);
  });
  ipcMain.on('engine:ua-mode', (event) => {
    event.returnValue = engines.uaModeForSender(event.sender);
  });
  ipcMain.on('engine:response', (event, rid, json) => {
    engines.handleResponse(event.sender, String(rid), String(json));
  });

  // Updates
  ipcMain.handle('update:check', (event) => (fromMainWindow(event) ? updater.check() : null));
  ipcMain.handle('update:install', (event) => (fromMainWindow(event) ? updater.install() : false));
  ipcMain.handle('update:status', (event) => (fromMainWindow(event) ? updater.status() : null));
}

function setupMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'Ansicht',
        submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      { role: 'windowMenu' },
    ]),
  );
}
