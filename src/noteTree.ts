import type { Folder, Note } from './api';

export type NoteTreeNode = {
  folder: Folder;
  notes: Note[];
  children: NoteTreeNode[];
};

export type NoteTree = {
  folders: NoteTreeNode[];
  rootNotes: Note[];
};

export function buildNoteTree(folders: Folder[], notes: Note[], query = ''): NoteTree {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const folderIds = new Set(folders.map(folder => folder.id));
  const foldersByParent = new Map<string | null, Folder[]>();
  const notesByFolder = new Map<string | null, Note[]>();

  for (const folder of folders) {
    const parentId = folder.parent_id && folder.parent_id !== folder.id && folderIds.has(folder.parent_id)
      ? folder.parent_id
      : null;
    const siblings = foldersByParent.get(parentId) || [];
    siblings.push(folder);
    foldersByParent.set(parentId, siblings);
  }
  for (const note of notes) {
    const folderId = note.folder_id && folderIds.has(note.folder_id) ? note.folder_id : null;
    const siblings = notesByFolder.get(folderId) || [];
    siblings.push(note);
    notesByFolder.set(folderId, siblings);
  }

  const emitted = new Set<string>();
  const makeNode = (folder: Folder, ancestors: ReadonlySet<string>): NoteTreeNode | null => {
    if (ancestors.has(folder.id) || emitted.has(folder.id)) return null;
    emitted.add(folder.id);
    const nextAncestors = new Set(ancestors).add(folder.id);
    return {
      folder,
      notes: notesByFolder.get(folder.id) || [],
      children: (foldersByParent.get(folder.id) || [])
        .map(child => makeNode(child, nextAncestors))
        .filter((child): child is NoteTreeNode => child !== null),
    };
  };

  const tree = (foldersByParent.get(null) || [])
    .map(folder => makeNode(folder, new Set()))
    .filter((node): node is NoteTreeNode => node !== null);
  // Keep malformed legacy data visible instead of silently dropping a cyclic branch.
  for (const folder of folders) {
    if (emitted.has(folder.id)) continue;
    const node = makeNode(folder, new Set());
    if (node) tree.push(node);
  }

  const rootNotes = notesByFolder.get(null) || [];
  if (!normalizedQuery) return { folders: tree, rootNotes };

  const filterNode = (node: NoteTreeNode, ancestorMatches = false): NoteTreeNode | null => {
    const folderMatches = ancestorMatches
      || node.folder.name.toLocaleLowerCase().includes(normalizedQuery)
      || node.folder.path.toLocaleLowerCase().includes(normalizedQuery);
    const visibleNotes = folderMatches
      ? node.notes
      : node.notes.filter(note => note.title.toLocaleLowerCase().includes(normalizedQuery));
    const visibleChildren = node.children
      .map(child => filterNode(child, folderMatches))
      .filter((child): child is NoteTreeNode => child !== null);
    if (!folderMatches && !visibleNotes.length && !visibleChildren.length) return null;
    return { ...node, notes: visibleNotes, children: visibleChildren };
  };

  return {
    folders: tree.map(node => filterNode(node)).filter((node): node is NoteTreeNode => node !== null),
    rootNotes: rootNotes.filter(note => note.title.toLocaleLowerCase().includes(normalizedQuery)),
  };
}

export function getFolderAncestorIds(folders: Folder[], folderId: string | null): string[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let currentId = folderId;
  while (currentId && !seen.has(currentId)) {
    const folder = byId.get(currentId);
    if (!folder) break;
    seen.add(currentId);
    ancestors.push(currentId);
    currentId = folder.parent_id;
  }
  return ancestors;
}
