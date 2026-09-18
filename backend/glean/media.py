from __future__ import annotations

import re
import subprocess
from pathlib import Path

import httpx
import imageio_ffmpeg
from . import store


def read_transcript(path):
    raw = path.read_bytes()
    if len(raw) > 20 * 1024 ** 2:
        raise ValueError('字幕文件超过 20 MB，请拆分后重试。')
    if b'\x00' in raw:
        raise ValueError('字幕文件不是有效的纯文本。请提供 .txt 文件。')
    text = None
    for encoding in ('utf-8-sig', 'gb18030'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError('无法读取字幕编码，请将 .txt 文件另存为 UTF-8 后重试。')
    if not text.strip():
        raise ValueError('字幕文件内容为空。')
    return text


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
