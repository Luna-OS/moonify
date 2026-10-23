import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  compactNumber,
  emptySearch,
  parseAmazonSearch,
  parseSpotifyArtist,
  parseSpotifySearch,
  parseYtmArtist,
  parseYtmSearch,
  ytmPlaylistId,
} from '../src/shared/parsers.js';

// Echte (gekürzte) Antworten, aufgenommen im Oktober 2026. Bei YouTube Music lieferte die
// Testumgebung keine Alben – je ein Album-Eintrag wurde nach dem Muster der Playlists ergänzt.
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const names = (list) => list.map((i) => i.name);

test('Spotify-Suche „Alles“: Playlists, Alben, Künstler, Songs und Top-Treffer', () => {
  const r = parseSpotifySearch(fixture('spotify-search-all.json'));
  assert.deepEqual(r.tracks.map((t) => t.title), ['Yellow', 'Viva La Vida', 'Sparks']);
  assert.deepEqual(names(r.playlists), ['Best Of Coldplay ⭐', 'Top 20 Coldplay Greatest Hits Playlist ❤️ Best Songs of Coldplay', 'Coldplay Radio']);
  assert.equal(r.playlists[2].subtitle, 'Spotify');
  assert.equal(r.playlists[0].ref.uri, 'spotify:playlist:1iYPdwq16bfcUR3WCMpIT8');
  assert.match(r.playlists[0].image, /^https:\/\//);
  assert.deepEqual(names(r.albums), ['Parachutes', 'Yellow', 'A Rush of Blood to the Head']);
  assert.equal(r.albums[0].subtitle, 'Coldplay · 2000');
  assert.equal(r.albums[0].kind, 'album');
  assert.deepEqual(names(r.artists), ['Coldplay', 'Imagine Dragons', 'OneRepublic']);
  assert.equal(r.artists[0].kind, 'artist');
  assert.equal(r.artists[0].ref.uri, 'spotify:artist:4gzpq5DPGxSnKTe4SA8HAU');
  assert.match(r.artists[0].image, /^https:\/\/i\.scdn\.co\//);
  assert.equal(r.top.kind, 'artist');
  assert.equal(r.top.name, 'Coldplay');
});

test('Spotify-Künstlerseite: beliebte Songs, Alben, Playlists, ähnliche Künstler', () => {
  const page = parseSpotifyArtist(fixture('spotify-artist.json'));
  assert.equal(page.artist.name, 'Coldplay');
  assert.equal(page.artist.subtitle, '94 Mio. Hörer im Monat');
  assert.equal(page.artist.ref.uri, 'spotify:artist:4gzpq5DPGxSnKTe4SA8HAU');
  assert.deepEqual(page.tracks.map((t) => t.title), ['Yellow', 'Viva La Vida', 'Sparks', 'The Scientist']);
  assert.ok(page.tracks.every((t) => t.duration > 0 && t.ref.uri.startsWith('spotify:track:')));
  // beliebte Alben zuerst, ohne Doppelte, Singles dahinter
  assert.equal(page.albums[0].name, 'Parachutes');
  assert.equal(page.albums[0].subtitle, 'Album · 2000');
  assert.equal(new Set(page.albums.map((a) => a.id)).size, page.albums.length);
  assert.ok(page.albums.some((a) => a.subtitle.startsWith('Single')));
  assert.ok(names(page.playlists).includes('This Is Coldplay'));
  assert.deepEqual(names(page.related), ['Keane', 'Maroon 5']);
  assert.equal(parseSpotifyArtist('{}'), null);
});

test('YouTube-Music-Suche „Alles“: Künstler, Playlists, Alben, ohne Profile und Podcasts', () => {
  const r = parseYtmSearch(fixture('ytmusic-search-all.json'));
  assert.deepEqual(names(r.artists), ['Coldplay', 'Avicii', 'The Chainsmokers']);
  assert.equal(r.artists[0].subtitle, '345 Mio. Zuschauer/Monat');
  assert.equal(r.artists[0].ref.browseId, 'UCIaFw5VBEK8qaW6nRpx_qnw');
  assert.equal(r.top.name, 'Coldplay');
  assert.equal(r.playlists.length, 2);
  assert.equal(r.playlists[0].subtitle, 'ALAN&PABLO • 216.396 Aufrufe');
  assert.equal(r.playlists[0].ref.playlistId, 'PLWVo2tank-zw_Cg0nzfvxsaD-TYelJAOv');
  assert.equal(r.albums.length, 1);
  assert.equal(r.albums[0].name, 'Parachutes');
  assert.equal(r.albums[0].subtitle, 'Coldplay • 2000');
  assert.equal(r.albums[0].ref.playlistId, 'OLAK5uy_ktestParachutesAlbum');
  // Videos sind Songs, Profile/Podcasts/Folgen tauchen nirgends auf
  assert.deepEqual(r.tracks.map((t) => t.id), ['cIGd8gm_pYE', 'VlSEIa1zubs']);
  const all = [...r.playlists, ...r.albums, ...r.artists].map((i) => i.subtitle).join(' ');
  assert.doesNotMatch(all, /Profil|Podcast|Folge/);
  assert.deepEqual(parseYtmSearch('kaputt'), emptySearch());
});

test('YouTube-Music-Künstlerseite: Videos als Songs, wenn keine Songliste da ist', () => {
  const page = parseYtmArtist(fixture('ytmusic-artist.json'));
  assert.equal(page.artist.name, 'Coldplay');
  assert.match(page.artist.image, /^https:\/\/lh3\.googleusercontent\.com\//);
  assert.deepEqual(page.tracks.map((t) => t.title), ['Yellow', 'The Scientist', 'A Sky Full of Stars (Live at River Plate)', 'Viva La Vida (Live)']);
  assert.equal(page.tracks[0].artist, 'Coldplay');
  assert.equal(page.tracks[0].ref.videoId, 'yKNxeF4KMsY');
  assert.equal(page.playlists.length, 2);
  assert.equal(page.albums[0].name, 'Parachutes');
});

test('YouTube Music: playlistId eines Albums aus der Songliste', () => {
  const album = JSON.stringify({ contents: [{ musicResponsiveListItemRenderer: {
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'a', playlistId: 'OLAK5uy_abc' } } } } } },
    menu: { watchEndpoint: { videoId: 'a', playlistId: 'RDAMVMa' } },
  } }] });
  assert.equal(ytmPlaylistId(album), 'OLAK5uy_abc');
  assert.equal(ytmPlaylistId('{}'), '');
});

test('Amazon-Suche: Alben, Playlists (auch Community) und Künstler, ohne Podcasts und Hörbücher', () => {
  const r = parseAmazonSearch(fixture('amazon-search-all.json'));
  assert.equal(r.tracks.length, 2);
  assert.deepEqual(names(r.albums), ['Clair de lune', 'Clair de Lune']);
  assert.equal(r.albums[0].subtitle, 'Menahem Pressler & Claude Debussy · 2018');
  assert.equal(r.albums[0].ref.deeplink, '/albums/B079JTSF3K');
  // Playlist-Namen stehen bei Amazon nur im Platzhalter
  assert.deepEqual(names(r.playlists), ['Calming Music for Plants', 'Tremembé (Música da Série Original Prime)', 'DEBUSSY CLAIR DE LUNE,SUITE BERGAMASQUE by MB', 'Klassische Musik']);
  assert.equal(r.playlists[2].ref.deeplink, '/user-playlists/1ed19bfc081843e1ae1919e700b7438afrfr');
  assert.deepEqual(names(r.artists), ['Menahem Pressler', 'Claude Debussy']);
  assert.equal(r.artists[1].ref.deeplink, '/artists/B001PU7MDM/claude-debussy');
  const everything = JSON.stringify(r);
  assert.doesNotMatch(everything, /podcasts|audiobooks/);
});

test('Zahlen kurz auf Deutsch', () => {
  assert.equal(compactNumber(94044806), '94 Mio.');
  assert.equal(compactNumber(1500), '1500');
  assert.equal(compactNumber(0), '');
  assert.equal(compactNumber('x'), '');
});
