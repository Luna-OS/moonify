import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  interleave,
  parseAmazonTracks,
  parseDuration,
  parseSpotifyCollections,
  parseSpotifyTracks,
  parseYtmChips,
  parseYtmCollections,
  parseYtmTracks,
  pickImage,
  pickRelevant,
  relevantCount,
  ytmSongsChip,
} from '../src/shared/parsers.js';

// Echte (gekürzte) Antworten der Web-Player, aufgenommen im Oktober 2026
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('Spotify-Suche: Songs mit Künstler, Album, Dauer und Cover', () => {
  const tracks = parseSpotifyTracks(fixture('spotify-search.json'));
  assert.equal(tracks.length, 4);
  const [first] = tracks;
  assert.equal(first.provider, 'spotify');
  assert.equal(first.title, 'Clair de Lune');
  assert.equal(first.artist, 'Johann Debussy');
  assert.equal(first.album, 'Clair de Lune');
  assert.equal(first.duration, 275);
  assert.match(first.image, /^https:\/\/i\.scdn\.co\//);
  assert.equal(first.ref.uri, 'spotify:track:6Er8Fz6fuZNi5cvwQjv1ya');
  assert.equal(tracks[1].artist, 'Claude Debussy, Alexis Weissenberg');
});

test('Spotify-Playlist: Songs und Playlist-Infos', () => {
  const raw = fixture('spotify-playlist.json');
  const tracks = parseSpotifyTracks(raw);
  assert.equal(tracks.length, 4);
  assert.equal(tracks[0].title, 'Patient Zero');
  assert.equal(tracks[0].artist, 'Taylor Swift');
  assert.equal(tracks[0].duration, 226);
  const [playlist] = parseSpotifyCollections(raw);
  assert.equal(playlist.name, 'Today’s Top Hits');
  assert.equal(playlist.kind, 'playlist');
  assert.equal(playlist.ref.uri, 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
  assert.match(playlist.image, /^https:\/\//);
});

test('Spotify-Bibliothek: Lieblingssongs, Playlists und Alben', () => {
  const library = {
    data: {
      me: {
        libraryV3: {
          items: [
            { item: { data: { __typename: 'PseudoPlaylist', uri: 'spotify:user:luna:collection', name: 'Liked Songs' } } },
            { item: { data: { __typename: 'Playlist', uri: 'spotify:playlist:abc', name: 'Mondnacht', ownerV2: { data: { name: 'Luna' } }, images: { items: [{ sources: [{ url: 'https://i.scdn.co/image/x', width: 300 }] }] } } } },
            { item: { data: { __typename: 'Album', uri: 'spotify:album:def', name: 'Clair de Lune', artists: { items: [{ profile: { name: 'Debussy' } }] }, coverArt: { sources: [{ url: 'https://i.scdn.co/image/y', width: 300 }] } } } },
          ],
        },
      },
    },
  };
  const items = parseSpotifyCollections(library);
  assert.deepEqual(items.map((i) => [i.kind, i.name, i.ref.uri]), [
    ['playlist', 'Lieblingssongs', 'spotify:collection:tracks'],
    ['playlist', 'Mondnacht', 'spotify:playlist:abc'],
    ['album', 'Clair de Lune', 'spotify:album:def'],
  ]);
  assert.equal(items[1].subtitle, 'Luna');
  assert.equal(items[2].subtitle, 'Debussy');
});

test('YouTube-Music-Suche: Videos werden zu abspielbaren Einträgen', () => {
  const tracks = parseYtmTracks(fixture('ytmusic-search.json'));
  assert.ok(tracks.length >= 3);
  assert.equal(tracks[0].ref.videoId, '2fpIa30D6oM');
  assert.equal(tracks[0].title, 'Clair de lune debussy');
  assert.equal(tracks[0].artist, 'dindin.inparis');
  // Podcast-Folgen sind keine Songs
  assert.ok(tracks.every((t) => !/Folge/.test(t.artist)));
  assert.ok(tracks.every((t) => t.image.startsWith('https://')));
});

test('YouTube-Music-Playlist: Dauer und Künstler aus den Spalten', () => {
  const tracks = parseYtmTracks(fixture('ytmusic-playlist.json'));
  assert.equal(tracks.length, 4);
  assert.equal(tracks[0].title, 'I Knew It, I Knew You');
  assert.equal(tracks[0].artist, 'Taylor Swift');
  assert.equal(tracks[0].duration, 184);
  assert.equal(tracks[3].artist, 'Ella Langley, Morgan Wallen');
});

test('YouTube-Music: Filter-Chips und Playlists der Bibliothek', () => {
  const chips = parseYtmChips(fixture('ytmusic-search.json'));
  assert.ok(chips.some((c) => c.label === 'Videos'));
  assert.equal(ytmSongsChip(chips), null);
  assert.deepEqual(ytmSongsChip([{ label: 'Titel', params: 'abc' }]), { label: 'Titel', params: 'abc' });
  const library = {
    contents: [
      { musicTwoRowItemRenderer: { title: { runs: [{ text: 'Gute Nacht' }] }, subtitle: { runs: [{ text: 'Playlist' }, { text: ' • ' }, { text: 'Luna' }] }, navigationEndpoint: { browseEndpoint: { browseId: 'VLPL123' } } } },
      { musicTwoRowItemRenderer: { title: { runs: [{ text: 'Neue Episode' }] }, navigationEndpoint: { browseEndpoint: { browseId: 'MPSPxyz' } } } },
      { musicTwoRowItemRenderer: { title: { runs: [{ text: 'Album' }] }, navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_1' } } } },
    ],
  };
  const items = parseYtmCollections(library);
  assert.deepEqual(items.map((i) => [i.kind, i.name, i.ref.playlistId]), [
    ['playlist', 'Gute Nacht', 'PL123'],
    ['album', 'Album', ''],
  ]);
  assert.equal(items[0].subtitle, 'Playlist • Luna');
});

test('Amazon-Music-Suche: Songs mit Link zum Abspielen, Alben werden übersprungen', () => {
  const tracks = parseAmazonTracks(fixture('amazon-search.json'));
  assert.equal(tracks.length, 4);
  assert.equal(tracks[0].title, 'Clair De Lune');
  assert.equal(tracks[0].artist, 'Claude Debussy');
  assert.equal(tracks[0].id, 'B002G71OV4');
  assert.equal(tracks[0].ref.deeplink, '/albums/B00842WY0K?trackAsin=B002G71OV4');
  assert.match(tracks[0].image, /^https:\/\/m\.media-amazon\.com\//);
});

test('Parser vertragen kaputte Daten', () => {
  for (const parser of [parseSpotifyTracks, parseSpotifyCollections, parseYtmTracks, parseYtmCollections, parseAmazonTracks, parseYtmChips]) {
    assert.deepEqual(parser('{kaputt'), []);
    assert.deepEqual(parser(null), []);
    assert.deepEqual(parser({}), []);
  }
});

test('Hilfsfunktionen', () => {
  assert.equal(parseDuration('3:07'), 187);
  assert.equal(parseDuration('1:02:45'), 3765);
  assert.equal(parseDuration('7,9 Mio. Aufrufe'), 0);
  assert.equal(pickImage([{ url: 'https://a/64', width: 64 }, { url: 'https://a/300', width: 300 }, { url: 'https://a/640', width: 640 }]), 'https://a/300');
  assert.equal(pickImage([{ url: 'http://unsicher', width: 300 }]), '');
  assert.deepEqual(interleave([[1, 2, 3], ['a'], ['x', 'y']]), [1, 'a', 'x', 2, 'y', 3]);
});

test('Unpassende Song-Filter-Ergebnisse werden durch normale Treffer ersetzt', () => {
  const t = (title, artist = '') => ({ title, artist, album: '' });
  const songs = [t('Moonlight Sonata', 'Beethoven'), t('Nostalgia', 'Yanni')];
  const plain = [t('Clair de Lune', 'Debussy'), t('Lullaby')];
  assert.equal(relevantCount(songs, 'Clair de Lune'), 0);
  assert.equal(relevantCount(plain, 'Clair de Lune'), 1);
  assert.equal(pickRelevant(songs, plain, 'Clair de Lune'), plain);
  const good = [t('Clair de Lune', 'Debussy')];
  assert.equal(pickRelevant(good, plain, 'clair de lune'), good);
  assert.equal(pickRelevant([], plain, 'x'), plain);
});
