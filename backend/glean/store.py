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
    'transcription_base_url': '', 'transcription_model': 'whisper-1', 'transcription_key': '',
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
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, kind TEXT, note_id TEXT, created_at TEXT);
        ''')
        if 'note_file' not in [r['name'] for r in c.execute('PRAGMA table_info(notes)')]:
            c.execute("ALTER TABLE notes ADD COLUMN note_file TEXT DEFAULT ''")
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
    value['repository_path'] = value['repository_path'] or str(DATA / 'notes')
    if not private:
        for key in ('api_key', 'transcription_key'):
            value['has_' + key] = bool(value[key])
            value[key] = ''
    return value


def save_settings(value):
    with LOCK:
        current = settings(True)
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
            temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2))
            temporary.chmod(0o600)
            temporary.replace(path)
    return settings()


def materialize_notes(folder=None, move=False):
    folder = folder or settings(True)['repository_path']
    with db() as c:
        _materialize(c, folder, move)


def _materialize(c, folder, move=False):
    for row in c.execute('SELECT * FROM notes').fetchall():
        if move or not row['note_file']:
            path = repository.write(folder, row['title'], row['content'])
            c.execute('UPDATE notes SET note_file=? WHERE id=?', (path, row['id']))


def rows(query, params=()):
    with db() as c:
        return [dict(r) for r in c.execute(query, params)]


def one(query, params=()):
    result = rows(query, params)
    return result[0] if result else None


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


def create_note(title, content, transcript, source, kind, duration=0):
    note_id, timestamp = uid(), now()
    with db() as c:
        c.execute('INSERT INTO notes (id,title,content,transcript,source,kind,duration,vault_file,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                  (note_id, title, content, transcript, source, kind, duration, '', timestamp, timestamp))
        c.execute('INSERT INTO events VALUES (?,?,?,?)', (uid(), 'manual' if kind == 'manual' else 'curated' if kind == 'curate' else 'generated', note_id, timestamp))
        path = repository.write(settings(True)['repository_path'], title, content)
        c.execute('UPDATE notes SET note_file=? WHERE id=?', (path, note_id))
    return note_id


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
        c.execute('DELETE FROM events WHERE note_id=?', (note_id,))
        c.execute('DELETE FROM jobs WHERE note_id=?', (note_id,))
        c.execute('DELETE FROM notes WHERE id=?', (note_id,))
