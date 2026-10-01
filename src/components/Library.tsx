import { type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowUpRight, BookOpen, FileText, Folder as FolderIcon, FolderPlus,
  Grid2X2, GripVertical, List, Plus, Search, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { api, post, type Folder, type Note } from '../api';

export type LibraryFilter = 'all' | 'folders' | 'notes' | 'ai' | 'manual';
type SortOrder = 'newest' | 'oldest' | 'title';

export default function Library({ notes, folders, filter, selectedFolder, onFilterChange, onFolderChange, onOpen, onGenerate, onChanged, notify }: {
  notes: Note[]; folders: Folder[]; onOpen: (id: string, edit?: boolean) => void; onGenerate: () => void;
  filter: LibraryFilter; selectedFolder: string | null;
  onFilterChange: (filter: LibraryFilter) => void; onFolderChange: (folderId: string | null) => void;
  onChanged: () => void | Promise<void>; notify: (message: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [draggingNote, setDraggingNote] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setFolderDialog(false);
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
    if (selectedFolder) {
      await api(`/notes/${note.id}/folder`, { method: 'PUT', body: JSON.stringify({ folder_id: selectedFolder }) });
    }
    await onChanged();
    onOpen(note.id, true);
  });

  const createFolder = (event: FormEvent) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    void work('folder-create', async () => {
      const folder = await post<Folder>('/folders', { name });
      setFolderDialog(false);
      setFolderName('');
      await onChanged();
      notify(`已新建文件夹「${folder.name}」`);
    });
  };

  const importNote = (file?: File) => {
    if (!file) return;
    void work('import', async () => {
      if (!file.name.toLowerCase().endsWith('.md') || file.size > 2_000_000) throw new Error('请选择不超过 2 MB 的 Markdown 文件');
      const note = await post<Note>('/notes', {
        title: file.name.replace(/\.md$/i, '').slice(0, 160) || '导入笔记', content: await file.text(),
      });
      if (selectedFolder) {
        await api(`/notes/${note.id}/folder`, { method: 'PUT', body: JSON.stringify({ folder_id: selectedFolder }) });
      }
      await onChanged();
      onOpen(note.id);
    });
  };

  const moveNote = (note: Note, folderId: string | null) => {
    if ((note.folder_id || null) === folderId || busy) return;
    void work('move-' + note.id, async () => {
      await api(`/notes/${note.id}/folder`, { method: 'PUT', body: JSON.stringify({ folder_id: folderId }) });
      await onChanged();
      const destination = folderId ? folders.find(folder => folder.id === folderId)?.name : '未分类';
      notify(`《${note.title}》已移至「${destination || '目标文件夹'}」`);
    });
  };

  const folderDropProps = (folder: Folder) => ({
    onDragEnter: (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); if (draggingNote) setDropTarget(folder.id); },
    onDragOver: (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; },
    onDragLeave: (event: DragEvent<HTMLButtonElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(''); },
    onDrop: (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const noteId = event.dataTransfer.getData('text/plain') || draggingNote;
      const note = notes.find(item => item.id === noteId);
      setDraggingNote('');
      setDropTarget('');
      if (note) moveNote(note, folder.id);
    },
  });

  const currentFolder = folders.find(folder => folder.id === selectedFolder) || null;
  const folderCards = !selectedFolder && (filter === 'all' || filter === 'folders')
    ? folders.filter(folder => folder.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [];
  const visibleNotes = useMemo(() => {
    if (filter === 'folders' && !selectedFolder) return [];
    const query = search.trim().toLocaleLowerCase();
    return notes.filter(note =>
      (selectedFolder ? note.folder_id === selectedFolder : filter !== 'all' || !note.folder_id) &&
      (filter !== 'ai' || note.kind !== 'manual') &&
      (filter !== 'manual' || note.kind === 'manual') &&
      (!query || (note.title + note.excerpt).toLocaleLowerCase().includes(query)))
      .sort((left, right) => sort === 'title'
        ? left.title.localeCompare(right.title, 'zh-CN')
        : sort === 'oldest'
          ? left.updated_at.localeCompare(right.updated_at)
          : right.updated_at.localeCompare(left.updated_at));
  }, [filter, notes, search, selectedFolder, sort]);
  const contentCount = selectedFolder ? visibleNotes.length : folderCards.length + visibleNotes.length;

  const chooseFilter = (value: LibraryFilter) => {
    onFolderChange(null);
    onFilterChange(value);
  };

  return <>
    <div className="library library-flat page-enter">
      <div className="page-heading library-heading">
        <div>
          {currentFolder && <button className="library-back" onClick={() => onFolderChange(null)}><ArrowLeft size={15}/>{filter === 'folders' ? '返回文件夹' : '返回全部'}</button>}
          <span className="section-kicker">理解，记录，慢慢连接</span>
          <h1>{currentFolder?.name || '我的笔记'}</h1>
          <p>{currentFolder ? `${currentFolder.note_count} 篇笔记 · 新建与导入的内容会直接保存到这里。` : `${contentCount} 项内容 · 拖动笔记卡片到文件夹，让知识各归其位。`}</p>
        </div>
        <div className="library-actions">
          <button className="button secondary" disabled={!!busy} onClick={() => setFolderDialog(true)}><FolderPlus size={16}/>新建文件夹</button>
          <button className="button secondary" disabled={!!busy} onClick={create}><Plus size={16}/>新建笔记</button>
          <label className="button secondary import-markdown"><Upload size={16}/>导入笔记<input type="file" accept=".md,text/markdown" disabled={!!busy} aria-label="导入笔记" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; importNote(file); }}/></label>
          <button className="button primary" onClick={onGenerate}><Sparkles size={16}/>AI 生成</button>
        </div>
        <aside className="library-verse">行千里路，<br/>记一寸心。<i>阅</i></aside>
      </div>

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="library-controls library-controls-flat">
        {!selectedFolder && <div className="content-tabs" role="tablist" aria-label="内容类型">
          {[
            ['all', '全部'], ['folders', '文件夹'], ['notes', '笔记'], ['ai', 'AI 笔记'], ['manual', '手写 / 导入'],
          ].map(([key, label]) => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => chooseFilter(key as LibraryFilter)}>{label}</button>)}
        </div>}
        {selectedFolder && <div className="folder-current-label"><FolderIcon size={16}/><span>{currentFolder?.name}</span><b>{visibleNotes.length} 篇</b></div>}
        <div className="library-view-controls">
          <label className="search-field"><Search size={16}/><input ref={searchRef} placeholder="搜索标题与摘要…" aria-label="搜索笔记" value={search} onChange={event => setSearch(event.target.value)}/><kbd>⌘ K</kbd></label>
          <label className="sort-select" aria-label="排序方式"><select value={sort} onChange={event => setSort(event.target.value as SortOrder)}><option value="newest">最近更新</option><option value="oldest">最早更新</option><option value="title">标题排序</option></select></label>
          <div className="layout-switch" aria-label="显示方式"><button className={layout === 'grid' ? 'active' : ''} aria-label="网格显示" onClick={() => setLayout('grid')}><Grid2X2 size={16}/></button><button className={layout === 'list' ? 'active' : ''} aria-label="列表显示" onClick={() => setLayout('list')}><List size={17}/></button></div>
        </div>
      </div>

      {contentCount ? <div className={`content-grid ${layout === 'list' ? 'list-layout' : ''}`}>
        {folderCards.map(folder => {
          const children = notes.filter(note => note.folder_id === folder.id);
          const description = children.length ? children.slice(0, 3).map(note => note.title).join('、') : '把相关笔记拖到这里';
          return <button key={folder.id} {...folderDropProps(folder)} className={`folder-card ${dropTarget === folder.id ? 'drop-target' : ''}`} onClick={() => onFolderChange(folder.id)}>
            <span className="card-grip"><GripVertical size={15}/></span>
            <span className="folder-card-icon"><FolderIcon size={31}/></span>
            <strong>{folder.name}</strong>
            <p>{description}</p>
            <footer><span>{folder.note_count} 项内容</span><ArrowUpRight size={16}/></footer>
            {dropTarget === folder.id && <em>松开以移入</em>}
          </button>;
        })}
        {visibleNotes.map(note => <article key={note.id} className={`note-card note-card-flat ${draggingNote === note.id ? 'is-dragging' : ''}`} role="button" tabIndex={0} draggable={!busy} onDragStart={event => { setDraggingNote(note.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', note.id); }} onDragEnd={() => { setDraggingNote(''); setDropTarget(''); }} onClick={() => onOpen(note.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(note.id); } }}>
          <header>
            <span className="card-grip" title="拖动到文件夹"><GripVertical size={15}/></span>
            <span className="note-file-icon"><FileText size={20}/></span>
            <span className="tag">{note.kind === 'manual' ? '手写笔记' : note.kind === 'curate' ? 'AI 整理' : 'AI 生成'}</span>
            <label className="note-move" title="移动到文件夹" onClick={event => event.stopPropagation()}><FolderIcon size={14}/><select aria-label={`移动《${note.title}》到文件夹`} value={note.folder_id || ''} disabled={!!busy} onChange={event => moveNote(note, event.target.value || null)}><option value="">未分类</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            <button className="note-delete" title="删除笔记" aria-label={`删除《${note.title}》`} disabled={!!busy} onClick={event => { event.stopPropagation(); if (!window.confirm(`确定删除《${note.title}》吗？本地 Markdown 文件也会一并删除。`)) return; void work('delete-' + note.id, async () => { await api(`/notes/${note.id}`, { method: 'DELETE' }); await onChanged(); }); }}>{busy === 'delete-' + note.id ? <span className="delete-progress"/> : <Trash2 size={15}/>}</button>
          </header>
          <h2>{note.title}</h2>
          <p>{note.excerpt}</p>
          <div className="note-file-path" title={note.note_file}>{note.folder_name ? `${note.folder_name} / ` : ''}{note.note_file ? note.note_file.split(/[\\/]/).pop() : '等待保存到仓库'}</div>
          <footer><span>{new Date(note.updated_at).toLocaleDateString('zh-CN')} 更新</span><ArrowUpRight size={16}/></footer>
        </article>)}
        {(filter !== 'folders' || selectedFolder) && <button className="new-note-tile new-note-tile-flat" onClick={onGenerate} disabled={!!busy}><span><Sparkles size={19}/></span><strong>AI 新建笔记</strong><p>从字幕、视频或已有笔记，<br/>交给 AI 整理。</p></button>}
      </div> : <div className="library-empty library-empty-flat"><BookOpen size={42} strokeWidth={1}/><h2>{search ? '没有找到匹配的内容' : filter === 'folders' ? '新建一个文件夹，让知识各归其位。' : currentFolder ? `「${currentFolder.name}」还是空的` : '从一份素材，或一页空白开始。'}</h2><p>{currentFolder ? '你可以在这里新建笔记，或从“全部内容”拖动笔记到这个文件夹。' : 'AI 生成与手写笔记，都以 Markdown 文件保存在本地仓库。'}</p><div className="library-actions"><button className="button secondary" onClick={filter === 'folders' ? () => setFolderDialog(true) : create}>{filter === 'folders' ? <FolderPlus size={16}/> : <Plus size={16}/>} {filter === 'folders' ? '新建文件夹' : '写一篇笔记'}</button>{filter !== 'folders' && <button className="button primary" onClick={onGenerate}><Sparkles size={16}/>让 AI 帮我整理</button>}</div></div>}
    </div>

    {folderDialog && <div className="folder-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFolderDialog(false); }}><form className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" onSubmit={createFolder}><button type="button" className="icon-button folder-dialog-close" aria-label="关闭" onClick={() => setFolderDialog(false)}><X size={17}/></button><span className="folder-dialog-icon"><FolderPlus size={23}/></span><h2 id="folder-dialog-title">新建文件夹</h2><p>文件夹会同步创建在你的本地笔记仓库中。</p><label>文件夹名称<input autoFocus maxLength={60} placeholder="例如：产品设计" value={folderName} onChange={event => setFolderName(event.target.value)}/></label><div><button type="button" className="button secondary" onClick={() => setFolderDialog(false)}>取消</button><button type="submit" className="button primary" disabled={!folderName.trim() || busy === 'folder-create'}>{busy === 'folder-create' ? '正在创建…' : '创建文件夹'}</button></div></form></div>}
  </>;
}
