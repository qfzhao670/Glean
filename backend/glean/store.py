from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from . import repository

DATA = Path(os.environ.get('GLEAN_DATA_DIR', Path.cwd() / '.glean')).resolve()
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
LOCK = threading.RLock()
DEFAULTS = {
    'base_url': 'https://api.openai.com/v1', 'model': '', 'api_key': '',
    'transcription_base_url': '', 'transcription_model': 'mlx-community/whisper-large-v3-turbo-4bit',
    'transcription_language': 'auto', 'transcription_key': '',
    'vault_path': '', 'notes_folder': 'Glean', 'chunk_chars': 12000,
    'repository_path': '',
    'auto_patch': True,
}


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


@contextmanager
def db():
    with LOCK:
        conn = sqlite3.connect(DATA / 'glean.db', timeout=20)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def init():
    with db() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY, title TEXT, content TEXT, transcript TEXT DEFAULT '',
          source TEXT, kind TEXT, duration REAL DEFAULT 0, vault_file TEXT DEFAULT '',
          created_at TEXT, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, status TEXT, stage TEXT, progress INTEGER DEFAULT 0,
          title TEXT, kind TEXT, payload TEXT, error TEXT DEFAULT '', note_id TEXT DEFAULT '', created_at TEXT);
        CREATE TABLE IF NOT EXISTS revisions (
          id TEXT PRIMARY KEY, note_id TEXT, content TEXT, reason TEXT, created_at TEXT);
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY, note_id TEXT, role TEXT, content TEXT, patch TEXT DEFAULT '', created_at TEXT);
        CREATE TABLE IF NOT EXISTS rag_messages (
          id TEXT PRIMARY KEY, role TEXT, content TEXT, sources TEXT DEFAULT '[]',
          grounded INTEGER DEFAULT 0, created_at TEXT);
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, kind TEXT, note_id TEXT, created_at TEXT);
        CREATE TABLE IF NOT EXISTS knowledge_links (
          note_id TEXT, target TEXT, created_at TEXT,
          PRIMARY KEY (note_id, target));
        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY, name TEXT, created_at TEXT, parent_id TEXT DEFAULT NULL);
        CREATE TABLE IF NOT EXISTS book_entries (
          id TEXT PRIMARY KEY, note_id TEXT, note_title TEXT, content TEXT, created_at TEXT);
        CREATE INDEX IF NOT EXISTS book_entries_created_at ON book_entries(created_at);
        ''')
        if 'note_file' not in [r['name'] for r in c.execute('PRAGMA table_info(notes)')]:
            c.execute("ALTER TABLE notes ADD COLUMN note_file TEXT DEFAULT ''")
        if 'folder_id' not in [r['name'] for r in c.execute('PRAGMA table_info(notes)')]:
            c.execute("ALTER TABLE notes ADD COLUMN folder_id TEXT DEFAULT NULL")
        if 'parent_id' not in [r['name'] for r in c.execute('PRAGMA table_info(folders)')]:
            c.execute("ALTER TABLE folders ADD COLUMN parent_id TEXT DEFAULT NULL")
        # The original one-level model made names globally unique. Nested
        # folders only need uniqueness among siblings, so rebuild old tables
        # once to remove the inline UNIQUE constraint.
        folder_sql = c.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='folders'"
        ).fetchone()[0]
        if re.search(r'name\s+TEXT\s+UNIQUE', folder_sql, re.I):
            c.executescript('''
                ALTER TABLE folders RENAME TO folders_legacy;
                CREATE TABLE folders (
                  id TEXT PRIMARY KEY, name TEXT, created_at TEXT, parent_id TEXT DEFAULT NULL);
                INSERT INTO folders (id,name,created_at,parent_id)
                  SELECT id,name,created_at,parent_id FROM folders_legacy;
                DROP TABLE folders_legacy;
            ''')
        c.execute('''CREATE UNIQUE INDEX IF NOT EXISTS folders_parent_name_unique
                     ON folders(COALESCE(parent_id, ''), name)''')
        # Historical counters are intentionally independent of the live notes
        # table. Upgrade existing libraries from their current contents once;
        # subsequent deletes keep both creation events and discovered links.
        creation_kinds = ('manual', 'generated', 'curated')
        for note in c.execute('SELECT id,content,created_at FROM notes').fetchall():
            for target in links(note['content']):
                c.execute(
                    'INSERT OR IGNORE INTO knowledge_links VALUES (?,?,?)',
                    (note['id'], target, note['created_at']),
                )
        # Very old databases may have notes without their creation event.
        for note in c.execute('SELECT id,kind,created_at FROM notes').fetchall():
            exists = c.execute(
                'SELECT 1 FROM events WHERE note_id=? AND kind IN (?,?,?)',
                (note['id'], *creation_kinds),
            ).fetchone()
            if not exists:
                kind = 'manual' if note['kind'] == 'manual' else 'curated' if note['kind'] == 'curate' else 'generated'
                c.execute('INSERT INTO events VALUES (?,?,?,?)', (uid(), kind, note['id'], note['created_at']))
        c.execute("UPDATE jobs SET status='failed', error='应用已重启，任务中断。可以重试，已提取的字幕会继续使用。' WHERE status IN ('running','queued')")
    (DATA / 'notes').mkdir(exist_ok=True)
    # Existing database-only notes gain Markdown files on upgrade. A disconnected
    # repository must not prevent startup; the library exposes the pending count.
    try:
        materialize_notes()
    except ValueError:
        pass


def settings(private=False):
    path = DATA / 'settings.json'
    saved = json.loads(path.read_text()) if path.exists() else {}
    value = {key: saved.get(key, default) for key, default in DEFAULTS.items()}
    # Migrate every cloud Whisper model used by older releases. Legacy service
    # credentials stay readable for settings-file compatibility, but local
    # transcription never reads or sends them.
    if value['transcription_model'] != DEFAULTS['transcription_model']:
        value['transcription_model'] = DEFAULTS['transcription_model']
    value['repository_path'] = value['repository_path'] or str(DATA / 'notes')
    if not private:
        for key in ('api_key', 'transcription_key'):
            value['has_' + key] = bool(value[key])
            value[key] = ''
    return value


def save_settings(value):
    with LOCK:
        current = settings(True)
        previous_repository = current['repository_path']
        for key, val in value.items():
            if key in DEFAULTS:
                if key in ('api_key', 'transcription_key') and val == '':
                    continue  # Empty fields keep saved secrets; null explicitly clears them.
                current[key] = '' if val is None else val
        current['repository_path'] = str(repository.root(current['repository_path'] or str(DATA / 'notes')))
        path = DATA / 'settings.json'
        temporary = path.with_suffix('.tmp')
        with db() as c:
            if current['repository_path'] != settings(True)['repository_path']:
                # Copy to the newly chosen folder, keeping previous files intact.
                _materialize(c, current['repository_path'], move=True)
                repository.copy_assets(previous_repository, current['repository_path'])
            temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2))
            temporary.chmod(0o600)
            temporary.replace(path)
    return settings()


def materialize_notes(folder=None, move=False):
    folder = folder or settings(True)['repository_path']
    with db() as c:
        _materialize(c, folder, move)


def _materialize(c, folder, move=False):
    # Recreate the complete hierarchy, including empty folders, when upgrading
    # or switching repositories.
    for row in c.execute('SELECT id FROM folders').fetchall():
        parent = Path()
        for name in _folder_relative(c, row['id']).parts:
            repository.ensure_folder(folder, name, parent=parent)
            parent /= name
    query = 'SELECT notes.* FROM notes'
    for row in c.execute(query).fetchall():
        if move or not row['note_file']:
            relative = _folder_relative(c, row['folder_id']) if row['folder_id'] else Path()
            destination = repository.root(folder) / relative
            path = repository.write(str(destination), row['title'], row['content'])
            c.execute('UPDATE notes SET note_file=? WHERE id=?', (path, row['id']))


def rows(query, params=()):
    with db() as c:
        return [dict(r) for r in c.execute(query, params)]


def one(query, params=()):
    result = rows(query, params)
    return result[0] if result else None


def _folder_chain(c, folder_id):
    """Return a folder's rows from the repository root to the folder."""
    chain, seen = [], set()
    current = folder_id
    while current:
        if current in seen:
            raise ValueError('文件夹层级异常，请重启应用后检查笔记仓库。')
        seen.add(current)
        folder = c.execute('SELECT * FROM folders WHERE id=?', (current,)).fetchone()
        if not folder:
            raise ValueError('文件夹不存在')
        chain.append(folder)
        current = folder['parent_id']
    return list(reversed(chain))


def _folder_relative(c, folder_id):
    return Path(*(folder['name'] for folder in _folder_chain(c, folder_id)))


def _descendant_folder_ids(c, folder_id, include_self=True):
    children = {}
    for row in c.execute('SELECT id,parent_id FROM folders').fetchall():
        children.setdefault(row['parent_id'], []).append(row['id'])
    result, pending = [], [folder_id]
    while pending:
        current = pending.pop()
        result.append(current)
        pending.extend(children.get(current, ()))
    return result if include_self else result[1:]


def list_folders():
    with db() as c:
        values = [dict(row) for row in c.execute('''
            SELECT folders.id,folders.name,folders.parent_id,folders.created_at,
                   COUNT(notes.id) AS note_count
            FROM folders LEFT JOIN notes ON notes.folder_id=folders.id
            GROUP BY folders.id ORDER BY folders.created_at,folders.name
        ''').fetchall()]
        child_counts = {}
        for folder in values:
            child_counts[folder['parent_id']] = child_counts.get(folder['parent_id'], 0) + 1
        note_counts = {folder['id']: folder['note_count'] for folder in values}
        for folder in values:
            descendants = _descendant_folder_ids(c, folder['id'])
            folder['child_count'] = child_counts.get(folder['id'], 0)
            folder['descendant_note_count'] = sum(note_counts.get(folder_id, 0) for folder_id in descendants)
            folder['path'] = str(_folder_relative(c, folder['id']))
        return values


def links(content):
    # Embeds are assets, not knowledge links; ignore fenced code.
    content = re.sub(r'```.*?```', '', content, flags=re.S)
    return list(dict.fromkeys(re.findall(r'(?<!!)\[\[([^\]|#]+)(?:[^\]]*)\]\]', content)))


def title_of(content, fallback):
    match = re.search(r'^#\s+(.+)$', content, re.M)
    return match.group(1).strip()[:160] if match else fallback[:160]


def update_job(job_id, **values):
    with db() as c:
        c.execute(f"UPDATE jobs SET {','.join(k+'=?' for k in values)} WHERE id=?", (*values.values(), job_id))


def create_note(title, content, transcript, source, kind, duration=0, folder_id=None):
    note_id, timestamp = uid(), now()
    with db() as c:
        relative = _folder_relative(c, folder_id) if folder_id else Path()
        c.execute('INSERT INTO notes (id,title,content,transcript,source,kind,duration,vault_file,created_at,updated_at,folder_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                  (note_id, title, content, transcript, source, kind, duration, '', timestamp, timestamp, folder_id))
        c.execute('INSERT INTO events VALUES (?,?,?,?)', (uid(), 'manual' if kind == 'manual' else 'curated' if kind == 'curate' else 'generated', note_id, timestamp))
        for target in links(content):
            c.execute('INSERT OR IGNORE INTO knowledge_links VALUES (?,?,?)', (note_id, target, timestamp))
        destination = repository.root(settings(True)['repository_path']) / relative
        path = repository.write(str(destination), title, content)
        c.execute('UPDATE notes SET note_file=? WHERE id=?', (path, note_id))
    return note_id


def create_book_entries(note_id, note_title, contents):
    """Persist a reviewed batch with one shared, server-authored timestamp."""
    timestamp = now()
    entries = [
        {'id': uid(), 'note_id': note_id, 'note_title': note_title,
         'content': content, 'created_at': timestamp}
        for content in contents
    ]
    with db() as c:
        c.executemany(
            'INSERT INTO book_entries (id,note_id,note_title,content,created_at) VALUES (?,?,?,?,?)',
            [(entry['id'], entry['note_id'], entry['note_title'], entry['content'], entry['created_at'])
             for entry in entries],
        )
    return entries


def list_book_entries():
    # rowid preserves the user's review order for entries saved in one batch,
    # whose server-authored timestamps are intentionally identical.
    return rows('SELECT id,note_id,note_title,content,created_at FROM book_entries ORDER BY created_at,rowid')


def create_folder(name, parent_id=None):
    folder_id, timestamp = uid(), now()
    with db() as c:
        if c.execute('SELECT 1 FROM folders WHERE name=? AND parent_id IS ?', (name, parent_id)).fetchone():
            raise ValueError('已有同名文件夹，请换一个名称。')
        parent = _folder_relative(c, parent_id) if parent_id else Path()
        repository.ensure_folder(settings(True)['repository_path'], name, exclusive=True, parent=parent)
        c.execute('INSERT INTO folders (id,name,created_at,parent_id) VALUES (?,?,?,?)',
                  (folder_id, name, timestamp, parent_id))
    return {'id': folder_id, 'name': name, 'parent_id': parent_id, 'created_at': timestamp,
            'note_count': 0, 'child_count': 0, 'descendant_note_count': 0,
            'path': str(parent / name)}


def rename_folder(folder_id, name):
    repository_path = settings(True)['repository_path']
    renamed = None
    try:
        with db() as c:
            folder = c.execute('SELECT * FROM folders WHERE id=?', (folder_id,)).fetchone()
            if not folder:
                raise ValueError('文件夹不存在')
            if folder['name'] == name:
                count = c.execute('SELECT COUNT(*) FROM notes WHERE folder_id=?', (folder_id,)).fetchone()[0]
                return {**dict(folder), 'note_count': count, 'path': str(_folder_relative(c, folder_id))}
            if c.execute('SELECT 1 FROM folders WHERE name=? AND parent_id IS ? AND id<>?',
                         (name, folder['parent_id'], folder_id)).fetchone():
                raise ValueError('已有同名文件夹，请换一个名称。')

            old_relative = _folder_relative(c, folder_id)
            root_path = repository.root(repository_path)
            source = root_path / old_relative
            descendants = _descendant_folder_ids(c, folder_id)
            placeholders = ','.join('?' for _ in descendants)
            notes = c.execute(
                f'SELECT id,note_file FROM notes WHERE folder_id IN ({placeholders})', descendants,
            ).fetchall()
            relative_paths = []
            for note in notes:
                try:
                    relative_paths.append((note['id'], Path(note['note_file']).relative_to(source)))
                except ValueError as exc:
                    raise ValueError('文件夹中的笔记路径异常，本次未重命名。') from exc

            old_path, new_path = repository.rename_folder(repository_path, old_relative, name)
            renamed = (old_path, new_path)
            c.execute('UPDATE folders SET name=? WHERE id=?', (name, folder_id))
            for note_id, relative in relative_paths:
                c.execute('UPDATE notes SET note_file=? WHERE id=?', (str(new_path / relative), note_id))
            direct_count = c.execute('SELECT COUNT(*) FROM notes WHERE folder_id=?', (folder_id,)).fetchone()[0]
            return {**dict(folder), 'name': name, 'note_count': direct_count,
                    'path': str(old_relative.parent / name)}
    except Exception:
        if renamed:
            old_path, new_path = renamed
            try:
                new_path.rename(old_path)
            except OSError as rollback_error:
                raise ValueError('文件夹已重命名，但数据更新失败，请重启应用后检查笔记仓库。') from rollback_error
        raise


def move_folder(folder_id, parent_id=None):
    repository_path = settings(True)['repository_path']
    moved = None
    try:
        with db() as c:
            folder = c.execute('SELECT * FROM folders WHERE id=?', (folder_id,)).fetchone()
            if not folder:
                raise ValueError('文件夹不存在')
            if folder['parent_id'] == parent_id:
                return
            descendants = _descendant_folder_ids(c, folder_id)
            if parent_id == folder_id or parent_id in descendants:
                raise ValueError('文件夹不能移入自身或它的子文件夹。')
            if parent_id:
                _folder_chain(c, parent_id)
            if c.execute('SELECT 1 FROM folders WHERE name=? AND parent_id IS ? AND id<>?',
                         (folder['name'], parent_id, folder_id)).fetchone():
                raise ValueError('目标位置已有同名文件夹。')

            old_relative = _folder_relative(c, folder_id)
            destination = _folder_relative(c, parent_id) if parent_id else Path()
            root_path = repository.root(repository_path)
            source = root_path / old_relative
            placeholders = ','.join('?' for _ in descendants)
            notes = c.execute(
                f'SELECT id,note_file FROM notes WHERE folder_id IN ({placeholders})', descendants,
            ).fetchall()
            relative_paths = []
            for note in notes:
                try:
                    relative_paths.append((note['id'], Path(note['note_file']).relative_to(source)))
                except ValueError as exc:
                    raise ValueError('文件夹中的笔记路径异常，本次未移动。') from exc

            old_path, new_path = repository.move_folder(repository_path, old_relative, destination)
            moved = (old_path, new_path)
            c.execute('UPDATE folders SET parent_id=? WHERE id=?', (parent_id, folder_id))
            for note_id, relative in relative_paths:
                c.execute('UPDATE notes SET note_file=? WHERE id=?', (str(new_path / relative), note_id))
    except Exception:
        if moved:
            old_path, new_path = moved
            try:
                new_path.rename(old_path)
            except OSError as rollback_error:
                raise ValueError('文件夹已移动，但数据更新失败，请重启应用后检查笔记仓库。') from rollback_error
        raise


def delete_folder(folder_id, mode='delete'):
    repository_path = settings(True)['repository_path']
    with db() as c:
        folder = c.execute('SELECT * FROM folders WHERE id=?', (folder_id,)).fetchone()
        if not folder:
            raise ValueError('文件夹不存在')
        relative = _folder_relative(c, folder_id)
        descendants = _descendant_folder_ids(c, folder_id)
        placeholders = ','.join('?' for _ in descendants)
        notes = c.execute(
            f'SELECT id,folder_id,note_file,content FROM notes WHERE folder_id IN ({placeholders})', descendants,
        ).fetchall()

        if mode == 'promote':
            parent_id = folder['parent_id']
            parent_relative = relative.parent
            direct_notes = [note for note in notes if note['folder_id'] == folder_id]
            children = c.execute('SELECT id,name FROM folders WHERE parent_id=?', (folder_id,)).fetchall()
            mapping = repository.promote_folder(
                repository_path, relative, parent_relative,
                {note['note_file']: note['content'] for note in direct_notes},
                [child['name'] for child in children],
            )
            root_path = repository.root(repository_path)
            old_root = root_path / relative
            for note in notes:
                old_note = Path(note['note_file'])
                immediate = old_root / old_note.relative_to(old_root).parts[0]
                new_immediate = Path(mapping[str(immediate)])
                new_note = new_immediate / old_note.relative_to(immediate)
                new_folder_id = parent_id if note['folder_id'] == folder_id else note['folder_id']
                c.execute('UPDATE notes SET folder_id=?,note_file=? WHERE id=?',
                          (new_folder_id, str(new_note), note['id']))
            c.execute('UPDATE folders SET parent_id=? WHERE parent_id=?', (parent_id, folder_id))
            c.execute('DELETE FROM folders WHERE id=?', (folder_id,))
            return

        root_path = repository.root(repository_path)
        managed_directories = [root_path / _folder_relative(c, child_id)
                               for child_id in descendants if child_id != folder_id]
        repository.delete_folder_tree(
            repository_path, relative,
            {note['note_file']: note['content'] for note in notes}, managed_directories,
        )
        note_ids = [note['id'] for note in notes]
        for note_id in note_ids:
            c.execute('DELETE FROM messages WHERE note_id=?', (note_id,))
            c.execute('DELETE FROM revisions WHERE note_id=?', (note_id,))
            c.execute('DELETE FROM jobs WHERE note_id=?', (note_id,))
        if note_ids:
            note_placeholders = ','.join('?' for _ in note_ids)
            c.execute(f'DELETE FROM notes WHERE id IN ({note_placeholders})', note_ids)
        c.execute(f'DELETE FROM folders WHERE id IN ({placeholders})', descendants)


def move_note(note_id, folder_id=None):
    with db() as c:
        note = c.execute('SELECT * FROM notes WHERE id=?', (note_id,)).fetchone()
        if not note:
            raise ValueError('笔记不存在')
        folder_path = Path()
        if folder_id:
            folder_path = _folder_relative(c, folder_id)
        if note['folder_id'] == folder_id:
            return
        path = repository.move(
            settings(True)['repository_path'], note['note_file'], note['content'], folder_path,
        )
        c.execute('UPDATE notes SET folder_id=?,note_file=? WHERE id=?', (folder_id, path, note_id))


def revise(note_id, content, reason, expected=None, title=None):
    with db() as c:
        note = c.execute('SELECT * FROM notes WHERE id=?', (note_id,)).fetchone()
        if not note:
            raise ValueError('笔记不存在')
        if expected is not None and note['content'] != expected:
            raise ValueError('笔记已发生变化，请刷新后再试')
        c.execute('INSERT INTO revisions VALUES (?,?,?,?,?)', (uid(), note_id, note['content'], reason, now()))
        title = title or title_of(content, note['title'])
        c.execute('UPDATE notes SET content=?,title=?,updated_at=? WHERE id=?', (content, title, now(), note_id))
        for target in links(content):
            c.execute('INSERT OR IGNORE INTO knowledge_links VALUES (?,?,?)', (note_id, target, now()))
        if reason == 'chat_patch':
            c.execute('INSERT INTO events VALUES (?,?,?,?)', (uid(), 'patch', note_id, now()))
        elif reason == 'edit':
            c.execute('INSERT INTO events VALUES (?,?,?,?)', (uid(), 'edit', note_id, now()))
        path = repository.write(settings(True)['repository_path'], title, content, note['note_file'], note['content'])
        c.execute('UPDATE notes SET note_file=? WHERE id=?', (path, note_id))


def delete_note(note_id):
    with db() as c:
        note = c.execute('SELECT * FROM notes WHERE id=?', (note_id,)).fetchone()
        if not note:
            raise ValueError('笔记不存在')
        repository.remove(settings(True)['repository_path'], note['note_file'], note['content'])
        c.execute('DELETE FROM messages WHERE note_id=?', (note_id,))
        c.execute('DELETE FROM revisions WHERE note_id=?', (note_id,))
        # Creation/activity events and discovered knowledge links are a learning
        # history, not a projection of the current library. Keep them so the
        # dashboard never moves backwards when a note is removed.
        c.execute('DELETE FROM jobs WHERE note_id=?', (note_id,))
        c.execute('DELETE FROM notes WHERE id=?', (note_id,))
