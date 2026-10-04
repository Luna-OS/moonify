import assert from 'node:assert/strict';
import { test } from 'node:test';
import { litPath, lunarPhase, progressToLit } from '../src/renderer/lib/moon.js';

test('Neumond hat keine beleuchtete Fläche, Vollmond eine ganze Scheibe', () => {
  assert.equal(litPath(0), '');
  assert.match(litPath(1), /A 10 10 0 1 1 .* A 10 10 0 1 1 /);
});

test('zunehmende Sichel: rechter Rand hell, Schattengrenze wölbt sich nach rechts', () => {
  assert.equal(litPath(0.25, true), 'M 12 2 A 10 10 0 0 1 12 22 A 5 10 0 0 0 12 2 Z');
});

test('zunehmender Dreiviertelmond: Schattengrenze wölbt sich nach links', () => {
  assert.equal(litPath(0.75, true), 'M 12 2 A 10 10 0 0 1 12 22 A 5 10 0 0 1 12 2 Z');
});

test('abnehmender Mond ist gespiegelt', () => {
  assert.equal(litPath(0.25, false), 'M 12 2 A 10 10 0 0 0 12 22 A 5 10 0 0 1 12 2 Z');
  assert.equal(litPath(0.75, false), 'M 12 2 A 10 10 0 0 0 12 22 A 5 10 0 0 0 12 2 Z');
});

test('Halbmond hat eine gerade Schattengrenze', () => {
  assert.match(litPath(0.5), /A 0 10/);
});

test('Fortschritt: Sichel am Anfang, Vollmond am Ende', () => {
  assert.ok(progressToLit(0) > 0.05 && progressToLit(0) < 0.2);
  assert.equal(progressToLit(1), 1);
  assert.equal(progressToLit(5), 1);
  assert.equal(progressToLit(-1), progressToLit(0));
});

test('echte Mondphasen stimmen mit bekannten Terminen überein', () => {
  // Vollmond am 7. September 2025, Neumond am 21. September 2025
  const full = lunarPhase(new Date(Date.UTC(2025, 8, 7, 18, 9)));
  assert.equal(full.name, 'Vollmond');
  assert.ok(full.lit > 0.98);
  const fresh = lunarPhase(new Date(Date.UTC(2025, 8, 21, 19, 54)));
  assert.equal(fresh.name, 'Neumond');
  assert.ok(fresh.lit < 0.02);
  // Erstes Viertel am 29. September 2025
  const quarter = lunarPhase(new Date(Date.UTC(2025, 8, 29, 23, 54)));
  assert.equal(quarter.waxing, true);
  assert.ok(Math.abs(quarter.lit - 0.5) < 0.08);
});
