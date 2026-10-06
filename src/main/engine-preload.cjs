// Läuft unsichtbar in den Web-Playern von Spotify, YouTube Music und Amazon Music.
// - meldet, was gerade läuft (Media Session API),
// - führt Befehle der Moonify-Playerleiste aus (Play/Pause, Springen, Lautstärke …),
// - sucht, lädt Bibliothek/Playlists und startet Songs für die Moonify-Oberfläche.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('__moonifyBridge', {
  emit(json) {
    if (typeof json === 'string' && json.length < 20000) ipcRenderer.send('engine:state', json);
  },
  respond(requestId, json) {
    if (typeof json === 'string') ipcRenderer.send('engine:response', String(requestId), json);
  },
  onCommand(callback) {
    ipcRenderer.on('moonify:command', (_event, command) => {
      try {
        callback(JSON.stringify(command));
      } catch {
        // Befehl konnte nicht ausgeführt werden – ignorieren
      }
    });
  },
});

// Diese Funktion läuft in der Welt der Webseite, damit sie deren
// Media-Session-Handler, <audio>/<video>-Elemente und Netzwerkanfragen sieht.
function moonifyEngine() {
  const bridge = window.__moonifyBridge;
  if (!bridge || window.__moonifyHooked) return;
  window.__moonifyHooked = true;

  const host = location.hostname;
  const provider = /(^|\.)spotify\.com$/.test(host)
    ? 'spotify'
    : /(^|\.)youtube\.com$/.test(host)
      ? 'ytmusic'
      : /(^|\.)amazon\.[a-z.]+$/.test(host)
        ? 'amazon'
        : null;

  /* ---------------- Wiedergabe-Zustand ---------------- */

  const ms = navigator.mediaSession;
  const handlers = Object.create(null);
  let positionState = null;
  let positionStamp = 0;
  let activeMedia = null;
  let desiredVolume = null;
  let lastJson = '';

  if (ms) {
    const originalSetHandler = ms.setActionHandler.bind(ms);
    ms.setActionHandler = function (action, handler) {
      handlers[action] = typeof handler === 'function' ? handler : null;
      return originalSetHandler(action, handler);
    };
    if (typeof ms.setPositionState === 'function') {
      const originalSetPosition = ms.setPositionState.bind(ms);
      ms.setPositionState = function (state) {
        positionState = state ? { duration: state.duration, position: state.position, playbackRate: state.playbackRate } : null;
        positionStamp = performance.now();
        return originalSetPosition(state);
      };
    }
  }

  const proto = HTMLMediaElement.prototype;
  const originalPlay = proto.play;
  proto.play = function () {
    adopt(this);
    return originalPlay.apply(this, arguments);
  };
  document.addEventListener(
    'play',
    (event) => {
      if (event.target instanceof HTMLMediaElement) adopt(event.target);
    },
    true,
  );

  function adopt(element) {
    activeMedia = element;
    applyVolume();
  }

  function findMedia() {
    if (activeMedia && !activeMedia.paused) return activeMedia;
    const elements = Array.from(document.querySelectorAll('audio, video'));
    return elements.find((e) => !e.paused) || activeMedia || elements.find((e) => e.duration > 0) || null;
  }

  function applyVolume() {
    if (desiredVolume === null) return;
    const media = findMedia();
    if (media && Math.abs(media.volume - desiredVolume) > 0.005) media.volume = desiredVolume;
  }

  function callHandler(action, details) {
    const handler = handlers[action];
    if (typeof handler !== 'function') return false;
    try {
      handler(Object.assign({ action }, details));
      return true;
    } catch {
      return false;
    }
  }

  function bestArtwork(artwork) {
    if (!artwork || !artwork.length) return '';
    const size = (a) => {
      const m = /(\d+)x(\d+)/.exec(a.sizes || '');
      return m ? Number(m[1]) * Number(m[2]) : 0;
    };
    const best = Array.from(artwork).sort((a, b) => size(b) - size(a))[0];
    try {
      return new URL(best.src, location.href).href;
    } catch {
      return '';
    }
  }

  function timing(media, playing) {
    const mediaDuration = media && Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    const ps = positionState;
    const psDuration = ps && Number.isFinite(ps.duration) && ps.duration > 0 ? ps.duration : 0;
    if (mediaDuration && (!psDuration || Math.abs(mediaDuration - psDuration) < 1.5)) {
      return { position: media.currentTime, duration: mediaDuration };
    }
    if (psDuration) {
      const rate = Number.isFinite(ps.playbackRate) ? ps.playbackRate : 1;
      const elapsed = playing ? ((performance.now() - positionStamp) / 1000) * rate : 0;
      return { position: Math.min(psDuration, (ps.position || 0) + elapsed), duration: psDuration };
    }
    return { position: 0, duration: 0 };
  }

  let wasPlaying = false;
  function snapshot() {
    const media = findMedia();
    const metadata = ms && ms.metadata;
    const playing = media ? !media.paused && !media.ended : !!ms && ms.playbackState === 'playing';
    if (playing !== wasPlaying && positionState) {
      const t = timing(media, wasPlaying);
      positionState.position = t.position;
      positionStamp = performance.now();
    }
    wasPlaying = playing;
    const { position, duration } = timing(media, playing);
    return {
      title: metadata ? metadata.title : '',
      artist: metadata ? metadata.artist : '',
      album: metadata ? metadata.album : '',
      artwork: metadata ? bestArtwork(metadata.artwork) : '',
      playing,
      position: Math.round(position * 4) / 4,
      duration: Math.round(duration * 4) / 4,
      canNext: typeof handlers.nexttrack === 'function',
      canPrev: typeof handlers.previoustrack === 'function',
      canSeek: typeof handlers.seekto === 'function' || !!media,
    };
  }

  function tick() {
    applyVolume();
    dismissInterruptions();
    let json;
    try {
      json = JSON.stringify(snapshot());
    } catch {
      return;
    }
    if (json !== lastJson) {
      lastJson = json;
      bridge.emit(json);
    }
  }

  // YouTube Music fragt nach einer Weile „Wiedergabe fortsetzen?“ – automatisch bestätigen.
  function dismissInterruptions() {
    if (provider !== 'ytmusic') return;
    const dialog = document.querySelector('ytmusic-you-there-renderer');
    if (dialog && dialog.offsetParent !== null) dialog.querySelector('button, yt-button-renderer, tp-yt-paper-button')?.click();
  }

  /* ---------------- Netzwerk mitlesen ---------------- */

  const nativeFetch = window.fetch.bind(window);
  const templates = Object.create(null);
  const waiters = [];
  let ytHeaders = null;

  function requestKey(url, body) {
    if (!url) return null;
    if (url.includes('/pathfinder/')) {
      try {
        return 'pf:' + JSON.parse(body).operationName;
      } catch {
        return null;
      }
    }
    if (url.includes('/api/showSearch')) return 'amz:search';
    if (url.includes('/youtubei/v1/')) return 'yt';
    return null;
  }

  function remember(url, method, headers, body, credentials) {
    const key = requestKey(url, body);
    if (!key) return null;
    let absolute = url;
    try {
      absolute = new URL(url, location.href).href;
    } catch {
      // URL bleibt wie sie ist
    }
    if (key === 'yt') {
      ytHeaders = { headers, at: Date.now() };
    } else {
      templates[key] = { url: absolute, method: method || 'GET', headers, body, credentials };
    }
    return key;
  }

  function settle(key, textValue) {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].key === key) {
        const waiter = waiters.splice(i, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(textValue);
      }
    }
  }

  function wanted(key) {
    return key && waiters.some((w) => w.key === key);
  }

  function headersToObject(input) {
    const result = {};
    try {
      new Headers(input || undefined).forEach((value, name) => {
        result[name] = value;
      });
    } catch {
      // ungewöhnliche Header ignorieren
    }
    return result;
  }

  window.fetch = function (input, init) {
    let url = '';
    let method = '';
    let headers = {};
    let body = null;
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      method = (init && init.method) || (input && input.method) || 'GET';
      headers = headersToObject((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      if (init && typeof init.body === 'string') body = init.body;
    } catch {
      // nur mitlesen, nie stören
    }
    const credentials = (init && init.credentials) || (input instanceof Request ? input.credentials : undefined);
    let key = remember(url, method, headers, body, credentials);
    const result = nativeFetch(input, init);
    if (!key && body === null && input instanceof Request && url && url.includes('/pathfinder/')) {
      input
        .clone()
        .text()
        .then((b) => {
          const k = remember(url, method, headers, b, credentials);
          if (wanted(k)) result.then((r) => r.clone().text()).then((t) => settle(k, t)).catch(() => {});
        })
        .catch(() => {});
    } else if (wanted(key)) {
      result.then((r) => r.clone().text()).then((t) => settle(key, t)).catch(() => {});
    }
    return result;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__moonify = { method, url: String(url), headers: {} };
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__moonify) this.__moonify.headers[String(name).toLowerCase()] = String(value);
    return xhrSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__moonify;
    if (info) {
      const key = remember(info.url, info.method, info.headers, typeof body === 'string' ? body : null, this.withCredentials ? 'include' : 'same-origin');
      if (wanted(key)) {
        this.addEventListener('load', () => {
          try {
            settle(key, this.responseText);
          } catch {
            // Antwort war kein Text
          }
        });
      }
    }
    return xhrSend.apply(this, arguments);
  };

  function waitForResponse(key, timeout) {
    return new Promise((resolve, reject) => {
      const waiter = { key, resolve, timer: 0 };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('Zeitüberschreitung'));
      }, timeout);
      waiters.push(waiter);
    });
  }

  const BLOCKED_HEADERS = /^(user-agent|referer|origin|host|cookie|content-length|accept-encoding|connection|sec-.*)$/i;

  function cleanHeaders(headers) {
    const result = {};
    for (const [name, value] of Object.entries(headers || {})) if (!BLOCKED_HEADERS.test(name)) result[name] = value;
    return result;
  }

  async function replay(key, changeBody) {
    const t = templates[key];
    if (!t) return null;
    let body;
    if (t.body) body = JSON.stringify(changeBody(JSON.parse(t.body)));
    const response = await nativeFetch(t.url, {
      method: t.method,
      headers: cleanHeaders(t.headers),
      body,
      credentials: t.credentials || 'same-origin',
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.text();
  }

  /* ---------------- Navigation & Hilfen ---------------- */

  function spaNavigate(path) {
    const target = new URL(path, location.href);
    if (target.origin !== location.origin) {
      location.assign(target.href);
      return;
    }
    history.pushState({}, '', target.pathname + target.search + target.hash);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(find, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const found = find();
      if (found) return found;
      await sleep(150);
    }
    return null;
  }

  function isPlaying() {
    const media = findMedia();
    return !!media && !media.paused;
  }

  // Seite wechseln und auf die Antwort warten, die die Seite dabei selbst lädt.
  async function navigateAndCapture(key, path, rid) {
    // Spotify wechselt Seiten zuverlässig ohne Neuladen; bei Amazon klappt das nur
    // mit Neuladen – das machen wir aber nie, während Musik läuft.
    const trySpa = provider === 'spotify' || isPlaying() || !rid;
    if (trySpa) {
      const pending = waitForResponse(key, 8000);
      spaNavigate(path);
      try {
        return await pending;
      } catch (err) {
        if (isPlaying() || !rid) throw err;
      }
    }
    // Ganz neu laden. Die neu geladene Seite beantwortet die Anfrage selbst – siehe resumeCapture().
    sessionStorage.setItem(CAPTURE_KEY, JSON.stringify({ key, rid, at: Date.now() }));
    location.assign(new URL(path, location.href).href);
    return new Promise(() => {});
  }

  const CAPTURE_KEY = '__moonifyPendingCapture';

  function resumeCapture() {
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(CAPTURE_KEY) || 'null');
    } catch {
      return;
    }
    if (!pending) return;
    if (Date.now() - pending.at > 40000) {
      sessionStorage.removeItem(CAPTURE_KEY);
      return;
    }
    // Erst nach der Antwort aufräumen – die Seite kann sich beim Laden noch einmal selbst weiterleiten
    waitForResponse(pending.key, 25000)
      .then((data) => {
        sessionStorage.removeItem(CAPTURE_KEY);
        bridge.respond(pending.rid, JSON.stringify({ ok: true, data }));
      })
      .catch(() => {});
  }

  /* ---------------- Spotify ---------------- */

  const PENDING_KEY = '__moonifyPendingPlay';

  async function spotifyQuery(operation, variables, fallbackPath, rid) {
    const key = 'pf:' + operation;
    if (templates[key]) {
      try {
        return await replay(key, (b) => Object.assign({}, b, { variables: Object.assign({}, b.variables, variables) }));
      } catch {
        // Vorlage veraltet → Seite selbst laden lassen
      }
    }
    if (!fallbackPath) throw new Error('Noch keine Daten – bitte kurz warten und erneut versuchen');
    return navigateAndCapture(key, fallbackPath, rid);
  }

  function spotifyPath(uri) {
    if (uri === 'spotify:collection:tracks') return '/collection/tracks';
    const [, type, id] = String(uri).split(':');
    return `/${type}/${id}`;
  }

  async function spotifyCollection(uri, rid) {
    if (uri === 'spotify:collection:tracks') return spotifyQuery('fetchLibraryTracks', { offset: 0, limit: 50 }, '/collection/tracks', rid);
    if (uri.startsWith('spotify:album:')) return spotifyQuery('getAlbum', { uri, offset: 0, limit: 50 }, spotifyPath(uri), rid);
    return spotifyQuery('fetchPlaylist', { uri, offset: 0, limit: 100 }, spotifyPath(uri), rid);
  }

  async function spotifyPlay(trackUri, contextUri, allowReload = true) {
    const path = spotifyPath(contextUri || trackUri);
    const selector = '[data-testid="action-bar-row"] [data-testid="play-button"]';
    const before = document.querySelector(selector);
    const samePage = location.pathname === path;
    if (!samePage) spaNavigate(path);
    // Erst den Knopf der neuen Seite nehmen, nicht den der vorherigen
    const fresh = () => {
      if (location.pathname !== path) return null;
      const button = document.querySelector(selector);
      return button && (samePage || button !== before) ? button : null;
    };
    let button = await waitFor(fresh, 8000);
    if (!button) {
      if (!allowReload) throw new Error('Spotify konnte den Song nicht starten');
      // Seite neu laden und danach erneut versuchen
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ trackUri, contextUri, at: Date.now() }));
      location.assign(new URL(path, location.href).href);
      return 'reload';
    }
    if (contextUri && trackUri) {
      const id = trackUri.split(':').pop();
      const row = await waitFor(() => document.querySelector(`[data-testid="tracklist-row"] a[href*="/track/${id}"]`)?.closest('[data-testid="tracklist-row"]'), 6000);
      const rowButton = row && (row.querySelector('[aria-colindex="1"] button') || row.querySelector('button'));
      if (rowButton) button = rowButton;
    }
    button.click();
    return 'ok';
  }

  /* ---------------- YouTube Music ---------------- */

  function cookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function sapisidHash() {
    const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (!sapisid) return '';
    const ts = Math.floor(Date.now() / 1000);
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return `SAPISIDHASH ${ts}_${hex}`;
  }

  async function innertube(endpoint, payload) {
    const cfg = (window.ytcfg && (window.ytcfg.data_ || (window.ytcfg.get && { INNERTUBE_CONTEXT: window.ytcfg.get('INNERTUBE_CONTEXT') }))) || {};
    if (!cfg.INNERTUBE_CONTEXT) throw new Error('YouTube Music ist noch nicht bereit');
    const headers = { 'content-type': 'application/json' };
    const captured = ytHeaders && Date.now() - ytHeaders.at < 20 * 60 * 1000 ? cleanHeaders(ytHeaders.headers) : {};
    for (const name of ['authorization', 'x-goog-authuser', 'x-goog-visitor-id', 'x-youtube-client-name', 'x-youtube-client-version', 'x-origin', 'x-goog-pageid']) {
      if (captured[name]) headers[name] = captured[name];
    }
    if (!headers.authorization) {
      const auth = await sapisidHash();
      if (auth) {
        headers.authorization = auth;
        headers['x-origin'] = location.origin;
        headers['x-goog-authuser'] = headers['x-goog-authuser'] || '0';
      }
    }
    const response = await nativeFetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({ context: cfg.INNERTUBE_CONTEXT }, payload)),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.text();
  }

  /* ---------------- Amazon Music ---------------- */

  async function amazonSearch(query, rid) {
    if (templates['amz:search']) {
      try {
        return await replay('amz:search', (b) => {
          const next = Object.assign({}, b, { suggestedKeyword: query });
          try {
            const keyword = JSON.parse(b.keyword);
            keyword.keyword = query;
            next.keyword = JSON.stringify(keyword);
          } catch {
            // Feld hat ein anderes Format – nur suggestedKeyword setzen
          }
          return next;
        });
      } catch {
        // Vorlage veraltet → Seite selbst suchen lassen
      }
    }
    return navigateAndCapture('amz:search', `/search/${encodeURIComponent(query)}?filter=IsLibrary%7Cfalse&sc=none`, rid);
  }

  function amazonPlay(deeplink) {
    const url = new URL(deeplink, location.origin);
    url.searchParams.set('do', 'play');
    location.assign(url.href);
    return 'navigating';
  }

  /* ---------------- Anfragen der Moonify-Oberfläche ---------------- */

  async function handleRequest(req, rid) {
    if (!provider) throw new Error('Unbekannte Seite');
    const type = req.type;
    if (provider === 'spotify') {
      if (type === 'search') return spotifyQuery('searchTracks', { searchTerm: req.query, offset: 0, limit: 30 }, `/search/${encodeURIComponent(req.query)}/tracks`, rid);
      if (type === 'library') return spotifyQuery('libraryV3', { offset: 0, limit: 50 }, null);
      if (type === 'collection') return spotifyCollection(String(req.ref.uri), rid);
      if (type === 'play') return spotifyPlay(req.track && req.track.ref.uri, req.context && req.context.ref.uri);
    }
    if (provider === 'ytmusic') {
      if (type === 'search') return innertube('search', req.params ? { query: req.query, params: String(req.params) } : { query: req.query });
      if (type === 'library') return innertube('browse', { browseId: 'FEmusic_liked_playlists' });
      if (type === 'collection') return innertube('browse', { browseId: String(req.ref.browseId) });
      if (type === 'play') {
        const videoId = req.track && req.track.ref.videoId;
        const playlistId = req.context && req.context.ref.playlistId;
        const url = videoId
          ? `/watch?v=${encodeURIComponent(videoId)}${playlistId ? `&list=${encodeURIComponent(playlistId)}` : ''}`
          : `/watch?list=${encodeURIComponent(playlistId)}`;
        setTimeout(() => location.assign(url), 50);
        return 'navigating';
      }
    }
    if (provider === 'amazon') {
      if (type === 'search') return amazonSearch(String(req.query), rid);
      if (type === 'play') {
        const deeplink = req.track && req.track.ref.deeplink;
        setTimeout(() => amazonPlay(deeplink), 50);
        return 'navigating';
      }
    }
    throw new Error('Wird von diesem Dienst nicht unterstützt');
  }

  bridge.onCommand((json) => {
    const command = JSON.parse(json);
    const media = findMedia();
    switch (command.type) {
      case 'request':
        handleRequest(command.req || {}, command.rid)
          .then((data) => bridge.respond(command.rid, JSON.stringify({ ok: true, data })))
          .catch((err) => bridge.respond(command.rid, JSON.stringify({ ok: false, error: String((err && err.message) || err) })));
        return;
      case 'play':
        if (!callHandler('play') && media) media.play();
        break;
      case 'pause':
        if (!callHandler('pause') && media) media.pause();
        break;
      case 'next':
        callHandler('nexttrack');
        break;
      case 'prev':
        callHandler('previoustrack');
        break;
      case 'seek': {
        const time = Number(command.time);
        if (!Number.isFinite(time) || time < 0) break;
        if (!callHandler('seekto', { seekTime: time, fastSeek: false }) && media) media.currentTime = time;
        if (positionState) {
          positionState.position = time;
          positionStamp = performance.now();
        }
        break;
      }
      case 'volume': {
        const volume = Number(command.volume);
        if (Number.isFinite(volume)) desiredVolume = Math.min(1, Math.max(0, volume));
        applyVolume();
        break;
      }
      default:
        break;
    }
    setTimeout(tick, 120);
  });

  setInterval(tick, 500);
  resumeCapture();

  if (provider === 'spotify') {
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      sessionStorage.removeItem(PENDING_KEY);
      if (pending && Date.now() - pending.at < 30000) {
        window.addEventListener('load', () => setTimeout(() => spotifyPlay(pending.trackUri, pending.contextUri, false).catch(() => {}), 1500), { once: true });
      }
    } catch {
      // kein gespeicherter Wunsch
    }
  }
}

function runInPage(func) {
  if (typeof contextBridge.executeInMainWorld === 'function') contextBridge.executeInMainWorld({ func });
  else webFrame.executeJavaScript(`(${func.toString()})()`);
}

// Auf Googles Anmeldeseite im Firefox-Modus auch die Chrome-Merkmale im JavaScript verstecken
function hideChromeHints() {
  try {
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
  } catch {
    // nicht änderbar – dann eben nicht
  }
}

if (location.hostname === 'accounts.google.com') {
  let mode = 'native';
  try {
    mode = ipcRenderer.sendSync('engine:ua-mode');
  } catch {
    // Hauptprozess nicht erreichbar
  }
  if (mode === 'firefox') runInPage(hideChromeHints);
} else {
  runInPage(moonifyEngine);
}
