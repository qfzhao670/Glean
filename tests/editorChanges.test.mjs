import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEditorMarkdown } from '../src/editorChanges.ts';

test('focusing and blurring preserves the original markdown formatting', () => {
  const source = 'paragraph with  deliberate spacing\n\n\n';
  const renderedBaseline = 'paragraph with  deliberate spacing';

  assert.deepEqual(resolveEditorMarkdown(source, renderedBaseline, renderedBaseline), {
    changed: false,
    markdown: source,
  });
});

test('real editor changes use the serialized markdown', () => {
  assert.deepEqual(resolveEditorMarkdown('before', 'before', 'after'), {
    changed: true,
    markdown: 'after',
  });
});

test('undoing an edit back to the rendered baseline clears the change', () => {
  assert.deepEqual(resolveEditorMarkdown('before\n', 'before', 'before'), {
    changed: false,
    markdown: 'before\n',
  });
});
