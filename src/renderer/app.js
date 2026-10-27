import { AMAZON_REGIONS, PROVIDERS, getProvider } from '../shared/providers.js';
import {
  emptySearch,
  interleave,
  parseAmazonSearch,
  parseSpotifyArtist,
  parseSpotifyCollections,
  parseSpotifySearch,
  parseSpotifyTracks,
  parseYtmArtist,
  parseYtmBrowse,
  parseYtmChips,
  parseYtmCollections,
  parseYtmLyrics,
  parseYtmNext,
  parseYtmSearch,
  parseYtmSuggestions,
  parseYtmTracks,
  pickRelevant,
  ytmPlaylistId,
  ytmSongsChip,
} from '../shared/parsers.js';
import { activeLineIndex, normalizeName } from '../shared/lyrics.js';
import { formatTime, greeting, safeImageUrl } from './lib/format.js';
import { icons } from './lib/icons.js';
import { lunarPhase, moonSvg } from './lib/moon.js';
import { MoonProgress } from './lib/moon-progress.js';
import { PlayerHub } from './lib/player.js';
import { LibraryStore, itemKey, trackKey } from './lib/library-store.js';
import { EndDetector, Queue, titlesMatch } from './lib/queue.js';
import { enabledIds, loadSettings, saveSettings } from './lib/settings.js';
import { startStarfield } from './lib/starfield.js';

const isDesktop = Boolean(window.moonify);
const unavailable = async () => ({ ok: false, error: 'Nur in der Moonify-Desktop-App verfügbar' });
const noop = () => () => {};
const api = window.moonify || {
  info: async () => ({ platform: 'web', version: '0.0.0', widevine: false }),
  loginStatus: async () => ({}),
  logout: async () => true,
  openExternal: async (url) => window.open(url, '_blank', 'noopener'),
  lyrics: unavailable,
  engines: {
    start: async () => false,
    stop: async () => {},
    show: async () => false,
    home: async () => false,
    command: async () => false,
    request: unavailable,
    onState: noop,
    onLogin: noop,
    onReady: noop,
    onError: noop,
    onWindow: noop,
    onNotice: noop,
  },
  updates: { check: async () => ({ state: 'dev' }), install: async () => {}, status: async () => ({ state: 'dev' }), onStatus: noop },
};

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const hub = new PlayerHub();
let info = { platform: 'web', version: '' };
let loginStatus = {};
const engineState = {};
let view = { kind: 'home' };
let progress;
let updateStatus = { state: 'idle' };

const store = new LibraryStore();
const queue = new Queue();
const endDetector = new EndDetector();
let nowTrack = null; // Song, den Moonify zuletzt gestartet hat

// type: Alles | Songs | Playlists | Alben | Künstler; filter: Dienst
const search = { query: '', token: 0, filter: 'all', type: 'all', results: {} };
const library = {};
let collection = null; // geöffnete Playlist / geöffnetes Album
let artistState = null; // geöffnete Künstlerseite
const backStack = []; // für „Zurück“
// Songtext zum laufenden Song (status: idle | loading | found | instrumental | none | error)
const lyrics = { key: '', song: null, status: 'idle', data: null, timer: 0, lineIndex: -1, userScrollAt: 0 };

/* ---------- kleine DOM-Helfer ---------- */

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value; // nur für eigene, statische Icons
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const providerOptions = () => ({ amazonRegion: settings.amazonRegion });
const connected = () => enabledIds(settings).map(getProvider);

function providerBadge(provider, size = '') {
  return h('span', { class: `provider-badge ${size}`, style: `--brand:${provider.color}` }, provider.name.charAt(0));
}

function providerTag(provider) {
  return h('span', { class: 'provider-tag', style: `--brand:${provider.color}` }, h('span', { class: 'dot' }), provider.short);
}

function statusOf(provider) {
  if (!settings.enabled[provider.id]) return { text: 'Nicht verbunden', cls: 'off' };
  const engine = engineState[provider.id] || {};
  if (engine.error) return { text: 'Problem beim Laden', cls: 'warn' };
  if (loginStatus[provider.id]) return { text: 'Angemeldet', cls: 'ok' };
  return { text: 'Nicht angemeldet', cls: 'warn' };
}

function art(url, cls = '') {
  const safe = safeImageUrl(url);
  return safe
    ? h('img', { class: cls, src: safe, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', draggable: 'false' })
    : h('div', { class: `${cls} art-placeholder`, html: moonSvg({ lit: 0.35, glow: false }) });
}

function spinner(label) {
  return h('div', { class: 'loading' }, h('span', { class: 'loading-moon', html: moonSvg({ lit: 0.6 }) }), label);
}

/* ---------- Toasts & Dialog ---------- */

function toast(message, kind = 'info') {
  const node = h('div', { class: `toast ${kind}` }, message);
  $('toasts').append(node);
  setTimeout(() => node.classList.add('hide'), 3200);
  setTimeout(() => node.remove(), 3700);
}

function openModal({ title, text, actions, input = null, body = null }) {
  const modal = $('modal');
  $('modal-title').textContent = title;
  $('modal-text').textContent = text;
  const field = input
    ? h('input', { class: 'modal-input', type: 'text', maxlength: '120', placeholder: input.placeholder || '', 'aria-label': input.placeholder || title })
    : null;
  if (field) field.value = input.value || '';
  $('modal-input-slot').replaceChildren(...(field ? [field] : body ? [body] : []));
  const close = () => {
    modal.hidden = true;
  };
  const primary = actions.find((a) => a.run && !a.danger) || actions.find((a) => a.run);
  $('modal-actions').replaceChildren(
    ...actions.map((a) =>
      h('button', {
        class: `btn ${a.danger ? 'danger' : a.run ? 'primary' : 'ghost'}`,
        onclick: () => {
          close();
          a.run?.(field ? field.value : undefined);
        },
      }, a.label)),
  );
  if (field) {
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && primary) {
        e.preventDefault();
        close();
        primary.run(field.value);
      }
    });
  }
  modal.hidden = false;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };
  (field || modal.querySelector('.modal-actions button'))?.focus();
}

/* ---------- Dienste ---------- */

async function startEngine(id) {
  engineState[id] = { ...(engineState[id] || {}), error: null };
  await api.engines.start(id, providerOptions());
}

async function connectProvider(id) {
  settings.enabled[id] = true;
  saveSettings(settings);
  await startEngine(id);
  await api.engines.show(id, { login: true });
  renderAll();
}

function disconnectProvider(id) {
  const provider = getProvider(id);
  openModal({
    title: `${provider.name} trennen?`,
    text: 'Beim Ausblenden bleibst du angemeldet und kannst den Dienst später sofort wieder verbinden. Beim Abmelden werden alle Login-Daten dieses Dienstes aus Moonify gelöscht.',
    actions: [
      { label: 'Abbrechen' },
      { label: 'Nur ausblenden', run: () => removeProvider(id, false) },
      { label: 'Abmelden & trennen', danger: true, run: () => removeProvider(id, true) },
    ],
  });
}

async function removeProvider(id, logout) {
  settings.enabled[id] = false;
  saveSettings(settings);
  await api.engines.stop(id);
  hub.remove(id);
  delete search.results[id];
  delete library[id];
  if (logout) await api.logout(id);
  await refreshLoginStatus(true);
  renderAll();
}

function setAmazonRegion(region) {
  if (!Object.hasOwn(AMAZON_REGIONS, region)) return;
  settings.amazonRegion = region;
  saveSettings(settings);
  if (settings.enabled.amazon) api.engines.home('amazon', providerOptions());
}

async function request(id, req) {
  try {
    const result = await api.engines.request(id, req);
    if (!result?.ok) throw new Error(result?.error || 'Unbekannter Fehler');
    return result.data;
  } catch (err) {
    throw new Error(err?.message || String(err));
  }
}

/* ---------- Abspielen & Warteschlange ---------- */

function canPlay(track) {
  return Boolean(settings.enabled[track.provider]) && track.playable !== false;
}

async function startTrack(track, context = null) {
  const provider = getProvider(track.provider);
  if (!settings.enabled[provider.id]) {
    toast(`${provider.name} ist nicht verbunden – in den Einstellungen verbinden.`, 'error');
    return false;
  }
  nowTrack = track;
  store.addHistory(track);
  // Andere Dienste sofort pausieren, damit nichts übereinander läuft
  for (const other of connected()) if (other.id !== provider.id && hub.isPlaying(other.id)) api.engines.command(other.id, { type: 'pause' });
  toast(`„${track.title}“ wird über ${provider.short} gestartet …`);
  try {
    await request(provider.id, { type: 'play', track, context });
    return true;
  } catch (err) {
    toast(`${provider.short}: ${err.message}`, 'error');
    return false;
  }
}

/** Einzelner Song (Suche) oder Song aus einer Playlist eines Dienstes. */
async function playTrack(track, context = null) {
  if (context && context.provider === track.provider) {
    // Der Dienst spielt seine Playlist selbst weiter
    queue.clear();
    endDetector.reset(null);
  } else {
    queue.playNow(track);
    endDetector.reset(track);
  }
  return startTrack(track, context);
}

/** Liste in Moonifys Warteschlange abspielen – auch gemischt aus mehreren Diensten. */
function playList(tracks, start = 0, { shuffle = false } = {}) {
  const wanted = shuffle ? tracks : tracks.slice(start);
  const list = wanted.filter(canPlay);
  const skipped = wanted.length - list.length;
  if (shuffle) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  if (!list.length) {
    toast('Keiner dieser Songs kann gerade abgespielt werden – sind die Dienste verbunden?', 'error');
    return;
  }
  if (skipped) toast(`${skipped} Song${skipped === 1 ? '' : 's'} übersprungen (Dienst nicht verbunden).`);
  const first = queue.set(list, 0);
  endDetector.reset(first);
  startTrack(first);
}

function playNextInQueue() {
  let next = queue.next();
  while (next && !canPlay(next)) next = queue.next();
  endDetector.reset(next);
  if (next) startTrack(next);
  renderNowPlayingIfVisible('queue');
}

function playPreviousInQueue() {
  const previous = queue.previous();
  endDetector.reset(previous);
  if (previous) startTrack(previous);
  renderNowPlayingIfVisible('queue');
}

function addToQueue(track, next = false) {
  if (!canPlay(track)) {
    toast(`${getProvider(track.provider).name} ist nicht verbunden.`, 'error');
    return;
  }
  const started = next ? queue.playNext(track) : queue.add(track);
  if (started) {
    endDetector.reset(started);
    startTrack(started);
  } else {
    toast(next ? `„${track.title}“ kommt als Nächstes.` : `„${track.title}“ ist in der Warteschlange.`, 'ok');
  }
  renderNowPlayingIfVisible('queue');
}

async function playCollection(item, tracks) {
  if (!tracks?.length) return;
  if (item.provider === 'moonify') playList(tracks, 0);
  else await playTrack(tracks[0], item);
}

/** Ganze Playlist, ganzes Album oder Künstler direkt beim Dienst starten (ohne Songliste). */
async function startContext(item) {
  const provider = getProvider(item.provider);
  if (!settings.enabled[provider.id]) {
    toast(`${provider.name} ist nicht verbunden – in den Einstellungen verbinden.`, 'error');
    return false;
  }
  queue.clear();
  endDetector.reset(null);
  nowTrack = null;
  for (const other of connected()) if (other.id !== provider.id && hub.isPlaying(other.id)) api.engines.command(other.id, { type: 'pause' });
  toast(`„${item.name}“ wird über ${provider.short} gestartet …`);
  try {
    await request(provider.id, { type: 'play', track: null, context: { provider: item.provider, kind: item.kind, id: item.id, ref: item.ref } });
    return true;
  } catch (err) {
    toast(`${provider.short}: ${err.message}`, 'error');
    return false;
  }
}

/** Kann der Abspiel-Knopf auf einer Kachel direkt starten? */
function canQuickPlay(item) {
  if (!settings.enabled[item.provider]) return false;
  return !(item.kind === 'artist' && item.provider === 'amazon');
}

async function quickPlay(item) {
  if (item.provider === 'ytmusic') {
    // YouTube Music startet Playlists nur zuverlässig mit dem ersten Song – also erst die Songs laden
    toast(`„${item.name}“ wird geladen …`);
    try {
      const tracks = item.kind === 'artist' ? (await loadArtistData(item)).tracks : await loadCollectionTracks(item);
      if (!tracks.length) toast('Keine Songs gefunden.', 'error');
      else if (item.kind === 'artist') playList(tracks);
      else playTrack(tracks[0], item);
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  startContext(item);
}

/** Seite eines Dienstes im eigenen Fenster öffnen (z. B. Amazon-Künstler). */
async function openInWindow(item) {
  try {
    await request(item.provider, { type: 'open', ref: item.ref });
  } catch {
    // Fenster trotzdem zeigen
  }
  api.engines.show(item.provider);
}

function openItem(item) {
  if (item.provider !== 'moonify' && item.kind === 'artist') openArtist(item);
  else openCollection(item);
}

function saveButton(item) {
  const saved = store.isSaved(item);
  return h('button', {
    class: `btn ghost save-btn${saved ? ' saved' : ''}`,
    'aria-pressed': String(saved),
    title: saved ? 'Nicht mehr merken' : 'In der Bibliothek merken',
    html: `${saved ? icons.bookmarkFilled : icons.bookmark}<span>${saved ? 'Gemerkt' : 'Merken'}</span>`,
    onclick: () => {
      const now = store.toggleSaved(item);
      toast(now ? `„${item.name}“ gemerkt – du findest es in der Bibliothek.` : `„${item.name}“ nicht mehr gemerkt.`, now ? 'ok' : 'info');
    },
  });
}

function isCurrent(track) {
  const current = hub.current();
  return Boolean(current && current.id === track.provider && current.title && titlesMatch(track.title, current.title));
}

/** Song, der gerade läuft – falls Moonify ihn gestartet hat (für Herz & Menü). */
function currentKnownTrack() {
  const current = hub.current();
  if (!current || !nowTrack || current.id !== nowTrack.provider) return null;
  return titlesMatch(nowTrack.title, current.title) ? nowTrack : null;
}

function toggleFavorite(track) {
  const saved = store.toggleFavorite(track);
  toast(saved ? `„${track.title}“ gespeichert ❤` : `„${track.title}“ aus Lieblingssongs entfernt`, saved ? 'ok' : 'info');
}

function heartButton(track, extraClass = '') {
  const saved = store.isFavorite(track);
  return h('button', {
    class: `icon-btn heart${saved ? ' saved' : ''} ${extraClass}`,
    title: saved ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs hinzufügen',
    'aria-label': saved ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs hinzufügen',
    'aria-pressed': String(saved),
    html: saved ? icons.heartFilled : icons.heart,
    onclick: (e) => {
      e.stopPropagation();
      toggleFavorite(track);
    },
  });
}

/* ---------- Kontextmenü ---------- */

function closeMenu() {
  document.getElementById('menu')?.remove();
}

function openMenu(anchor, entries) {
  closeMenu();
  const menu = h('div', { class: 'menu', id: 'menu', role: 'menu' },
    entries.map((entry) => {
      if (entry === '-') return h('div', { class: 'menu-sep' });
      if (entry.label && !entry.run) return h('div', { class: 'menu-label' }, entry.label);
      return h('button', {
        class: `menu-item${entry.danger ? ' danger' : ''}`,
        role: 'menuitem',
        html: `${entry.icon || ''}<span></span>`,
        onclick: (e) => {
          e.stopPropagation();
          closeMenu();
          entry.run();
        },
      });
    }));
  // Texte sicher setzen (Playlist-Namen kommen vom Nutzer)
  [...menu.querySelectorAll('.menu-item span')].forEach((span, i) => {
    span.textContent = entries.filter((e) => e !== '-' && e.run)[i].text;
  });
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
  const top = rect.bottom + height + 8 > window.innerHeight ? Math.max(12, rect.top - height - 6) : rect.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('.menu-item')?.focus();
}

function playlistEntries(tracks) {
  const list = Array.isArray(tracks) ? tracks : [tracks];
  return [
    { label: 'Zu Playlist hinzufügen' },
    ...store.data.playlists.map((p) => ({
      text: p.name,
      icon: icons.library,
      run: () => {
        const added = store.addToPlaylist(p.id, list);
        toast(added ? `${added === 1 ? `„${list[0].title}“` : `${added} Songs`} → „${p.name}“` : 'Ist schon in der Playlist.', added ? 'ok' : 'info');
      },
    })),
    { text: 'Neue Playlist …', icon: icons.plus, run: () => createPlaylistDialog(list) },
  ];
}

function trackMenu(anchor, track, context) {
  const inMoonifyPlaylist = context?.provider === 'moonify' && context.kind === 'playlist';
  const entries = [
    { text: 'Radio starten', icon: icons.radio, run: () => startRadio(track) },
    { text: 'Als Nächstes spielen', icon: icons.next, run: () => addToQueue(track, true) },
    { text: 'Zur Warteschlange hinzufügen', icon: icons.queue, run: () => addToQueue(track) },
    { text: store.isFavorite(track) ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs hinzufügen', icon: icons.heart, run: () => toggleFavorite(track) },
  ];
  if (track.artistLink) entries.push({ text: 'Zum Künstler', icon: icons.mic, run: () => openArtist(track.artistLink) });
  if (track.albumLink) entries.push({ text: 'Zum Album', icon: icons.library, run: () => openCollection(track.albumLink) });
  if (shareUrl(track)) entries.push({ text: 'Link kopieren', icon: icons.link, run: () => copyLink(track) });
  entries.push('-', ...playlistEntries(track));
  if (inMoonifyPlaylist) {
    entries.push('-',
      { text: 'Nach oben', icon: icons.up, run: () => store.moveInPlaylist(context.id, trackKey(track), -1) },
      { text: 'Nach unten', icon: icons.down, run: () => store.moveInPlaylist(context.id, trackKey(track), 1) },
      { text: 'Aus dieser Playlist entfernen', icon: icons.close, danger: true, run: () => store.removeFromPlaylist(context.id, trackKey(track)) });
  }
  openMenu(anchor, entries);
}

function createPlaylistDialog(tracks = []) {
  openModal({
    title: 'Neue Playlist',
    text: tracks.length ? `${tracks.length === 1 ? `„${tracks[0].title}“ wird` : `${tracks.length} Songs werden`} direkt hinzugefügt. Songs aus verschiedenen Diensten lassen sich mischen.` : 'Songs aus verschiedenen Diensten lassen sich mischen.',
    input: { placeholder: 'Name der Playlist', value: '' },
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Erstellen',
        run: (name) => {
          const playlist = store.createPlaylist(name);
          if (tracks.length) store.addToPlaylist(playlist.id, tracks);
          toast(`Playlist „${playlist.name}“ erstellt`, 'ok');
        },
      },
    ],
  });
}

function trackList(tracks, context = null, { numbered = false } = {}) {
  const moonify = context?.provider === 'moonify';
  return h('div', { class: 'track-list', role: 'list' },
    tracks.map((track, index) => {
      const provider = getProvider(track.provider);
      const current = isCurrent(track);
      const available = canPlay(track);
      const play = () => {
        if (!available) {
          toast(`${provider.name} ist nicht verbunden – in den Einstellungen verbinden.`, 'error');
          return;
        }
        if (moonify) playList(tracks, index);
        else playTrack(track, context);
      };
      const menuButton = h('button', {
        class: 'icon-btn tr-more',
        title: 'Mehr',
        'aria-label': 'Mehr Optionen',
        html: icons.more,
        onclick: (e) => {
          e.stopPropagation();
          trackMenu(e.currentTarget, track, context);
        },
      });
      return h('div', {
        class: `track-row${current ? ' current' : ''}${available ? '' : ' disabled'}`,
        role: 'listitem',
        tabindex: '0',
        title: available ? 'Abspielen' : `${provider.name} ist nicht verbunden`,
        onclick: play,
        oncontextmenu: (e) => {
          e.preventDefault();
          trackMenu(menuButton, track, context);
        },
        onkeydown: (e) => {
          if (e.key === 'Enter') play();
        },
      },
      h('span', { class: 'tr-index' },
        current && hub.current()?.playing
          ? h('span', { class: 'eq', style: `--brand:${provider.color}` }, h('i'), h('i'), h('i'))
          : h('span', { class: 'tr-num' }, numbered ? String(index + 1) : ''),
        h('span', { class: 'tr-play', html: icons.play })),
      art(track.image, 'tr-art'),
      h('div', { class: 'tr-main' },
        h('div', { class: 'tr-title' }, track.title || 'Unbekannter Titel'),
        h('div', { class: 'tr-sub' }, [track.artist, track.album].filter(Boolean).join(' · '))),
      providerTag(provider),
      heartButton(track, 'tr-heart'),
      h('span', { class: 'tr-duration' }, track.duration ? formatTime(track.duration) : ''),
      menuButton);
    }));
}

/* ---------- Suche ---------- */

const SEARCH_TYPES = [
  { id: 'all', label: 'Alles' },
  { id: 'tracks', label: 'Songs' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Alben' },
  { id: 'artists', label: 'Künstler' },
];
const KIND_LABELS = { playlist: 'Playlist', album: 'Album', artist: 'Künstler' };

async function searchProvider(id, query, token) {
  search.results[id] = { status: 'loading', more: 'idle', ...emptySearch() };
  renderSearchIfVisible();
  let ok = false;
  try {
    const data = await request(id, { type: 'search', query });
    let result;
    if (id === 'spotify') {
      result = { ...emptySearch(), tracks: parseSpotifyTracks(data) };
    } else if (id === 'amazon') {
      result = parseAmazonSearch(data);
    } else {
      result = parseYtmSearch(data);
      // Wenn es einen „Songs“-Filter gibt, lieber Songs statt Videos – aber nur, wenn sie zur Suche passen
      const chip = ytmSongsChip(parseYtmChips(data));
      if (chip) {
        const songs = await request(id, { type: 'search', query, params: chip.params }).then(parseYtmTracks).catch(() => []);
        result.tracks = pickRelevant(songs, result.tracks, query);
      }
    }
    if (token !== search.token) return;
    search.results[id] = { ...result, status: 'done', more: id === 'spotify' ? 'loading' : 'done', tracks: result.tracks.slice(0, 40) };
    ok = true;
  } catch (err) {
    if (token !== search.token) return;
    search.results[id] = { ...emptySearch(), status: 'error', more: 'done', error: err.message };
  }
  renderSearchIfVisible();
  if (ok && id === 'spotify') loadSpotifyMore(query, token);
}

// Playlists, Alben und Künstler holt Spotify mit einer zweiten Abfrage – erst nach den Songs,
// damit das Player-Fenster nicht zwei Seiten gleichzeitig öffnet.
async function loadSpotifyMore(query, token) {
  const entry = search.results.spotify;
  try {
    const all = parseSpotifySearch(await request('spotify', { type: 'searchAll', query }));
    if (token !== search.token) return;
    Object.assign(entry, { playlists: all.playlists, albums: all.albums, artists: all.artists, top: all.top, more: 'done' });
    if (!entry.tracks.length) entry.tracks = all.tracks;
  } catch {
    if (token !== search.token) return;
    entry.more = 'error';
  }
  renderSearchIfVisible();
}

function runSearch(query, { type = 'all' } = {}) {
  const q = query.trim();
  if (!q) return;
  const list = connected();
  search.query = q;
  search.token += 1;
  search.results = {};
  search.type = type;
  if (search.filter !== 'all' && !settings.enabled[search.filter]) search.filter = 'all';
  $('search-input').value = q;
  store.addSearch(q);
  showView({ kind: 'search' });
  for (const provider of list) searchProvider(provider.id, q, search.token);
}

function renderSearchIfVisible() {
  if (view.kind === 'search') renderSearch();
}

function bigSearchForm() {
  return h('form', {
    class: 'big-search',
    onsubmit: (e) => {
      e.preventDefault();
      runSearch(e.target.elements.q.value);
    },
  },
  h('span', { class: 'search-icon', html: icons.search }),
  h('input', { name: 'q', type: 'search', placeholder: 'Song, Künstler, Album oder Playlist …', 'aria-label': 'Suchbegriff', autofocus: true }));
}

function recentSearches() {
  const list = store.data.searches;
  if (!list.length) return null;
  return h('section', { class: 'recent-searches' },
    h('div', { class: 'section-head spaced' },
      h('h2', {}, 'Zuletzt gesucht'),
      h('button', { class: 'link-btn', onclick: () => store.clearSearches() }, 'Verlauf löschen')),
    h('div', { class: 'chips' }, list.map((q) => h('span', { class: 'chip recent' },
      h('button', { class: 'recent-q', onclick: () => runSearch(q) }, h('span', { html: icons.search }), q),
      h('button', { class: 'recent-x', title: 'Entfernen', 'aria-label': `„${q}“ entfernen`, html: icons.close, onclick: () => store.removeSearch(q) })))));
}

/** Bester Treffer: Künstler/Playlist/Album mit genau dem gesuchten Namen, sonst der Top-Treffer eines Dienstes. */
function topResult(visible, found) {
  const q = normalizeName(search.query);
  const exact = [...found.artists, ...found.playlists, ...found.albums].find((i) => normalizeName(i.name) === q);
  if (exact) return exact;
  return visible.map((p) => search.results[p.id]?.top).find(Boolean) || null;
}

function topCard(item) {
  const provider = getProvider(item.provider);
  const subtitle = item.subtitle && item.subtitle !== KIND_LABELS[item.kind] ? item.subtitle : '';
  return h('div', {
    class: `top-card${item.kind === 'artist' ? ' artist' : ''}`,
    style: `--brand:${provider.color}`,
    role: 'button',
    tabindex: '0',
    onclick: () => openItem(item),
    onkeydown: (e) => {
      if (e.key === 'Enter') openItem(item);
    },
  },
  h('div', { class: 'tc-art' }, art(item.image)),
  h('div', { class: 'tc-name' }, item.name),
  h('div', { class: 'tc-sub' }, h('span', { class: 'kind-pill' }, KIND_LABELS[item.kind] || ''), providerTag(provider), subtitle ? h('span', { class: 'tc-extra' }, subtitle) : null),
  canQuickPlay(item) ? h('button', {
    class: 'cc-play big',
    title: 'Abspielen',
    'aria-label': `${item.name} abspielen`,
    html: icons.play,
    onclick: (e) => {
      e.stopPropagation();
      quickPlay(item);
    },
  }) : null);
}

function rowHead(title, type, showAll) {
  return h('div', { class: 'section-head spaced' },
    h('h2', {}, title),
    showAll ? h('button', { class: 'link-btn', onclick: () => setSearchType(type) }, 'Alle anzeigen') : null);
}

function cardRow(items) {
  return h('div', { class: 'card-row' }, items.map(collectionCard));
}

function renderSearch() {
  const root = $('view-search');
  const list = connected();
  if (!list.length) {
    root.replaceChildren(page(emptyState('Noch kein Dienst verbunden', 'Verbinde Spotify, YouTube Music oder Amazon Music in den Einstellungen – dann kannst du hier alles auf einmal durchsuchen.', true)));
    return;
  }
  if (!search.query) {
    root.replaceChildren(page(
      h('h1', { class: 'page-title' }, 'Suchen'),
      h('p', { class: 'section-sub' }, `Ein Suchfeld für ${list.map((p) => p.short).join(', ').replace(/, ([^,]*)$/, ' & $1')} – Songs, Playlists, Alben und Künstler.`),
      bigSearchForm(),
      recentSearches(),
    ));
    root.querySelector('input')?.focus();
    return;
  }

  const visible = search.filter === 'all' ? list : list.filter((p) => p.id === search.filter);
  const pick = (key, providers = visible) => interleave(providers.map((p) => search.results[p.id]?.[key] || []));
  const found = { tracks: pick('tracks'), playlists: pick('playlists'), albums: pick('albums'), artists: pick('artists') };
  const loading = visible.some((p) => search.results[p.id]?.status === 'loading');
  const loadingMore = visible.some((p) => search.results[p.id]?.more === 'loading');
  const countOf = (type, providers = visible) => (type === 'all'
    ? ['tracks', 'playlists', 'albums', 'artists'].reduce((n, key) => n + pick(key, providers).length, 0)
    : pick(type, providers).length);
  const busy = (type, providers = visible) => providers.some((p) => {
    const r = search.results[p.id];
    return r?.status === 'loading' || (type !== 'tracks' && r?.more === 'loading');
  });

  const tabs = h('div', { class: 'type-tabs', role: 'tablist' }, SEARCH_TYPES.map((t) => h('button', {
    class: `type-tab${search.type === t.id ? ' active' : ''}`,
    role: 'tab',
    'aria-selected': String(search.type === t.id),
    onclick: () => setSearchType(t.id),
  }, t.label, t.id === 'all' ? null : busy(t.id) ? h('span', { class: 'chip-spin', html: moonSvg({ lit: 0.5, glow: false }) }) : h('span', { class: 'chip-count' }, String(countOf(t.id))))));

  const chips = list.length > 1 ? h('div', { class: 'chips' },
    h('button', { class: `chip${search.filter === 'all' ? ' active' : ''}`, onclick: () => setFilter('all') }, 'Alle Dienste'),
    ...list.map((p) => h('button', { class: `chip${search.filter === p.id ? ' active' : ''}`, style: `--brand:${p.color}`, onclick: () => setFilter(p.id) },
      h('span', { class: 'dot' }), p.short,
      busy(search.type, [p]) ? h('span', { class: 'chip-spin', html: moonSvg({ lit: 0.5, glow: false }) }) : h('span', { class: 'chip-count' }, String(countOf(search.type, [p])))))) : null;

  const problems = visible
    .filter((p) => search.results[p.id]?.status === 'error')
    .map((p) => h('div', { class: 'notice warn small' },
      h('strong', {}, `${p.name}: `), search.results[p.id].error, ' ',
      h('button', { class: 'link-btn', onclick: () => searchProvider(p.id, search.query, search.token) }, 'Erneut versuchen'),
      ' · ',
      h('button', { class: 'link-btn', onclick: () => api.engines.show(p.id) }, 'Im Fenster öffnen')));

  let body;
  if (search.type === 'all') {
    body = renderSearchAll(visible, found, loading, loadingMore);
  } else if (search.type === 'tracks') {
    body = found.tracks.length ? trackList(found.tracks) : null;
  } else {
    body = found[search.type].length ? h('div', { class: 'collection-grid' }, found[search.type].map(collectionCard)) : null;
  }
  if (!body) {
    const label = SEARCH_TYPES.find((t) => t.id === search.type).label;
    body = busy(search.type) ? spinner('Suche läuft …') : problems.length ? null : emptyState('Keine Treffer', search.type === 'all' ? `Für „${search.query}“ wurde nichts gefunden.` : `Keine ${label} für „${search.query}“ gefunden.`);
  }

  root.replaceChildren(page(
    h('div', { class: 'search-head' },
      h('h1', { class: 'page-title' }, h('span', { class: 'muted' }, 'Ergebnisse für '), `„${search.query}“`),
      h('button', { class: 'link-btn', onclick: () => {
        search.query = '';
        $('search-input').value = '';
        renderSearch();
      } }, 'Neue Suche')),
    tabs,
    chips,
    problems,
    body,
  ));
}

function renderSearchAll(visible, found, loading, loadingMore) {
  const parts = [];
  const top = topResult(visible, found);
  const songCount = top ? 4 : 6;
  const songs = found.tracks.length ? trackList(found.tracks.slice(0, songCount)) : null;
  if (top || songs) {
    parts.push(h('div', { class: `search-top${top ? '' : ' no-top'}` },
      top ? h('section', { class: 'top-hit' }, h('h2', { class: 'row-title' }, 'Top-Treffer'), topCard(top)) : null,
      songs ? h('section', { class: 'top-songs' }, rowHead('Songs', 'tracks', found.tracks.length > songCount), songs) : null));
  }
  for (const [key, title] of [['playlists', 'Playlists'], ['albums', 'Alben'], ['artists', 'Künstler']]) {
    const items = found[key].filter((i) => i !== top);
    if (items.length) parts.push(h('section', { class: 'search-row' }, rowHead(title, key, items.length > 6), cardRow(items.slice(0, 12))));
  }
  if (parts.length && (loading || loadingMore)) parts.push(h('div', { class: 'search-more' }, spinner('Weitere Treffer werden geladen …')));
  return parts.length ? parts : null;
}

function setFilter(filter) {
  search.filter = filter;
  renderSearch();
}

function setSearchType(type) {
  search.type = type;
  renderSearch();
  $('view-search').scrollTop = 0;
}

/* ---------- Bibliothek ---------- */

async function loadLibrary(id, force = false) {
  const provider = getProvider(id);
  if (!provider.library || !settings.enabled[id]) return;
  if (!force && library[id] && library[id].status !== 'error') return;
  library[id] = { status: 'loading', items: [] };
  renderLibraryViews();
  try {
    const data = await request(id, { type: 'library' });
    let items = id === 'spotify' ? parseSpotifyCollections(data) : parseYtmCollections(data);
    const liked = id === 'spotify'
      ? { provider: id, kind: 'playlist', id: 'liked', name: 'Lieblingssongs', subtitle: 'Spotify', image: '', ref: { uri: 'spotify:collection:tracks' } }
      : { provider: id, kind: 'playlist', id: 'VLLM', name: 'Lieblingssongs', subtitle: 'YouTube Music', image: '', ref: { browseId: 'VLLM', playlistId: 'LM' } };
    items = [liked, ...items.filter((i) => i.name !== 'Lieblingssongs')];
    library[id] = { status: 'done', items };
  } catch (err) {
    library[id] = { status: 'error', items: [], error: err.message };
  }
  renderLibraryViews();
}

function renderLibraryViews() {
  if (view.kind === 'library') renderLibrary();
  if (view.kind === 'home') renderHomeShelf();
}

/* Moonifys eigene Sammlungen (Lieblingssongs, Playlists, Verlauf) */

const songs = (n) => `${n} ${n === 1 ? 'Song' : 'Songs'}`;

function moonifyItems() {
  const items = [
    { provider: 'moonify', kind: 'favorites', id: 'favorites', name: 'Lieblingssongs', subtitle: songs(store.data.favorites.length) },
    ...store.data.playlists.map((p) => ({ provider: 'moonify', kind: 'playlist', id: p.id, name: p.name, subtitle: songs(p.tracks.length) })),
  ];
  if (store.data.history.length) items.push({ provider: 'moonify', kind: 'history', id: 'history', name: 'Zuletzt gehört', subtitle: songs(store.data.history.length) });
  return items;
}

function moonifyTracks(item) {
  if (item.kind === 'favorites') return store.data.favorites;
  if (item.kind === 'history') return store.data.history;
  return store.playlist(item.id)?.tracks || [];
}

function moonifyCover(item) {
  if (item.kind === 'favorites') return h('div', { class: 'liked-art moon-liked', html: icons.heartFilled });
  if (item.kind === 'history') return h('div', { class: 'liked-art moon-history', html: icons.reload });
  const covers = moonifyTracks(item).map((t) => t.image).filter(Boolean).slice(0, 4);
  if (covers.length >= 4) return h('div', { class: 'mosaic' }, covers.map((c) => art(c)));
  if (covers.length) return art(covers[0]);
  return h('div', { class: 'liked-art moon-playlist', html: moonSvg({ lit: 0.55, glow: false }) });
}

function moonifyCard(item) {
  return h('button', { class: 'collection-card moonify', onclick: () => openCollection(item) },
    h('div', { class: 'cc-art' }, moonifyCover(item)),
    h('div', { class: 'cc-name' }, item.name),
    h('div', { class: 'cc-sub' }, h('span', { class: 'provider-tag moon-tag' }, h('span', { class: 'dot' }), 'Moonify'), ` ${item.subtitle}`));
}

function newPlaylistCard() {
  return h('button', { class: 'collection-card add-card', onclick: () => createPlaylistDialog() },
    h('div', { class: 'cc-art' }, h('div', { class: 'add-art', html: icons.plus })),
    h('div', { class: 'cc-name' }, 'Neue Playlist'),
    h('div', { class: 'cc-sub' }, 'Songs aus allen Diensten mischen'));
}

/** Kachel für Playlists, Alben und Künstler der Dienste (mit Abspiel-Knopf). */
function collectionCard(item) {
  if (item.provider === 'moonify') return moonifyCard(item);
  const provider = getProvider(item.provider);
  const liked = item.id === 'liked' || item.id === 'VLLM';
  const sub = item.kind === 'artist' ? 'Künstler' : item.subtitle && item.subtitle !== provider.name ? item.subtitle : '';
  return h('div', {
    class: `collection-card${item.kind === 'artist' ? ' artist' : ''}`,
    style: `--brand:${provider.color}`,
    role: 'button',
    tabindex: '0',
    title: item.name,
    onclick: () => openItem(item),
    onkeydown: (e) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) openItem(item);
    },
  },
  h('div', { class: 'cc-art' },
    liked ? h('div', { class: 'liked-art', html: icons.sparkle }) : art(item.image),
    canQuickPlay(item) ? h('button', {
      class: 'cc-play',
      title: 'Abspielen',
      'aria-label': `${item.name} abspielen`,
      html: icons.play,
      onclick: (e) => {
        e.stopPropagation();
        quickPlay(item);
      },
    }) : null),
  h('div', { class: 'cc-name' }, item.name),
  h('div', { class: 'cc-sub' }, providerTag(provider), sub ? ` ${sub}` : ''));
}

// Bereiche der YouTube-Music-Bibliothek (angemeldet)
const YTM_LIBRARY = [
  ['Songs mit „Mag ich“', 'FEmusic_liked_videos'],
  ['Alben', 'FEmusic_liked_albums'],
  ['Künstler', 'FEmusic_library_corpus_track_artists'],
  ['Abos', 'FEmusic_library_corpus_artists'],
  ['Verlauf', 'FEmusic_history'],
];

function renderLibrary() {
  const root = $('view-library');
  const list = connected();
  const own = h('section', { class: 'lib-section' },
    h('div', { class: 'section-head' }, h('span', { class: 'moon-badge', html: moonSvg({ lit: 0.72, glow: false }) }), h('h2', {}, 'In Moonify gespeichert')),
    h('div', { class: 'collection-grid' }, moonifyItems().map(moonifyCard), newPlaylistCard()));
  const saved = store.data.saved.length
    ? h('section', { class: 'lib-section' },
      h('div', { class: 'section-head' }, h('span', { class: 'moon-badge', html: icons.bookmarkFilled }), h('h2', {}, 'Gemerkt')),
      h('div', { class: 'collection-grid' }, store.data.saved.map(collectionCard)))
    : null;
  if (!list.length) {
    root.replaceChildren(page(h('h1', { class: 'page-title' }, 'Bibliothek'), own, saved,
      emptyState('Noch kein Dienst verbunden', 'Verbinde deine Musikdienste in den Einstellungen, dann erscheinen hier auch ihre Playlists und Lieblingssongs.', true)));
    return;
  }
  const sections = list.map((provider) => {
    const head = h('div', { class: 'section-head' }, providerBadge(provider, 'small'), h('h2', {}, provider.name));
    if (!provider.library) {
      return h('section', { class: 'lib-section' }, head,
        h('div', { class: 'notice small' }, `Die Bibliothek von ${provider.name} kann Moonify noch nicht anzeigen – Suchen und Abspielen klappt aber. `,
          h('button', { class: 'link-btn', onclick: () => api.engines.show(provider.id) }, `${provider.short} im Fenster öffnen`)));
    }
    if (!loginStatus[provider.id]) {
      return h('section', { class: 'lib-section' }, head,
        h('div', { class: 'notice small' }, 'Melde dich an, um deine Playlists und Lieblingssongs zu sehen. ',
          h('button', { class: 'link-btn', onclick: () => api.engines.show(provider.id, { login: true }) }, 'Jetzt anmelden')));
    }
    const lib = library[provider.id];
    if (!lib || lib.status === 'loading') return h('section', { class: 'lib-section' }, head, spinner('Bibliothek wird geladen …'));
    if (lib.status === 'error') {
      return h('section', { class: 'lib-section' }, head,
        h('div', { class: 'notice warn small' }, `${lib.error} `, h('button', { class: 'link-btn', onclick: () => loadLibrary(provider.id, true) }, 'Erneut versuchen')));
    }
    const shortcuts = provider.id === 'ytmusic'
      ? h('div', { class: 'chips' }, YTM_LIBRARY.map(([label, browseId]) => h('button', { class: 'chip', onclick: () => openBrowseLink({ browseId }, label) }, label)))
      : null;
    return h('section', { class: 'lib-section' }, head, shortcuts, h('div', { class: 'collection-grid' }, lib.items.map(collectionCard)));
  });
  root.replaceChildren(page(h('h1', { class: 'page-title' }, 'Bibliothek'), own, saved, sections));
  for (const provider of list) if (provider.library && loginStatus[provider.id] && !library[provider.id]) loadLibrary(provider.id);
}

/* ---------- Playlist / Album ---------- */

function openCollection(item) {
  const state = { item, status: 'loading', tracks: [], filter: '' };
  if (item.provider === 'moonify') state.status = 'done';
  // Amazon zeigt Album- und Playlist-Seiten nur angemeldet im eigenen Fenster
  else if (item.provider === 'amazon') state.status = 'unsupported';
  showView({ kind: 'collection', state });
  if (state.status === 'loading') loadCollection(state);
}

/** Songs einer Playlist / eines Albums beim Dienst laden. */
async function loadCollectionTracks(item) {
  const data = await request(item.provider, { type: 'collection', ref: item.ref });
  let tracks = item.provider === 'spotify' ? parseSpotifyTracks(data) : parseYtmTracks(data);
  // Ohne playlistId spielt YouTube Music nur den einen Song statt des Albums
  if (item.provider === 'ytmusic' && !item.ref.playlistId) item.ref = { ...item.ref, playlistId: ytmPlaylistId(data) };
  if (item.kind === 'album') {
    // Songs eines Albums haben oft kein eigenes Cover und keinen Künstler
    const artist = item.artistName || albumArtist(item.subtitle);
    tracks = tracks.map((t) => ({ ...t, image: t.image || item.image, artist: t.artist || artist, album: t.album || item.name }));
  }
  return tracks;
}

async function loadCollection(state) {
  state.status = 'loading';
  try {
    state.tracks = await loadCollectionTracks(state.item);
    // Seiten wie „Angesagt“ kommen ohne eigenes Cover
    if (!state.item.image && state.tracks[0]?.image) state.item.image = state.tracks[0].image;
    state.status = 'done';
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
  }
  if (view.kind === 'collection' && collection === state) renderCollection();
}

/** „Coldplay · 2000“ → „Coldplay“ (aber nicht „Album · 2000“). */
function albumArtist(subtitle) {
  const first = String(subtitle || '').split(/\s[•·]\s/)[0].trim();
  return /^(\d{4}|album|single|ep|compilation)$/i.test(first) ? '' : first;
}

function matchesFilter(track, query) {
  const q = normalizeName(query);
  if (!q) return true;
  return normalizeName(`${track.title} ${track.artist} ${track.album}`).includes(q);
}

/** Suchfeld innerhalb einer langen Liste; aktualisiert nur die Liste darunter. */
function filteredTracks(state, tracks, renderList) {
  const slot = h('div', { class: 'filtered' });
  const fill = () => {
    const shown = tracks.filter((t) => matchesFilter(t, state.filter));
    slot.replaceChildren(shown.length ? renderList(shown) : h('p', { class: 'section-sub' }, `Nichts gefunden für „${state.filter}“.`));
  };
  fill();
  if (tracks.length < 12) return [slot];
  const input = h('input', {
    class: 'filter-input',
    type: 'search',
    placeholder: 'In dieser Liste suchen …',
    'aria-label': 'In dieser Liste suchen',
    oninput: (e) => {
      state.filter = e.target.value;
      fill();
    },
  });
  input.value = state.filter || '';
  return [h('label', { class: 'filter-box' }, h('span', { html: icons.search }), input), slot];
}

/** Neu zeichnen, ohne dass das Suchfeld der Liste den Fokus verliert. */
function keepFilterFocus(root, render) {
  const focused = document.activeElement?.classList.contains('filter-input') && root.contains(document.activeElement);
  render();
  if (focused) {
    const input = root.querySelector('.filter-input');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

function renderCollection() {
  const root = $('view-collection');
  if (!collection) return;
  if (collection.item.provider === 'moonify') {
    keepFilterFocus(root, () => renderMoonifyCollection(root, collection.item));
    return;
  }
  const state = collection;
  const { item, status, tracks, error } = state;
  const provider = getProvider(item.provider);
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const liked = item.id === 'liked' || item.id === 'VLLM';
  const actions = status === 'unsupported'
    ? [
      h('button', { class: 'btn primary', disabled: !settings.enabled[item.provider], html: `${icons.play}<span>Abspielen</span>`, onclick: () => startContext(item) }),
      h('button', { class: 'btn ghost', html: `${icons.window}<span>Im Fenster öffnen</span>`, onclick: () => openInWindow(item) }),
    ]
    : [
      h('button', { class: 'btn primary', disabled: !tracks.length, html: `${icons.play}<span>Abspielen</span>`, onclick: () => playCollection(item, tracks) }),
      h('button', {
        class: 'btn ghost',
        disabled: !tracks.length,
        html: `${icons.library}<span>In Moonify speichern</span>`,
        onclick: (e) => openMenu(e.currentTarget, playlistEntries(tracks)),
      }),
    ];
  if (!liked) actions.push(saveButton(item));
  const header = h('div', { class: 'collection-header', style: `--brand:${provider.color}` },
    h('div', { class: 'ch-art' }, liked ? h('div', { class: 'liked-art', html: icons.sparkle }) : art(item.image)),
    h('div', { class: 'ch-text' },
      h('small', {}, item.kind === 'album' ? 'Album' : 'Playlist'),
      h('h1', {}, item.name),
      h('div', { class: 'ch-meta' }, providerTag(provider), item.subtitle ? ` ${item.subtitle}` : '',
        status === 'done' ? ` · ${songs(tracks.length)}${total ? ` · ${Math.round(total / 60)} Min.` : ''}` : ''),
      h('div', { class: 'ch-actions' }, actions)));
  let body;
  if (status === 'loading') body = spinner('Songs werden geladen …');
  else if (status === 'error') body = h('div', { class: 'notice warn' }, error, ' ', h('button', { class: 'link-btn', onclick: () => { loadCollection(state); renderCollection(); } }, 'Erneut versuchen'));
  else if (status === 'unsupported') body = h('div', { class: 'notice' }, `Die Songliste kann Moonify bei ${provider.name} noch nicht anzeigen. „Abspielen“ startet ${item.kind === 'album' ? 'das ganze Album' : 'die ganze Playlist'} direkt bei ${provider.short}.`);
  else if (!tracks.length) body = emptyState('Leer', 'Hier sind noch keine Songs.');
  else body = filteredTracks(state, tracks, (shown) => trackList(shown, item, { numbered: shown.length === tracks.length }));
  keepFilterFocus(root, () => root.replaceChildren(page(backButton(), header, body)));
}

function renderMoonifyCollection(root, item) {
  if (item.kind === 'playlist' && !store.playlist(item.id)) {
    showView({ kind: 'library' });
    return;
  }
  const tracks = moonifyTracks(item);
  const name = item.kind === 'playlist' ? store.playlist(item.id).name : item.name;
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const services = [...new Set(tracks.map((t) => t.provider))].map(getProvider);
  const actions = [
    h('button', { class: 'btn primary', disabled: !tracks.length, html: `${icons.play}<span>Abspielen</span>`, onclick: () => playList(tracks, 0) }),
    h('button', { class: 'btn ghost', disabled: tracks.length < 2, html: `${icons.shuffle}<span>Zufällig</span>`, onclick: () => playList(tracks, 0, { shuffle: true }) }),
  ];
  if (item.kind === 'playlist') {
    actions.push(
      h('button', {
        class: 'btn ghost',
        html: `${icons.edit}<span>Umbenennen</span>`,
        onclick: () => openModal({
          title: 'Playlist umbenennen',
          text: '',
          input: { value: name, placeholder: 'Name der Playlist' },
          actions: [{ label: 'Abbrechen' }, { label: 'Speichern', run: (value) => store.renamePlaylist(item.id, value) }],
        }),
      }),
      h('button', {
        class: 'btn ghost',
        html: `${icons.trash}<span>Löschen</span>`,
        onclick: () => openModal({
          title: `„${name}“ löschen?`,
          text: 'Die Playlist wird aus Moonify entfernt. Die Songs bei den Diensten bleiben unberührt.',
          actions: [{ label: 'Abbrechen' }, { label: 'Löschen', danger: true, run: () => store.deletePlaylist(item.id) }],
        }),
      }));
  }
  if (item.kind === 'history' && tracks.length) {
    actions.push(h('button', { class: 'btn ghost', html: `${icons.trash}<span>Verlauf leeren</span>`, onclick: () => store.clearHistory() }));
  }
  const header = h('div', { class: 'collection-header moonify' },
    h('div', { class: 'ch-art' }, moonifyCover(item)),
    h('div', { class: 'ch-text' },
      h('small', {}, item.kind === 'history' ? 'Verlauf' : 'Moonify-Playlist'),
      h('h1', {}, name),
      h('div', { class: 'ch-meta' },
        `${songs(tracks.length)}${total ? ` · ${Math.round(total / 60)} Min.` : ''}`,
        services.length ? ' · ' : '',
        services.map((p) => providerTag(p))),
      h('div', { class: 'ch-actions' }, actions)));
  let body;
  if (!tracks.length) {
    body = emptyState(
      item.kind === 'favorites' ? 'Noch keine Lieblingssongs' : 'Noch leer',
      item.kind === 'favorites'
        ? 'Tippe bei einem Song auf das Herz, um ihn hier zu speichern.'
        : 'Füge Songs über das ⋯-Menü bei einem Song hinzu – aus allen Diensten gemischt.',
    );
  } else {
    body = filteredTracks(collection, tracks, (shown) => trackList(shown, { provider: 'moonify', kind: item.kind, id: item.id }, { numbered: item.kind !== 'history' && shown.length === tracks.length }));
  }
  root.replaceChildren(page(backButton(), header, body));
}

/* ---------- Künstler ---------- */

async function loadArtistData(item) {
  const data = await request(item.provider, { type: 'artist', ref: item.ref });
  const result = item.provider === 'spotify' ? parseSpotifyArtist(data) : parseYtmArtist(data);
  if (!result) throw new Error('Die Künstlerseite konnte nicht gelesen werden');
  const name = item.name || result.artist.name;
  for (const album of result.albums) album.artistName = name;
  return result;
}

function openArtist(item) {
  const state = { item, status: item.provider === 'amazon' ? 'unsupported' : 'loading', data: null, error: '' };
  showView({ kind: 'artist', state });
  if (state.status === 'loading') loadArtist(state);
}

async function loadArtist(state) {
  state.status = 'loading';
  try {
    state.data = await loadArtistData(state.item);
    state.status = 'done';
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
  }
  if (view.kind === 'artist' && artistState === state) renderArtist();
}

function renderArtist() {
  const state = artistState;
  if (!state) return;
  const { item, status, data } = state;
  const provider = getProvider(item.provider);
  const info = data?.artist || {};
  const tracks = data?.tracks || [];
  const subtitle = info.subtitle && info.subtitle !== 'Künstler' ? info.subtitle : item.subtitle && item.subtitle !== 'Künstler' ? item.subtitle : '';
  const actions = status === 'unsupported'
    ? [
      h('button', { class: 'btn primary', html: `${icons.window}<span>Im Fenster öffnen</span>`, onclick: () => openInWindow(item) }),
      h('button', { class: 'btn ghost', html: `${icons.search}<span>Songs suchen</span>`, onclick: () => {
        search.filter = item.provider;
        runSearch(item.name);
      } }),
    ]
    : [
      h('button', {
        class: 'btn primary',
        disabled: !tracks.length || !settings.enabled[item.provider],
        html: `${icons.play}<span>Abspielen</span>`,
        // Spotify spielt Künstler selbst (mit Radio danach), sonst Moonifys Warteschlange
        onclick: () => (item.provider === 'spotify' ? startContext(item) : playList(tracks)),
      }),
      h('button', { class: 'btn ghost', disabled: tracks.length < 2, html: `${icons.shuffle}<span>Zufällig</span>`, onclick: () => playList(tracks, 0, { shuffle: true }) }),
    ];
  // YouTube Music: „Mix“ (Radio des Künstlers) – startet mit dem beliebtesten Song
  if (data?.radio && tracks.length) {
    actions.push(h('button', {
      class: 'btn ghost',
      html: `${icons.radio}<span>Mix</span>`,
      onclick: () => playTrack(tracks[0], { provider: 'ytmusic', kind: 'playlist', id: data.radio, name: 'Mix', ref: { playlistId: data.radio } }),
    }));
  }
  actions.push(saveButton(item));
  const header = h('div', { class: 'collection-header artist-header', style: `--brand:${provider.color}` },
    h('div', { class: 'ch-art round' }, art(item.image || info.image)),
    h('div', { class: 'ch-text' },
      h('small', {}, 'Künstler'),
      h('h1', {}, item.name || info.name),
      h('div', { class: 'ch-meta' }, providerTag(provider), subtitle ? ` ${subtitle}` : ''),
      h('div', { class: 'ch-actions' }, actions)));
  let body;
  if (status === 'loading') {
    body = spinner('Künstlerseite wird geladen …');
  } else if (status === 'error') {
    body = h('div', { class: 'notice warn' }, state.error, ' ', h('button', { class: 'link-btn', onclick: () => { loadArtist(state); renderArtist(); } }, 'Erneut versuchen'));
  } else if (status === 'unsupported') {
    body = h('div', { class: 'notice' }, `Künstlerseiten zeigt ${provider.name} nur im eigenen Fenster. Öffne sie dort – oder such hier nach Songs von ${item.name}.`);
  } else {
    body = [];
    if (tracks.length) {
      body.push(h('h2', { class: 'section-title first' }, 'Beliebte Songs'),
        // Abspielen über Moonifys Warteschlange: der Reihe nach durch die beliebten Songs
        trackList(tracks.slice(0, 10), { provider: 'moonify', kind: 'artist', id: item.id }, { numbered: true }));
    }
    for (const [key, title] of [['albums', 'Alben & Singles'], ['playlists', 'Playlists'], ['related', 'Ähnliche Künstler']]) {
      if (data[key]?.length) body.push(h('h2', { class: 'section-title' }, title), cardRow(data[key].slice(0, 20)));
    }
    if (!body.length) body = emptyState('Nichts gefunden', 'Zu diesem Künstler gibt es hier gerade keine Songs.');
  }
  $('view-artist').replaceChildren(page(backButton(), header, body));
}

/* ---------- Erkunden & Seiten von YouTube Music ---------- */

let exploreState = null; // „Erkunden“ (FEmusic_explore)
let browseState = null; // geöffnete Seite wie Charts, Neuerscheinungen, Genre …
let homeFeed = null; // Startseite von YouTube Music

/** Link auf eine YT-Music-Seite öffnen – Playlists, Alben und Künstler in Moonifys eigenen Ansichten. */
function openBrowseLink(link, title = '') {
  const id = String(link.browseId || '');
  if (id.startsWith('VL')) {
    openCollection({ provider: 'ytmusic', kind: 'playlist', id, name: title || 'Playlist', subtitle: 'YouTube Music', image: '', ref: { browseId: id, playlistId: id.slice(2) } });
  } else if (id.startsWith('MPRE')) {
    openCollection({ provider: 'ytmusic', kind: 'album', id, name: title || 'Album', subtitle: '', image: '', ref: { browseId: id, playlistId: '' } });
  } else if (id.startsWith('UC')) {
    openArtist({ provider: 'ytmusic', kind: 'artist', id, name: title, subtitle: 'Künstler', image: '', ref: { browseId: id } });
  } else {
    const state = { browseId: id, params: link.params || '', title, status: 'loading', data: null, error: '' };
    showView({ kind: 'browse', state });
    loadBrowse(state);
  }
}

async function loadBrowse(state) {
  state.status = 'loading';
  try {
    state.data = parseYtmBrowse(await request('ytmusic', { type: 'browse', browseId: state.browseId, params: state.params }));
    state.status = 'done';
    state.loadedAt = Date.now();
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
  }
  if (view.kind === 'browse' && browseState === state) renderBrowse();
  if (view.kind === 'explore' && exploreState === state) renderExplore();
}

function openExplore() {
  const stale = exploreState && exploreState.status !== 'loading' && Date.now() - (exploreState.loadedAt || 0) > 10 * 60 * 1000;
  if (!exploreState || stale || exploreState.status === 'error') {
    exploreState = { browseId: 'FEmusic_explore', params: '', title: 'Erkunden', status: 'idle', data: null, error: '' };
  }
  showView({ kind: 'explore', state: exploreState });
  if (exploreState.status === 'idle' && settings.enabled.ytmusic) loadBrowse(exploreState);
}

function browseBody(state) {
  if (!state || state.status === 'loading' || state.status === 'idle') return spinner('Wird geladen …');
  if (state.status === 'error') {
    return h('div', { class: 'notice warn' }, `YouTube Music: ${state.error} `,
      h('button', { class: 'link-btn', onclick: () => loadBrowse(state) }, 'Erneut versuchen'));
  }
  if (!state.data.sections.length) return emptyState('Nichts gefunden', 'YouTube Music hat hier gerade nichts geliefert.');
  return browseSections(state.data.sections);
}

function renderExplore() {
  const root = $('view-explore');
  const head = [h('h1', { class: 'page-title' }, 'Erkunden'), h('p', { class: 'section-sub' }, 'Neuerscheinungen, Charts, Stimmungen & Genres und was gerade angesagt ist – von YouTube Music.')];
  if (!settings.enabled.ytmusic) {
    root.replaceChildren(page(head, emptyState('YouTube Music verbinden', '„Erkunden“ kommt von YouTube Music. Verbinde YouTube Music in den Einstellungen – eine Anmeldung ist dafür nicht nötig.', true)));
    return;
  }
  root.replaceChildren(page(head, browseBody(exploreState)));
}

function renderBrowse() {
  const state = browseState;
  if (!state) return;
  $('view-browse').replaceChildren(page(backButton(), h('h1', { class: 'page-title' }, state.data?.title || state.title || 'YouTube Music'), browseBody(state)));
}

/** Song-Kachel (z. B. Musikvideos) mit Abspiel-Knopf. */
function trackCard(track) {
  const provider = getProvider(track.provider);
  const wide = /ytimg\.com\/vi\//.test(track.image);
  const play = () => {
    if (!canPlay(track)) {
      toast(`${provider.name} ist nicht verbunden – in den Einstellungen verbinden.`, 'error');
      return;
    }
    playTrack(track);
  };
  return h('div', {
    class: `collection-card track-card${wide ? ' wide' : ''}`,
    style: `--brand:${provider.color}`,
    role: 'button',
    tabindex: '0',
    title: track.title,
    onclick: play,
    onkeydown: (e) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) play();
    },
    oncontextmenu: (e) => {
      e.preventDefault();
      trackMenu(e.currentTarget, track, null);
    },
  },
  h('div', { class: 'cc-art' }, art(track.image), h('button', {
    class: 'cc-play',
    title: 'Abspielen',
    'aria-label': `${track.title} abspielen`,
    html: icons.play,
    onclick: (e) => {
      e.stopPropagation();
      play();
    },
  })),
  h('div', { class: 'cc-name' }, track.title),
  h('div', { class: 'cc-sub' }, track.artist || provider.name));
}

/** Lange Songlisten erst gekürzt zeigen – „Alle anzeigen“ klappt sie auf. */
function expandableTracks(section) {
  const limit = 8;
  const wrap = h('div', { class: 'expandable' });
  const fill = (all) => {
    const shown = all ? section.tracks : section.tracks.slice(0, limit);
    wrap.replaceChildren(
      trackList(shown, null, { numbered: section.tracks.some((t) => t.rank) }),
      section.tracks.length > limit && !section.more
        ? h('button', { class: 'link-btn more-btn', onclick: () => fill(!all) }, all ? 'Weniger anzeigen' : `Alle ${section.tracks.length} anzeigen`)
        : null,
    );
  };
  fill(false);
  return wrap;
}

/** Abschnitte einer YT-Music-Seite: Kacheln, Songlisten, Navigation (Genres, Charts …). */
function browseSections(sections) {
  return sections.map((section) => {
    const parts = [];
    if (section.title) {
      parts.push(h('div', { class: 'section-head spaced' },
        h('h2', {}, section.title),
        section.more ? h('button', { class: 'link-btn', onclick: () => openBrowseLink(section.more, section.title) }, 'Alle anzeigen') : null));
    }
    if (section.nav.length) {
      parts.push(h('div', { class: 'nav-tiles' }, section.nav.map((n) => h('button', {
        class: 'nav-tile',
        style: n.color ? `--tile:${n.color}` : '',
        onclick: () => openBrowseLink(n, n.label),
      }, n.label))));
    }
    if (section.tracks.length) parts.push(section.layout === 'cards' ? h('div', { class: 'card-row' }, section.tracks.map(trackCard)) : expandableTracks(section));
    if (section.items.length) parts.push(cardRow(section.items));
    return h('section', { class: 'browse-section' }, parts);
  });
}

/** Startseite von YouTube Music (persönlich, wenn angemeldet) – höchstens alle 30 Minuten neu. */
function loadHomeFeed() {
  if (!settings.enabled.ytmusic) return;
  if (homeFeed && (homeFeed.status === 'loading' || Date.now() - homeFeed.at < (homeFeed.status === 'error' ? 60 * 1000 : 30 * 60 * 1000))) return;
  homeFeed = { status: 'loading', data: null, at: Date.now() };
  const entry = homeFeed;
  request('ytmusic', { type: 'browse', browseId: 'FEmusic_home' })
    .then((json) => {
      entry.data = parseYtmBrowse(json);
      entry.status = 'done';
    })
    .catch(() => {
      entry.status = 'error';
    })
    .finally(() => {
      if (view.kind === 'home') renderHomeShelf();
    });
}

/* ---------- Jetzt läuft: Als Nächstes, Songtext, Ähnliche Titel ---------- */

const NOW_TABS = [
  { id: 'queue', label: 'Als Nächstes' },
  { id: 'lyrics', label: 'Songtext' },
  { id: 'related', label: 'Ähnlich' },
];
let nowTab = 'queue';
const ytNext = new Map(); // „next“-Antworten von YouTube Music je Song
const ytRelated = new Map(); // „Ähnliche Titel“ je Seite
const likeOverrides = new Map(); // eigene Bewertungen (Daumen), bis YouTube sie bestätigt

function openNowPlaying(tab = nowTab) {
  nowTab = tab;
  if (view.kind === 'nowplaying') renderNowPlaying();
  else showView({ kind: 'nowplaying' });
}

/** Knöpfe der Playerleiste: gleicher Reiter schon offen → zurück, sonst dorthin. */
function toggleNowPlaying(tab) {
  if (view.kind === 'nowplaying' && nowTab === tab) goBack();
  else openNowPlaying(tab);
}

function renderNowPlayingIfVisible(tab = null) {
  if (view.kind === 'nowplaying' && (!tab || nowTab === tab)) renderNowPlaying();
}

/** Läuft gerade etwas über YouTube Music (mit bekannter Video-ID)? */
function currentYtSong() {
  const c = hub.current();
  return c?.id === 'ytmusic' && c.videoId ? c : null;
}

/** „next“ für einen YouTube-Music-Song laden – einmal je Song. */
function ensureYtNext(c = currentYtSong()) {
  if (!c) return null;
  // Läuft ein einzelner Song, spielt YouTube Music danach sein Radio zu diesem Song
  const playlistId = c.playlistId || `RDAMVM${c.videoId}`;
  const key = `${c.videoId}|${playlistId}`;
  let entry = ytNext.get(key);
  // Nach einem Fehler erst nach 30 Sekunden neu fragen (sonst fragt jedes Neuzeichnen erneut)
  if (entry?.status === 'error' && Date.now() - entry.at > 30 * 1000) entry = null;
  if (!entry) {
    entry = { status: 'loading', data: null, error: '', at: Date.now() };
    ytNext.set(key, entry);
    if (ytNext.size > 30) ytNext.delete(ytNext.keys().next().value);
    entry.promise = request('ytmusic', { type: 'next', videoId: c.videoId, playlistId })
      .then((json) => {
        entry.data = parseYtmNext(json);
        entry.status = 'done';
      })
      .catch((err) => {
        entry.status = 'error';
        entry.error = err.message;
        entry.at = Date.now();
      })
      .finally(() => renderNowPlayingIfVisible());
  }
  return entry;
}

/** Der laufende Song als Moonify-Song (für Herz, Menü, Radio, Link). */
function currentAsTrack() {
  const known = currentKnownTrack();
  if (known) return known;
  const yt = currentYtSong();
  if (!yt) return null;
  return { provider: 'ytmusic', kind: 'track', id: yt.videoId, title: yt.title, artist: yt.artist, album: yt.album, duration: yt.duration, image: yt.artwork, ref: { videoId: yt.videoId } };
}

function renderNowPlaying() {
  const root = $('view-nowplaying');
  const panelScroll = root.querySelector('.np-panel')?.scrollTop || 0;
  const sameTab = root.dataset.tab === nowTab;
  root.dataset.tab = nowTab;
  const current = hub.current();
  const provider = current ? getProvider(current.id) : null;
  const track = currentAsTrack();
  const left = current
    ? h('div', { class: 'np-left' },
      h('div', { class: 'np-art' }, art(current.artwork)),
      h('div', { class: 'np-title' }, current.title || 'Unbekannter Titel'),
      h('div', { class: 'np-artist' },
        track?.artistLink
          ? h('button', { class: 'link-btn', onclick: () => openArtist(track.artistLink) }, current.artist || track.artistLink.name)
          : current.artist || current.album || ''),
      h('div', { class: 'np-meta' }, providerTag(provider), current.album && current.album !== current.artist ? h('span', {}, current.album) : null),
      h('div', { class: 'np-actions' }, nowActions(current, track)))
    : h('div', { class: 'np-left' }, emptyState('Nichts läuft gerade', 'Such dir einen Song aus oder stöbere unter „Erkunden“.'));
  const tabs = h('div', { class: 'type-tabs np-tabs', role: 'tablist' }, NOW_TABS.map((t) => h('button', {
    class: `type-tab${nowTab === t.id ? ' active' : ''}`,
    role: 'tab',
    'aria-selected': String(nowTab === t.id),
    onclick: () => openNowPlaying(t.id),
  }, t.label)));
  const body = nowTab === 'lyrics' ? lyricsContent() : nowTab === 'related' ? relatedContent() : queueContent();
  const panel = h('div', { class: 'np-panel' }, body);
  root.replaceChildren(h('div', { class: 'np-layout' }, left, h('div', { class: 'np-right' }, tabs, panel)));
  if (nowTab === 'lyrics') {
    lyrics.lineIndex = -1;
    updateLyricsLine(true);
  } else if (sameTab) {
    panel.scrollTop = panelScroll;
  }
}

function nowActions(current, track) {
  const actions = [];
  if (track) actions.push(heartButton(track, 'np-heart'));
  if (current.id === 'ytmusic' && current.videoId && loginStatus.ytmusic) actions.push(...likeButtons(current));
  if (track) {
    actions.push(h('button', { class: 'btn ghost small', html: `${icons.radio}<span>Radio starten</span>`, onclick: () => startRadio(track) }));
  }
  if (current.id === 'ytmusic') {
    actions.push(h('button', { class: 'btn ghost small', html: `${icons.video}<span>Video ansehen</span>`, onclick: () => api.engines.show('ytmusic') }));
  }
  if (track) {
    actions.push(h('button', {
      class: 'icon-btn',
      title: 'Mehr',
      'aria-label': 'Mehr Optionen',
      html: icons.more,
      onclick: (e) => trackMenu(e.currentTarget, track, null),
    }));
  }
  return actions;
}

function likeButtons(c) {
  const entry = ensureYtNext(c);
  const status = likeOverrides.get(c.videoId) || entry?.data?.likeStatus || 'INDIFFERENT';
  const make = (value, icon, label) => h('button', {
    class: `icon-btn np-like${status === value ? ' active' : ''}`,
    title: label,
    'aria-label': label,
    'aria-pressed': String(status === value),
    html: icon,
    onclick: () => rate(c.videoId, status === value ? 'INDIFFERENT' : value),
  });
  return [make('LIKE', icons.thumbUp, 'Mag ich'), make('DISLIKE', icons.thumbDown, 'Mag ich nicht')];
}

/** Daumen hoch/runter bei YouTube Music (landet dort in „Mag ich“). */
async function rate(videoId, status) {
  const action = { LIKE: 'like', DISLIKE: 'dislike', INDIFFERENT: 'none' }[status];
  const before = likeOverrides.get(videoId);
  likeOverrides.set(videoId, status);
  renderNowPlayingIfVisible();
  try {
    await request('ytmusic', { type: 'like', action, videoId });
    if (status === 'LIKE') toast('Bei YouTube Music zu „Mag ich“ hinzugefügt 👍', 'ok');
  } catch (err) {
    if (before) likeOverrides.set(videoId, before);
    else likeOverrides.delete(videoId);
    renderNowPlayingIfVisible();
    toast(`YouTube Music: ${err.message}`, 'error');
  }
}

/* Als Nächstes */

function moonifyQueueContent() {
  const current = queue.current();
  const upcoming = queue.upcoming();
  const sections = [h('h2', { class: 'section-title first' }, 'Läuft gerade'), trackList([current])];
  sections.push(h('div', { class: 'section-head spaced' },
    h('h2', {}, `Als Nächstes (${upcoming.length})`),
    upcoming.length > 1 ? h('button', { class: 'link-btn', onclick: () => {
      queue.shuffleUpcoming();
      toast('Warteschlange gemischt 🔀', 'ok');
    } }, 'Mischen') : null,
    upcoming.length ? h('button', { class: 'link-btn', onclick: () => {
      queue.items = [current];
      queue.index = 0;
      queue.changed();
    } }, 'Leeren') : null));
  if (upcoming.length) {
    const list = trackList(upcoming, { provider: 'moonify', kind: 'queue', id: 'queue' });
    // Entfernen-Knopf je Zeile
    [...list.children].forEach((row, i) => {
      row.append(h('button', {
        class: 'icon-btn tr-remove',
        title: 'Aus der Warteschlange entfernen',
        'aria-label': 'Aus der Warteschlange entfernen',
        html: icons.close,
        onclick: (e) => {
          e.stopPropagation();
          queue.remove(i);
        },
      }));
    });
    sections.push(list);
  } else {
    sections.push(h('p', { class: 'section-sub' }, 'Danach ist Schluss – oder der Dienst spielt von selbst weiter.'));
  }
  return sections;
}

function queueContent() {
  // Eigene Warteschlange zeigen, sobald darin etwas ansteht – sonst die des Dienstes
  if (queue.current() && queue.upcoming().length) return moonifyQueueContent();
  const yt = currentYtSong();
  if (yt) {
    const entry = ensureYtNext(yt);
    if (entry.status === 'loading') return spinner('Als Nächstes wird geladen …');
    if (entry.status === 'error') {
      return h('div', { class: 'notice warn' }, `YouTube Music: ${entry.error} `,
        h('button', { class: 'link-btn', onclick: () => {
          entry.at = 0; // sofort neu laden
          renderNowPlaying();
        } }, 'Erneut versuchen'));
    }
    const { tracks, playlistId } = entry.data;
    if (!tracks.length) return emptyState('Nichts in Sicht', 'YouTube Music hat gerade keine nächsten Songs geliefert.');
    const listId = playlistId || yt.playlistId;
    const context = listId ? { provider: 'ytmusic', kind: 'playlist', id: listId, ref: { playlistId: listId } } : null;
    return [h('p', { class: 'np-hint' }, 'Von YouTube Music – läuft von selbst weiter. Ein Klick springt zu einem Song.'), trackList(tracks, context)];
  }
  const playing = hub.current();
  if (playing) {
    return emptyState('Der Dienst entscheidet', `${getProvider(playing.id).name} spielt von selbst weiter. Über „⋯“ bei einem Song („Als Nächstes spielen“) stellst du dir hier eine eigene Reihenfolge zusammen.`);
  }
  return emptyState('Die Warteschlange ist leer', 'Spiele eine Playlist ab oder wähle bei einem Song „Zur Warteschlange hinzufügen“.');
}

/* Ähnliche Titel */

function relatedContent() {
  const yt = currentYtSong();
  if (!yt) {
    return emptyState('Ähnliche Titel', hub.current()
      ? 'Ähnliche Titel liefert YouTube Music – starte über „⋯ → Radio starten“ ein Radio zu diesem Song, dann erscheinen sie hier.'
      : 'Starte einen Song, dann erscheinen hier ähnliche Titel.');
  }
  const entry = ensureYtNext(yt);
  if (entry.status === 'loading') return spinner('Ähnliche Titel werden geladen …');
  const id = entry.data?.relatedId;
  const none = () => emptyState('Keine ähnlichen Titel', 'YouTube Music hat zu diesem Song nichts Ähnliches geliefert. Unter „Als Nächstes“ findest du das Radio zum Song.');
  if (!id) return none();
  let related = ytRelated.get(id);
  if (related?.status === 'error' && Date.now() - related.at > 30 * 1000) related = null;
  if (!related) {
    related = { status: 'loading', data: null, at: Date.now() };
    ytRelated.set(id, related);
    if (ytRelated.size > 20) ytRelated.delete(ytRelated.keys().next().value);
    request('ytmusic', { type: 'browse', browseId: id })
      .then((json) => {
        related.data = parseYtmBrowse(json);
        related.status = 'done';
      })
      .catch(() => {
        related.status = 'error';
        related.at = Date.now();
      })
      .finally(() => renderNowPlayingIfVisible('related'));
  }
  if (related.status === 'loading') return spinner('Ähnliche Titel werden geladen …');
  if (related.status === 'error' || !related.data.sections.length) return none();
  return browseSections(related.data.sections);
}

/* Radio & Teilen */

const radioContext = (videoId) => ({ provider: 'ytmusic', kind: 'playlist', id: `RDAMVM${videoId}`, name: 'Radio', ref: { playlistId: `RDAMVM${videoId}` } });

/** Radio zu einem Song – über YouTube Music, auch für Songs anderer Dienste. */
async function startRadio(track) {
  if (!settings.enabled.ytmusic) {
    toast('Das Radio kommt von YouTube Music – verbinde YouTube Music in den Einstellungen (ohne Anmeldung möglich).', 'error');
    return;
  }
  let seed = track.provider === 'ytmusic' ? track : null;
  if (!seed) {
    toast(`Radio zu „${track.title}“ wird bei YouTube Music gesucht …`);
    try {
      const found = parseYtmTracks(await request('ytmusic', { type: 'search', query: `${track.title} ${track.artist}`.trim() }));
      seed = found.find((t) => titlesMatch(track.title, t.title)) || found[0] || null;
    } catch {
      seed = null;
    }
    if (!seed) {
      toast('Dazu hat YouTube Music kein Radio gefunden.', 'error');
      return;
    }
  }
  playTrack(seed, radioContext(seed.ref?.videoId || seed.id));
}

function shareUrl(track) {
  if (track.provider === 'ytmusic') return `https://music.youtube.com/watch?v=${encodeURIComponent(track.ref?.videoId || track.id)}`;
  if (track.provider === 'spotify') return `https://open.spotify.com/track/${encodeURIComponent(track.id)}`;
  if (track.provider === 'amazon' && track.ref?.deeplink) return `https://${AMAZON_REGIONS[settings.amazonRegion]?.host || 'music.amazon.de'}${track.ref.deeplink}`;
  return '';
}

async function copyLink(track) {
  const url = shareUrl(track);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const area = h('textarea', { style: 'position:fixed;opacity:0' });
    area.value = url;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('Link kopiert – du kannst ihn jetzt teilen.', 'ok');
}

/* ---------- Songtexte ---------- */

const lyricsKey = (current) => (current?.title ? `${current.title}\n${current.artist}` : '');

/** Bei jedem Songwechsel im Hintergrund nach einem Songtext suchen. */
function watchLyrics() {
  const current = hub.current();
  const key = lyricsKey(current);
  if (key === lyrics.key) return;
  clearTimeout(lyrics.timer);
  Object.assign(lyrics, {
    key,
    song: current ? { id: current.id, title: current.title, artist: current.artist, artwork: current.artwork } : null,
    status: key ? 'loading' : 'idle',
    data: null,
    lineIndex: -1,
  });
  // Kurz warten: beim Songwechsel kommen Titel, Künstler und Länge oft nacheinander an
  if (key) lyrics.timer = setTimeout(() => loadLyrics(key), 800);
  renderLyricsButton();
  renderNowPlayingIfVisible('lyrics');
}

/** Songtext direkt von YouTube Music (ohne Zeitangaben) – wenn LRCLIB nichts hat. */
async function ytLyrics(c) {
  if (c?.id !== 'ytmusic' || !c.videoId) return null;
  const entry = ensureYtNext(c);
  await entry.promise;
  if (!entry.data?.lyricsId) return null;
  try {
    return parseYtmLyrics(await request('ytmusic', { type: 'browse', browseId: entry.data.lyricsId }));
  } catch {
    return null;
  }
}

async function loadLyrics(key, attempt = 0) {
  const current = hub.current();
  if (lyricsKey(current) !== key) return;
  let response;
  try {
    response = await api.lyrics({ title: current.title, artist: current.artist, duration: current.duration });
  } catch {
    response = { ok: false };
  }
  if (lyrics.key !== key) return; // inzwischen läuft ein anderer Song
  if (response?.ok && response.lyrics) {
    const data = response.lyrics;
    lyrics.data = data;
    lyrics.status = data.instrumental && !data.plain ? 'instrumental' : 'found';
  } else {
    // LRCLIB hat nichts (oder ist nicht erreichbar) – bei YouTube Music dort nachsehen
    const yt = await ytLyrics(hub.current());
    if (lyrics.key !== key) return;
    if (yt) {
      lyrics.data = { synced: null, plain: yt.text, source: 'YouTube Music', credit: yt.source };
      lyrics.status = 'found';
    } else if (response?.ok) {
      lyrics.status = 'none';
    } else {
      lyrics.status = 'error';
      // Kein Netz oder LRCLIB überlastet: später noch einmal versuchen
      if (attempt < 2) lyrics.timer = setTimeout(() => loadLyrics(key, attempt + 1), 15000 * (attempt + 1));
    }
  }
  renderLyricsButton();
  renderNowPlayingIfVisible('lyrics');
}

/** Der Mikrofon-Knopf erscheint nur, wenn es zum Song einen Songtext gibt. */
function renderLyricsButton() {
  const button = $('btn-lyrics');
  const open = view.kind === 'nowplaying' && nowTab === 'lyrics';
  button.hidden = !(open || lyrics.status === 'found');
  button.classList.toggle('active', open);
  button.title = open ? 'Songtext schließen' : 'Songtext';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(open));
  const queueOpen = view.kind === 'nowplaying' && nowTab === 'queue';
  $('btn-queue').classList.toggle('active', queueOpen);
  $('btn-queue').setAttribute('aria-pressed', String(queueOpen));
}

function lyricsContent() {
  const { song, status, data } = lyrics;
  if (!song) return emptyState('Nichts läuft gerade', 'Starte einen Song – gibt es einen Songtext dazu, erscheint er hier.');
  if (status === 'loading' || status === 'idle') return spinner('Songtext wird gesucht …');
  if (status === 'error') {
    return h('div', { class: 'notice warn' }, 'Songtexte sind gerade nicht erreichbar. ',
      h('button', { class: 'link-btn', onclick: () => {
        lyrics.status = 'loading';
        renderNowPlaying();
        loadLyrics(lyrics.key, 2);
      } }, 'Erneut versuchen'));
  }
  if (status === 'instrumental') return emptyState('Instrumental', 'Dieser Song hat keinen Gesang – einfach zurücklehnen und zuhören.');
  if (status === 'none') return emptyState('Kein Songtext gefunden', 'Zu diesem Song gibt es leider noch keinen Songtext.');
  const body = data.synced
    ? h('div', { class: 'lyric-lines' }, ...data.synced.map((line) => h('p', {
      class: `lyric-line${line.text ? '' : ' gap'}`,
      onclick: () => seekTo(line.time),
    }, line.text || '♪')))
    : h('div', { class: 'lyrics-plain' }, data.plain);
  const credit = data.source === 'YouTube Music'
    ? `Songtext von YouTube Music${data.credit ? ` · ${data.credit}` : ''}`
    : data.synced ? 'Songtext von LRCLIB · Klick auf eine Zeile springt dorthin' : 'Songtext von LRCLIB';
  return [body, h('p', { class: 'lyrics-source' }, credit)];
}

/** Hebt die Zeile hervor, die gerade gesungen wird, und scrollt mit. */
function updateLyricsLine(jump = false) {
  if (view.kind !== 'nowplaying' || nowTab !== 'lyrics' || lyrics.status !== 'found' || !lyrics.data?.synced) return;
  const current = hub.current();
  if (lyricsKey(current) !== lyrics.key) return;
  const index = activeLineIndex(lyrics.data.synced, current.position);
  if (index === lyrics.lineIndex && !jump) return;
  lyrics.lineIndex = index;
  const nodes = $('view-nowplaying').querySelectorAll('.lyric-line');
  nodes.forEach((node, i) => {
    node.classList.toggle('active', i === index);
    node.classList.toggle('past', i < index);
  });
  // Hat man gerade selbst gescrollt, nicht dazwischenfunken
  if (nodes[index] && Date.now() - lyrics.userScrollAt > 4000) {
    nodes[index].scrollIntoView({ block: 'center', behavior: jump ? 'auto' : 'smooth' });
  }
}

/* ---------- Startseite ---------- */

function emptyState(title, text, withSettings = false) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-moon', html: moonSvg({ lit: 0.3 }) }),
    h('h2', {}, title),
    h('p', {}, text),
    withSettings ? h('button', { class: 'btn primary', onclick: () => showView({ kind: 'settings' }) }, 'Zu den Einstellungen') : null);
}

function page(...children) {
  return h('div', { class: 'page' }, ...children);
}

function renderHome() {
  const root = $('view-home');
  const list = connected();
  const phase = lunarPhase();
  const hero = h('div', { class: 'hero' },
    h('div', { class: 'hero-text' },
      h('p', { class: 'eyebrow', html: `${icons.sparkle}<span></span>` }),
      h('h1', {}, greeting()),
      h('p', { class: 'hero-sub' }, list.length
        ? 'All deine Musik unter einem Himmel.'
        : 'Willkommen bei Moonify – verbinde deine Musikdienste und hör alles an einem Ort.')),
    h('div', { class: 'hero-moon', html: moonSvg({ lit: phase.lit, waxing: phase.waxing, className: 'big' }) }));
  hero.querySelector('.eyebrow span').textContent = `${phase.name} · ${Math.round(phase.lit * 100)} % beleuchtet`;

  const nowCard = h('div', { class: 'now-card', id: 'home-now', hidden: true },
    h('div', { class: 'now-card-art', id: 'home-now-art' }),
    h('div', { class: 'now-card-text' },
      h('small', { id: 'home-now-label' }, 'Jetzt läuft'),
      h('div', { class: 'now-card-title', id: 'home-now-title' }),
      h('div', { class: 'now-card-artist', id: 'home-now-artist' })));

  const sections = [hero, nowCard];
  if (list.length) {
    sections.push(
      h('div', { class: 'quick-actions' },
        h('button', { class: 'quick', onclick: () => showView({ kind: 'search' }) }, h('span', { html: icons.search }), h('strong', {}, 'Suchen'), h('small', {}, 'In allen Diensten gleichzeitig')),
        h('button', { class: 'quick', onclick: () => showView({ kind: 'library' }) }, h('span', { html: icons.library }), h('strong', {}, 'Bibliothek'), h('small', {}, 'Playlists & Lieblingssongs')),
        h('button', { class: 'quick', onclick: () => showView({ kind: 'settings' }) }, h('span', { html: icons.settings }), h('strong', {}, 'Dienste'), h('small', {}, list.map((p) => p.short).join(' · ')))),
      h('div', { id: 'home-shelf' }),
    );
  } else {
    sections.push(
      h('h2', { class: 'section-title' }, 'Womit hörst du Musik?'),
      h('p', { class: 'section-sub' }, 'Wähle einen oder mehrere Dienste. Keiner ist Pflicht – du meldest dich in einem eigenen Fenster an, die Musik erscheint dann direkt hier in Moonify.'),
      h('div', { class: 'provider-grid' },
        PROVIDERS.map((p) =>
          h('div', { class: 'provider-card onboarding', style: `--brand:${p.color}` },
            h('div', { class: 'card-glow' }),
            providerBadge(p, 'large'),
            h('div', { class: 'card-name' }, p.name),
            h('div', { class: 'card-hint' }, p.description),
            h('button', { class: 'btn primary', onclick: () => connectProvider(p.id) }, 'Verbinden')))),
    );
  }
  root.replaceChildren(page(sections));
  renderHomeShelf();
  loadHomeFeed();
  renderPlayer(true);
  for (const provider of list) if (provider.library && loginStatus[provider.id] && !library[provider.id]) loadLibrary(provider.id);
}

function renderHomeShelf() {
  const shelf = $('home-shelf');
  if (!shelf) return;
  const parts = [];
  const recent = store.data.history.slice(0, 5);
  if (recent.length) {
    parts.push(h('div', { class: 'section-head spaced' }, h('h2', {}, 'Zuletzt gehört'),
      h('button', { class: 'link-btn', onclick: () => openCollection({ provider: 'moonify', kind: 'history', id: 'history', name: 'Zuletzt gehört' }) }, 'Alle anzeigen')),
    trackList(recent, { provider: 'moonify', kind: 'history', id: 'history' }));
  }
  const own = moonifyItems().filter((i) => i.kind !== 'history' && (i.kind !== 'favorites' || store.data.favorites.length));
  const saved = store.data.saved.slice(0, 6);
  const items = interleave(connected().map((p) => (library[p.id]?.status === 'done' ? library[p.id].items : []))).slice(0, 10);
  if (own.length || saved.length || items.length) {
    parts.push(h('h2', { class: 'section-title' }, 'Deine Musik'), h('div', { class: 'collection-grid' }, own.map(moonifyCard), saved.map(collectionCard), items.map(collectionCard)));
  }
  if (settings.enabled.ytmusic && homeFeed?.status === 'done' && homeFeed.data.sections.length) {
    parts.push(h('div', { class: 'section-head spaced' }, h('h2', {}, 'Von YouTube Music'),
      h('button', { class: 'link-btn', onclick: openExplore }, 'Erkunden')),
    browseSections(homeFeed.data.sections.slice(0, 8)));
  }
  shelf.replaceChildren(...parts);
}

/* ---------- Einstellungen ---------- */

function renderSettings() {
  const root = $('view-settings');
  const notices = [];
  if (!isDesktop) notices.push(h('div', { class: 'notice' }, 'Das ist die Browser-Vorschau. Die Musikdienste laufen nur in der Moonify-Desktop-App.'));
  else if (!info.widevine) notices.push(h('div', { class: 'notice warn' }, 'Diese Moonify-Version enthält kein Widevine. Spotify und Amazon Music brauchen das für die Wiedergabe.'));

  const cards = PROVIDERS.map((p) => {
    const on = settings.enabled[p.id];
    const status = statusOf(p);
    const loggedIn = loginStatus[p.id];
    const actions = !on
      ? [h('button', { class: 'btn primary', html: `${icons.login}<span>Verbinden</span>`, onclick: () => connectProvider(p.id) })]
      : [
        loggedIn ? null : h('button', { class: 'btn primary', html: `${icons.login}<span>Anmelden</span>`, onclick: () => api.engines.show(p.id, { login: true }) }),
        h('button', { class: 'btn ghost', html: `${icons.window}<span>Im Fenster öffnen</span>`, onclick: () => api.engines.show(p.id) }),
        h('button', { class: 'btn ghost', onclick: () => disconnectProvider(p.id) }, 'Trennen'),
      ];
    const notes = [];
    if (p.id === 'ytmusic') notes.push('Suchen und Hören klappt auch ohne Anmeldung – für Playlists und Lieblingssongs bitte anmelden.');
    if (p.id === 'amazon') notes.push('Suchen und Abspielen klappt, die Bibliothek kann Moonify noch nicht anzeigen.');
    if (on && engineState[p.id]?.error) notes.push(`Fehler: ${engineState[p.id].error}`);
    let extra = null;
    if (p.id === 'amazon') {
      extra = h('label', { class: 'field' }, h('span', {}, 'Region'),
        h('select', { class: 'select', 'aria-label': 'Amazon-Music-Region', onchange: (e) => setAmazonRegion(e.target.value) },
          Object.entries(AMAZON_REGIONS).map(([key, region]) =>
            h('option', { value: key, selected: key === settings.amazonRegion }, `${region.label} (${region.host})`))));
    }
    return h('article', { class: `manage-card${on ? ' on' : ''}`, style: `--brand:${p.color}` },
      providerBadge(p, 'large'),
      h('div', { class: 'manage-body' },
        h('div', { class: 'manage-head' }, h('h3', {}, p.name), h('span', { class: `pill ${status.cls}` }, status.text)),
        h('p', {}, p.description),
        notes.map((n) => h('p', { class: 'note' }, n)),
        extra),
      h('div', { class: 'manage-actions' }, actions));
  });

  root.replaceChildren(page(
    h('h1', { class: 'page-title' }, 'Einstellungen'),
    h('h2', { class: 'section-title first' }, 'Musikdienste'),
    h('p', { class: 'section-sub' }, 'Verbinde nur, was du nutzt. Die Anmeldung öffnet sich in einem eigenen Fenster – im Hauptfenster siehst du nur Moonify. Die Dienste laufen unsichtbar im Hintergrund und spielen die Musik ab.'),
    notices,
    h('div', { class: 'manage-list' }, cards),
    h('h2', { class: 'section-title' }, 'Updates'),
    h('div', { id: 'update-card' }),
    h('h2', { class: 'section-title' }, 'Über Moonify'),
    h('div', { class: 'about' },
      h('div', { class: 'about-moon', html: moonSvg({ lit: 0.72 }) }),
      h('div', {},
        h('strong', {}, `Moonify ${info.version || ''}`),
        h('p', {}, `Widevine (für Spotify & Amazon): ${info.widevineReady ? 'aktiv' : info.widevine ? 'wird geladen' : 'nicht verfügbar'}`),
        h('button', { class: 'link-btn', onclick: () => api.openExternal('https://github.com/Luna-OS/moonify') }, 'Moonify auf GitHub'))),
  ));
  renderUpdateCard();
}

function renderUpdateCard() {
  const card = $('update-card');
  if (!card) return;
  const s = updateStatus || { state: 'idle' };
  const check = () => api.updates.check();
  const button = (label, onclick, primary = false, icon = '') =>
    h('button', { class: `btn ${primary ? 'primary' : 'ghost'}`, html: `${icon}<span>${label}</span>`, onclick });
  let line;
  let actions = [];
  switch (s.state) {
    case 'checking':
      line = [h('span', { class: 'inline-spin', html: moonSvg({ lit: 0.5, glow: false }) }), 'Suche nach Updates …'];
      break;
    case 'downloading':
      line = [`Version ${s.version || ''} wird heruntergeladen … ${s.percent || 0} %`, h('div', { class: 'bar' }, h('div', { style: `width:${s.percent || 0}%` }))];
      break;
    case 'ready':
      line = [h('strong', {}, `Version ${s.version} ist bereit.`), ' Moonify startet kurz neu, um sie zu installieren.'];
      actions = [button('Jetzt neu starten', () => api.updates.install(), true, icons.reload)];
      break;
    case 'available':
      line = [h('strong', {}, `Version ${s.version} ist verfügbar.`), ' Die neue Datei wird im Browser heruntergeladen – danach einfach installieren.'];
      actions = [button('Herunterladen', () => api.updates.install(), true, icons.download), button('Erneut prüfen', check)];
      break;
    case 'none':
      line = [h('span', { class: 'ok-text', html: icons.check }), 'Du hast die neueste Version.'];
      actions = [button('Nach Updates suchen', check, false, icons.reload)];
      break;
    case 'error':
      line = [`Update-Prüfung fehlgeschlagen: ${s.message || 'unbekannter Fehler'}`];
      actions = [button('Erneut versuchen', check, true, icons.reload), button('Releases öffnen', () => api.openExternal('https://github.com/Luna-OS/moonify/releases/latest'))];
      break;
    case 'dev':
      line = ['Updates gibt es nur in der installierten App.'];
      actions = [button('Releases öffnen', () => api.openExternal('https://github.com/Luna-OS/moonify/releases/latest'))];
      break;
    default:
      line = ['Prüfe, ob es eine neue Moonify-Version gibt.'];
      actions = [button('Nach Updates suchen', check, true, icons.reload)];
  }
  card.replaceChildren(
    h('div', { class: `update-card state-${s.state}` },
      h('div', { class: 'update-icon', html: icons.download }),
      h('div', { class: 'update-body' }, h('div', { class: 'update-version' }, `Installiert: ${s.current || info.version || '–'}`), h('div', { class: 'update-line' }, line)),
      h('div', { class: 'manage-actions' }, actions)));
}

function setUpdateStatus(status) {
  if (!status) return;
  const before = updateStatus?.state;
  updateStatus = status;
  renderUpdateCard();
  renderSidebar();
  if (before !== status.state && status.state === 'ready') toast(`Update ${status.version} ist bereit – in den Einstellungen neu starten.`, 'ok');
  if (before !== status.state && status.state === 'available') toast(`Moonify ${status.version} ist verfügbar.`, 'ok');
}

/* ---------- Navigation ---------- */

const VIEWS = ['home', 'search', 'explore', 'browse', 'library', 'collection', 'artist', 'nowplaying', 'settings'];

const sameView = (a, b) => a.kind === b.kind && a.state === b.state;

/** Ansicht wechseln. Die vorige Ansicht kommt auf den „Zurück“-Stapel (außer beim Zurückgehen). */
function showView(next, { back = false } = {}) {
  const leaving = view;
  if (!sameView(leaving, next)) {
    leaving.scroll = $(`view-${leaving.kind}`).scrollTop;
    if (!back) {
      backStack.push(leaving);
      if (backStack.length > 40) backStack.shift();
    }
  }
  view = next;
  if (view.kind === 'collection' && view.state) collection = view.state;
  if (view.kind === 'artist' && view.state) artistState = view.state;
  if (view.kind === 'browse' && view.state) browseState = view.state;
  if (view.kind === 'explore' && view.state) exploreState = view.state;
  for (const name of VIEWS) $(`view-${name}`).classList.toggle('active', view.kind === name);
  if (view.kind === 'home') renderHome();
  if (view.kind === 'search') renderSearch();
  if (view.kind === 'library') renderLibrary();
  if (view.kind === 'collection') renderCollection();
  if (view.kind === 'artist') renderArtist();
  if (view.kind === 'explore') renderExplore();
  if (view.kind === 'browse') renderBrowse();
  if (view.kind === 'nowplaying') renderNowPlaying();
  if (view.kind === 'settings') renderSettings();
  if (!sameView(leaving, next)) $(`view-${view.kind}`).scrollTop = back ? view.scroll || 0 : 0;
  closeMenu();
  renderSidebar();
  renderLyricsButton();
}

function goBack() {
  let previous = backStack.pop();
  // Inzwischen gelöschte Moonify-Playlists überspringen
  while (previous?.kind === 'collection' && previous.state?.item.provider === 'moonify' && previous.state.item.kind === 'playlist' && !store.playlist(previous.state.item.id)) {
    previous = backStack.pop();
  }
  showView(previous || { kind: 'home' }, { back: true });
}

function backButton() {
  return h('button', { class: 'back-btn', title: 'Zurück (Alt + ←)', 'aria-label': 'Zurück', html: `${icons.back}<span>Zurück</span>`, onclick: goBack });
}

function openViewKey() {
  if (view.kind === 'collection' && collection) return collection.item.provider === 'moonify' ? `moonify:${collection.item.id}` : itemKey(collection.item);
  if (view.kind === 'artist' && artistState) return itemKey(artistState.item);
  return '';
}

function renderSidebarPlaylists() {
  const open = openViewKey();
  const items = moonifyItems().filter((i) => i.kind !== 'history');
  $('nav-playlists').replaceChildren(
    ...items.map((item) => h('button', {
      class: `nav-playlist${open === `moonify:${item.id}` ? ' active' : ''}`,
      title: item.name,
      onclick: () => openCollection(item),
    }, h('span', { class: 'np-icon', html: item.kind === 'favorites' ? icons.heartFilled : icons.library }), h('span', { class: 'nav-label' }, item.name))),
    // Gemerkte Playlists, Alben und Künstler der Dienste
    ...store.data.saved.slice(0, 30).map((item) => h('button', {
      class: `nav-playlist saved${open === itemKey(item) ? ' active' : ''}`,
      title: `${item.name} · ${getProvider(item.provider).name}`,
      style: `--brand:${getProvider(item.provider).color}`,
      onclick: () => openItem(item),
    }, h('span', { class: `np-icon np-art${item.kind === 'artist' ? ' round' : ''}` }, art(item.image)), h('span', { class: 'nav-label' }, item.name), h('span', { class: 'np-dot' }))),
    h('button', { class: 'nav-playlist add', onclick: () => createPlaylistDialog() }, h('span', { class: 'np-icon', html: icons.plus }), h('span', { class: 'nav-label' }, 'Neue Playlist')),
  );
}

function renderSidebar() {
  renderSidebarPlaylists();
  const open = openViewKey();
  const inSidebar = open && (open.startsWith('moonify:') || store.data.saved.some((i) => itemKey(i) === open));
  // Playlist/Künstler: den Bereich markieren, aus dem man gekommen ist (Suche, Bibliothek …)
  const origin = [...backStack].reverse().find((v) => !['collection', 'artist', 'browse', 'nowplaying'].includes(v.kind))?.kind || '';
  const nested = ['collection', 'artist', 'browse'].includes(view.kind);
  const active = nested ? (inSidebar ? '' : origin) : view.kind;
  for (const name of ['home', 'search', 'explore', 'library', 'settings']) $(`nav-${name}`).classList.toggle('active', active === name);
  const hasUpdate = ['ready', 'available'].includes(updateStatus?.state);
  $('nav-settings').classList.toggle('has-badge', hasUpdate);
  const current = hub.current();
  const list = connected();
  $('nav-services').replaceChildren(
    ...(list.length
      ? list.map((p) => {
        const status = statusOf(p);
        const playing = current?.id === p.id && current.playing;
        return h('button', { class: 'nav-service', style: `--brand:${p.color}`, title: `${p.name} – ${status.text}`, onclick: () => showView({ kind: 'settings' }) },
          providerBadge(p, 'small'),
          h('span', { class: 'nav-label' }, p.name),
          playing
            ? h('span', { class: 'eq', 'aria-label': 'spielt gerade' }, h('i'), h('i'), h('i'))
            : h('span', { class: `status-dot ${status.cls}`, 'aria-label': status.text }));
      })
      : [h('button', { class: 'nav-empty', onclick: () => showView({ kind: 'settings' }) }, 'Noch kein Dienst verbunden – jetzt verbinden')]),
  );
}

function renderTonight() {
  const phase = lunarPhase();
  $('tonight').replaceChildren(
    h('span', { class: 'tonight-moon', html: moonSvg({ lit: phase.lit, waxing: phase.waxing, glow: false }) }),
    h('span', { class: 'tonight-text' }, h('small', {}, 'Heute am Himmel'), h('span', {}, `${phase.name} · ${Math.round(phase.lit * 100)} %`)),
  );
}

function updateSearchPlaceholder() {
  const list = connected();
  const input = $('search-input');
  input.disabled = !list.length;
  input.placeholder = list.length
    ? `Suchen in ${list.map((p) => p.short).join(', ').replace(/, ([^,]*)$/, ' & $1')} …`
    : 'Verbinde zuerst einen Dienst';
}

function renderAll() {
  updateSearchPlaceholder();
  showView(view);
}

/* ---------- Playerleiste ---------- */

let lastArt = null;
let lastHomeArt = null;

function setArt(container, url, cacheKey) {
  if (cacheKey === url) return url;
  container.replaceChildren(art(url));
  return url;
}

function renderPlayer(force = false) {
  const current = hub.current();
  const provider = current ? getProvider(current.id) : null;
  if (force) {
    lastArt = null;
    lastHomeArt = null;
  }
  lastArt = setArt($('now-art'), current?.artwork || '', force ? null : lastArt);
  const title = current ? current.title || 'Unbekannter Titel' : 'Nichts läuft gerade';
  const artist = current ? current.artist || current.album || '' : 'Suche einen Song und leg los';
  setText($('now-title'), title);
  setText($('now-artist'), artist);

  const source = $('now-source');
  source.hidden = !provider;
  if (provider && source.dataset.provider !== provider.id) {
    source.dataset.provider = provider.id;
    source.style.setProperty('--brand', provider.color);
    source.title = `${provider.name} im Fenster öffnen`;
    source.replaceChildren(h('span', { class: 'dot' }), `über ${provider.name}`);
  }

  const playing = Boolean(current?.playing);
  const play = $('btn-play');
  play.disabled = !current;
  if (play.dataset.state !== String(playing)) {
    play.dataset.state = String(playing);
    play.innerHTML = playing ? icons.pause : icons.play;
    play.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    play.title = playing ? 'Pause' : 'Abspielen';
  }
  renderModeButtons(current);
  $('btn-prev').disabled = !(current?.canPrev || (queue.active && queue.index > 0));
  $('btn-next').disabled = !(current?.canNext || (queue.active && queue.upcoming().length));
  const known = currentKnownTrack();
  const heartSlot = $('now-heart');
  const heartKey = known ? `${trackKey(known)}:${store.isFavorite(known)}` : '';
  if (heartSlot.dataset.key !== heartKey) {
    heartSlot.dataset.key = heartKey;
    heartSlot.replaceChildren(...(known ? [heartButton(known)] : []));
  }
  const queueCount = queue.upcoming().length;
  $('btn-queue').classList.toggle('has-items', queueCount > 0);
  $('btn-queue').title = queueCount ? `Warteschlange (${queueCount} als Nächstes)` : 'Warteschlange';

  const duration = current?.duration || 0;
  const position = current?.position || 0;
  progress.set({ position, duration, disabled: !current?.canSeek });
  setText($('time-current'), formatTime(position));
  setText($('time-total'), formatTime(duration));
  document.body.classList.toggle('is-playing', playing);

  const homeNow = $('home-now');
  if (homeNow) {
    homeNow.hidden = !current;
    if (current) {
      lastHomeArt = setArt($('home-now-art'), current.artwork, force ? null : lastHomeArt);
      setText($('home-now-label'), playing ? `Jetzt läuft · ${provider.name}` : `Pausiert · ${provider.name}`);
      setText($('home-now-title'), title);
      setText($('home-now-artist'), artist);
    }
  }
  document.title = current?.title && playing ? `${current.title} · Moonify` : 'Moonify';
  updateLyricsLine();
}

/** Zufall & Wiederholen: steuern den Player des Dienstes (bzw. Moonifys Warteschlange). */
function renderModeButtons(current) {
  const shuffle = $('btn-shuffle');
  const canShuffle = Boolean(current?.canShuffle) || (queue.active && queue.upcoming().length > 1);
  shuffle.disabled = !canShuffle;
  shuffle.classList.toggle('active', current?.shuffle === true);
  shuffle.setAttribute('aria-pressed', String(current?.shuffle === true));
  const repeat = $('btn-repeat');
  const mode = current?.repeat || '';
  repeat.disabled = !mode;
  repeat.classList.toggle('active', mode === 'all' || mode === 'one');
  if (repeat.dataset.mode !== mode) {
    repeat.dataset.mode = mode;
    repeat.innerHTML = mode === 'one' ? icons.repeatOne : icons.repeat;
    const label = { off: 'Wiederholen: aus', all: 'Wiederholen: alle', one: 'Wiederholen: diesen Song' }[mode] || 'Wiederholen (bei diesem Dienst nicht verfügbar)';
    repeat.title = label;
    repeat.setAttribute('aria-label', label);
  }
}

function toggleShuffle() {
  const c = hub.current();
  // Moonifys eigene Warteschlange mischt Moonify selbst
  if (queue.active && queue.upcoming().length > 1) {
    queue.shuffleUpcoming();
    toast('Warteschlange gemischt 🔀', 'ok');
    return;
  }
  if (c?.canShuffle) {
    api.engines.command(c.id, { type: 'shuffle' });
    if (c.id === 'ytmusic') toast('YouTube Music mischt „Als Nächstes“ neu 🔀');
  }
}

function cycleRepeat() {
  const c = hub.current();
  if (c?.repeat) api.engines.command(c.id, { type: 'repeat' });
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function seekTo(time) {
  const c = hub.current();
  if (!c?.canSeek) return;
  api.engines.command(c.id, { type: 'seek', time });
  hub.patch(c.id, { position: time });
}

function togglePlay() {
  const current = hub.current();
  if (!current) return;
  api.engines.command(current.id, { type: current.playing ? 'pause' : 'play' });
  hub.patch(current.id, { playing: !current.playing });
}

function effectiveVolume() {
  return settings.muted ? 0 : settings.volume;
}

function sendVolume(id) {
  api.engines.command(id, { type: 'volume', volume: effectiveVolume() });
}

function applyVolumeUi() {
  const input = $('volume');
  const value = Math.round(effectiveVolume() * 100);
  input.value = String(value);
  input.style.setProperty('--fill', `${value}%`);
  const mute = $('btn-mute');
  mute.innerHTML = effectiveVolume() === 0 ? icons.muted : icons.volume;
  mute.setAttribute('aria-label', settings.muted ? 'Ton an' : 'Stumm schalten');
  mute.title = settings.muted ? 'Ton an' : 'Stumm schalten';
}

function setVolume(volume, muted = false) {
  settings.volume = volume;
  settings.muted = muted;
  saveSettings(settings);
  applyVolumeUi();
  for (const provider of connected()) sendVolume(provider.id);
}

/* ---------- Login-Status ---------- */

async function refreshLoginStatus(quiet = false) {
  let next = {};
  try {
    next = (await api.loginStatus()) || {};
  } catch {
    return;
  }
  if (JSON.stringify(next) === JSON.stringify(loginStatus)) return;
  loginStatus = next;
  if (!quiet) renderAll();
}

/* ---------- Start ---------- */

/* ---------- Tastenkürzel (wie bei YouTube Music) ---------- */

const SHORTCUTS = [
  ['Leertaste / K', 'Abspielen / Pause'],
  ['J / L', '10 Sekunden zurück / vor'],
  ['Umschalt + N / P', 'Nächster / vorheriger Titel'],
  ['+ / −', 'Lauter / leiser'],
  ['M', 'Stumm schalten'],
  ['S / R', 'Zufall / Wiederholen'],
  ['/  oder  Strg + K', 'Suchen'],
  ['Alt + ←', 'Zurück'],
  ['?', 'Diese Übersicht'],
];

function showShortcuts() {
  const table = h('div', { class: 'shortcut-list' }, SHORTCUTS.map(([keys, label]) => h('div', { class: 'shortcut' }, h('kbd', {}, keys), h('span', {}, label))));
  openModal({ title: 'Tastenkürzel', text: '', body: table, actions: [{ label: 'Schließen' }] });
}

function handleShortcut(e) {
  const c = hub.current();
  const key = e.key;
  const run = (fn) => {
    e.preventDefault();
    fn();
  };
  if (key === 'k' || key === 'K') run(togglePlay);
  else if ((key === 'j' || key === 'l') && c) run(() => seekTo(Math.max(0, Math.min(c.duration || Infinity, c.position + (key === 'l' ? 10 : -10)))));
  else if (key === 'N' && e.shiftKey) run(() => $('btn-next').click());
  else if (key === 'P' && e.shiftKey) run(() => $('btn-prev').click());
  else if (key === '+' || key === '=') run(() => setVolume(Math.min(1, (settings.muted ? 0 : settings.volume) + 0.05), false));
  else if (key === '-') run(() => setVolume(Math.max(0, settings.volume - 0.05), false));
  else if (key === 'm' || key === 'M') run(() => $('btn-mute').click());
  else if (key === 's' || key === 'S') run(toggleShuffle);
  else if (key === 'r' || key === 'R') run(cycleRepeat);
  else if (key === '/') run(() => $('search-input').focus());
  else if (key === '?') run(showShortcuts);
}

/* ---------- Suchvorschläge ---------- */

const suggest = { token: 0, items: [], index: -1, timer: 0 };

function bindSuggestions() {
  const input = $('search-input');
  const box = h('div', { class: 'suggest-box', id: 'suggest', role: 'listbox', hidden: true });
  $('search-form').append(box);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'suggest');
  input.addEventListener('input', () => {
    clearTimeout(suggest.timer);
    suggest.timer = setTimeout(() => updateSuggestions(input.value), 160);
  });
  input.addEventListener('focus', () => updateSuggestions(input.value));
  input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
  input.addEventListener('keydown', (e) => {
    if (box.hidden || !suggest.items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // -1 = das Suchfeld selbst, danach die Vorschläge – rundum
      const count = suggest.items.length;
      let next = suggest.index + (e.key === 'ArrowDown' ? 1 : -1);
      if (next < -1) next = count - 1;
      if (next >= count) next = -1;
      suggest.index = next;
      renderSuggestions();
    } else if (e.key === 'Enter' && suggest.index >= 0) {
      e.preventDefault();
      pickSuggestion(suggest.items[suggest.index].text);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });
}

async function updateSuggestions(value) {
  const token = ++suggest.token;
  const q = value.trim();
  const lower = q.toLowerCase();
  const recent = store.data.searches.filter((s) => s.toLowerCase().startsWith(lower) && s.toLowerCase() !== lower).slice(0, q ? 3 : 6);
  let queries = [];
  if (q && settings.enabled.ytmusic) {
    try {
      queries = parseYtmSuggestions(await request('ytmusic', { type: 'suggest', input: q })).queries;
    } catch {
      queries = [];
    }
  }
  if (token !== suggest.token || document.activeElement !== $('search-input')) return;
  const seen = new Set(recent.map((r) => r.toLowerCase()));
  suggest.items = [
    ...recent.map((text) => ({ text, recent: true })),
    ...queries.filter((x) => !seen.has(x.toLowerCase())).map((text) => ({ text, recent: false })),
  ].slice(0, 8);
  suggest.index = -1;
  renderSuggestions();
}

function renderSuggestions() {
  const box = $('suggest');
  const q = $('search-input').value.trim().toLowerCase();
  box.hidden = !suggest.items.length;
  box.replaceChildren(...suggest.items.map((item, i) => {
    const starts = q && item.text.toLowerCase().startsWith(q);
    return h('button', {
      class: `suggest-item${i === suggest.index ? ' active' : ''}`,
      type: 'button',
      role: 'option',
      'aria-selected': String(i === suggest.index),
      // mousedown statt click: sonst schließt das Verlassen des Suchfelds die Liste vorher
      onmousedown: (e) => {
        e.preventDefault();
        pickSuggestion(item.text);
      },
    },
    h('span', { class: 'suggest-icon', html: item.recent ? icons.history : icons.search }),
    starts ? h('span', {}, h('span', { class: 'muted' }, item.text.slice(0, q.length)), h('strong', {}, item.text.slice(q.length))) : h('span', {}, item.text));
  }));
}

function hideSuggestions() {
  suggest.token += 1;
  suggest.items = [];
  const box = $('suggest');
  if (box) box.hidden = true;
}

function pickSuggestion(text) {
  hideSuggestions();
  $('search-input').value = text;
  runSearch(text);
  $('search-input').blur();
}

const captchaShown = {}; // „Bist du ein Roboter?“ höchstens alle 5 Minuten melden

function bindStaticUi() {
  $('brand-moon').innerHTML = moonSvg({ lit: 0.72, waxing: true });
  $('search-icon').innerHTML = icons.search;
  $('btn-prev').innerHTML = icons.prev;
  $('btn-next').innerHTML = icons.next;
  $('nav-home').innerHTML = `${icons.home}<span class="nav-label">Start</span>`;
  $('nav-search').innerHTML = `${icons.search}<span class="nav-label">Suchen</span>`;
  $('nav-explore').innerHTML = `${icons.compass}<span class="nav-label">Erkunden</span>`;
  $('nav-library').innerHTML = `${icons.library}<span class="nav-label">Bibliothek</span>`;
  $('nav-settings').innerHTML = `${icons.settings}<span class="nav-label">Einstellungen</span><span class="badge" aria-label="Update verfügbar"></span>`;
  $('search-kbd').textContent = info.platform === 'darwin' ? '⌘ K' : 'Strg K';

  for (const name of ['home', 'search', 'library', 'settings']) {
    $(`nav-${name}`).addEventListener('click', () => showView({ kind: name }));
  }
  $('nav-explore').addEventListener('click', openExplore);

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    hideSuggestions();
    runSearch($('search-input').value);
    $('search-input').blur();
  });

  $('btn-play').addEventListener('click', togglePlay);
  // Mit Moonify-Warteschlange: Moonify schaltet weiter, sonst der Dienst selbst
  $('btn-next').addEventListener('click', () => {
    if (queue.active && queue.upcoming().length) {
      playNextInQueue();
      return;
    }
    const c = hub.current();
    if (c) api.engines.command(c.id, { type: 'next' });
  });
  $('btn-prev').addEventListener('click', () => {
    const c = hub.current();
    if (queue.active && queue.index > 0 && (!c || c.position < 5)) {
      playPreviousInQueue();
      return;
    }
    if (c) api.engines.command(c.id, { type: 'prev' });
  });
  $('btn-queue').addEventListener('click', () => toggleNowPlaying('queue'));
  $('btn-queue').innerHTML = icons.queue;
  $('btn-lyrics').addEventListener('click', () => toggleNowPlaying('lyrics'));
  $('btn-lyrics').innerHTML = icons.lyrics;
  $('btn-shuffle').addEventListener('click', toggleShuffle);
  $('btn-shuffle').innerHTML = icons.shuffle;
  $('btn-repeat').addEventListener('click', cycleRepeat);
  $('btn-repeat').innerHTML = icons.repeat;
  // Cover oder Titel in der Playerleiste → „Jetzt läuft“
  for (const id of ['now-art', 'now-title']) {
    $(id).addEventListener('click', () => {
      if (!hub.current()) return;
      if (view.kind === 'nowplaying') goBack();
      else openNowPlaying();
    });
  }
  for (const type of ['wheel', 'touchmove']) {
    $('view-nowplaying').addEventListener(type, () => { lyrics.userScrollAt = Date.now(); }, { passive: true });
  }
  bindSuggestions();

  // Maustaste „Zurück“
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
      e.preventDefault();
      goBack();
    }
  });

  // Menüs schließen
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#menu')) closeMenu();
  });
  window.addEventListener('blur', closeMenu);
  $('content').addEventListener('scroll', closeMenu, true);

  // Gespeichertes geändert → betroffene Ansichten neu zeichnen
  store.addEventListener('change', () => {
    renderPlayer();
    if (view.kind === 'library') renderLibrary();
    if (view.kind === 'collection') renderCollection();
    if (view.kind === 'artist') renderArtist();
    if (view.kind === 'search') renderSearch();
    if (view.kind === 'nowplaying') renderNowPlaying();
    if (view.kind === 'home') renderHomeShelf();
    renderSidebar();
  });
  queue.addEventListener('change', () => {
    renderNowPlayingIfVisible('queue');
    renderPlayer();
  });
  $('now-source').addEventListener('click', () => {
    const c = hub.current();
    if (c) api.engines.show(c.id);
  });

  $('volume').addEventListener('input', (e) => setVolume(Number(e.target.value) / 100, false));
  $('btn-mute').addEventListener('click', () => {
    if (settings.muted || settings.volume === 0) setVolume(settings.volume || 0.5, false);
    else setVolume(settings.volume, true);
  });

  progress = new MoonProgress($('progress'), { onSeek: seekTo });

  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
      e.preventDefault();
      $('search-input').focus();
      $('search-input').select();
    } else if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
    } else if (e.key === 'Escape') {
      if (document.getElementById('menu')) closeMenu();
      else if (!$('modal').hidden) $('modal').hidden = true;
      else if (document.activeElement === $('search-input')) $('search-input').blur();
    } else if (e.code === 'Space' && !typing && !(e.target instanceof HTMLButtonElement) && !e.target?.closest?.('.moon-progress, .track-row, [role="button"]')) {
      e.preventDefault();
      togglePlay();
    } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      handleShortcut(e);
    }
  });

  hub.addEventListener('pause-others', (event) => {
    for (const id of event.detail.ids) api.engines.command(id, { type: 'pause' });
  });
  let sidebarKey = '';
  let rowsKey = '';
  let nowKey = '';
  hub.addEventListener('change', () => {
    watchLyrics();
    renderPlayer();
    const current = hub.current();
    const key = current ? `${current.id}:${current.playing}` : '';
    if (key !== sidebarKey) {
      sidebarKey = key;
      renderSidebar();
    }
    // Markierung des laufenden Songs in Listen aktualisieren
    const nextRows = current ? `${current.id}:${current.title}:${current.playing}` : '';
    if (nextRows !== rowsKey) {
      rowsKey = nextRows;
      if (view.kind === 'search') renderSearch();
      if (view.kind === 'collection') renderCollection();
      if (view.kind === 'artist') renderArtist();
      if (view.kind === 'browse') renderBrowse();
      if (view.kind === 'explore') renderExplore();
      if (view.kind === 'home') renderHomeShelf();
    }
    // „Jetzt läuft“: bei neuem Song, Cover oder Video neu zeichnen
    const nextNow = current ? `${current.id}:${current.title}:${current.artwork}:${current.videoId}:${current.playing}` : '';
    if (nextNow !== nowKey) {
      nowKey = nextNow;
      if (view.kind === 'nowplaying') renderNowPlaying();
    }
  });

  api.engines.onState((id, json) => {
    if (!settings.enabled[id]) return;
    let state;
    try {
      state = JSON.parse(json);
    } catch {
      return; // kaputte Nachricht ignorieren
    }
    hub.update(id, state);
    // Song der Warteschlange zu Ende → nächsten starten (auch bei anderem Dienst)
    if (queue.active && endDetector.observe(id, state)) playNextInQueue();
  });
  api.engines.onReady((id) => {
    engineState[id] = { ...(engineState[id] || {}), ready: true, error: null };
    sendVolume(id);
  });
  api.engines.onError((id, message) => {
    engineState[id] = { ...(engineState[id] || {}), error: message };
    if (view.kind === 'settings') renderSettings();
    renderSidebar();
  });
  api.engines.onLogin((id, loggedIn) => {
    const was = Boolean(loginStatus[id]);
    if (was === Boolean(loggedIn)) return;
    loginStatus = { ...loginStatus, [id]: loggedIn };
    if (loggedIn && !was) {
      toast(`Bei ${getProvider(id).name} angemeldet ✓`, 'ok');
      delete library[id];
    }
    renderAll();
  });
  api.engines.onNotice?.((id, notice) => {
    const name = getProvider(id)?.name || 'Der Dienst';
    if (notice === 'google-retry') toast('Google hat die Anmeldung abgelehnt – Moonify versucht es mit einer anderen Methode …');
    if (notice === 'captcha' && Date.now() - (captchaShown[id] || 0) > 5 * 60 * 1000) {
      captchaShown[id] = Date.now();
      openModal({
        title: `${name} möchte kurz etwas prüfen`,
        text: 'Google fragt, ob du kein Roboter bist (das passiert manchmal nach vielen Anfragen). Öffne das Fenster und bestätige es – danach läuft die Musik weiter.',
        actions: [{ label: 'Später' }, { label: 'Fenster öffnen', run: () => api.engines.show(id) }],
      });
    }
    if (notice === 'google-blocked') {
      openModal({
        title: 'Google blockiert die Anmeldung',
        text: `Google lässt die Anmeldung in diesem Fenster gerade nicht zu. ${id === 'ytmusic' ? 'YouTube Music kannst du trotzdem ohne Anmeldung durchsuchen und hören – nur Playlists und Lieblingssongs fehlen dann.' : `Bei ${name} kannst du dich alternativ mit E-Mail und Passwort statt „Mit Google anmelden“ einloggen.`} Du kannst es später erneut versuchen.`,
        actions: [{ label: 'Später' }, { label: 'Erneut versuchen', run: () => api.engines.show(id, { login: true }) }],
      });
    }
  });
  api.updates.onStatus(setUpdateStatus);
}

function animate() {
  let last = 0;
  const frame = (time) => {
    requestAnimationFrame(frame);
    if (time - last < 66 || !hub.current()?.playing || progress.dragging) return;
    last = time;
    renderPlayer();
  };
  requestAnimationFrame(frame);
}

async function init() {
  try {
    info = { ...info, ...(await api.info()) };
  } catch {
    // Standardwerte behalten
  }
  document.body.classList.add(`platform-${info.platform}`);
  startStarfield($('sky'));
  bindStaticUi();
  applyVolumeUi();
  renderTonight();
  await refreshLoginStatus(true);
  // Nur verbundene Dienste werden überhaupt geladen
  for (const provider of connected()) startEngine(provider.id);
  updateSearchPlaceholder();
  showView({ kind: 'home' });
  animate();
  setInterval(() => refreshLoginStatus(), 30000);
  setInterval(renderTonight, 30 * 60 * 1000);
  try {
    setUpdateStatus(await api.updates.status());
  } catch {
    // kein Update-Status
  }
  // Einmal beim Start leise nach Updates schauen
  setTimeout(() => api.updates.check().catch(() => {}), 8000);
}

init();
