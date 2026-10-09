import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EndDetector, Queue, titlesMatch } from '../src/renderer/lib/queue.js';

const t = (id, title = id, provider = 'spotify') => ({ id, title, provider });

test('Titel-Vergleich ist großzügig', () => {
  assert.ok(titlesMatch('Clair de Lune', 'Clair de Lune - Remastered 2020'));
  assert.ok(titlesMatch('Clair de lune (Live)', 'clair de lune'));
  assert.ok(titlesMatch('Für Elise', 'Fur Elise'));
  assert.ok(!titlesMatch('Clair de Lune', 'Moonlight Sonata'));
  assert.ok(!titlesMatch('', 'x'));
});

test('Warteschlange: abspielen, als Nächstes, hinten anstellen', () => {
  const q = new Queue();
  assert.equal(q.active, false);
  assert.equal(q.set([t('a'), t('b'), t('c')], 1).id, 'b');
  q.playNext(t('x'));
  q.add(t('z'));
  assert.deepEqual(q.upcoming().map((i) => i.id), ['x', 'c', 'z']);
  assert.equal(q.next().id, 'x');
  assert.equal(q.previous().id, 'b');
  assert.ok(q.remove(0));
  assert.deepEqual(q.upcoming().map((i) => i.id), ['c', 'z']);
  assert.equal(q.next().id, 'c');
  assert.equal(q.next().id, 'z');
  assert.equal(q.next(), null);
  assert.equal(q.active, false);
});

test('Einzelner Song behält die restliche Warteschlange', () => {
  const q = new Queue();
  q.set([t('a'), t('b'), t('c')]);
  q.playNow(t('n'));
  assert.equal(q.current().id, 'n');
  assert.deepEqual(q.upcoming().map((i) => i.id), ['b', 'c']);
  const empty = new Queue();
  assert.equal(empty.add(t('first')).id, 'first');
});

test('Song-Ende: normal zu Ende gespielt', () => {
  const d = new EndDetector();
  d.reset(t('a', 'Clair de Lune'), 0);
  assert.equal(d.observe('spotify', { title: 'Alter Song', playing: true, position: 10, duration: 100 }, 1000), false);
  assert.equal(d.observe('spotify', { title: 'Clair de Lune', playing: true, position: 1, duration: 300 }, 2000), false);
  assert.equal(d.observe('spotify', { title: 'Clair de Lune', playing: true, position: 150, duration: 300 }, 3000), false);
  assert.equal(d.observe('spotify', { title: 'Clair de Lune', playing: false, position: 299.5, duration: 300 }, 4000), true);
  assert.equal(d.observe('spotify', { title: 'Clair de Lune', playing: false, position: 300, duration: 300 }, 5000), false);
});

test('Song-Ende: Dienst spielt von selbst etwas anderes', () => {
  const d = new EndDetector();
  d.reset(t('a', 'Clair de Lune', 'ytmusic'), 0);
  d.observe('ytmusic', { title: 'Clair de Lune', playing: true, position: 1, duration: 300 }, 1000);
  assert.equal(d.observe('spotify', { title: 'Anderes', playing: true }, 2000), false);
  assert.equal(d.observe('ytmusic', { title: 'Clair de Lune', playing: false, position: 120, duration: 300 }, 3000), false);
  assert.equal(d.observe('ytmusic', { title: 'Autoplay-Song', playing: true, position: 1, duration: 200 }, 4000), true);
});

test('Song-Ende: abweichender Titel beim Start wird nach 20 s akzeptiert, nicht übersprungen', () => {
  const d = new EndDetector();
  d.reset(t('a', 'Debussy: Clair de lune, CD 82 No. 3', 'amazon'), 0);
  assert.equal(d.observe('amazon', { title: 'Suite bergamasque: III', playing: true, position: 5, duration: 300 }, 5000), false);
  assert.equal(d.observe('amazon', { title: 'Suite bergamasque: III', playing: true, position: 25, duration: 300 }, 25000), false);
  assert.equal(d.observe('amazon', { title: 'Suite bergamasque: III', playing: true, position: 60, duration: 300 }, 60000), false);
  assert.equal(d.observe('amazon', { title: 'Suite bergamasque: III', playing: false, position: 299, duration: 300 }, 300000), true);
});
