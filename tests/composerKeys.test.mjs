import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSubmitComposer } from '../src/composerKeys.ts';

const keyEvent = (overrides = {}) => ({
  key: 'Enter',
  shiftKey: false,
  nativeEvent: { isComposing: false },
  ...overrides,
});

test('Enter used to confirm IME composition does not submit', () => {
  assert.equal(shouldSubmitComposer(keyEvent({
    nativeEvent: { isComposing: true },
  })), false);
});

test('IME keyCode fallback does not submit when isComposing is unreliable', () => {
  assert.equal(shouldSubmitComposer(keyEvent({
    nativeEvent: { isComposing: false, keyCode: 229 },
  })), false);
});

test('Enter after composition has finished submits', () => {
  assert.equal(shouldSubmitComposer(keyEvent()), true);
});

test('Shift+Enter still inserts a newline', () => {
  assert.equal(shouldSubmitComposer(keyEvent({ shiftKey: true })), false);
});
