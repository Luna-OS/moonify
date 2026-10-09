import { PROVIDER_IDS } from '../../shared/providers.js';

// Moonifys eigene Sammlung: Lieblingssongs, Playlists und Verlauf.
// Funktioniert für alle Dienste gleich (auch gemischt) und ohne Anmeldung.

const KEY = 'moonify.library.v1';
const HISTORY_MAX = 50;
const TEXT_MAX = 300;

export function trackKey(track) {
  return `${track.provider}:${track.id}`;
}

function text(value) {
  return typeof value === 'string' ? value.slice(0, TEXT_MAX) : '';
}

/** Nur die Felder speichern, die zum Anzeigen und Abspielen nötig sind. */
export function cleanTrack(track) {
  if (!track || typeof track !== 'object' || !PROVIDER_IDS.includes(track.provider)) return null;
  const id = text(track.id);
  if (!id) return null;
  const ref = {};
  for (const name of ['uri', 'videoId', 'playlistId', 'deeplink']) {
    if (typeof track.ref?.[name] === 'string') ref[name] = track.ref[name].slice(0, 500);
  }
  if (!Object.keys(ref).length) return null;
  const image = typeof track.image === 'string' && track.image.startsWith('https://') ? track.image.slice(0, 1000) : '';
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

export function emptyLibrary() {
  return { favorites: [], playlists: [], history: [] };
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
}
