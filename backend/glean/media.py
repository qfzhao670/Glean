from __future__ import annotations

import os
import platform
import re
import subprocess
import sys
import types
import wave
from pathlib import Path

import imageio_ffmpeg

from . import store


LOCAL_TRANSCRIPTION_MODELS = {
    'mlx-community/whisper-large-v3-turbo-4bit',
}


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


def _model_is_ready(path: Path):
    return (path / 'config.json').is_file() and (path / 'weights.safetensors').is_file() and any(path.glob('*.tiktoken'))


def _local_model_candidates(model_id: str):
    bundled = os.environ.get('GLEAN_BUNDLED_MODEL_DIR')
    if bundled:
        yield Path(bundled)
    # Keep the old data directory as a development/upgrade fallback. The
    # application never downloads into it; packaged builds use the first path.
    yield store.DATA / 'models' / model_id.rsplit('/', 1)[-1]


def _find_local_model(model_id: str):
    return next((path for path in _local_model_candidates(model_id) if _model_is_ready(path)), None)


def _prepare_local_model(model_id: str, job_id: str):
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('本地语音识别目前需要 Apple Silicon Mac（M1 或更新芯片）。')
    if model_id not in LOCAL_TRANSCRIPTION_MODELS:
        raise ValueError('当前版本只支持应用内置的 4-bit Whisper 模型。')
    store.update_job(job_id, stage='加载应用内置语音模型', progress=10)
    target = _find_local_model(model_id)
    if target is None:
        raise ValueError('应用内置语音模型缺失或文件不完整，请重新安装拾知。')
    return target


def _load_engine():
    # mlx-whisper imports its optional word-alignment stack unconditionally.
    # Segment timestamps do not use it, so keep scipy/numba out of the desktop
    # bundle and install a tiny guard before importing mlx-whisper.
    timing_module = 'mlx_whisper.timing'
    if timing_module not in sys.modules:
        timing = types.ModuleType(timing_module)
        def word_timestamps_are_disabled(**_kwargs):
            raise RuntimeError('word timestamps are disabled')
        timing.add_word_timestamps = word_timestamps_are_disabled
        sys.modules[timing_module] = timing
    try:
        import mlx_whisper
    except ImportError as exc:
        detail = f'{exc}; {exc.__cause__!r}' if exc.__cause__ else str(exc)
        raise ValueError(f'本地语音识别组件未安装，请重新安装或构建拾知：{detail}') from exc
    return mlx_whisper


def local_engine_status(model_id: str):
    error = ''
    try:
        _load_engine()
        import mlx.core as mx
        available = bool(mx.metal.is_available())
    except Exception as exc:
        available = False
        error = str(exc)
    return {'available': available, 'model_downloaded': _find_local_model(model_id) is not None, 'model': model_id, 'error': error}


def _recognize(chunk: Path, model_path: Path, language: str):
    mlx_whisper = _load_engine()
    try:
        import numpy as np
        with wave.open(str(chunk)) as wav:
            audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    except Exception as exc:
        raise ValueError('无法读取提取后的本地音频。') from exc
    options = {
        'path_or_hf_repo': str(model_path),
        'verbose': None,
        'task': 'transcribe',
        'temperature': (0.0, 0.2, 0.4),
        'condition_on_previous_text': True,
    }
    if language != 'auto':
        options['language'] = language
        if language == 'zh':
            options['initial_prompt'] = '以下是普通话课程或会议录音，请使用简体中文和规范标点。'
    try:
        return mlx_whisper.transcribe(audio, **options)
    except Exception as exc:
        raise ValueError('本地语音识别失败。请关闭占用内存较多的应用后重试。') from exc


def _timestamp(seconds: float):
    total = max(0, round(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f'{hours:02d}:{minutes:02d}:{seconds:02d}'


def _clean_transcript_text(value):
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    return re.sub(r'([，。！？、,.!?])\1+', r'\1', text)


def _join_transcript_parts(parts):
    output = ''
    for part in parts:
        text = _clean_transcript_text(part)
        if not text:
            continue
        needs_space = output and output[-1].isascii() and output[-1].isalnum() and text[0].isascii() and text[0].isalnum()
        output += (' ' if needs_space else '') + text
    return output


def _render_result(result: dict, offset: float):
    segments = []
    for raw in result.get('segments') or []:
        text = _clean_transcript_text(raw.get('text'))
        if not text:
            continue
        start = float(raw.get('start') or 0)
        end = max(start, float(raw.get('end') or start))
        segments.append({'start': start, 'end': end, 'text': text})
    if not segments:
        return _clean_transcript_text(result.get('text'))

    lines = []
    group = []
    group_start = 0.0
    for index, segment in enumerate(segments):
        if not group:
            group_start = segment['start']
        group.append(segment['text'])
        duration = segment['end'] - group_start
        following = segments[index + 1] if index + 1 < len(segments) else None
        flush = following is None or duration >= 25
        if following is not None:
            next_duration = following['end'] - group_start
            # Prefer a natural Whisper boundary near 25 seconds. Never pull a
            # normal segment into a group once it would cross 30 seconds.
            if duration >= 20 and (next_duration > 30 or abs(25 - duration) <= abs(25 - next_duration)):
                flush = True
            # A long silence is also a useful semantic boundary.
            silence = following['start'] - segment['end']
            if (duration >= 20 and silence >= 3) or following['start'] - group_start > 30:
                flush = True
        if flush:
            lines.append(f'[{_timestamp(offset + group_start)}] {_join_transcript_parts(group)}')
            group = []
    return '\n'.join(lines)


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

    uncached = [chunk for chunk in audio if not chunk.with_suffix('.txt').exists()]
    model_path = None
    if uncached:
        model_path = _prepare_local_model(config['transcription_model'], job_id)

    transcript, duration, offset = [], 0, 0
    language = config.get('transcription_language', 'auto')
    for index, chunk in enumerate(audio):
        store.update_job(job_id, stage=f'本机声音转字幕 {index + 1} / {len(audio)}', progress=12 + int(index / len(audio) * 22))
        cached = chunk.with_suffix('.txt')
        with wave.open(str(chunk)) as wav:
            chunk_duration = wav.getnframes() / wav.getframerate()
        if cached.exists():
            text = cached.read_text()
        else:
            text = _render_result(_recognize(chunk, model_path, language), offset)
            cached.write_text(text)
        if text.strip():
            transcript.append(text)
        duration += chunk_duration
        offset += chunk_duration
    if not any(re.sub(r'\[[0-9:]+\]', '', text).strip() for text in transcript):
        raise ValueError('视频中未识别到语音。')
    return '\n\n'.join(transcript), duration
