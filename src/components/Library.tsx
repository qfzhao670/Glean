import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, FileText, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, post, type Note } from '../api';

export default function Library({ notes, onOpen, onGenerate, onChanged }: {
  notes: Note[]; onOpen: (id: string, edit?: boolean) => void; onGenerate: () => void; onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function work(name: string, run: () => Promise<void>) {
    setBusy(name);
    setError('');
    try { await run(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(''); }
  }

  const create = () => work('create', async () => {
    const note = await post<Note>('/notes', { title: '未命名笔记' });
    onChanged();
    onOpen(note.id, true);
  });

  const importNote = (file?: File) => {
    if (!file) return;
    work('import', async () => {
      if (!file.name.toLowerCase().endsWith('.md') || file.size > 2_000_000) throw new Error('请选择不超过 2 MB 的 Markdown 文件');
      const note = await post<Note>('/notes', {
        title: file.name.replace(/\.md$/i, '').slice(0, 160) || '导入笔记', content: await file.text(),
      });
      onChanged();
      onOpen(note.id);
    });
  };

  const visible = notes.filter(note =>
    (filter === 'all' || (filter === 'ai' ? note.kind !== 'manual' : note.kind === 'manual')) &&
    (note.title + note.excerpt).toLowerCase().includes(search.toLowerCase()));

  return <div className="library page-enter">
    <div className="page-heading library-heading">
      <div><span className="section-kicker">理解，记录，慢慢连接</span><h1>我的笔记</h1><p>{notes.length} 篇笔记 · AI 帮你提炼，也留一页给自己的想法。</p></div>
      <div className="library-actions">
        <button className="button secondary" disabled={!!busy} onClick={create}><Plus size={16}/>新建笔记</button>
        <label className="button secondary import-markdown"><Upload size={16}/>导入笔记<input type="file" accept=".md,text/markdown" disabled={!!busy} aria-label="导入笔记" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; importNote(file); }}/></label>
        <button className="button primary" onClick={onGenerate}><Sparkles size={16}/>AI 生成</button>
      </div>
      <aside className="library-verse">行千里路，<br/>记一寸心。<i>阅</i></aside>
    </div>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="library-controls">
      <div className="filter-tabs">{[{ key: 'all', label: '全部笔记' }, { key: 'ai', label: 'AI 笔记' }, { key: 'manual', label: '手写 / 导入' }].map(item => <button key={item.key} className={filter === item.key ? 'active' : ''} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
      <label className="search-field"><Search size={16}/><input ref={searchRef} placeholder="搜索标题与摘要…" aria-label="搜索笔记" value={search} onChange={event => setSearch(event.target.value)}/><kbd>⌘ K</kbd></label>
    </div>
    {visible.length ? <div className="note-grid">{visible.map(note => <div key={note.id} className="note-card" role="button" tabIndex={0} onClick={() => onOpen(note.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(note.id); } }}><div className="note-card-heading"><span className="note-file-icon"><FileText size={21}/></span><span className="tag">{note.kind === 'manual' ? '手写笔记' : note.kind === 'curate' ? 'AI 整理' : 'AI 生成'}</span><button className="note-delete" title="删除笔记" aria-label={`删除《${note.title}》`} disabled={!!busy} onClick={event => { event.stopPropagation(); if (!window.confirm(`确定删除《${note.title}》吗？本地 Markdown 文件也会一并删除。`)) return; work('delete-' + note.id, async () => { await api(`/notes/${note.id}`, { method: 'DELETE' }); onChanged(); }); }} onKeyDown={event => event.stopPropagation()}>{busy === 'delete-' + note.id ? <span className="delete-progress"/> : <Trash2 size={15}/>}</button></div><h2>{note.title}</h2><p>{note.excerpt}</p><div className="note-file-path" title={note.note_file}>{note.note_file ? note.note_file.split(/[\\/]/).pop() : '等待保存到仓库'}</div><footer><span>{new Date(note.updated_at).toLocaleDateString('zh-CN')} 更新 · {note.links} 个连接</span><ArrowUpRight size={17}/></footer></div>)}<button className="new-note-tile" onClick={create} disabled={!!busy}><span><Plus size={20}/></span><strong>新建笔记</strong><p>记录此刻的思考，<br/>也是修行的一部分。</p></button></div> : <div className="library-empty"><BookOpen size={42} strokeWidth={1}/><h2>{search || filter !== 'all' ? '没有找到匹配的笔记' : '从一份素材，或一页空白开始。'}</h2><p>AI 生成与手写笔记，都以 Markdown 文件保存在本地仓库。</p><div className="library-actions"><button className="button secondary" disabled={!!busy} onClick={create}><Plus size={16}/>写一篇笔记</button><button className="button primary" onClick={onGenerate}><Sparkles size={16}/>让 AI 帮我整理</button></div></div>}
  </div>;
}
