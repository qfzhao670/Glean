import io
import json
import threading
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
import imageio_ffmpeg
from glean import ai, media, service, store


def test_chunking_is_lossless_with_chinese_and_long_lines():
    text = ('缓存与内存的联系。\n' * 970) + ('超长行' * 800) + '\n最后的具体例子不能丢失。'
    parts = ai.chunks(text, 2000)
    assert len(parts) > 3
    assert ''.join(parts) == text
    assert all(len(part) <= 2001 for part in parts)


def test_patch_unique_anchor_and_restore(client):
    original = '# 缓存\n\n- CPU 使用缓存。\n\n后文。\n'
    note_id = store.create_note('缓存', original, '原始字幕：缓存可以减少等待时间。', '课程', 'url')
    with patch.object(ai, 'chat', return_value={'answer': '缓存保存经常访问的数据。', 'patch': {'anchor': '- CPU 使用缓存。', 'title': '缓存的作用', 'body': '缓存把经常使用的数据放到更近的位置。'}}):
        response = client.post(f'/api/notes/{note_id}/chat', json={'message': '缓存是做什么的？'})
    assert response.status_code == 200
    changed = response.json()
    assert '  > [!question]- 补丁：缓存的作用' in changed['content']
    assert len(changed['messages']) == 2
    assert changed['transcript'].startswith('原始字幕')
    restored = client.post(f'/api/notes/{note_id}/restore/{changed["revisions"][0]["id"]}')
    assert restored.json()['content'] == original
    assert client.get('/api/stats').json()['patches'] == 1


def test_ambiguous_patch_and_duplicate_are_rejected():
    value = {'anchor': '同一行', 'title': '解释', 'body': '补充解释'}
    assert ai.apply_patch('同一行\n同一行\n', value) is None
    assert ai.apply_patch('同一行\n补充解释\n', value) is None
    assert ai.apply_patch('不存在原句', value) is None


def test_chat_setting_disables_mutation(client):
    store.save_settings({'auto_patch': False})
    note_id = store.create_note('缓存', '# 缓存\n原句', '', '', 'curate')
    with patch.object(ai, 'chat', return_value={'answer': '解释', 'patch': {'anchor': '原句', 'title': '新解释', 'body': '解释正文'}}):
        response = client.post(f'/api/notes/{note_id}/chat', json={'message': '解释一下'})
    assert response.json()['content'] == '# 缓存\n原句'
    assert not response.json()['revisions']


def test_edit_conflict_does_not_overwrite(client):
    note_id = store.create_note('原文', '# 原文', '', '', 'curate')
    response = client.put(f'/api/notes/{note_id}', json={'content': '替代文本', 'expected': '过期内容'})
    assert response.status_code == 400
    assert client.get(f'/api/notes/{note_id}').json()['content'] == '# 原文'


def test_vault_export_is_contained_and_never_overwrites(tmp_path):
    vault = tmp_path / 'vault'
    vault.mkdir()
    store.save_settings({'vault_path': str(vault)})
    note_id = store.create_note('../特殊/标题', '# 原文', '', '', 'curate')
    note = store.one('SELECT * FROM notes WHERE id=?', (note_id,))
    first = Path(service.export_note(note))
    first.write_text('用户在 Obsidian 中的修改')
    second = Path(service.export_note(note))
    assert first != second
    assert first.read_text() == '用户在 Obsidian 中的修改'
    assert second.read_text() == '# 原文'
    with pytest.raises(ValueError):
        service.vault_target('../escape.md')
    outside = tmp_path / 'outside'
    outside.mkdir()
    (vault / 'linked').symlink_to(outside)
    with pytest.raises(ValueError):
        service.vault_target('linked/escape.md')


def test_url_allowlist_and_subtitle_parsing():
    for url in ['http://youtube.com/watch?v=x', 'https://youtube.com.attacker.test/a', 'file:///etc/passwd', 'https://localhost/video', 'https://user:secret@youtube.com/watch?v=x']:
        with pytest.raises(ValueError):
            media.validate_video_url(url)
    assert media.validate_video_url('https://www.bilibili.com/video/BV123')
    raw = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n你好 &amp; <c>世界</c>\n\n00:00:02.000 --> 00:00:03.000\n你好 &amp; <c>世界</c>\n\n00:00:03.000 --> 00:00:04.000\n新的知识\n'
    assert media.subtitle_text(raw, 'vtt') == '你好 & 世界\n新的知识'
    assert media.subtitle_text('{"events":[{"segs":[{"utf8":"hello"}]}]}', 'json3') == 'hello'
    assert media.subtitle_text('{"body":[{"content":"哔哩哔哩字幕"}]}', 'json') == '哔哩哔哩字幕'


def test_missing_subtitles_stop_without_downloading(tmp_path):
    with patch.object(media.yt_dlp, 'YoutubeDL') as mocked:
        ydl = mocked.return_value.__enter__.return_value
        ydl.extract_info.return_value = {'title': '无字幕视频', 'subtitles': {}, 'automatic_captions': {}}
        with pytest.raises(ValueError, match='没有可获取的字幕'):
            media.fetch_subtitles('https://youtu.be/example', tmp_path, store.settings(True))
        ydl.extract_info.assert_called_once_with('https://youtu.be/example', download=False)
        ydl.urlopen.assert_not_called()


def test_long_generation_preserves_every_segment_and_reuses_checkpoints():
    store.save_settings({'model': 'test', 'chunk_chars': 2000})
    text = ('这是重要的原始细节。\n' * 800) + '最后一个知识点。'
    parts = ai.chunks(text, 2000)
    with patch.object(ai, 'completion', side_effect=[f'## 章节 {i}\n\n保留细节 {i}。' for i in range(len(parts))]) as llm, patch.object(ai, 'json_completion', return_value={'title': '完整长课', 'tags': ['学习'], 'overview': '课程导读'}):
        result = ai.generate(text, '长课', 'video', 'url', 'long-job', store.settings(True))
        assert llm.call_count == len(parts)
        for i in range(len(parts)):
            assert f'保留细节 {i}。' in result
    with patch.object(ai, 'completion') as llm, patch.object(ai, 'json_completion', return_value={'title': '完整长课', 'tags': [], 'overview': ''}):
        ai.generate(text, '长课', 'video', 'url', 'long-job', store.settings(True))
        llm.assert_not_called()


def test_job_failure_can_retry_and_complete(client):
    with patch.object(service.EXECUTOR, 'submit'):
        response = client.post('/api/jobs', json={'kind': 'curate', 'title': '旧笔记', 'content': '# 旧笔记\n保留例子。'})
    job_id = response.json()['id']
    service.run_job(job_id)
    assert client.get('/api/jobs').json()[0]['status'] == 'failed'
    store.save_settings({'model': 'test'})
    with patch.object(ai, 'generate', return_value='# 新笔记\n保留例子。'):
        service.run_job(job_id)
    job = client.get('/api/jobs').json()[0]
    assert job['status'] == 'completed'
    note = client.get('/api/notes/' + job['note_id']).json()
    assert note['title'] == '新笔记'
    assert len(note['revisions']) == 1
    assert client.get('/api/stats').json()['curated'] == 1


def test_missing_image_aborts_curate(client):
    with patch.object(service.EXECUTOR, 'submit'):
        job_id = service.new_job('curate', '图片笔记', {'content': '# 图\n![[重要.png]]'})
    store.save_settings({'model': 'test'})
    with patch.object(ai, 'generate', return_value='# 图\n模型遗漏图片'):
        service.run_job(job_id)
    assert client.get('/api/jobs').json()[0]['status'] == 'failed'
    assert client.get('/api/notes').json() == []


def test_api_auth_origin_and_secret_redaction(client):
    assert client.get('/api/notes', headers={'X-Glean-Token': 'wrong'}).status_code == 401
    assert client.get('/api/notes', headers={'Origin': 'https://attacker.example'}).status_code == 403
    store.save_settings({'api_key': 'private-key-value', 'model': 'test'})
    settings = client.get('/api/settings').json()
    assert settings['api_key'] == '' and settings['has_api_key'] is True
    assert 'private-key-value' not in client.get('/api/settings').text
    store.save_settings({'api_key': ''})
    assert store.settings(True)['api_key'] == 'private-key-value'
    store.save_settings({'api_key': None})
    assert store.settings(True)['api_key'] == ''


def test_links_count_excludes_embeds_and_code(client):
    store.create_note('一', '# 一\n[[二]] [[二|别名]] [[三#标题]] ![[图片.png]]\n```\n[[代码示例]]\n```', '', '', 'url')
    stats = client.get('/api/stats').json()
    assert stats['links'] == 2 and stats['generated'] == 1
    assert len(stats['activity']) == 84


@pytest.fixture
def model_server():
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            result = {'text': '这是从视频声音得到的字幕。'} if self.path.endswith('/audio/transcriptions') else {'choices': [{'finish_reason': 'stop', 'message': {'content': '模型服务连接成功'}}]}
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        def log_message(self, *_): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}/v1'
    server.shutdown()
    server.server_close()


def test_real_http_model_protocol(model_server):
    config = {**store.settings(True), 'base_url': model_server, 'model': 'fixture-model'}
    assert ai.completion([{'role': 'user', 'content': '你好'}], config) == '模型服务连接成功'


def test_mp4_to_audio_to_transcript(tmp_path, model_server):
    video = tmp_path / 'test.mp4'
    folder = tmp_path / 'audio'
    folder.mkdir()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ffmpeg, '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', str(video)], check=True, capture_output=True)
    config = {**store.settings(True), 'base_url': model_server}
    transcript, duration = media.transcribe(video, folder, config, 'test-job')
    assert '从视频声音得到的字幕' in transcript
    assert .9 < duration < 1.2
    assert len(list(folder.glob('*.wav'))) == 1


def test_length_finish_reason_is_not_saved():
    response = httpx.Response(200, json={'choices': [{'finish_reason': 'length', 'message': {'content': '# 不完整内容'}}]})
    with patch.object(httpx.Client, 'post', return_value=response):
        with pytest.raises(ValueError, match='长度上限'):
            ai.completion([{'role': 'user', 'content': 'generate'}], {**store.settings(True), 'model': 'test'})
