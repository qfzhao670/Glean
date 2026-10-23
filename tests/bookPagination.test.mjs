import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBookEntriesByPage } from '../src/bookPagination.ts';

const entry = (id, length) => ({
  id, note_id: 'note', note_title: '测试笔记', content: '知'.repeat(length), created_at: '2026-10-22T12:00:00+08:00',
});

test('each note summary owns one page even when summaries are short', () => {
  const entries = [entry('1', 20), entry('2', 20), entry('3', 20), entry('4', 20), entry('5', 20)];
  assert.deepEqual(groupBookEntriesByPage(entries).map(page => page.map(item => item.id)), [
    ['1'], ['2'], ['3'], ['4'], ['5'],
  ]);
});

test('summary length never changes the one-summary-per-page rule', () => {
  const entries = [entry('1', 100), entry('2', 100), entry('3', 100), entry('4', 400), entry('5', 20)];
  const pages = groupBookEntriesByPage(entries);
  assert.deepEqual(pages.map(page => page.map(item => item.id)), [['1'], ['2'], ['3'], ['4'], ['5']]);
  assert.deepEqual(pages.flat(), entries);
});
