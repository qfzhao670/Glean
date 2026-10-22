import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteTree, getFolderAncestorIds } from '../src/noteTree.ts';

const folder = (id, name, parentId = null) => ({
  id, name, parent_id: parentId, path: parentId ? `课程/${name}` : name,
  created_at: '', note_count: 0, child_count: 0, descendant_note_count: 0,
});
const note = (id, title, folderId = null) => ({ id, title, folder_id: folderId });

test('builds nested folders instead of flattening every folder at the root', () => {
  const folders = [folder('course', '课程'), folder('chapter', '第一章', 'course'), folder('topic', '线程', 'chapter')];
  const notes = [note('deep-note', '线程调度', 'topic'), note('root-note', '收件箱')];

  const tree = buildNoteTree(folders, notes);

  assert.deepEqual(tree.folders.map(node => node.folder.id), ['course']);
  assert.deepEqual(tree.folders[0].children.map(node => node.folder.id), ['chapter']);
  assert.deepEqual(tree.folders[0].children[0].children.map(node => node.folder.id), ['topic']);
  assert.deepEqual(tree.folders[0].children[0].children[0].notes.map(item => item.id), ['deep-note']);
  assert.deepEqual(tree.rootNotes.map(item => item.id), ['root-note']);
});

test('search keeps the ancestor chain for a matching nested note', () => {
  const folders = [folder('course', '课程'), folder('chapter', '第一章', 'course'), folder('other', '其他')];
  const notes = [note('match', '线程调度', 'chapter'), note('hidden', '网络协议', 'other')];

  const tree = buildNoteTree(folders, notes, '线程');

  assert.deepEqual(tree.folders.map(node => node.folder.id), ['course']);
  assert.deepEqual(tree.folders[0].children.map(node => node.folder.id), ['chapter']);
  assert.deepEqual(tree.folders[0].children[0].notes.map(item => item.id), ['match']);
});

test('returns every folder that must be expanded to reveal a selected note', () => {
  const folders = [folder('course', '课程'), folder('chapter', '第一章', 'course'), folder('topic', '线程', 'chapter')];
  assert.deepEqual(getFolderAncestorIds(folders, 'topic'), ['topic', 'chapter', 'course']);
});
