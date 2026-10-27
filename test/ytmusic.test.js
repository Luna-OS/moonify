import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  parseSpotifyTracks,
  parseYtmBrowse,
  parseYtmLyrics,
  parseYtmNext,
  parseYtmSuggestions,
  parseYtmTracks,
} from '../src/shared/parsers.js';

// Echte (gekürzte) Antworten von YouTube Music ohne Anmeldung, aufgenommen im Oktober 2026
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('Erkunden: Navigations-Knöpfe (ohne Podcasts), angesagte Songs mit Platz, neue Musikvideos', () => {
  const page = parseYtmBrowse(fixture('ytmusic-explore.json'));
  const [nav, trending, videos] = page.sections;
  assert.deepEqual(nav.nav.map((n) => [n.label, n.browseId]), [['Neu', 'FEmusic_new_releases'], ['Charts', 'FEmusic_charts']]);
  assert.equal(nav.nav[1].params, 'sgYPRkVtdXNpY19leHBsb3Jl');
  assert.equal(trending.title, 'Angesagt');
  assert.equal(trending.tracks.length, 3);
  assert.equal(trending.tracks[0].title, 'Tarantino (Official Music Video)');
  assert.equal(trending.tracks[0].artist, 'LISA');
  assert.equal(trending.tracks[0].rank, '1');
  assert.match(trending.more.browseId, /^VLOLAK5uy_/);
  assert.equal(videos.title, 'Neue Musikvideos');
  assert.ok(videos.tracks.length > 0);
  assert.ok(videos.tracks.every((t) => t.ref.videoId));
  assert.equal(videos.more.browseId, 'FEmusic_new_releases_videos');
  // Folgen/Podcasts tauchen nicht auf
  assert.doesNotMatch(JSON.stringify(page.sections.map((s) => s.title)), /Folgen|Podcast/);
});

test('Charts: Playlists und Top-Künstler', () => {
  const page = parseYtmBrowse(fixture('ytmusic-charts.json'));
  assert.equal(page.title, 'Charts');
  const titles = page.sections.map((s) => s.title);
  assert.ok(titles.includes('Video-Charts'));
  const artists = page.sections.find((s) => s.title === 'Top-Künstler');
  assert.ok(artists.items.length > 0);
  assert.ok(artists.items.every((i) => i.kind === 'artist' && i.ref.browseId.startsWith('UC')));
  const charts = page.sections.find((s) => s.title === 'Video-Charts');
  assert.ok(charts.items.every((i) => i.kind === 'playlist' && i.ref.playlistId));
  assert.ok(!titles.some((t) => /Podcast/.test(t)));
});

test('Als Nächstes: Warteschlange des Dienstes, Songtext-/Ähnlich-Seite, Gefällt-mir-Status', () => {
  const next = parseYtmNext(fixture('ytmusic-next.json'));
  assert.equal(next.tracks.length, 3);
  assert.equal(next.tracks[0].id, 'VlSEIa1zubs');
  assert.equal(next.tracks[0].selected, true);
  assert.equal(next.tracks[0].artist, 'Coldplay');
  assert.equal(next.tracks[0].duration, 221);
  assert.equal(next.tracks[1].selected, false);
  assert.equal(next.playlistId, 'RDAMVMVlSEIa1zubs');
  assert.match(next.lyricsId, /^MPLYt/);
  assert.match(next.relatedId, /^MPTRt/);
  assert.equal(next.likeStatus, 'INDIFFERENT');
  assert.deepEqual(parseYtmNext('kaputt').tracks, []);
});

test('Songtext von YouTube Music', () => {
  const lyrics = parseYtmLyrics(fixture('ytmusic-lyrics.json'));
  assert.match(lyrics.text, /^Whoa/);
  assert.match(lyrics.text, /I pray that I don't give up/);
  assert.equal(parseYtmLyrics('{}'), null);
});

test('Suchvorschläge', () => {
  const s = parseYtmSuggestions(fixture('ytmusic-suggestions.json'));
  assert.equal(s.queries[0], 'coldplay');
  assert.ok(s.queries.includes('coldplay viva la vida'));
  assert.equal(new Set(s.queries).size, s.queries.length);
});

test('Songs kennen ihren Künstler und ihr Album („Zum Künstler“ / „Zum Album“)', () => {
  const [spotify] = parseSpotifyTracks(fixture('spotify-search.json'));
  assert.equal(spotify.artistLink.kind, 'artist');
  assert.match(spotify.artistLink.ref.uri, /^spotify:artist:/);
  assert.equal(spotify.albumLink.kind, 'album');
  assert.equal(spotify.albumLink.name, 'Clair de Lune');
  assert.equal(spotify.albumLink.ref.uri, 'spotify:album:4Bz2SosHKpUoQknNNOfrwI');
  const yt = parseYtmTracks(fixture('ytmusic-playlist.json')).find((t) => t.artistLink);
  assert.ok(yt, 'mindestens ein YT-Music-Song mit Künstler-Link');
  assert.match(yt.artistLink.ref.browseId, /^UC/);
});
