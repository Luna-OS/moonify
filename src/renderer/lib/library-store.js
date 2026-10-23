import { PROVIDER_IDS } from '../../shared/providers.js';

// Moonifys eigene Sammlung: Lieblingssongs, Playlists, Verlauf, gemerkte Playlists/Alben/
// Künstler der Dienste und die letzten Suchbegriffe.
// Funktioniert für alle Dienste gleich (auch gemischt) und ohne Anmeldung.

const KEY = 'moonify.library.v1';
const HISTORY_MAX = 50;
const SAVED_MAX = 200;
const SEARCHES_MAX = 8;
const TEXT_MAX = 300;
const REF_FIELDS = ['uri', 'videoId', 'playlistId', 'browseId', 'deeplink'];
const SAVED_KINDS = ['playlist', 'album', 'artist'];

export function trackKey(track) {
  return `${track.provider}:${track.id}`;
}

/** Schlüssel für gemerkte Playlists, Alben und Künstler. */
export function itemKey(item) {
  return `${item.provider}:${item.kind}:${item.id}`;
}

function cleanRef(raw) {
  const ref = {};
  for (const name of REF_FIELDS) {
    if (typeof raw?.[name] === 'string' && raw[name]) ref[name] = raw[name].slice(0, 500);
  }
  return ref;
}

function cleanImage(value) {
  return typeof value === 'string' && value.startsWith('https://') ? value.slice(0, 1000) : '';
}

function text(value) {
  return typeof value === 'string' ? value.slice(0, TEXT_MAX) : '';
}

/** Nur die Felder speichern, die zum Anzeigen und Abspielen nötig sind. */
export function cleanTrack(track) {
  if (!track || typeof track !== 'object' || !PROVIDER_IDS.includes(track.provider)) return null;
  const id = text(track.id);
  if (!id) return null;
  const ref = cleanRef(track.ref);
  delete ref.browseId;
  if (!Object.keys(ref).length) return null;
  const image = cleanImage(track.image);
  const duration = Number(track.duration);
  return {
    provider: track.provider,
    kind: 'track',
    id,
    title: text(track.title),
    artist: text(track.artist),
    album: text(track.album),
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    image,
    ref,
  };
}

function cleanList(list) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const track = cleanTrack(raw);
    if (!track || seen.has(trackKey(track))) continue;
    seen.add(trackKey(track));
    result.push(track);
  }
  return result;
}

/** Playlist, Album oder Künstler eines Dienstes zum Merken. */
export function cleanItem(item) {
  if (!item || typeof item !== 'object' || !PROVIDER_IDS.includes(item.provider) || !SAVED_KINDS.includes(item.kind)) return null;
  const id = text(item.id);
  const name = text(item.name).trim();
  const ref = cleanRef(item.ref);
  if (!id || !name || !Object.keys(ref).length) return null;
  return { provider: item.provider, kind: item.kind, id, name, subtitle: text(item.subtitle), image: cleanImage(item.image), ref };
}

function cleanSearch(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

export function emptyLibrary() {
  return { favorites: [], playlists: [], history: [], saved: [], searches: [] };
}

export function sanitizeLibrary(raw) {
  const base = emptyLibrary();
  if (!raw || typeof raw !== 'object') return base;
  base.favorites = cleanList(raw.favorites);
  base.history = cleanList(raw.history).slice(0, HISTORY_MAX);
  const ids = new Set();
  for (const p of Array.isArray(raw.playlists) ? raw.playlists : []) {
    const id = text(p?.id);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    base.playlists.push({
      id,
      name: text(p.name).trim() || 'Playlist',
      createdAt: Number(p.createdAt) || 0,
      tracks: cleanList(p.tracks),
    });
  }
  const savedKeys = new Set();
  for (const entry of Array.isArray(raw.saved) ? raw.saved : []) {
    const item = cleanItem(entry);
    if (!item || savedKeys.has(itemKey(item))) continue;
    savedKeys.add(itemKey(item));
    base.saved.push(item);
  }
  base.saved = base.saved.slice(0, SAVED_MAX);
  const searches = (Array.isArray(raw.searches) ? raw.searches : []).map(cleanSearch).filter(Boolean);
  base.searches = searches.filter((q, i) => searches.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i).slice(0, SEARCHES_MAX);
  return base;
}

export class LibraryStore extends EventTarget {
  constructor(storage = globalThis.localStorage, now = () => Date.now()) {
    super();
    this.storage = storage;
    this.now = now;
    this.data = emptyLibrary();
    try {
      this.data = sanitizeLibrary(JSON.parse(storage.getItem(KEY) || 'null'));
    } catch {
      // kaputter Speicher → leer anfangen
    }
  }

  save() {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Speichern nicht möglich – im Speicher bleibt es trotzdem erhalten
    }
    this.dispatchEvent(new Event('change'));
  }

  /* Lieblingssongs */

  isFavorite(track) {
    const key = trackKey(track);
    return this.data.favorites.some((t) => trackKey(t) === key);
  }

  toggleFavorite(track) {
    const clean = cleanTrack(track);
    if (!clean) return false;
    const key = trackKey(clean);
    if (this.isFavorite(clean)) {
      this.data.favorites = this.data.favorites.filter((t) => trackKey(t) !== key);
      this.save();
      return false;
    }
    this.data.favorites.unshift(clean);
    this.save();
    return true;
  }

  /* Playlists */

  playlist(id) {
    return this.data.playlists.find((p) => p.id === id) || null;
  }

  createPlaylist(name) {
    const playlist = {
      id: `pl-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: text(String(name || '')).trim() || `Playlist ${this.data.playlists.length + 1}`,
      createdAt: this.now(),
      tracks: [],
    };
    this.data.playlists.push(playlist);
    this.save();
    return playlist;
  }

  renamePlaylist(id, name) {
    const playlist = this.playlist(id);
    const clean = text(String(name || '')).trim();
    if (!playlist || !clean) return false;
    playlist.name = clean;
    this.save();
    return true;
  }

  deletePlaylist(id) {
    const before = this.data.playlists.length;
    this.data.playlists = this.data.playlists.filter((p) => p.id !== id);
    if (this.data.playlists.length === before) return false;
    this.save();
    return true;
  }

  /** Fügt Songs hinzu (ohne Doppelte); gibt die Anzahl neuer Songs zurück. */
  addToPlaylist(id, tracks) {
    const playlist = this.playlist(id);
    if (!playlist) return 0;
    const keys = new Set(playlist.tracks.map(trackKey));
    let added = 0;
    for (const raw of Array.isArray(tracks) ? tracks : [tracks]) {
      const track = cleanTrack(raw);
      if (!track || keys.has(trackKey(track))) continue;
      keys.add(trackKey(track));
      playlist.tracks.push(track);
      added += 1;
    }
    if (added) this.save();
    return added;
  }

  removeFromPlaylist(id, key) {
    const playlist = this.playlist(id);
    if (!playlist) return false;
    const before = playlist.tracks.length;
    playlist.tracks = playlist.tracks.filter((t) => trackKey(t) !== key);
    if (playlist.tracks.length === before) return false;
    this.save();
    return true;
  }

  moveInPlaylist(id, key, offset) {
    const playlist = this.playlist(id);
    if (!playlist) return false;
    const from = playlist.tracks.findIndex((t) => trackKey(t) === key);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= playlist.tracks.length) return false;
    const [track] = playlist.tracks.splice(from, 1);
    playlist.tracks.splice(to, 0, track);
    this.save();
    return true;
  }

  /* Verlauf */

  addHistory(track) {
    const clean = cleanTrack(track);
    if (!clean) return;
    const key = trackKey(clean);
    this.data.history = [clean, ...this.data.history.filter((t) => trackKey(t) !== key)].slice(0, HISTORY_MAX);
    this.save();
  }

  clearHistory() {
    this.data.history = [];
    this.save();
  }

  /* Gemerkte Playlists, Alben und Künstler der Dienste */

  isSaved(item) {
    if (!item) return false;
    const key = itemKey(item);
    return this.data.saved.some((i) => itemKey(i) === key);
  }

  /** Merkt sich ein Element bzw. vergisst es wieder; gibt den neuen Zustand zurück. */
  toggleSaved(item) {
    const clean = cleanItem(item);
    if (!clean) return false;
    const key = itemKey(clean);
    if (this.isSaved(clean)) {
      this.data.saved = this.data.saved.filter((i) => itemKey(i) !== key);
      this.save();
      return false;
    }
    this.data.saved = [clean, ...this.data.saved].slice(0, SAVED_MAX);
    this.save();
    return true;
  }

  /* Letzte Suchbegriffe */

  addSearch(query) {
    const clean = cleanSearch(query);
    if (!clean) return;
    const lower = clean.toLowerCase();
    this.data.searches = [clean, ...this.data.searches.filter((q) => q.toLowerCase() !== lower)].slice(0, SEARCHES_MAX);
    this.save();
  }

  removeSearch(query) {
    const before = this.data.searches.length;
    this.data.searches = this.data.searches.filter((q) => q !== query);
    if (this.data.searches.length !== before) this.save();
  }

  clearSearches() {
    this.data.searches = [];
    this.save();
  }
}
