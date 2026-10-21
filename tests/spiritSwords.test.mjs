import assert from 'node:assert/strict';
import test from 'node:test';
import { getSpiritSwordCount, parseSpiritLayoutSeed } from '../src/spiritSwords.ts';

test('one spirit sword is forged for every ten notes', () => {
  assert.equal(getSpiritSwordCount(0), 0);
  assert.equal(getSpiritSwordCount(9), 0);
  assert.equal(getSpiritSwordCount(10), 1);
  assert.equal(getSpiritSwordCount(19), 1);
  assert.equal(getSpiritSwordCount(20), 2);
});

test('spirit sword count is capped at fifteen', () => {
  assert.equal(getSpiritSwordCount(149), 14);
  assert.equal(getSpiritSwordCount(150), 15);
  assert.equal(getSpiritSwordCount(999), 15);
});

test('saved spirit sword layouts restore only valid seeds', () => {
  assert.equal(parseSpiritLayoutSeed('0'), 0);
  assert.equal(parseSpiritLayoutSeed('17'), 17);
  assert.equal(parseSpiritLayoutSeed(null), 0);
  assert.equal(parseSpiritLayoutSeed('-1'), 0);
  assert.equal(parseSpiritLayoutSeed('1.5'), 0);
  assert.equal(parseSpiritLayoutSeed('not-a-seed'), 0);
  assert.equal(parseSpiritLayoutSeed(String(Number.MAX_SAFE_INTEGER + 1)), 0);
});
