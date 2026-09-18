from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import ai, media, store

EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix='glean-jobs')


def vault_target(relative):
    cfg = store.settings(True)
    if not cfg['vault_path']:
        raise ValueError('请先选择 Obsidian 仓库。')
    root = Path(cfg['vault_path']).expanduser().resolve()
    if not root.is_dir():
        raise ValueError('Obsidian 仓库目录不存在。')
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or target == root:
        raise ValueError('笔记路径必须位于所选仓库内。')
    if target.suffix.lower() != '.md':
        raise ValueError('只能读写 Markdown 笔记。')
    return target


def export_note(note):
    cfg = store.settings(True)
    filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '-', note['title']).strip('. ')[:120] or '未命名笔记'
    # Always create a unique export. Never overwrite a separately edited Obsidian file.
    target = vault_target(str(Path(cfg['notes_folder']) / (filename + '.md')))
    target.parent.mkdir(parents=True, exist_ok=True)
    for index in range(10000):
        candidate = target if index == 0 else target.with_stem(target.stem + f' ({index + 1})')
        try:
            with candidate.open('x', encoding='utf-8') as file:
                file.write(note['content'])
            with store.db() as c:
                c.execute('UPDATE notes SET vault_file=? WHERE id=?', (str(candidate), note['id']))
            return str(candidate)
        except FileExistsError:
            continue
    raise ValueError('同名笔记过多，请调整标题。')


def run_job(job_id):
    job = store.one('SELECT * FROM jobs WHERE id=?', (job_id,))
    payload = json.loads(job['payload'])
    folder = store.DATA / 'jobs' / job_id
    folder.mkdir(parents=True, exist_ok=True)
    config = store.settings(True)
    try:
        if not config['model'].strip():
            raise ValueError('请先在设置中填写文本模型名称，然后重试。')
        store.update_job(job_id, status='running', stage='准备素材', progress=3, error='')
        title, source, duration, original = job['title'], payload.get('source') or job['title'], 0, ''
        transcript_cache = folder / 'transcript.json'
        if job['kind'] == 'curate':
            text = payload['content']
            original = text
        elif transcript_cache.exists():
            cached = json.loads(transcript_cache.read_text())
            text, title, duration = cached['text'], cached['title'], cached['duration']
        else:
            if job['kind'] == 'txt':
                store.update_job(job_id, stage='读取字幕文件', progress=10)
                text = media.read_transcript(Path(payload['path']))
            elif job['kind'] == 'mp4':
                text, duration = media.transcribe(Path(payload['path']), folder, config, job_id)
            else:
                raise ValueError('视频链接导入已停用，请上传 .txt 字幕文件重新创建任务。')
            transcript_cache.write_text(json.dumps({'text': text, 'title': title, 'duration': duration}, ensure_ascii=False))
        content = ai.generate(text, title, source, job['kind'], job_id, config)
        # Guard against dropped embedded assets on a curate operation.
        if original:
            embeds = re.findall(r'!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^\)]+\)', original)
            missing = [e for e in embeds if e not in content]
            if missing:
                raise ValueError('模型遗漏了原笔记中的图片引用，本次未保存。请重试或换用其他模型。')
        if payload.get('note_id'):
            note_id = payload['note_id']
            store.revise(note_id, content, 'curate', expected=original)
        else:
            raw_files = list(folder.glob('original.*'))
            transcript = raw_files[0].read_text(encoding='utf-8-sig') if raw_files else text
            note_id = store.create_note(store.title_of(content, title), content, '' if original else transcript, source, job['kind'], duration)
            if original:
                with store.db() as c:
                    c.execute('INSERT INTO revisions VALUES (?,?,?,?,?)', (store.uid(), note_id, original, 'original_import', store.now()))
        store.update_job(job_id, status='completed', stage='已保存到本地笔记仓库', progress=100, note_id=note_id)
        # Keep extracted subtitles, remove large temporary audio/video after success.
        for audio in folder.glob('audio-*.wav'):
            audio.unlink(missing_ok=True)
        if job['kind'] in ('txt', 'mp4'):
            Path(payload['path']).unlink(missing_ok=True)
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError) else '处理未完成，请检查模型服务和素材后重试。'
        store.update_job(job_id, status='failed', stage='等待重试', error=message)


def new_job(kind, title, payload):
    job_id = store.uid()
    with store.db() as c:
        c.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)',
                  (job_id, 'queued', '等待处理', 0, title[:160], kind, json.dumps(payload), '', '', store.now()))
    EXECUTOR.submit(run_job, job_id)
    return job_id
