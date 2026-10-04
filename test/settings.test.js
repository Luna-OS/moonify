import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSettings, enabledIds, loadSettings, sanitizeSettings, saveSettings } from '../src/renderer/lib/settings.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

test('kein Anbieter ist standardmäßig verbunden', () => {
  assert.deepEqual(enabledIds(defaultSettings()), []);
});

test('nur ausgewählte Anbieter gelten als verbunden', () => {
  const s = sanitizeSettings({ enabled: { spotify: true, amazon: true, ytmusic: 'ja' } });
  assert.deepEqual(enabledIds(s), ['spotify', 'amazon']);
});

test('ungültige Werte fallen auf Standardwerte zurück', () => {
  const s = sanitizeSettings({ enabled: { hacker: true }, amazonRegion: 'xx', volume: 7, muted: 'yes' });
  assert.deepEqual(enabledIds(s), []);
  assert.equal(s.amazonRegion, 'de');
  assert.equal(s.volume, 1);
  assert.equal(s.muted, false);
});

test('Einstellungen werden gespeichert und wieder geladen', () => {
  const storage = memoryStorage();
  const s = defaultSettings();
  s.enabled.ytmusic = true;
  s.volume = 0.3;
  saveSettings(s, storage);
  const loaded = loadSettings(storage);
  assert.deepEqual(enabledIds(loaded), ['ytmusic']);
  assert.equal(loaded.volume, 0.3);
});

test('kaputter Speicher bricht die App nicht', () => {
  const broken = { getItem: () => '{kaputt', setItem: () => { throw new Error('voll'); } };
  assert.deepEqual(loadSettings(broken), defaultSettings());
  assert.doesNotThrow(() => saveSettings(defaultSettings(), broken));
});
