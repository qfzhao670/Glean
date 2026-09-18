import json
from pathlib import Path
from unittest.mock import patch

from glean import ai, store


def test_reveal_only_requested_secret_requires_local_auth_and_never_caches(client):
    store.save_settings({'api_key': 'fixture-text-key', 'transcription_key': 'fixture-speech-key'})
    url = '/api/settings/secrets/api_key/reveal'
    assert client.post(url, headers={'X-Glean-Token': 'wrong'}).status_code == 401
    assert client.post(url, headers={'Origin': 'https://attacker.example'}).status_code == 403
    assert client.post('/api/settings/secrets/vault_path/reveal').status_code == 422
    response = client.post(url)
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.json() == {'value': 'fixture-text-key'}
    assert client.post('/api/settings/secrets/transcription_key/reveal').json() == {'value': 'fixture-speech-key'}
    assert 'fixture-' not in client.get('/api/settings').text
    store.save_settings({'api_key': None})
    assert client.post(url).json() == {'value': ''}


def test_delete_note_removes_managed_file_and_related_records(client):
    created = client.post('/api/notes', json={'title': '待删除', 'content': '# 待删除\n\n正文'}).json()
    note_id = created['id']
    path = Path(created['note_file'])
    client.put(f'/api/notes/{note_id}', json={'title': '待删除', 'content': '# 待删除\n\n修改', 'expected': created['content']})
    with store.db() as connection:
        connection.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)', (store.uid(), note_id, 'user', '问题', '', store.now()))
    response = client.delete(f'/api/notes/{note_id}')
    assert response.json() == {'ok': True}
    assert not path.exists()
    assert store.one('SELECT * FROM notes WHERE id=?', (note_id,)) is None
    assert store.rows('SELECT * FROM messages WHERE note_id=?', (note_id,)) == []
    assert store.rows('SELECT * FROM revisions WHERE note_id=?', (note_id,)) == []
    assert store.rows('SELECT * FROM events WHERE note_id=?', (note_id,)) == []


def test_delete_refuses_to_remove_externally_changed_markdown(client):
    created = client.post('/api/notes', json={'title': '保留', 'content': '# 保留'}).json()
    path = Path(created['note_file'])
    path.write_text('外部修改')
    response = client.delete(f'/api/notes/{created["id"]}')
    assert response.status_code == 400
    assert '外部程序修改' in response.json()['detail']
    assert path.read_text() == '外部修改'
    assert client.get(f'/api/notes/{created["id"]}').status_code == 200


def test_chat_stream_emits_deltas_then_persists_completed_answer(client):
    created = client.post('/api/notes', json={'title': '流式笔记', 'content': '# 流式笔记\n原句'}).json()
    with patch.object(ai, 'chat_stream', return_value=iter(['第一段', '第二段'])), patch.object(ai, 'chat_patch', return_value=None):
        response = client.post(f'/api/notes/{created["id"]}/chat/stream', json={'message': '请解释'})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0] == {'type': 'delta', 'content': '第一段'}
    assert events[1] == {'type': 'delta', 'content': '第二段'}
    assert events[-1]['type'] == 'done'
    messages = events[-1]['note']['messages']
    assert [(message['role'], message['content']) for message in messages] == [('user', '请解释'), ('assistant', '第一段第二段')]
    assert response.headers['Cache-Control'] == 'no-store'
