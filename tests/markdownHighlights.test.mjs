import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkHighlights, { splitHighlightedText } from '../src/markdownHighlights.ts';

test('splits highlight syntax into mark-rendered markdown nodes', () => {
  assert.deepEqual(splitHighlightedText('before ==important== after'), [
    { type: 'text', value: 'before ' },
    { type: 'emphasis', data: { hName: 'mark' }, children: [{ type: 'text', value: 'important' }] },
    { type: 'text', value: ' after' },
  ]);
});

test('highlight transformer visits nested inline formatting', () => {
  const tree = { type: 'root', children: [{ type: 'strong', children: [{ type: 'text', value: '==important==' }] }] };
  remarkHighlights()(tree);
  assert.equal(tree.children[0].children[0].data.hName, 'mark');
  assert.equal(tree.children[0].children[0].children[0].value, 'important');
});

test('react-markdown renders highlight syntax as mark elements', () => {
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkHighlights] }, 'before ==important== after'));
  assert.match(html, /before <mark>important<\/mark> after/);
});

test('leaves unmatched equals untouched', () => {
  assert.deepEqual(splitHighlightedText('a == b'), [{ type: 'text', value: 'a == b' }]);
});
