import { BrowserWindow, session, shell } from 'electron';
import { PROVIDERS, getProvider, isInAppUrl, isLoginCookie } from '../shared/providers.js';

const BACKGROUND = '#0b0c22';
const REQUEST_TIMEOUT = 45000;
const GOOGLE_BLOCKED = /^https:\/\/accounts\.google\.com\/(v3\/)?signin\/rejected/;
const FIREFOX_UA = {
  win32: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
};

/**
 * Verwaltet pro Anbieter ein unsichtbares Fenster mit dessen Web-Player.
 * Das Fenster spielt die Musik ab und liefert Suche/Bibliothek; sichtbar wird es
 * nur zum Anmelden oder wenn man den Dienst bewusst „im Fenster öffnen“ möchte.
 */
export class EngineManager {
  constructor({ preload, icon, send, nativeUserAgent }) {
    this.preload = preload;
    this.icon = icon;
    this.send = send;
    this.nativeUserAgent = nativeUserAgent;
    this.engines = new Map();
    this.pending = new Map();
    this.nextRequestId = 1;
    this.quitting = false;
    this.watchedSessions = new Set();
    // Google-Anmeldung: erst mit echter App-Kennung, bei Ablehnung mit Firefox-Kennung
    this.googleMode = new Map();
    this.firefoxUserAgent = FIREFOX_UA[process.platform] || FIREFOX_UA.linux;
    this.userAgent = '';
  }

  googleModeFor(id) {
    return this.googleMode.get(id) || 'native';
  }

  /** Welche Kennung soll eine Google-Anmeldeseite in diesem Fenster sehen? */
  uaModeForSender(sender) {
    const id = this.idForSender(sender);
    return id ? this.googleModeFor(id) : 'native';
  }

  /** Sitzungen vorbereiten: Google-Login erlauben und Logins erkennen. */
  prepareSessions(userAgent) {
    this.userAgent = userAgent;
    for (const provider of PROVIDERS) {
      const ses = session.fromPartition(provider.partition);
      ses.setUserAgent(userAgent);
      // Google lehnt getarnte Browser ab. Für die Anmeldeseiten deshalb zuerst die echte
      // App-Kennung senden (wie die Electron-App th-ch/youtube-music). Lehnt Google trotzdem
      // ab, wird auf eine Firefox-Kennung ohne Chrome-Merkmale gewechselt.
      ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (details, callback) => {
        const headers = details.requestHeaders;
        if (this.googleModeFor(provider.id) === 'firefox') {
          headers['User-Agent'] = this.firefoxUserAgent;
          for (const name of Object.keys(headers)) if (/^sec-ch-ua/i.test(name)) delete headers[name];
        } else {
          headers['User-Agent'] = this.nativeUserAgent;
        }
        callback({ requestHeaders: headers });
      });
      if (!this.watchedSessions.has(provider.id)) {
        this.watchedSessions.add(provider.id);
        let timer = 0;
        ses.cookies.on('changed', (_event, cookie) => {
          if (!provider.loginCookies.includes(cookie.name)) return;
          clearTimeout(timer);
          timer = setTimeout(() => this.refreshLogin(provider.id), 800);
        });
      }
    }
  }

  async isLoggedIn(id) {
    const provider = getProvider(id);
    if (!provider) return false;
    const cookies = await session.fromPartition(provider.partition).cookies.get({});
    const now = Date.now() / 1000;
    return cookies.some((c) => isLoginCookie(provider, c) && (!c.expirationDate || c.expirationDate > now));
  }

  async loginStatus() {
    const entries = await Promise.all(PROVIDERS.map(async (p) => [p.id, await this.isLoggedIn(p.id).catch(() => false)]));
    return Object.fromEntries(entries);
  }

  async refreshLogin(id) {
    const loggedIn = await this.isLoggedIn(id).catch(() => false);
    this.send('engine:login', id, loggedIn);
    const engine = this.engines.get(id);
    if (loggedIn && engine?.loginPending) {
      engine.loginPending = false;
      // Kurz warten, bis alle Weiterleitungen fertig sind, dann zurück zum Player
      setTimeout(() => {
        if (engine.window.isDestroyed()) return;
        engine.window.webContents.setUserAgent(this.userAgent);
        safeLoad(engine.window, getProvider(id).home(engine.options));
        engine.window.hide();
        this.send('engine:window', id, false);
      }, 2500);
    }
  }

  start(id, options = {}) {
    const provider = getProvider(id);
    if (!provider) return false;
    const existing = this.engines.get(id);
    if (existing) {
      existing.options = options;
      return true;
    }
    const window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 780,
      title: `${provider.name} – Moonify`,
      backgroundColor: BACKGROUND,
      autoHideMenuBar: true,
      icon: this.icon,
      webPreferences: {
        partition: provider.partition,
        preload: this.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false,
      },
    });
    const engine = { id, window, options, ready: false, loginPending: false };
    this.engines.set(id, engine);

    const contents = window.webContents;
    contents.setAudioMuted(false);
    // Bereit, sobald die Hauptseite steht – nachladende Teile spielen keine Rolle
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) engine.ready = false;
    });
    contents.on('dom-ready', () => {
      engine.ready = true;
      this.send('engine:ready', id);
    });
    contents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.send('engine:error', id, description || 'Seite konnte nicht geladen werden');
    });
    contents.on('render-process-gone', () => {
      engine.ready = false;
      this.send('engine:error', id, 'Der Player ist abgestürzt');
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isInAppUrl(provider, url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 760,
            autoHideMenuBar: true,
            backgroundColor: BACKGROUND,
            parent: window,
            webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
          },
        };
      }
      openExternal(url);
      return { action: 'deny' };
    });
    // Zurück/Vor per Tastatur, da das Fenster keine Browserleiste hat
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const back = (input.alt && input.key === 'ArrowLeft') || (input.meta && input.key === '[');
      const forward = (input.alt && input.key === 'ArrowRight') || (input.meta && input.key === ']');
      if (back && contents.navigationHistory.canGoBack()) {
        contents.navigationHistory.goBack();
        event.preventDefault();
      } else if (forward && contents.navigationHistory.canGoForward()) {
        contents.navigationHistory.goForward();
        event.preventDefault();
      }
    });
    contents.on('did-navigate', (_event, url) => this.checkGoogleBlock(id, url));
    // Eigener Titel statt dem der Webseite
    window.on('page-title-updated', (event) => event.preventDefault());
    // Schließen versteckt das Fenster nur – die Musik läuft weiter
    window.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      window.hide();
      if (engine.loginPending) contents.setUserAgent(this.userAgent);
      engine.loginPending = false;
      this.send('engine:window', id, false);
    });

    safeLoad(window, provider.home(options));
    return true;
  }

  /** Google zeigt „Anmeldung nicht möglich“ → andere Methode probieren. */
  checkGoogleBlock(id, url) {
    if (!GOOGLE_BLOCKED.test(String(url))) return;
    const engine = this.engines.get(id);
    if (!engine || engine.window.isDestroyed()) return;
    const provider = getProvider(id);
    if (this.googleModeFor(id) === 'native') {
      this.googleMode.set(id, 'firefox');
      engine.window.webContents.setUserAgent(this.firefoxUserAgent);
      this.send('engine:notice', id, 'google-retry');
      safeLoad(engine.window, provider.login(engine.options));
    } else {
      this.googleMode.set(id, 'native');
      engine.window.webContents.setUserAgent(this.userAgent);
      this.send('engine:notice', id, 'google-blocked');
    }
  }

  stop(id) {
    const engine = this.engines.get(id);
    if (!engine) return;
    this.engines.delete(id);
    for (const [rid, request] of this.pending) {
      if (request.id === id) {
        clearTimeout(request.timer);
        request.resolve({ ok: false, error: 'Dienst wurde getrennt' });
        this.pending.delete(rid);
      }
    }
    if (!engine.window.isDestroyed()) engine.window.destroy();
  }

  stopAll() {
    this.quitting = true;
    for (const id of [...this.engines.keys()]) this.stop(id);
  }

  /** Fenster zeigen – zum Anmelden oder um den Dienst direkt zu benutzen. */
  show(id, { login = false } = {}) {
    const engine = this.engines.get(id);
    if (!engine) return false;
    const provider = getProvider(id);
    if (login) {
      engine.loginPending = true;
      engine.window.webContents.setUserAgent(this.googleModeFor(id) === 'firefox' ? this.firefoxUserAgent : this.userAgent);
      engine.window.setTitle(`Bei ${provider.name} anmelden – Moonify`);
      safeLoad(engine.window, provider.login(engine.options));
    } else {
      engine.window.setTitle(`${provider.name} – Moonify`);
    }
    engine.window.show();
    engine.window.focus();
    this.send('engine:window', id, true);
    return true;
  }

  load(id, url) {
    const engine = this.engines.get(id);
    if (!engine || !String(url).startsWith('https://')) return false;
    safeLoad(engine.window, url);
    return true;
  }

  idForSender(sender) {
    for (const [id, engine] of this.engines) {
      if (!engine.window.isDestroyed() && engine.window.webContents === sender) return id;
    }
    return null;
  }

  command(id, command) {
    const engine = this.engines.get(id);
    if (!engine || engine.window.isDestroyed()) return false;
    engine.window.webContents.send('moonify:command', command);
    return true;
  }

  async request(id, req) {
    const engine = this.engines.get(id);
    if (!engine) return { ok: false, error: 'Dienst ist nicht verbunden' };
    if (!engine.ready) await this.waitReady(engine, 20000);
    if (!engine.ready) return { ok: false, error: 'Dienst lädt noch – bitte gleich nochmal versuchen' };
    const rid = String(this.nextRequestId++);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        resolve({ ok: false, error: 'Der Dienst hat nicht geantwortet' });
      }, REQUEST_TIMEOUT);
      this.pending.set(rid, { id, resolve, timer });
      this.command(id, { type: 'request', rid, req });
    });
  }

  waitReady(engine, timeout) {
    return new Promise((resolve) => {
      const end = Date.now() + timeout;
      const check = () => {
        if (engine.ready || Date.now() > end || engine.window.isDestroyed()) resolve();
        else setTimeout(check, 250);
      };
      check();
    });
  }

  handleResponse(sender, rid, json) {
    const request = this.pending.get(rid);
    if (!request || this.idForSender(sender) !== request.id) return;
    this.pending.delete(rid);
    clearTimeout(request.timer);
    try {
      request.resolve(JSON.parse(json));
    } catch {
      request.resolve({ ok: false, error: 'Ungültige Antwort' });
    }
  }

  async logout(id) {
    const provider = getProvider(id);
    if (!provider) return false;
    const ses = session.fromPartition(provider.partition);
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    const engine = this.engines.get(id);
    if (engine && !engine.window.isDestroyed()) safeLoad(engine.window, provider.home(engine.options));
    return true;
  }
}

/** Seite laden; abgebrochene Ladevorgänge (z. B. durch Weiterleitungen) sind kein Fehler. */
function safeLoad(win, url) {
  if (!win || win.isDestroyed()) return;
  win.loadURL(url).catch(() => {});
}

export function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') shell.openExternal(parsed.toString());
  } catch {
    // ungültige URL ignorieren
  }
}
