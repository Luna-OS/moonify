import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeLineIndex,
  cleanArtist,
  cleanTitle,
  createLyricsService,
  findLyrics,
  parseLrc,
  pickBest,
  primaryArtist,
  toLyrics,
} from '../src/shared/lyrics.js';

// Gekürzte echte Antwort von lrclib.net/api/get (Coldplay – Yellow)
const YELLOW = {
  id: 16232,
  trackName: 'Yellow',
  artistName: 'Coldplay',
  albumName: 'Yellow - Single',
  duration: 267,
  instrumental: false,
  plainLyrics: 'Look at the stars\nLook how they shine for you\n\nAnd everything you do',
  syncedLyrics: '[00:33.62] Look at the stars\n[00:37.31] Look how they shine for you\n[00:42.16] \n[00:43.45] And everything you do\n',
};

test('Titel werden von Video-Zusätzen befreit', () => {
  assert.equal(cleanTitle('Yellow (Official Video)'), 'Yellow');
  assert.equal(cleanTitle('Coldplay - Yellow (Official Video)', 'ColdplayVEVO'), 'Yellow');
  assert.equal(cleanTitle('Bohemian Rhapsody - Remastered 2011'), 'Bohemian Rhapsody');
  assert.equal(cleanTitle('Señorita (feat. Camila Cabello) [Lyric Video]'), 'Señorita');
  assert.equal(cleanTitle('Song ft. Someone'), 'Song');
  assert.equal(cleanTitle('Atemlos durch die Nacht'), 'Atemlos durch die Nacht');
  // Klammern, die zum Titel gehören, bleiben
  assert.equal(cleanTitle('(I Can\'t Get No) Satisfaction'), '(I Can\'t Get No) Satisfaction');
  assert.equal(cleanTitle('Smells Like Teen Spirit (Live)'), 'Smells Like Teen Spirit');
});

test('Künstlernamen werden vereinheitlicht', () => {
  assert.equal(cleanArtist('Coldplay - Topic'), 'Coldplay');
  assert.equal(cleanArtist('ColdplayVEVO'), 'Coldplay');
  assert.equal(cleanArtist('Coldplay • Parachutes • 2000'), 'Coldplay');
  assert.equal(primaryArtist('Shawn Mendes, Camila Cabello'), 'Shawn Mendes');
  assert.equal(primaryArtist('David Guetta feat. Sia'), 'David Guetta');
  assert.equal(primaryArtist('Helene Fischer'), 'Helene Fischer');
});

test('LRC wird in Zeilen mit Zeit zerlegt', () => {
  const lines = parseLrc('[ar:Coldplay]\n[00:33.62] Look at the stars\n[01:02.5]Zwei\n[00:10.00][00:50.00]Refrain\n[02:00]');
  assert.deepEqual(lines, [
    { time: 10, text: 'Refrain' },
    { time: 33.62, text: 'Look at the stars' },
    { time: 50, text: 'Refrain' },
    { time: 62.5, text: 'Zwei' },
    { time: 120, text: '' },
  ]);
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc(null), []);
});

test('Die gerade gesungene Zeile wird gefunden', () => {
  const lines = parseLrc(YELLOW.syncedLyrics);
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 33.5), 0); // kurz vorher schon hervorheben
  assert.equal(activeLineIndex(lines, 38), 1);
  assert.equal(activeLineIndex(lines, 500), lines.length - 1);
  assert.equal(activeLineIndex([], 10), -1);
});

test('LRCLIB-Datensatz wird zum Songtext', () => {
  const result = toLyrics(YELLOW);
  assert.equal(result.trackName, 'Yellow');
  assert.equal(result.synced.length, 4);
  assert.equal(result.synced[2].text, ''); // Pause bleibt als ♪ erhalten
  assert.match(result.plain, /^Look at the stars/);
  assert.equal(toLyrics({ trackName: 'X', plainLyrics: '', syncedLyrics: null, instrumental: false }), null);
  assert.equal(toLyrics({ trackName: 'X', instrumental: true }).instrumental, true);
  // Nur ungesyncter Text
  const plain = toLyrics({ trackName: 'X', plainLyrics: 'eins\nzwei' });
  assert.equal(plain.synced, null);
  assert.equal(plain.plain, 'eins\nzwei');
});

test('Bester Treffer: richtiger Song, passende Länge, mit Zeitstempeln', () => {
  const query = { title: 'Yellow', artist: 'Coldplay', duration: 267 };
  const records = [
    { trackName: 'Yellow Submarine', artistName: 'The Beatles', duration: 160, plainLyrics: 'x' },
    { trackName: 'Yellow', artistName: 'Coldplay', duration: 320, plainLyrics: 'live' },
    { trackName: 'Yellow', artistName: 'Coldplay', duration: 268, plainLyrics: 'plain' },
    { trackName: 'Yellow', artistName: 'Coldplay', duration: 266, plainLyrics: 'p', syncedLyrics: '[00:01.00]a' },
  ];
  assert.equal(pickBest(records, query), records[3]);
  // Falscher Künstler → kein Treffer
  assert.equal(pickBest([{ trackName: 'Yellow', artistName: 'Someone Else', duration: 267, plainLyrics: 'x' }], query), null);
  assert.equal(pickBest(null, query), null);
});

function fakeApi(routes) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    for (const [part, reply] of routes) {
      if (url.includes(part)) {
        if (reply instanceof Error) throw reply;
        return reply;
      }
    }
    return { status: 404, data: null };
  };
  return { calls, fetchJson };
}

test('findLyrics: direkter Treffer reicht', async () => {
  const api = fakeApi([['/get?', { status: 200, data: YELLOW }]]);
  const result = await findLyrics({ title: 'Yellow (Official Video)', artist: 'Coldplay', duration: 267.4 }, api.fetchJson);
  assert.equal(result.trackName, 'Yellow');
  assert.equal(api.calls.length, 1);
  assert.match(api.calls[0], /track_name=Yellow&artist_name=Coldplay&duration=267/);
});

test('findLyrics: sonst Suche, am Ende freie Suche', async () => {
  const api = fakeApi([
    ['/search?track_name', { status: 200, data: [] }],
    ['/search?q=', { status: 200, data: [YELLOW] }],
  ]);
  const result = await findLyrics({ title: 'Yellow', artist: 'Coldplay', duration: 0 }, api.fetchJson);
  assert.equal(result.trackName, 'Yellow');
  assert.equal(api.calls.length, 3);
});

test('findLyrics: nichts gefunden → null', async () => {
  const none = fakeApi([['/search?', { status: 200, data: [] }]]);
  assert.equal(await findLyrics({ title: 'Unbekannt', artist: 'Niemand' }, none.fetchJson), null);
  assert.equal(await findLyrics({ title: '', artist: 'Niemand' }, none.fetchJson), null);
});

test('findLyrics: eine überlastete Suche wird von der anderen aufgefangen', async () => {
  const api = fakeApi([
    ['/get?', new Error('503')],
    ['/search?track_name', new Error('503')],
    ['/search?q=', { status: 200, data: [YELLOW] }],
  ]);
  const result = await findLyrics({ title: 'Yellow', artist: 'Coldplay', duration: 267 }, api.fetchJson);
  assert.equal(result.trackName, 'Yellow');
});

test('findLyrics: nichts gefunden, aber Abfragen fehlgeschlagen → Fehler statt „kein Songtext“', async () => {
  const api = fakeApi([['/search?track_name', new Error('überlastet')], ['/search?q=', { status: 200, data: [] }]]);
  await assert.rejects(findLyrics({ title: 'Yellow', artist: 'Coldplay' }, api.fetchJson), /überlastet/);
});

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('Dienst: Zwischenspeicher, Wiederholung bei Überlastung, User-Agent', async () => {
  const seen = [];
  let busy = true;
  const fetchImpl = async (url, init) => {
    seen.push({ url, agent: init.headers['User-Agent'] });
    if (url.includes('/get?')) {
      if (busy) {
        busy = false;
        return response(503, {});
      }
      return response(200, YELLOW);
    }
    return response(404, {});
  };
  const lookup = createLyricsService(fetchImpl, { userAgent: 'Moonify/test', wait: async () => {} });
  const first = await lookup({ title: 'Yellow', artist: 'Coldplay', duration: 267 });
  assert.equal(first.trackName, 'Yellow');
  assert.equal(seen.length, 2); // 503, dann Erfolg
  assert.equal(seen[0].agent, 'Moonify/test');
  // Gleicher Song (andere Schreibweise) → aus dem Zwischenspeicher
  await lookup({ title: 'Yellow (Official Video)', artist: 'Coldplay - Topic', duration: 267.2 });
  assert.equal(seen.length, 2);
});

test('Dienst: „kein Songtext“ wird nur kurz gemerkt', async () => {
  let calls = 0;
  let clock = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    return url.includes('/search?') ? response(200, []) : response(404, {});
  };
  const lookup = createLyricsService(fetchImpl, { now: () => clock });
  assert.equal(await lookup({ title: 'Leise', artist: 'Niemand' }), null);
  const after = calls;
  assert.equal(await lookup({ title: 'Leise', artist: 'Niemand' }), null);
  assert.equal(calls, after);
  clock = 11 * 60 * 1000;
  await lookup({ title: 'Leise', artist: 'Niemand' });
  assert.ok(calls > after);
});
