import { AMAZON_REGIONS, PROVIDERS, getProvider } from '../shared/providers.js';
import {
  interleave,
  parseAmazonTracks,
  parseSpotifyCollections,
  parseSpotifyTracks,
  parseYtmChips,
  parseYtmCollections,
  parseYtmTracks,
  pickRelevant,
  ytmSongsChip,
} from '../shared/parsers.js';
import { formatTime, greeting, safeImageUrl } from './lib/format.js';
import { icons } from './lib/icons.js';
import { lunarPhase, moonSvg } from './lib/moon.js';
import { MoonProgress } from './lib/moon-progress.js';
import { PlayerHub } from './lib/player.js';
import { LibraryStore, trackKey } from './lib/library-store.js';
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

const search = { query: '', token: 0, filter: 'all', results: {} };
const library = {};
let collection = null;

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

function openModal({ title, text, actions, input = null }) {
  const modal = $('modal');
  $('modal-title').textContent = title;
  $('modal-text').textContent = text;
  const field = input
    ? h('input', { class: 'modal-input', type: 'text', maxlength: '120', placeholder: input.placeholder || '', 'aria-label': input.placeholder || title })
    : null;
  if (field) field.value = input.value || '';
  $('modal-input-slot').replaceChildren(...(field ? [field] : []));
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
  renderQueueIfVisible();
}

function playPreviousInQueue() {
  const previous = queue.previous();
  endDetector.reset(previous);
  if (previous) startTrack(previous);
  renderQueueIfVisible();
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
  renderQueueIfVisible();
}

async function playCollection(item, tracks) {
  if (!tracks?.length) return;
  if (item.provider === 'moonify') playList(tracks, 0);
  else await playTrack(tracks[0], item);
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
    { text: 'Als Nächstes spielen', icon: icons.next, run: () => addToQueue(track, true) },
    { text: 'Zur Warteschlange hinzufügen', icon: icons.queue, run: () => addToQueue(track) },
    { text: store.isFavorite(track) ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs hinzufügen', icon: icons.heart, run: () => toggleFavorite(track) },
    '-',
    ...playlistEntries(track),
  ];
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

function parseSearch(id, data) {
  if (id === 'spotify') return parseSpotifyTracks(data);
  if (id === 'ytmusic') return parseYtmTracks(data);
  if (id === 'amazon') return parseAmazonTracks(data);
  return [];
}

async function searchProvider(id, query, token) {
  search.results[id] = { status: 'loading', tracks: [] };
  renderSearchIfVisible();
  try {
    const data = await request(id, { type: 'search', query });
    let tracks = parseSearch(id, data);
    if (id === 'ytmusic') {
      // Wenn es einen „Songs“-Filter gibt, lieber Songs statt Videos – aber nur, wenn sie zur Suche passen
      const chip = ytmSongsChip(parseYtmChips(data));
      if (chip) {
        const songs = await request(id, { type: 'search', query, params: chip.params }).then(parseYtmTracks).catch(() => []);
        tracks = pickRelevant(songs, tracks, query);
      }
    }
    if (token !== search.token) return;
    search.results[id] = { status: 'done', tracks: tracks.slice(0, 40) };
  } catch (err) {
    if (token !== search.token) return;
    search.results[id] = { status: 'error', tracks: [], error: err.message };
  }
  renderSearchIfVisible();
}

function runSearch(query) {
  const q = query.trim();
  if (!q) return;
  const list = connected();
  search.query = q;
  search.token += 1;
  search.results = {};
  if (search.filter !== 'all' && !settings.enabled[search.filter]) search.filter = 'all';
  showView({ kind: 'search' });
  for (const provider of list) searchProvider(provider.id, q, search.token);
}

function renderSearchIfVisible() {
  if (view.kind === 'search') renderSearch();
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
      h('p', { class: 'section-sub' }, `Ein Suchfeld für ${list.map((p) => p.short).join(', ').replace(/, ([^,]*)$/, ' & $1')}.`),
      h('form', {
        class: 'big-search',
        onsubmit: (e) => {
          e.preventDefault();
          runSearch(e.target.elements.q.value);
        },
      },
      h('span', { class: 'search-icon', html: icons.search }),
      h('input', { name: 'q', type: 'search', placeholder: 'Song, Künstler oder Album …', 'aria-label': 'Suchbegriff', autofocus: true })),
    ));
    root.querySelector('input')?.focus();
    return;
  }

  const counts = Object.fromEntries(list.map((p) => [p.id, search.results[p.id]?.tracks.length || 0]));
  const anyLoading = list.some((p) => search.results[p.id]?.status === 'loading');
  const chips = [
    h('button', { class: `chip${search.filter === 'all' ? ' active' : ''}`, onclick: () => setFilter('all') },
      'Alle', h('span', { class: 'chip-count' }, String(Object.values(counts).reduce((a, b) => a + b, 0)))),
    ...list.map((p) => {
      const r = search.results[p.id];
      return h('button', { class: `chip${search.filter === p.id ? ' active' : ''}`, style: `--brand:${p.color}`, onclick: () => setFilter(p.id) },
        h('span', { class: 'dot' }), p.short,
        r?.status === 'loading' ? h('span', { class: 'chip-spin', html: moonSvg({ lit: 0.5, glow: false }) }) : h('span', { class: 'chip-count' }, String(counts[p.id])));
    }),
  ];

  const visible = search.filter === 'all' ? list : list.filter((p) => p.id === search.filter);
  const problems = visible
    .filter((p) => search.results[p.id]?.status === 'error')
    .map((p) => h('div', { class: 'notice warn small' },
      h('strong', {}, `${p.name}: `), search.results[p.id].error, ' ',
      h('button', { class: 'link-btn', onclick: () => searchProvider(p.id, search.query, search.token) }, 'Erneut versuchen'),
      ' · ',
      h('button', { class: 'link-btn', onclick: () => api.engines.show(p.id) }, 'Im Fenster öffnen')));
  const tracks = interleave(visible.map((p) => search.results[p.id]?.tracks || []));

  let body;
  if (tracks.length) body = trackList(tracks);
  else if (anyLoading) body = spinner('Suche läuft …');
  else if (!problems.length) body = emptyState('Keine Treffer', `Für „${search.query}“ wurde nichts gefunden.`);
  else body = null;

  root.replaceChildren(page(
    h('h1', { class: 'page-title' }, h('span', { class: 'muted' }, 'Ergebnisse für '), `„${search.query}“`),
    h('div', { class: 'chips' }, chips),
    problems,
    body,
  ));
}

function setFilter(filter) {
  search.filter = filter;
  renderSearch();
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

function collectionCard(item) {
  if (item.provider === 'moonify') return moonifyCard(item);
  const provider = getProvider(item.provider);
  return h('button', { class: 'collection-card', style: `--brand:${provider.color}`, onclick: () => openCollection(item) },
    h('div', { class: 'cc-art' }, item.id === 'liked' || item.id === 'VLLM' ? h('div', { class: 'liked-art', html: icons.sparkle }) : art(item.image)),
    h('div', { class: 'cc-name' }, item.name),
    h('div', { class: 'cc-sub' }, providerTag(provider), item.subtitle && item.subtitle !== provider.name ? ` ${item.subtitle}` : ''));
}

function renderLibrary() {
  const root = $('view-library');
  const list = connected();
  const own = h('section', { class: 'lib-section' },
    h('div', { class: 'section-head' }, h('span', { class: 'moon-badge', html: moonSvg({ lit: 0.72, glow: false }) }), h('h2', {}, 'In Moonify gespeichert')),
    h('div', { class: 'collection-grid' }, moonifyItems().map(moonifyCard), newPlaylistCard()));
  if (!list.length) {
    root.replaceChildren(page(h('h1', { class: 'page-title' }, 'Bibliothek'), own,
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
    return h('section', { class: 'lib-section' }, head, h('div', { class: 'collection-grid' }, lib.items.map(collectionCard)));
  });
  root.replaceChildren(page(h('h1', { class: 'page-title' }, 'Bibliothek'), own, sections));
  for (const provider of list) if (provider.library && loginStatus[provider.id] && !library[provider.id]) loadLibrary(provider.id);
}

/* ---------- Playlist / Album ---------- */

async function openCollection(item) {
  if (item.provider === 'moonify') {
    collection = { item, status: 'done', tracks: [] };
    showView({ kind: 'collection' });
    return;
  }
  collection = { item, status: 'loading', tracks: [] };
  showView({ kind: 'collection' });
  try {
    const data = await request(item.provider, { type: 'collection', ref: item.ref });
    if (collection?.item !== item) return;
    const tracks = item.provider === 'spotify' ? parseSpotifyTracks(data) : parseYtmTracks(data);
    collection = { item, status: 'done', tracks };
  } catch (err) {
    if (collection?.item !== item) return;
    collection = { item, status: 'error', tracks: [], error: err.message };
  }
  if (view.kind === 'collection') renderCollection();
}

function renderCollection() {
  const root = $('view-collection');
  if (!collection) return;
  if (collection.item.provider === 'moonify') {
    renderMoonifyCollection(root, collection.item);
    return;
  }
  const { item, status, tracks, error } = collection;
  const provider = getProvider(item.provider);
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const header = h('div', { class: 'collection-header', style: `--brand:${provider.color}` },
    h('div', { class: 'ch-art' }, item.id === 'liked' || item.id === 'VLLM' ? h('div', { class: 'liked-art', html: icons.sparkle }) : art(item.image)),
    h('div', { class: 'ch-text' },
      h('small', {}, item.kind === 'album' ? 'Album' : 'Playlist'),
      h('h1', {}, item.name),
      h('div', { class: 'ch-meta' }, providerTag(provider), item.subtitle ? ` ${item.subtitle}` : '',
        status === 'done' ? ` · ${songs(tracks.length)}${total ? ` · ${Math.round(total / 60)} Min.` : ''}` : ''),
      h('div', { class: 'ch-actions' },
        h('button', { class: 'btn primary', disabled: !tracks.length, html: `${icons.play}<span>Abspielen</span>`, onclick: () => playCollection(item, tracks) }),
        h('button', {
          class: 'btn ghost',
          disabled: !tracks.length,
          html: `${icons.library}<span>In Moonify speichern</span>`,
          onclick: (e) => openMenu(e.currentTarget, playlistEntries(tracks)),
        }),
        h('button', { class: 'btn ghost', onclick: () => showView({ kind: 'library' }) }, 'Zurück'))));
  let body;
  if (status === 'loading') body = spinner('Songs werden geladen …');
  else if (status === 'error') body = h('div', { class: 'notice warn' }, error);
  else if (!tracks.length) body = emptyState('Leer', 'Hier sind noch keine Songs.');
  else body = trackList(tracks, item, { numbered: true });
  root.replaceChildren(page(header, body));
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
    body = trackList(tracks, { provider: 'moonify', kind: item.kind, id: item.id }, { numbered: item.kind !== 'history' });
  }
  root.replaceChildren(page(header, body));
}

/* ---------- Warteschlange ---------- */

function renderQueueIfVisible() {
  if (view.kind === 'queue') renderQueue();
}

function renderQueue() {
  const root = $('view-queue');
  const current = queue.current();
  const upcoming = queue.upcoming();
  const sections = [h('h1', { class: 'page-title' }, 'Warteschlange')];
  if (!current) {
    sections.push(emptyState('Die Warteschlange ist leer', 'Spiele eine Moonify-Playlist ab oder wähle bei einem Song „Zur Warteschlange hinzufügen“.'));
  } else {
    sections.push(h('h2', { class: 'section-title first' }, 'Läuft gerade'), trackList([current]));
    sections.push(h('div', { class: 'section-head spaced' },
      h('h2', {}, `Als Nächstes (${upcoming.length})`),
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
  }
  root.replaceChildren(page(sections));
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
  const items = interleave(connected().map((p) => (library[p.id]?.status === 'done' ? library[p.id].items : []))).slice(0, 10);
  if (own.length || items.length) {
    parts.push(h('h2', { class: 'section-title' }, 'Deine Musik'), h('div', { class: 'collection-grid' }, own.map(moonifyCard), items.map(collectionCard)));
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

const VIEWS = ['home', 'search', 'library', 'collection', 'queue', 'settings'];

function showView(next) {
  view = next;
  for (const name of VIEWS) $(`view-${name}`).classList.toggle('active', view.kind === name);
  if (view.kind === 'home') renderHome();
  if (view.kind === 'search') renderSearch();
  if (view.kind === 'library') renderLibrary();
  if (view.kind === 'collection') renderCollection();
  if (view.kind === 'queue') renderQueue();
  if (view.kind === 'settings') renderSettings();
  $(`view-${view.kind}`).scrollTop = 0;
  closeMenu();
  renderSidebar();
}

function renderSidebarPlaylists() {
  const openItem = view.kind === 'collection' && collection?.item.provider === 'moonify' ? collection.item.id : null;
  const items = moonifyItems().filter((i) => i.kind !== 'history');
  $('nav-playlists').replaceChildren(
    ...items.map((item) => h('button', {
      class: `nav-playlist${openItem === item.id ? ' active' : ''}`,
      title: item.name,
      onclick: () => openCollection(item),
    }, h('span', { class: 'np-icon', html: item.kind === 'favorites' ? icons.heartFilled : icons.library }), h('span', { class: 'nav-label' }, item.name))),
    h('button', { class: 'nav-playlist add', onclick: () => createPlaylistDialog() }, h('span', { class: 'np-icon', html: icons.plus }), h('span', { class: 'nav-label' }, 'Neue Playlist')),
  );
}

function renderSidebar() {
  renderSidebarPlaylists();
  const active = view.kind === 'collection' ? (collection?.item.provider === 'moonify' ? '' : 'library') : view.kind;
  for (const name of ['home', 'search', 'library', 'settings']) $(`nav-${name}`).classList.toggle('active', active === name);
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
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
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

function bindStaticUi() {
  $('brand-moon').innerHTML = moonSvg({ lit: 0.72, waxing: true });
  $('search-icon').innerHTML = icons.search;
  $('btn-prev').innerHTML = icons.prev;
  $('btn-next').innerHTML = icons.next;
  $('nav-home').innerHTML = `${icons.home}<span class="nav-label">Start</span>`;
  $('nav-search').innerHTML = `${icons.search}<span class="nav-label">Suchen</span>`;
  $('nav-library').innerHTML = `${icons.library}<span class="nav-label">Bibliothek</span>`;
  $('nav-settings').innerHTML = `${icons.settings}<span class="nav-label">Einstellungen</span><span class="badge" aria-label="Update verfügbar"></span>`;
  $('search-kbd').textContent = info.platform === 'darwin' ? '⌘ K' : 'Strg K';

  for (const name of ['home', 'search', 'library', 'settings']) {
    $(`nav-${name}`).addEventListener('click', () => showView({ kind: name }));
  }

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
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
  $('btn-queue').addEventListener('click', () => showView(view.kind === 'queue' ? { kind: 'home' } : { kind: 'queue' }));
  $('btn-queue').innerHTML = icons.queue;

  // Menüs schließen
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#menu')) closeMenu();
  });
  window.addEventListener('blur', closeMenu);
  $('content').addEventListener('scroll', closeMenu, true);

  // Gespeichertes geändert → betroffene Ansichten neu zeichnen
  store.addEventListener('change', () => {
    renderSidebarPlaylists();
    renderPlayer();
    if (view.kind === 'library') renderLibrary();
    if (view.kind === 'collection') renderCollection();
    if (view.kind === 'search') renderSearch();
    if (view.kind === 'queue') renderQueue();
    if (view.kind === 'home') renderHomeShelf();
  });
  queue.addEventListener('change', () => {
    renderQueueIfVisible();
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

  progress = new MoonProgress($('progress'), {
    onSeek: (time) => {
      const c = hub.current();
      if (!c) return;
      api.engines.command(c.id, { type: 'seek', time });
      hub.patch(c.id, { position: time });
    },
  });

  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
      e.preventDefault();
      $('search-input').focus();
      $('search-input').select();
    } else if (e.key === 'Escape') {
      if (document.getElementById('menu')) closeMenu();
      else if (!$('modal').hidden) $('modal').hidden = true;
      else if (document.activeElement === $('search-input')) $('search-input').blur();
    } else if (e.code === 'Space' && !typing && !(e.target instanceof HTMLButtonElement) && !e.target?.closest?.('.moon-progress, .track-row')) {
      e.preventDefault();
      togglePlay();
    }
  });

  hub.addEventListener('pause-others', (event) => {
    for (const id of event.detail.ids) api.engines.command(id, { type: 'pause' });
  });
  let sidebarKey = '';
  let rowsKey = '';
  hub.addEventListener('change', () => {
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
      if (view.kind === 'queue') renderQueue();
      if (view.kind === 'home') renderHomeShelf();
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
