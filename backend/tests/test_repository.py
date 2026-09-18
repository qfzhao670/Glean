from datetime import date
import errno
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from glean import ai, repository, service, store


def test_manual_create_edit_restore_are_saved_to_same_markdown(client):
    original = '# 我的笔记\n\n原始内容'
    note = client.post('/api/notes', json={'title': '我的笔记', 'content': original}).json()
    path = Path(note['note_file'])
    assert note['kind'] == 'manual'
    assert path.parent == store.DATA / 'notes'
    assert path.read_text() == original
    changed = client.put('/api/notes/' + note['id'], json={'content': '# 新标题\n\n修改内容', 'expected': original, 'title': '新标题'}).json()
    assert changed['title'] == '新标题'
    assert Path(changed['note_file']) == path
    assert path.read_text() == changed['content']
    restored = client.post(f'/api/notes/{note["id"]}/restore/{changed["revisions"][0]["id"]}').json()
    assert restored['content'] == path.read_text() == original
    stats = client.get('/api/stats').json()
    assert stats['manual'] == 1 and stats['generated'] == 0 and stats['curated'] == 0
    assert client.get('/api/notes').json()[0]['note_file'] == str(path)


def test_repository_switch_copies_existing_notes_and_avoids_collisions(client, tmp_path):
    note = client.post('/api/notes', json={'title': '../课程/一', 'content': '完整正文'}).json()
    old = Path(note['note_file'])
    folder = tmp_path / '我的仓库'
    folder.mkdir()
    existing = folder / old.name
    existing.write_text('已有用户文件')
    chosen = client.put('/api/repository', json={'path': str(folder)})
    assert chosen.status_code == 200
    assert chosen.json() == {'path': str(folder), 'available': True, 'pending': 0}
    updated = client.get('/api/notes/' + note['id']).json()
    current = Path(updated['note_file'])
    assert current.parent == folder and current != existing
    assert current.read_text() == old.read_text() == '完整正文'
    assert existing.read_text() == '已有用户文件'
    assert Path(client.post('/api/notes', json={'title': '后来'}).json()['note_file']).parent == folder
    assert client.put('/api/repository', json={'path': str(folder)}).status_code == 200
    assert client.get('/api/notes/' + note['id']).json()['note_file'] == str(current)


def test_external_edits_and_symlinks_never_get_overwritten(client, tmp_path):
    note = client.post('/api/notes', json={'title': '原文', 'content': '# 原文'}).json()
    path = Path(note['note_file'])
    path.write_text('其他程序的修改')
    response = client.put('/api/notes/' + note['id'], json={'content': '应用内修改', 'expected': '# 原文'})
    assert response.status_code == 400 and '其他程序修改' in response.json()['detail']
    assert path.read_text() == '其他程序的修改'
    current = client.get('/api/notes/' + note['id']).json()
    assert current['content'] == '# 原文' and current['revisions'] == []
    outside = tmp_path / 'outside.md'
    outside.write_text('# 原文')
    path.unlink()
    path.symlink_to(outside)
    response = client.put('/api/notes/' + note['id'], json={'content': '应用内修改', 'expected': '# 原文'})
    assert response.status_code == 400
    assert outside.read_text() == '# 原文'


def test_write_failure_rolls_back_note_and_revision(client):
    with patch.object(repository, 'write', side_effect=ValueError('无法保存到笔记仓库')):
        assert client.post('/api/notes', json={'title': '不能保存'}).status_code == 400
    assert client.get('/api/notes').json() == []
    note = client.post('/api/notes', json={'title': '原文'}).json()
    with patch.object(repository, 'write', side_effect=ValueError('无法保存到笔记仓库')):
        assert client.put('/api/notes/' + note['id'], json={'content': '修改', 'expected': note['content']}).status_code == 400
    current = client.get('/api/notes/' + note['id']).json()
    assert current['content'] == note['content'] and current['revisions'] == []
    assert Path(current['note_file']).read_text() == note['content']


def test_failed_repository_change_keeps_settings_and_file_references(client, tmp_path):
    for title in ('甲', '乙'):
        client.post('/api/notes', json={'title': title})
    before = client.get('/api/notes').json()
    old_root = store.settings()['repository_path']
    target = tmp_path / 'new'
    target.mkdir()
    real_write = repository.write
    calls = 0
    def failing_write(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ValueError('磁盘空间不足')
        return real_write(*args, **kwargs)
    with patch.object(repository, 'write', side_effect=failing_write):
        assert client.put('/api/repository', json={'path': str(target)}).status_code == 400
    assert client.get('/api/notes').json() == before
    assert store.settings()['repository_path'] == old_root


def test_existing_database_notes_materialize_once_without_touching_exports(client, tmp_path):
    export = tmp_path / '旧导出.md'
    export.write_text('外部已编辑版本')
    with store.db() as db:
        db.execute('INSERT INTO notes (id,title,content,kind,vault_file,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ('legacy', '旧笔记', '# 旧内容', 'txt', str(export), store.now(), store.now()))
    store.init()
    note = client.get('/api/notes/legacy').json()
    assert Path(note['note_file']).read_text() == '# 旧内容'
    assert export.read_text() == '外部已编辑版本'
    store.init()
    assert client.get('/api/notes/legacy').json()['note_file'] == note['note_file']
    assert len(list((store.DATA / 'notes').glob('*.md'))) == 1


def test_repository_import_stays_inside_selected_folder(client, tmp_path):
    folder = tmp_path / 'notes'
    folder.mkdir()
    outside = tmp_path / 'outside.md'
    outside.write_text('外部文件')
    (folder / '链接.md').symlink_to(outside)
    (folder / '课程.md').write_text('# 课程正文')
    client.put('/api/repository', json={'path': str(folder)})
    assert client.get('/api/vault/notes').json() == [{'path': '课程.md', 'title': '课程'}]
    assert client.post('/api/vault/import', json={'path': '../outside.md'}).status_code == 400
    assert client.post('/api/vault/import', json={'path': '链接.md'}).status_code == 400
    assert client.post('/api/vault/import', json={'path': '课程.md'}).json()['content'] == '# 课程正文'
    assert client.put('/api/repository', json={'path': 'relative'}).status_code == 400


def test_generated_note_and_chat_patch_write_to_repository(client):
    store.save_settings({'model': 'test'})
    with patch.object(service.EXECUTOR, 'submit'):
        job_id = service.new_job('curate', '课程', {'content': '# 课程\n原句'})
    with patch.object(ai, 'generate', return_value='# 课程\n原句'):
        service.run_job(job_id)
    job = store.one('SELECT * FROM jobs WHERE id=?', (job_id,))
    assert job['status'] == 'completed'
    note = client.get('/api/notes/' + job['note_id']).json()
    assert Path(note['note_file']).read_text() == note['content']
    with patch.object(ai, 'chat', return_value={'answer': '解释', 'patch': {'anchor': '原句', 'title': '知识', 'body': '确定的解释'}}):
        changed = client.post('/api/notes/' + note['id'] + '/chat', json={'message': '解释'}).json()
    assert '确定的解释' in Path(note['note_file']).read_text() == changed['content']


@pytest.mark.parametrize('today,first', [(date(2026, 9, 18), '2026-03-18'), (date(2024, 8, 31), '2024-02-29'), (date(2026, 1, 1), '2025-07-01')])
def test_activity_covers_six_calendar_months_with_week_padding(client, today, first):
    with patch('glean.app.date') as mock_date:
        mock_date.today.return_value = today
        mock_date.side_effect = date
        activity = client.get('/api/stats').json()['activity']
    assert date.fromisoformat(activity[0]['date']).weekday() == 0
    assert date.fromisoformat(activity[-1]['date']).weekday() == 6
    visible = [day for day in activity if day['in_range']]
    assert visible[0]['date'] == first
    assert visible[-1]['date'] == today.isoformat()
    assert len(visible) == (today - date.fromisoformat(first)).days + 1


def test_context_overflow_explains_single_call_limit():
    response = httpx.Response(400, json={'error': 'maximum context length exceeded'})
    with patch.object(httpx.Client, 'post', return_value=response):
        with pytest.raises(ValueError, match='上下文容量'):
            ai.generate('完整素材', '课程', '字幕', 'txt', 'test', {**store.settings(True), 'model': 'test'})


def test_curate_preserves_frontmatter_even_if_model_omits_it():
    text = '---\ntags: [自定义]\ncourse: 原始属性\n---\n# 旧标题\n正文'
    with patch.object(ai, 'completion', return_value='# 新标题\n重点'):
        result = ai.generate(text, '旧标题', '', 'curate', 'test', store.settings(True))
    assert result.startswith('---\ntags: [自定义]\ncourse: 原始属性\n---\n')
    assert '# 新标题' in result


def test_repository_supports_filesystems_without_hard_links(tmp_path):
    existing = tmp_path / '笔记.md'
    existing.write_text('不能覆盖的文件')
    with patch('glean.repository.os.link', side_effect=OSError(errno.ENOTSUP, 'not supported')):
        path = repository.write(str(tmp_path), '笔记', '# 完整笔记')
    assert Path(path).read_text() == '# 完整笔记'
    assert existing.read_text() == '不能覆盖的文件'
    assert not list(tmp_path.glob('.glean-*'))


def test_upgrade_adds_file_column_to_original_database(tmp_path, monkeypatch):
    folder = tmp_path / 'old-data'
    folder.mkdir()
    monkeypatch.setattr(store, 'DATA', folder)
    with store.db() as db:
        db.execute('''CREATE TABLE notes (
            id TEXT PRIMARY KEY, title TEXT, content TEXT, transcript TEXT DEFAULT '',
            source TEXT, kind TEXT, duration REAL DEFAULT 0, vault_file TEXT DEFAULT '',
            created_at TEXT, updated_at TEXT)''')
        db.execute('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?)', ('old', '旧笔记', '# 旧笔记', '', '课程.txt', 'txt', 0, '', store.now(), store.now()))
    store.init()
    note = store.one('SELECT * FROM notes WHERE id=?', ('old',))
    assert Path(note['note_file']).read_text() == '# 旧笔记'
    assert note['source'] == '课程.txt'
