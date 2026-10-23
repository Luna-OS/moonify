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
  assert.deepEqual(store.data, { favorites: [], playlists: [], history: [], saved: [], searches: [] });
  assert.doesNotThrow(() => store.toggleFavorite(song('spotify', 'a')));
  assert.ok(store.isFavorite(song('spotify', 'a')));
});

const playlistItem = (id, name = `Liste ${id}`) => ({
  provider: 'spotify', kind: 'playlist', id, name, subtitle: 'Spotify', image: 'https://img/p.jpg', ref: { uri: `spotify:playlist:${id}` },
});

test('Gemerkt: Playlists, Alben und Künstler der Dienste an/aus, bleiben gespeichert', () => {
  const storage = memoryStorage();
  const store = new LibraryStore(storage);
  assert.equal(store.toggleSaved(playlistItem('a')), true);
  assert.equal(store.toggleSaved({ provider: 'ytmusic', kind: 'artist', id: 'UC1', name: 'Coldplay', ref: { browseId: 'UC1' } }), true);
  assert.equal(store.toggleSaved({ provider: 'amazon', kind: 'album', id: 'B1', name: 'Album', ref: { deeplink: '/albums/B1' } }), true);
  assert.ok(store.isSaved(playlistItem('a')));
  assert.ok(!store.isSaved(playlistItem('b')));
  const reloaded = new LibraryStore(storage);
  assert.deepEqual(reloaded.data.saved.map((i) => `${i.kind}:${i.id}`), ['album:B1', 'artist:UC1', 'playlist:a']);
  assert.equal(reloaded.toggleSaved(playlistItem('a')), false);
  assert.ok(!reloaded.isSaved(playlistItem('a')));
});

test('Gemerkt: nur saubere Einträge', () => {
  const store = new LibraryStore(memoryStorage());
  assert.equal(store.toggleSaved({ provider: 'hacker', kind: 'playlist', id: 'x', name: 'x', ref: { uri: 'x' } }), false);
  assert.equal(store.toggleSaved({ provider: 'spotify', kind: 'track', id: 'x', name: 'x', ref: { uri: 'x' } }), false);
  assert.equal(store.toggleSaved({ provider: 'spotify', kind: 'playlist', id: 'x', name: '  ', ref: { uri: 'x' } }), false);
  assert.equal(store.toggleSaved({ ...playlistItem('x'), image: 'javascript:alert(1)', ref: { uri: 'spotify:playlist:x', evil: 'y' } }), true);
  assert.equal(store.data.saved[0].image, '');
  assert.deepEqual(store.data.saved[0].ref, { uri: 'spotify:playlist:x' });
  const data = sanitizeLibrary({ saved: [playlistItem('1'), playlistItem('1'), { provider: 'spotify' }] });
  assert.equal(data.saved.length, 1);
});

test('Letzte Suchbegriffe: neueste zuerst, ohne Doppelte, höchstens 8', () => {
  const store = new LibraryStore(memoryStorage());
  for (const q of ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun']) store.addSearch(q);
  store.addSearch('  ZWEI ');
  store.addSearch('');
  assert.deepEqual(store.data.searches, ['ZWEI', 'neun', 'acht', 'sieben', 'sechs', 'fünf', 'vier', 'drei']);
  store.removeSearch('neun');
  assert.equal(store.data.searches.length, 7);
  store.clearSearches();
  assert.deepEqual(store.data.searches, []);
  assert.deepEqual(sanitizeLibrary({ searches: ['a', 'A', 5, ' b '] }).searches, ['a', 'b']);
});
