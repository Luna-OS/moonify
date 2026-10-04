import { app, BrowserWindow, Menu, ipcMain, net, protocol, session, shell } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROVIDERS, getProvider, getProviderByPartition, isInAppUrl } from '../shared/providers.js';

// `components` gibt es nur in der Widevine-Version von Electron (castLabs).
const require = createRequire(import.meta.url);
const { components } = require('electron');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '..');
const SERVED_DIRS = [path.join(SRC_DIR, 'renderer'), path.join(SRC_DIR, 'shared')];
const MAIN_PRELOAD = path.join(HERE, 'preload.cjs');
const WEBVIEW_PRELOAD = path.join(HERE, 'webview-preload.cjs');
const APP_URL = 'moonify://app/renderer/index.html';
const BACKGROUND = '#070818';

let mainWindow = null;
let widevineReady = false;

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
});

async function start() {
  if (components) {
    try {
      await components.whenReady();
      widevineReady = true;
    } catch (err) {
      console.error('Widevine konnte nicht geladen werden:', err);
    }
  }

  // Ohne „Electron/…“ im User-Agent lassen Google & Co. den Login zu.
  const userAgent = cleanUserAgent(session.defaultSession.getUserAgent());
  app.userAgentFallback = userAgent;
  for (const provider of PROVIDERS) {
    session.fromPartition(provider.partition).setUserAgent(userAgent);
  }

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
    icon: path.join(SRC_DIR, '..', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarOverlay: { color: '#0b0c22', symbolColor: '#cfd3ff', height: 48 } }),
    webPreferences: {
      preload: MAIN_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
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

  // Jede eingebettete Anbieter-Ansicht wird hier abgesichert.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const provider = getProviderByPartition(params.partition);
    if (!provider || !params.src?.startsWith('https://')) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preloadURL;
    webPreferences.preload = WEBVIEW_PRELOAD;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.backgroundThrottling = false;
    webPreferences.webSecurity = true;
  });

  contents.on('did-attach-webview', (_event, guest) => {
    const provider = getProviderByPartition(partitionOf(guest));
    guest.setWindowOpenHandler(({ url }) => {
      const inApp = provider ? isInAppUrl(provider, url) : PROVIDERS.some((p) => isInAppUrl(p, url));
      if (inApp) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 760,
            autoHideMenuBar: true,
            backgroundColor: BACKGROUND,
            parent: mainWindow,
            webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
          },
        };
      }
      openExternal(url);
      return { action: 'deny' };
    });
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(APP_URL);
}

const guestPartitions = new WeakMap();

function partitionOf(guest) {
  if (guestPartitions.has(guest)) return guestPartitions.get(guest);
  const match = PROVIDERS.find((p) => session.fromPartition(p.partition) === guest.session);
  const partition = match ? match.partition : null;
  guestPartitions.set(guest, partition);
  return partition;
}

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') shell.openExternal(parsed.toString());
  } catch {
    // ungültige URL ignorieren
  }
}

async function isLoggedIn(provider) {
  const cookies = await session.fromPartition(provider.partition).cookies.get({});
  const now = Date.now() / 1000;
  return cookies.some(
    (c) => provider.loginCookies.includes(c.name) && c.value && (!c.expirationDate || c.expirationDate > now),
  );
}

function fromMainWindow(event) {
  return mainWindow && event.sender === mainWindow.webContents;
}

function registerIpc() {
  ipcMain.handle('moonify:info', (event) => {
    if (!fromMainWindow(event)) return null;
    return {
      platform: process.platform,
      version: app.getVersion(),
      widevine: Boolean(components),
      widevineReady,
    };
  });

  ipcMain.handle('moonify:login-status', async (event) => {
    if (!fromMainWindow(event)) return {};
    const entries = await Promise.all(
      PROVIDERS.map(async (p) => [p.id, await isLoggedIn(p).catch(() => false)]),
    );
    return Object.fromEntries(entries);
  });

  ipcMain.handle('moonify:logout', async (event, id) => {
    if (!fromMainWindow(event)) return false;
    const provider = getProvider(id);
    if (!provider) return false;
    const ses = session.fromPartition(provider.partition);
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    return true;
  });

  ipcMain.handle('moonify:open-external', (event, url) => {
    if (fromMainWindow(event)) openExternal(url);
  });
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
