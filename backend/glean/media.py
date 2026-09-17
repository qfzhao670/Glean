from __future__ import annotations

import html
import json
import os
import shutil
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import imageio_ffmpeg
import yt_dlp
from yt_dlp.networking import Request
from yt_dlp.networking.exceptions import HTTPError, TransportError
from . import store


def validate_video_url(url):
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    allowed = ('youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv')
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not any(host == h or host.endswith('.' + h) for h in allowed):
        raise ValueError('请输入 HTTPS 的 YouTube 或哔哩哔哩视频链接。')
    return url


def subtitle_text(raw, ext):
    if ext == 'json3':
        data = json.loads(raw)
        lines = [''.join(seg.get('utf8', '') for seg in event.get('segs', [])) for event in data.get('events', [])]
    elif ext == 'json':
        data = json.loads(raw)
        lines = [item.get('content', '') for item in data.get('body', [])]
    else:
        lines = []
        skip_block = False
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                skip_block = False
                continue
            if line.startswith(('NOTE', 'STYLE', 'REGION')):
                skip_block = True
            if skip_block or '-->' in line or re.fullmatch(r'\d+', line) or line.startswith(('WEBVTT', 'Kind:', 'Language:')):
                continue
            line = re.sub(r'<[^>]+>', '', line)
            lines.append(html.unescape(line))
    clean = []
    for line in lines:
        line = line.strip()
        if line and (not clean or line != clean[-1]):
            clean.append(line)
    return '\n'.join(clean)


class QuietLogger:
    def debug(self, *_): pass
    def warning(self, *_): pass
    def error(self, *_): pass


def subtitle_candidates(info, requested):
    formats = ('json3', 'vtt', 'srt', 'json')

    def language_rank(lang):
        return next((i for i, wanted in enumerate(requested) if lang == wanted or lang.startswith(wanted + '-')), len(requested))

    for automatic, tracks in ((False, info.get('subtitles') or {}), (True, info.get('automatic_captions') or {})):
        candidates = [(lang, track) for lang, values in tracks.items() if lang != 'live_chat' for track in values
                      if track.get('ext') in formats and (track.get('url') or track.get('data'))]
        if automatic:
            # YouTube's translated auto-captions (tlang=...) can return 429 even
            # when original captions work. Let the model translate the original.
            native = [(lang, track) for lang, track in candidates if 'tlang' not in parse_qs(urlparse(track.get('url', '')).query)]
            if native:
                candidates = native
        candidates.sort(key=lambda item: (0 if automatic and item[0].endswith('-orig') else 1,
                                          language_rank(item[0]), item[0], formats.index(item[1]['ext'])))
        yield from (track for _, track in candidates)


def read_subtitle(ydl, track, headers):
    limit = 20 * 1024 * 1024
    if track.get('data') is not None:
        raw = track['data']
        raw = raw.encode('utf-8') if isinstance(raw, str) else raw
    else:
        for attempt in range(2):
            try:
                request = Request(track['url'], headers={**headers, **(track.get('http_headers') or {})})
                with ydl.urlopen(request) as response:
                    raw = response.read(limit + 1)
                break
            except HTTPError as exc:
                if exc.status < 500 or attempt:
                    raise
                time.sleep(1)
            except TransportError:
                if attempt:
                    raise
                time.sleep(1)
    if len(raw) > limit:
        raise ValueError('字幕文件超过 20 MB，请使用较短的视频。')
    return raw


def fetch_subtitles(url, folder, config):
    validate_video_url(url)
    # yt-dlp is used only for published subtitles; the video is never downloaded.
    runtime = os.environ.get('GLEAN_JS_RUNTIME') or shutil.which('node')
    js_runtimes = {'node': {'path': runtime}} if runtime else {}
    with yt_dlp.YoutubeDL({'js_runtimes': js_runtimes, 'ignore_no_formats_error': True, 'skip_download': True, 'noplaylist': True, 'quiet': True, 'logger': QuietLogger(), 'socket_timeout': 30, 'retries': 2}) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except yt_dlp.utils.DownloadError as exc:
            raise ValueError('无法读取该视频。请检查视频是否公开、链接是否有效，或更新 yt-dlp；部分平台需要登录权限。') from exc
        if not info or info.get('_type') in ('playlist', 'multi_video'):
            raise ValueError('请提供单个视频的链接。')
        requested = [s.strip() for s in config['subtitle_languages'].split(',') if s.strip()]
        candidates = list(subtitle_candidates(info, requested))
        if not candidates:
            raise ValueError('这个视频没有可获取的字幕，已停止。你可以改用本地 MP4，通过声音生成字幕。')
        failure = '字幕内容为空或格式无效，已停止生成。'
        cause = None
        for selected in candidates[:6]:
            try:
                raw = read_subtitle(ydl, selected, info.get('http_headers') or {})
                text = subtitle_text(raw.decode('utf-8-sig'), selected['ext'])
                if not text.strip():
                    continue
            except HTTPError as exc:
                if exc.status == 429:
                    raise ValueError('平台暂时限制字幕请求（HTTP 429）。请稍后点击重试；无需重新创建任务。') from exc
                failure = ('字幕访问被拒绝（HTTP 403），该字幕可能需要登录权限。' if exc.status == 403
                           else f'字幕获取失败（HTTP {exc.status}），请稍后重试。')
                cause = exc
                continue
            except (TransportError, OSError) as exc:
                raise ValueError('字幕下载连接中断或超时，请检查网络后重试。') from exc
            except (UnicodeError, json.JSONDecodeError, KeyError, TypeError, AttributeError) as exc:
                cause = exc
                continue
            (folder / ('original.' + selected['ext'])).write_bytes(raw)
            return text, info.get('title', '视频笔记'), info.get('duration') or 0
        raise ValueError(failure) from cause


def transcribe(path, folder, config, job_id):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    store.update_job(job_id, stage='提取音频，按 10 分钟切分', progress=8)
    try:
        result = subprocess.run([ffmpeg, '-nostdin', '-y', '-i', str(path), '-vn', '-ac', '1', '-ar', '16000',
                                 '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', '600', str(folder / 'audio-%04d.wav')],
                                capture_output=True, timeout=7200)
        if result.returncode:
            raise ValueError('无法读取视频中的声音，请确认 MP4 包含有效音轨。')
    except subprocess.TimeoutExpired as exc:
        raise ValueError('音频提取超时，请缩短视频后重试。') from exc
    audio = sorted(folder.glob('audio-*.wav'))
    if not audio:
        raise ValueError('没有提取到有效音轨。')
    endpoint = (config['transcription_base_url'] or config['base_url']).rstrip('/') + '/audio/transcriptions'
    key = config['transcription_key'] or config['api_key']
    headers = {'Authorization': f'Bearer {key}'} if key else {}
    transcript, duration = [], 0
    import wave
    for index, chunk in enumerate(audio):
        store.update_job(job_id, stage=f'声音转字幕 {index + 1} / {len(audio)}', progress=10 + int(index / len(audio) * 15))
        cached = chunk.with_suffix('.txt')
        with wave.open(str(chunk)) as wav:
            duration += wav.getnframes() / wav.getframerate()
        if cached.exists():
            text = cached.read_text()
        else:
            with chunk.open('rb') as file, httpx.Client(timeout=600, trust_env=False) as client:
                response = client.post(endpoint, headers=headers, files={'file': (chunk.name, file, 'audio/wav')},
                                       data={'model': config['transcription_model'], 'response_format': 'json'})
            if response.status_code >= 400:
                raise ValueError(f'语音识别服务返回 HTTP {response.status_code}。请检查语音模型、地址和密钥。')
            text = response.json().get('text', '').strip()
            cached.write_text(text)
        transcript.append(f'[音频段 {index * 10:02d}:00]\n{text}')
    if not any(re.sub(r'\[音频段[^\]]+\]', '', t).strip() for t in transcript):
        raise ValueError('视频中未识别到语音。')
    return '\n\n'.join(transcript), duration
