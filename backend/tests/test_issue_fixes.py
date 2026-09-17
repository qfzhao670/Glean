import io
import json
from unittest.mock import patch

import pytest
from yt_dlp.networking import Response
from yt_dlp.networking.exceptions import HTTPError
from glean import media, store


def caption(text):
    return json.dumps({'events': [{'segs': [{'utf8': text}]}]}).encode()


def test_native_youtube_captions_precede_translated_chinese(tmp_path):
    native = {'ext': 'json3', 'url': 'https://www.youtube.com/api/timedtext?lang=en', 'http_headers': {'Referer': 'https://www.youtube.com/'}}
    translated = {'ext': 'json3', 'url': 'https://www.youtube.com/api/timedtext?lang=en&tlang=zh-Hans'}
    with patch.object(media.yt_dlp, 'YoutubeDL') as mocked:
        ydl = mocked.return_value.__enter__.return_value
        ydl.extract_info.return_value = {'title': 'Original lecture', 'duration': 7200,
                                        'http_headers': {'User-Agent': 'fixture'},
                                        'automatic_captions': {'zh-Hans': [translated], 'en-orig': [native]}}
        ydl.urlopen.return_value = io.BytesIO(caption('Original English transcript'))
        text, title, duration = media.fetch_subtitles('https://youtu.be/example', tmp_path, store.settings(True))
        request = ydl.urlopen.call_args.args[0]
        assert request.url == native['url']
        assert request.headers['User-Agent'] == 'fixture'
        assert request.headers['Referer'] == native['http_headers']['Referer']
        assert (text, title, duration) == ('Original English transcript', 'Original lecture', 7200)
        assert (tmp_path / 'original.json3').read_bytes() == caption(text)


def test_manual_preferred_language_and_inline_bilibili_captions(tmp_path):
    with patch.object(media.yt_dlp, 'YoutubeDL') as mocked:
        ydl = mocked.return_value.__enter__.return_value
        ydl.extract_info.return_value = {'subtitles': {
            'en': [{'ext': 'vtt', 'data': 'English'}],
            'zh-Hans': [{'ext': 'json', 'data': json.dumps({'body': [{'content': '人工中文字幕'}]})}]},
            'automatic_captions': {'en-orig': [{'ext': 'vtt', 'data': 'Automatic'}]}}
        assert media.fetch_subtitles('https://www.bilibili.com/video/BV123', tmp_path, store.settings(True))[0] == '人工中文字幕'
        ydl.urlopen.assert_not_called()


def test_invalid_caption_format_falls_back_without_saving_bad_raw(tmp_path):
    with patch.object(media.yt_dlp, 'YoutubeDL') as mocked:
        ydl = mocked.return_value.__enter__.return_value
        ydl.extract_info.return_value = {'automatic_captions': {'en-orig': [
            {'ext': 'json3', 'data': 'invalid JSON'},
            {'ext': 'vtt', 'data': 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nUseful transcript'}]}}
        assert media.fetch_subtitles('https://youtu.be/example', tmp_path, store.settings(True))[0] == 'Useful transcript'
        assert not (tmp_path / 'original.json3').exists()
        assert (tmp_path / 'original.vtt').exists()


def test_rate_limit_is_actionable_and_does_not_hammer_platform(tmp_path):
    with patch.object(media.yt_dlp, 'YoutubeDL') as mocked:
        ydl = mocked.return_value.__enter__.return_value
        ydl.extract_info.return_value = {'automatic_captions': {'en-orig': [
            {'ext': 'json3', 'url': 'https://www.youtube.com/caption'},
            {'ext': 'vtt', 'url': 'https://www.youtube.com/caption-vtt'}]}}
        ydl.urlopen.side_effect = HTTPError(Response(io.BytesIO(), 'https://www.youtube.com/caption', {}, status=429))
        with pytest.raises(ValueError, match='HTTP 429'):
            media.fetch_subtitles('https://youtu.be/example', tmp_path, store.settings(True))
        assert ydl.urlopen.call_count == 1
        assert not list(tmp_path.glob('original.*'))


def test_transient_server_failure_retries_once(tmp_path):
    with patch.object(media.yt_dlp, 'YoutubeDL') as mocked, patch.object(media.time, 'sleep'):
        ydl = mocked.return_value.__enter__.return_value
        ydl.extract_info.return_value = {'subtitles': {'en': [{'ext': 'json3', 'url': 'https://www.youtube.com/caption'}]}}
        ydl.urlopen.side_effect = [HTTPError(Response(io.BytesIO(), 'https://www.youtube.com/caption', {}, status=503)), io.BytesIO(caption('Recovered'))]
        assert media.fetch_subtitles('https://youtu.be/example', tmp_path, store.settings(True))[0] == 'Recovered'
        assert ydl.urlopen.call_count == 2


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
