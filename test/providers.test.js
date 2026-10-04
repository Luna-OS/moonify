import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROVIDERS, getProvider, getProviderByPartition, hostMatches, isInAppUrl } from '../src/shared/providers.js';

test('genau die drei Anbieter mit eigenen Sitzungen', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ['spotify', 'ytmusic', 'amazon']);
  assert.equal(new Set(PROVIDERS.map((p) => p.partition)).size, 3);
  for (const p of PROVIDERS) assert.ok(p.partition.startsWith('persist:'));
  assert.equal(getProviderByPartition('persist:moonify-amazon').id, 'amazon');
  assert.equal(getProviderByPartition('persist:other'), null);
});

test('Such-URLs werden korrekt kodiert', () => {
  assert.equal(getProvider('spotify').search('AC/DC & co'), 'https://open.spotify.com/search/AC%2FDC%20%26%20co');
  assert.equal(getProvider('ytmusic').search('Mond lied'), 'https://music.youtube.com/search?q=Mond%20lied');
  assert.equal(getProvider('amazon').search('Luna', { amazonRegion: 'de' }), 'https://music.amazon.de/search/Luna');
  assert.equal(getProvider('amazon').search('Luna', { amazonRegion: 'com' }), 'https://music.amazon.com/search/Luna');
  assert.equal(getProvider('amazon').home({ amazonRegion: 'gibtsnicht' }), 'https://music.amazon.de/');
});

test('Domain-Prüfung akzeptiert Subdomains, aber keine Täuschungen', () => {
  assert.ok(hostMatches('accounts.spotify.com', 'spotify.com'));
  assert.ok(hostMatches('spotify.com', 'spotify.com'));
  assert.ok(!hostMatches('evilspotify.com', 'spotify.com'));
  assert.ok(!hostMatches('spotify.com.evil.net', 'spotify.com'));
});

test('Login-Popups bleiben in der App, alles andere öffnet extern', () => {
  const spotify = getProvider('spotify');
  assert.ok(isInAppUrl(spotify, 'https://accounts.spotify.com/login'));
  assert.ok(isInAppUrl(spotify, 'https://appleid.apple.com/auth/authorize'));
  assert.ok(isInAppUrl(spotify, 'https://accounts.google.com/o/oauth2'));
  assert.ok(!isInAppUrl(spotify, 'http://accounts.spotify.com/'));
  assert.ok(!isInAppUrl(spotify, 'https://example.com/'));
  assert.ok(!isInAppUrl(spotify, 'nicht-mal-eine-url'));
  assert.ok(!isInAppUrl(spotify, 'https://music.amazon.de/'));
});
