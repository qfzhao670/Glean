from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import calendar
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import ai, media, repository, service, store

store.init()
TOKEN = os.environ.get('GLEAN_TOKEN') or secrets.token_urlsafe(32)
app = FastAPI(title='Glean', docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def local_auth(request: Request, call_next):
    if request.url.path.startswith('/api'):
        origin = request.headers.get('origin')
        allowed = {f'http://127.0.0.1:{os.environ.get("GLEAN_PORT", "8765")}', 'http://127.0.0.1:5173'}
        if origin and origin not in allowed:
            return JSONResponse({'detail': '来源不受信任'}, status_code=403)
        if not secrets.compare_digest(request.headers.get('X-Glean-Token', ''), TOKEN):
            return JSONResponse({'detail': '本地会话已失效，请重新启动应用'}, status_code=401)
    return await call_next(request)


@app.exception_handler(ValueError)
async def value_error(_request, exc):
    return JSONResponse({'detail': str(exc)}, status_code=400)


def get_note(note_id):
    note = store.one('SELECT * FROM notes WHERE id=?', (note_id,))
    if not note:
        raise HTTPException(404, '笔记不存在')
    return note


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    base_url: str = Field(max_length=1000)
    model: str = Field(max_length=200)
    api_key: str | None = Field(default='', max_length=4000)
    transcription_base_url: str = Field(default='', max_length=1000)
    transcription_key: str | None = Field(default='', max_length=4000)
    transcription_model: Literal['mlx-community/whisper-large-v3-turbo-4bit'] = 'mlx-community/whisper-large-v3-turbo-4bit'
    transcription_language: Literal['auto', 'zh', 'en'] = 'auto'
    vault_path: str = Field(default='', max_length=2000)
    notes_folder: str = Field(default='Glean', max_length=200)
    chunk_chars: int = Field(default=12000, ge=2000, le=24000)
    auto_patch: bool = True
    repository_path: str = Field(default='', max_length=2000)
    @field_validator('base_url', 'transcription_base_url')
    @classmethod
    def url(cls, value):
        from urllib.parse import urlparse
        if not value:
            return value
        parsed = urlparse(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('模型地址必须是有效的 HTTP(S) base URL，不包含查询参数或用户名。')
        return value.rstrip('/')

    @field_validator('notes_folder')
    @classmethod
    def folder(cls, value):
        if Path(value).is_absolute() or '..' in Path(value).parts:
            raise ValueError('笔记文件夹须位于仓库内。')
        return value


class JobInput(BaseModel):
    kind: Literal['curate']
    title: str = Field(default='新笔记', max_length=160)
    content: str = Field(default='', max_length=2_000_000)
    note_id: str = ''


class ChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=8000)


class EditInput(BaseModel):
    content: str = Field(max_length=2_000_000)
    expected: str = Field(max_length=2_000_000)
    title: str | None = Field(default=None, min_length=1, max_length=160)


class NoteInput(BaseModel):
    title: str = Field(default='未命名笔记', min_length=1, max_length=160)
    content: str = Field(default='', max_length=2_000_000)


class RepositoryInput(BaseModel):
    path: str = Field(min_length=1, max_length=2000)


@app.get('/api/health')
def health():
    return {'ok': True, 'version': '0.2.0'}


@app.get('/api/settings')
def read_settings():
    return store.settings()


@app.get('/api/transcription/status')
def transcription_status():
    return media.local_engine_status(store.settings(True)['transcription_model'])


@app.post('/api/settings/secrets/{name}/reveal')
def reveal_secret(name: Literal['api_key', 'transcription_key']):
    # Ordinary settings responses remain redacted. Reveal only after an explicit
    # action from the authenticated local UI, and never cache this response.
    return JSONResponse({'value': store.settings(True)[name]}, headers={'Cache-Control': 'no-store'})


@app.put('/api/settings')
def write_settings(value: Settings):
    return store.save_settings(value.model_dump())


@app.get('/api/repository')
def read_repository():
    path = store.settings(True)['repository_path']
    pending = store.one("SELECT COUNT(*) AS count FROM notes WHERE note_file=''")['count']
    return {'path': path, 'available': Path(path).is_dir(), 'pending': pending}


@app.put('/api/repository')
def choose_repository(value: RepositoryInput):
    store.save_settings({'repository_path': value.path})
    store.materialize_notes()
    return read_repository()


@app.post('/api/settings/test')
def test_connection():
    ai.completion([{'role': 'user', 'content': 'Reply with OK.'}], max_tokens=32)
    return {'ok': True}


@app.get('/api/stats')
def stats():
    notes = store.rows('SELECT id,title,content,kind,duration,created_at,updated_at FROM notes ORDER BY updated_at DESC')
    events = store.rows('SELECT kind,created_at FROM events')
    days = {}
    for event in events:
        day = datetime.fromisoformat(event['created_at']).astimezone().date().isoformat()
        days[day] = days.get(day, 0) + 1
    today, streak = date.today(), 0
    cursor = today if today.isoformat() in days else today - timedelta(days=1)
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)
    month_index = today.year * 12 + today.month - 1 - 6
    year, month = divmod(month_index, 12)
    first = date(year, month + 1, min(today.day, calendar.monthrange(year, month + 1)[1]))
    start = first - timedelta(days=first.weekday())
    end = today + timedelta(days=6 - today.weekday())
    activity = [{'date': (start + timedelta(days=i)).isoformat(),
                 'count': days.get((start + timedelta(days=i)).isoformat(), 0),
                 'in_range': first <= start + timedelta(days=i) <= today}
                for i in range((end - start).days + 1)]
    return {'generated': sum(n['kind'] in ('txt', 'mp4', 'url') for n in notes), 'curated': sum(n['kind'] == 'curate' for n in notes),
            'manual': sum(n['kind'] == 'manual' for n in notes),
            'notes': len(notes), 'links': sum(len(store.links(n['content'])) for n in notes),
            'minutes': round(sum(n['duration'] for n in notes) / 60), 'patches': sum(e['kind'] == 'patch' for e in events),
            'streak': streak, 'active_days': len(days), 'activity': activity,
            'graph': [{'id': n['id'], 'title': n['title'], 'links': store.links(n['content'])} for n in notes]}


@app.get('/api/notes')
def notes():
    values = store.rows('SELECT id,title,content,source,kind,duration,vault_file,note_file,created_at,updated_at FROM notes ORDER BY updated_at DESC')
    for note in values:
        content = note.pop('content')
        body = re.sub(r'\A---\n.*?\n---\n', '', content, flags=re.S)
        note['excerpt'] = re.sub(r'[#*>\[\]=`]', '', body).strip().replace('\n', ' ')[:130]
        note['links'] = len(store.links(content))
    return values


@app.post('/api/notes')
def create_note(value: NoteInput):
    title = value.title.strip() or '未命名笔记'
    content = value.content or f'# {title}\n\n'
    note_id = store.create_note(store.title_of(content, title), content, '', '手动创建', 'manual')
    return note(note_id)


@app.get('/api/notes/{note_id}')
def note(note_id: str):
    value = get_note(note_id)
    value['messages'] = store.rows('SELECT * FROM messages WHERE note_id=? ORDER BY created_at', (note_id,))
    value['revisions'] = store.rows('SELECT id,reason,created_at FROM revisions WHERE note_id=? ORDER BY created_at DESC', (note_id,))
    return value


@app.put('/api/notes/{note_id}')
def edit(note_id: str, value: EditInput):
    store.revise(note_id, value.content, 'edit', value.expected, title=value.title)
    return note(note_id)


@app.delete('/api/notes/{note_id}')
def delete_note(note_id: str):
    store.delete_note(note_id)
    return {'ok': True}


@app.post('/api/notes/{note_id}/restore/{revision_id}')
def restore(note_id: str, revision_id: str):
    revision = store.one('SELECT * FROM revisions WHERE id=? AND note_id=?', (revision_id, note_id))
    if not revision:
        raise HTTPException(404, '历史版本不存在')
    store.revise(note_id, revision['content'], 'restore')
    return note(note_id)


@app.post('/api/notes/{note_id}/export')
def export(note_id: str):
    return {'path': service.export_note(get_note(note_id))}


@app.post('/api/notes/{note_id}/chat')
def chat(note_id: str, value: ChatInput):
    current = get_note(note_id)
    history = store.rows('SELECT role,content FROM messages WHERE note_id=? ORDER BY created_at', (note_id,))
    config = store.settings(True)
    result = ai.chat(current, history, value.message, config)
    answer = result.get('answer')
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError('模型返回的回答为空，请重试。')
    patch_status = ''
    if result.get('patch') and config['auto_patch']:
        patched = ai.apply_patch(current['content'], result['patch'])
        if patched:
            try:
                store.revise(note_id, patched, 'chat_patch', expected=current['content'])
                patch_status = '已添加可撤销的知识补丁'
            except ValueError:
                patch_status = '笔记已更新，本次补丁未自动写入'
        else:
            patch_status = '未找到唯一原句或内容重复，本次未写入补丁'
    with store.db() as c:
        c.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)', (store.uid(), note_id, 'user', value.message, '', store.now()))
        c.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)', (store.uid(), note_id, 'assistant', answer, patch_status, store.now()))
    return note(note_id)


@app.post('/api/notes/{note_id}/chat/stream')
def stream_chat(note_id: str, value: ChatInput):
    current = get_note(note_id)
    history = store.rows('SELECT role,content FROM messages WHERE note_id=? ORDER BY created_at', (note_id,))
    config = store.settings(True)

    def event(kind, **values):
        return json.dumps({'type': kind, **values}, ensure_ascii=False) + '\n'

    def generate():
        answer_parts = []
        try:
            for delta in ai.chat_stream(current, history, value.message, config):
                answer_parts.append(delta)
                yield event('delta', content=delta)
            answer = ''.join(answer_parts).strip()
            if not answer:
                raise ValueError('模型返回的回答为空，请重试。')
            patch_status = ''
            if config['auto_patch']:
                try:
                    patch = ai.chat_patch(current, value.message, answer, config)
                    if patch:
                        patched = ai.apply_patch(current['content'], patch)
                        if patched:
                            try:
                                store.revise(note_id, patched, 'chat_patch', expected=current['content'])
                                patch_status = '已添加可撤销的知识补丁'
                            except ValueError:
                                patch_status = '笔记已更新，本次补丁未自动写入'
                        else:
                            patch_status = '未找到唯一原句或内容重复，本次未写入补丁'
                except ValueError:
                    patch_status = '回答已保存，知识补丁生成失败'
            with store.db() as c:
                c.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)', (store.uid(), note_id, 'user', value.message, '', store.now()))
                c.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)', (store.uid(), note_id, 'assistant', answer, patch_status, store.now()))
            yield event('done', note=note(note_id))
        except ValueError as exc:
            yield event('error', message=str(exc))
        except Exception:
            yield event('error', message='对话未完成，请重试。')

    return StreamingResponse(generate(), media_type='application/x-ndjson', headers={
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    })


@app.get('/api/jobs')
def jobs():
    return store.rows('SELECT id,status,stage,progress,title,kind,error,note_id,created_at FROM jobs ORDER BY created_at DESC LIMIT 40')


@app.post('/api/jobs')
def create_job(value: JobInput):
    payload = value.model_dump()
    if value.note_id:
        current = get_note(value.note_id)
        payload['content'] = current['content']
        value.title = current['title']
    elif not value.content.strip():
        raise ValueError('请先输入或导入笔记。')
    return {'id': service.new_job(value.kind, value.title, payload)}


@app.post('/api/jobs/upload')
async def upload(file: UploadFile = File(...)):
    filename = re.split(r'[/\\]', file.filename or '')[-1]
    suffix = Path(filename).suffix.lower()
    if suffix not in ('.txt', '.mp4'):
        raise ValueError('请选择 .txt 字幕文件或 MP4 视频文件。')
    kind = 'txt' if suffix == '.txt' else 'mp4'
    limit = 20 * 1024 ** 2 if kind == 'txt' else 4 * 1024 ** 3
    folder = store.DATA / 'uploads'
    folder.mkdir(exist_ok=True)
    target = folder / (store.uid() + suffix)
    total = 0
    try:
        with target.open('wb') as output:
            while data := await file.read(1024 * 1024):
                total += len(data)
                if total > limit:
                    raise ValueError('字幕文件超过 20 MB，请拆分后重试。' if kind == 'txt' else '视频超过 4 GB，请先压缩或分段。')
                output.write(data)
        title = Path(filename).stem.strip() or ('字幕笔记' if kind == 'txt' else '视频笔记')
        return {'id': service.new_job(kind, title, {'path': str(target), 'source': filename})}
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.post('/api/jobs/{job_id}/retry')
def retry(job_id: str):
    with store.db() as c:
        updated = c.execute("UPDATE jobs SET status='queued',error='',stage='等待重试' WHERE id=? AND status='failed'", (job_id,))
        if updated.rowcount != 1:
            raise ValueError('仅失败的任务可以重试。')
    service.EXECUTOR.submit(service.run_job, job_id)
    return {'ok': True}


@app.get('/api/vault/notes')
def vault_notes():
    cfg = store.settings(True)
    root = repository.root(cfg['repository_path'])
    return [{'path': str(p.relative_to(root)), 'title': p.stem} for p in root.rglob('*.md')
            if not any(part.startswith('.') for part in p.relative_to(root).parts) and p.resolve().is_relative_to(root)][:3000]


class VaultImport(BaseModel):
    path: str = Field(max_length=2000)


@app.post('/api/vault/import')
def import_vault(value: VaultImport):
    root = repository.root(store.settings(True)['repository_path'])
    target = (root / value.path).resolve()
    if not target.is_relative_to(root) or target.suffix.lower() != '.md':
        raise ValueError('只能读取所选仓库内的 Markdown 文件。')
    if not target.is_file() or target.stat().st_size > 2_000_000:
        raise ValueError('文件不存在或超过 2 MB。')
    return {'title': target.stem, 'content': target.read_text(encoding='utf-8')}


# UI is bundled and served by the local sidecar in the desktop app.
UI = Path(os.environ.get('GLEAN_UI_DIR', Path(__file__).resolve().parents[2] / 'dist'))
if (UI / 'assets').is_dir():
    app.mount('/assets', StaticFiles(directory=UI / 'assets'), name='assets')

@app.get('/')
def index():
    if not (UI / 'index.html').exists():
        raise HTTPException(404, '请先运行 npm run build')
    return FileResponse(UI / 'index.html')
