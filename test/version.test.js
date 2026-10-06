import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions } from '../src/shared/version.js';

test('Versionen werden richtig verglichen', () => {
  assert.ok(compareVersions('0.2.0', '0.1.0') > 0);
  assert.ok(compareVersions('v0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.ok(compareVersions('44.5.1+wvcus', '44.5.0') > 0);
  assert.equal(compareVersions('', '0.0.0'), 0);
});
