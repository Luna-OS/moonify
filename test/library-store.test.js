import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryStore, cleanTrack, sanitizeLibrary, trackKey } from '../src/renderer/lib/library-store.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

const song = (provider, id, title = `Song ${id}`) => ({
  provider, kind: 'track', id, title, artist: 'Luna', album: '', duration: 200, image: 'https://img/x.jpg',
  ref: provider === 'spotify' ? { uri: `spotify:track:${id}` } : provider === 'ytmusic' ? { videoId: id } : { deeplink: `/albums/A?trackAsin=${id}` },
});

test('Lieblingssongs: an/aus und bleiben gespeichert', () => {
  const storage = memoryStorage();
  const store = new LibraryStore(storage);
  assert.equal(store.toggleFavorite(song('spotify', 'a')), true);
  assert.equal(store.toggleFavorite(song('ytmusic', 'b')), true);
  assert.ok(store.isFavorite(song('spotify', 'a')));
  const reloaded = new LibraryStore(storage);
  assert.deepEqual(reloaded.data.favorites.map(trackKey), ['ytmusic:b', 'spotify:a']);
  assert.equal(reloaded.toggleFavorite(song('spotify', 'a')), false);
  assert.ok(!reloaded.isFavorite(song('spotify', 'a')));
});

test('Playlists: anlegen, gemischt befüllen, ohne Doppelte, sortieren, löschen', () => {
  const store = new LibraryStore(memoryStorage());
  const p = store.createPlaylist('  Mondnacht  ');
  assert.equal(p.name, 'Mondnacht');
  assert.equal(store.addToPlaylist(p.id, [song('spotify', '1'), song('amazon', '2'), song('spotify', '1')]), 2);
  assert.equal(store.addToPlaylist(p.id, song('ytmusic', '3')), 1);
  assert.equal(store.addToPlaylist(p.id, song('ytmusic', '3')), 0);
  assert.deepEqual(store.playlist(p.id).tracks.map(trackKey), ['spotify:1', 'amazon:2', 'ytmusic:3']);
  assert.ok(store.moveInPlaylist(p.id, 'ytmusic:3', -2));
  assert.deepEqual(store.playlist(p.id).tracks.map(trackKey), ['ytmusic:3', 'spotify:1', 'amazon:2']);
  assert.ok(!store.moveInPlaylist(p.id, 'ytmusic:3', -1));
  assert.ok(store.removeFromPlaylist(p.id, 'spotify:1'));
  assert.ok(store.renamePlaylist(p.id, 'Sternenstaub'));
  assert.ok(!store.renamePlaylist(p.id, '   '));
  assert.equal(store.playlist(p.id).name, 'Sternenstaub');
  assert.equal(store.createPlaylist('').name, 'Playlist 2');
  assert.ok(store.deletePlaylist(p.id));
  assert.equal(store.playlist(p.id), null);
});

test('Verlauf: neueste zuerst, ohne Doppelte, höchstens 50', () => {
  const store = new LibraryStore(memoryStorage());
  for (let i = 0; i < 60; i++) store.addHistory(song('ytmusic', `v${i}`));
  store.addHistory(song('ytmusic', 'v10'));
  assert.equal(store.data.history.length, 50);
  assert.equal(trackKey(store.data.history[0]), 'ytmusic:v10');
  assert.equal(store.data.history.filter((t) => t.id === 'v10').length, 1);
});

test('Nur saubere Songs werden gespeichert', () => {
  assert.equal(cleanTrack({ provider: 'hacker', id: 'x', ref: { uri: 'x' } }), null);
  assert.equal(cleanTrack({ provider: 'spotify', id: 'x', ref: {} }), null);
  const t = cleanTrack({ ...song('spotify', 'x'), image: 'javascript:alert(1)', extra: 'weg', title: 'y'.repeat(999) });
  assert.equal(t.image, '');
  assert.equal(t.title.length, 300);
  assert.equal('extra' in t, false);
  const lib = sanitizeLibrary({ favorites: 'kaputt', playlists: [{ id: 'a', name: '', tracks: [song('amazon', '1')] }, { id: 'a' }, null] });
  assert.deepEqual(lib.favorites, []);
  assert.equal(lib.playlists.length, 1);
  assert.equal(lib.playlists[0].name, 'Playlist');
});

test('Kaputter Speicher bricht nichts', () => {
  const broken = { getItem: () => '{kaputt', setItem: () => { throw new Error('voll'); } };
  const store = new LibraryStore(broken);
  assert.deepEqual(store.data, { favorites: [], playlists: [], history: [] });
  assert.doesNotThrow(() => store.toggleFavorite(song('spotify', 'a')));
  assert.ok(store.isFavorite(song('spotify', 'a')));
});
