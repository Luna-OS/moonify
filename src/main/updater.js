import { app, net, shell } from 'electron';
import { createRequire } from 'node:module';
import { compareVersions } from '../shared/version.js';

const REPO = 'Luna-OS/moonify';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const require = createRequire(import.meta.url);

/**
 * Updates direkt aus den GitHub-Releases.
 * Windows (Installer) und Linux (AppImage) laden das Update selbst herunter und
 * installieren es beim Neustart. Auf macOS und bei .deb wird die neue Datei im
 * Browser heruntergeladen, weil sich diese Pakete nicht selbst ersetzen können.
 */
export function createUpdater(send) {
  const canInstall = app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.APPIMAGE)));
  let autoUpdater = null;
  let checking = false;
  let status = { state: 'idle', current: app.getVersion() };

  function set(next) {
    status = { ...status, ...next, current: app.getVersion() };
    send(status);
  }

  if (canInstall) {
    try {
      ({ autoUpdater } = require('electron-updater'));
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
      autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
      autoUpdater.on('update-not-available', () => set({ state: 'none' }));
      autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
      // Fehler während der Prüfung behandelt check() selbst (mit Ausweichweg)
      autoUpdater.on('error', (err) => {
        if (!checking) set({ state: 'error', message: friendlyError(err) });
      });
    } catch (err) {
      autoUpdater = null;
      console.error('Updater nicht verfügbar:', err);
    }
  }

  async function checkManually() {
    const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Moonify' },
    });
    if (!response.ok) throw new Error(`GitHub antwortet mit ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    if (!latest || compareVersions(latest, app.getVersion()) <= 0) {
      set({ state: 'none' });
      return;
    }
    set({ state: 'available', version: latest, url: downloadUrl(release) });
  }

  async function check() {
    if (!app.isPackaged) {
      set({ state: 'dev' });
      return status;
    }
    if (status.state === 'downloading' || status.state === 'ready') return status;
    set({ state: 'checking', message: '' });
    checking = true;
    try {
      if (autoUpdater) {
        try {
          await autoUpdater.checkForUpdates();
        } catch {
          // z. B. fehlende Update-Datei im Release → direkt bei GitHub nachsehen
          await checkManually();
        }
      } else {
        await checkManually();
      }
    } catch (err) {
      set({ state: 'error', message: friendlyError(err) });
    } finally {
      checking = false;
    }
    return status;
  }

  function install() {
    if (status.state === 'ready' && autoUpdater) {
      autoUpdater.quitAndInstall();
      return true;
    }
    shell.openExternal(status.url || RELEASES_URL);
    return true;
  }

  return { check, install, status: () => status, canInstall: Boolean(autoUpdater) };
}

function downloadUrl(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const pick = (test) => assets.find((a) => test(String(a.name)))?.browser_download_url;
  if (process.platform === 'darwin') {
    return pick((n) => n.endsWith(`-mac-${process.arch}.dmg`)) || pick((n) => n.endsWith('.dmg')) || release.html_url;
  }
  if (process.platform === 'linux') return pick((n) => n.endsWith(process.env.APPIMAGE ? '.AppImage' : '.deb')) || release.html_url;
  if (process.platform === 'win32') return pick((n) => n.endsWith('.exe')) || release.html_url;
  return release.html_url || RELEASES_URL;
}

function friendlyError(err) {
  const message = String((err && err.message) || err || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(message)) return 'Keine Verbindung zu GitHub';
  return message.split('\n')[0].slice(0, 160) || 'Unbekannter Fehler';
}
