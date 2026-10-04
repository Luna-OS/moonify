import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTime, normalizeState, safeImageUrl } from '../src/renderer/lib/format.js';
import { PlayerHub } from '../src/renderer/lib/player.js';

function clock() {
  let t = 0;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test('Zeitformat', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(187.9), '3:07');
  assert.equal(formatTime(3765), '1:02:45');
  assert.equal(formatTime(NaN), '0:00');
});

test('Cover nur über https, Texte werden begrenzt', () => {
  assert.equal(safeImageUrl('https://i.scdn.co/image/abc'), 'https://i.scdn.co/image/abc');
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('http://insecure/img.png'), '');
  const s = normalizeState({ title: 'x'.repeat(1000), playing: 'true', position: 500, duration: 200, artwork: 'file:///etc/passwd' });
  assert.equal(s.title.length, 300);
  assert.equal(s.playing, false);
  assert.equal(s.position, 200);
  assert.equal(s.artwork, '');
});

test('der Anbieter, der zuletzt startet, wird angezeigt – die anderen werden pausiert', () => {
  const hub = new PlayerHub(clock());
  const paused = [];
  hub.addEventListener('pause-others', (e) => paused.push(...e.detail.ids));

  hub.update('spotify', { title: 'Song A', playing: true, duration: 200, position: 10 });
  assert.equal(hub.current().id, 'spotify');
  assert.deepEqual(paused, []);

  hub.update('ytmusic', { title: 'Song B', playing: true, duration: 180, position: 0 });
  assert.equal(hub.current().id, 'ytmusic');
  assert.deepEqual(paused, ['spotify']);
});

test('Position wird während der Wiedergabe hochgerechnet', () => {
  const now = clock();
  const hub = new PlayerHub(now);
  hub.update('amazon', { title: 'Song', playing: true, duration: 100, position: 20 });
  now.advance(5000);
  assert.equal(hub.current().position, 25);
  hub.update('amazon', { title: 'Song', playing: false, duration: 100, position: 25 });
  now.advance(5000);
  assert.equal(hub.current().position, 25);
  now.advance(500000);
  hub.update('amazon', { title: 'Song', playing: true, duration: 100, position: 99 });
  now.advance(5000);
  assert.equal(hub.current().position, 100);
});

test('beim Trennen übernimmt ein anderer Anbieter oder nichts', () => {
  const hub = new PlayerHub(clock());
  hub.update('spotify', { title: 'A', playing: false });
  hub.update('ytmusic', { title: 'B', playing: true, duration: 10 });
  hub.remove('ytmusic');
  assert.equal(hub.current().id, 'spotify');
  hub.remove('spotify');
  assert.equal(hub.current(), null);
});

test('ein Anbieter ohne Song verdrängt die Anzeige nicht', () => {
  const hub = new PlayerHub(clock());
  hub.update('spotify', { title: 'Song A', playing: false, duration: 100 });
  hub.update('ytmusic', { title: 'Song B', playing: true, duration: 100 });
  hub.update('ytmusic', { title: '', playing: false });
  assert.equal(hub.current().id, 'spotify');
  hub.update('spotify', { title: '', playing: false });
  assert.equal(hub.current(), null);
});
