import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronRight, FileText, FolderOpen, Leaf, LoaderCircle, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Sprout, X } from 'lucide-react';
import { api, post, streamJobUpdates, type Job, type Note, type Settings, type Stats } from './api';
import { currentJobs } from './jobs';
import CreateModal from './components/CreateModal';
import SettingsPage from './components/SettingsPage';
import NoteDetail from './components/NoteDetail';
import Library from './components/Library';
import GeneratingNote from './components/GeneratingNote';
import HomeDashboard from './components/HomeDashboard';
const emptyStats: Stats = { generated: 0, curated: 0, manual: 0, notes: 0, links: 0, minutes: 0, patches: 0, streak: 0, active_days: 0, activity: [], graph: [] };

function Logo({ small = false }: { small?: boolean }) { return <svg viewBox="0 0 36 40" width={small ? 23 : 31} height={small ? 27 : 35} fill="none" aria-hidden="true"><path d="M18 36V14M18 25C6 26 2 16 4 7C15 8 21 13 18 25ZM18 18C29 19 35 9 31 2C22 4 18 8 18 18Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M9 15L18 25M27 9L18 18" stroke="currentColor" strokeWidth="1.2"/></svg>; }
export default function App() {
  const [page, setPage] = useState<'home' | 'notes' | 'settings'>('home'); const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(emptyStats); const [notes, setNotes] = useState<Note[]>([]); const [jobs, setJobs] = useState<Job[]>([]); const [settings, setSettings] = useState<Settings | null>(null);
  const [modal, setModal] = useState<'txt' | 'mp4' | 'curate' | null>(null); const [toast, setToast] = useState(''); const [error, setError] = useState(''); const [showJobs, setShowJobs] = useState(false); const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set()); const [toastNote, setToastNote] = useState('');
  const [generatingJob, setGeneratingJob] = useState<string | null>(null);
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [noteSwitcherCollapsed, setNoteSwitcherCollapsed] = useState(() => localStorage.getItem('glean-note-switcher-collapsed') === '1');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchedJobs = useRef(new Set<string>());
  const pendingGenerationJobs = useRef(new Set<string>());
  const jobStreams = useRef(new Map<string, AbortController>());
  const [editNew, setEditNew] = useState(false); const [dirty, setDirty] = useState(false);
  const notify = useCallback((message: string, noteId = '') => { setToast(message); setToastNote(noteId); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const refresh = useCallback(async () => { try { const [s, n, j, config] = await Promise.all([api<Stats>('/stats'), api<Note[]>('/notes'), api<Job[]>('/jobs'), api<Settings>('/settings')]); setStats(s); setNotes(n); setJobs(j); setSettings(config); setError('');
      for (const job of j) {
        if (job.status === 'running' || job.status === 'queued') watchedJobs.current.add(job.id);
        else if (watchedJobs.current.delete(job.id)) {
          if (job.status === 'completed') notify(`${job.title} 已完成`, job.note_id);
          else if (job.status === 'failed') { notify('当前任务未完成，请查看拾知进度'); setShowJobs(true); }
        }
      } } catch (e) { setError((e as Error).message); } }, [notify]);
  useEffect(() => { refresh(); const interval = setInterval(refresh, 10000); return () => { clearInterval(interval); if (toastTimer.current) clearTimeout(toastTimer.current); for (const controller of jobStreams.current.values()) controller.abort(); }; }, [refresh]);
  useEffect(() => {
    for (const job of jobs) {
      if (!['queued', 'running'].includes(job.status) || jobStreams.current.has(job.id)) continue;
      const controller = new AbortController();
      jobStreams.current.set(job.id, controller);
      streamJobUpdates(job.id, updated => {
        setJobs(previous => {
          const exists = previous.some(item => item.id === updated.id);
          return exists ? previous.map(item => item.id === updated.id ? updated : item) : [updated, ...previous];
        });
        if (pendingGenerationJobs.current.has(updated.id) && updated.status === 'running' && /大纲|笔记|填充|写作/.test(updated.stage)) {
          pendingGenerationJobs.current.delete(updated.id);
          setDirty(false);
          setSelected(null);
          setGeneratingJob(updated.id);
          setPage('notes');
          setShowJobs(false);
        }
        if (updated.status === 'completed' || updated.status === 'failed') {
          jobStreams.current.delete(updated.id);
          void refresh();
        }
      }, controller.signal).catch(reason => {
        jobStreams.current.delete(job.id);
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        // The ten-second refresh remains a quiet fallback for a dropped stream.
      });
    }
  }, [jobs, refresh]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (dirty && !window.confirm('还有未保存的修改，确定离开吗？')) return; setDirty(false); setGeneratingJob(null); setPage('notes'); setSelected(null); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="搜索笔记"]')?.focus(), 50); } if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setModal('txt'); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [dirty]);
  const canLeave = () => !dirty || window.confirm('还有未保存的修改，确定离开吗？');
  const navigate = (next: typeof page) => { if (!canLeave()) return; setDirty(false); setGeneratingJob(null); setPage(next); setSelected(null); };
  const openNote = (id: string, edit = false) => { if (!canLeave()) return; setDirty(false); setGeneratingJob(null); setEditNew(edit); setOpenNoteIds(previous => previous.includes(id) ? previous : [...previous, id]); setPage('notes'); setSelected(id); };
  const closeNote = (id: string) => {
    if (id === selected && !canLeave()) return;
    const index = openNoteIds.indexOf(id);
    const remaining = openNoteIds.filter(noteId => noteId !== id);
    setOpenNoteIds(remaining);
    if (id === selected) {
      setDirty(false);
      setEditNew(false);
      setSelected(remaining[Math.min(index, remaining.length - 1)] || null);
    }
  };
  const toggleNoteSwitcher = () => setNoteSwitcherCollapsed(previous => {
    const next = !previous;
    localStorage.setItem('glean-note-switcher-collapsed', next ? '1' : '0');
    return next;
  });
  const watchJob = (id: string) => { watchedJobs.current.add(id); pendingGenerationJobs.current.add(id); setShowJobs(true); refresh(); };
  const chooseRepository = async () => {
    try {
      const current = (settings?.repository_path || '').replace(/[\\/]+$/, '');
      const separator = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
      const parent = separator === 0 ? current.slice(0, 1) : separator === 2 && /^[A-Za-z]:/.test(current) ? current.slice(0, 3) : separator > 0 ? current.slice(0, separator) : current;
      const path = window.glean ? await window.glean.chooseVault() : window.prompt('请输入本地笔记仓库的绝对路径', parent);
      if (!path) return;
      await api('/repository', { method: 'PUT', body: JSON.stringify({ path }) });
      await refresh();
      notify('本地笔记仓库已更新，原文件保留');
    } catch (reason) { notify((reason as Error).message); }
  };
  const visibleJobs = currentJobs(jobs, dismissedJobs);
  const ongoing = jobs.filter(j => ['queued', 'running'].includes(j.status));
  const dateLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).replace(/日(?=星期)/, '日 ');
  return <div className={`app-shell ${selected ? 'note-focus' : ''}`}><aside className="sidebar"><div className="window-space"/><button className="brand" onClick={() => navigate('home')}><Logo/><span>拾知<small>Glean</small></span></button><div className="sidebar-caption">在这里，知识慢慢生长</div><button className="new-note-button" onClick={() => setModal('txt')}><Plus size={18}/>拾取新知<span>⌘ N</span></button><nav><button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}><Sprout size={19}/>拾知灵境<ChevronRight size={14}/></button><button className={page === 'notes' ? 'active' : ''} onClick={() => navigate('notes')}><BookOpen size={19}/>我的笔记<span className="nav-count">{notes.length.toString().padStart(2, '0')}</span></button></nav>
    <div className="sidebar-bottom"><div className="sidebar-quote"><Leaf size={21} strokeWidth={1.1}/><p>不必急着成为森林。<br/>今天，长出一片新叶就好。</p><span>一点一滴，皆有所获。</span></div><button className={`sidebar-settings ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>设置</button><button className="vault-indicator" title="选择本地笔记仓库" onClick={chooseRepository}><FolderOpen size={16}/><span>{settings?.repository_path ? '本地笔记仓库' : '选择本地笔记仓库'}<small>{settings?.repository_path ? settings.repository_path.split(/[\\/]/).filter(Boolean).pop() : '点击选择保存文件夹'}</small></span><ArrowUpRight size={15}/></button></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">我的空间 <span>/</span> <strong>{page === 'home' ? '拾知灵境' : page === 'settings' ? '设置' : generatingJob ? '笔记生成中' : selected ? '笔记详情' : '我的笔记'}</strong></div><div className="topbar-right"><button className={`task-indicator ${ongoing.length ? 'working' : ''}`} onClick={() => setShowJobs(!showJobs)}>{ongoing.length ? <LoaderCircle size={13} className="spin"/> : <span className="status-dot"/>}{ongoing.length ? `${ongoing.length} 份知识正在生长` : visibleJobs.length ? '当前任务未完成' : '拾知，日有所长'}</button><span className="topbar-separator"/><button className="profile" title="学习者的本地空间" onClick={() => navigate('settings')}>拾</button></div></header>
    {error && <div className="connection-error" role="alert">{error}<button onClick={refresh}>重新连接</button></div>}
    {showJobs && <div className="jobs-panel"><div className="section-heading"><h3>拾知进度</h3><button className="icon-button" aria-label="关闭进度" onClick={() => setShowJobs(false)}><X size={18}/></button></div>{visibleJobs.length === 0 ? <p className="muted">当前没有进行中的任务。完成的内容可在「我的笔记」查看。</p> : visibleJobs.map(j => <div className={`job-item ${j.status === 'running' ? 'is-running' : ''}`} key={j.id}><div><strong>{j.title}</strong>{j.status !== 'failed' && <b>{j.progress}%</b>}<span>{j.status === 'failed' ? '未完成' : j.stage}</span></div>{j.status === 'failed' ? <><p className="job-error">{j.error}</p><div className="job-actions"><button className="button subtle small" onClick={async () => { try { await post(`/jobs/${j.id}/retry`); watchJob(j.id); } catch (e) { notify((e as Error).message); } }}>重试</button><button className="button text-button small" onClick={() => setDismissedJobs(previous => new Set(previous).add(j.id))}>收起任务</button></div></> : <div className="progress-track" aria-label={`任务进度 ${j.progress}%`}><span style={{ width: `${j.progress}%` }}/></div>}</div>)}</div>}
    <main>{page === 'home' && <HomeDashboard stats={stats} notes={notes} dateLabel={dateLabel} onCreate={() => setModal('txt')} onOpen={openNote} onLibrary={() => navigate('notes')}/>}
    {page === 'notes' && generatingJob && <GeneratingNote jobId={generatingJob} onBack={() => navigate('notes')} onCompleted={id => { setGeneratingJob(null); setEditNew(false); setOpenNoteIds(previous => previous.includes(id) ? previous : [...previous, id]); setSelected(id); void refresh(); }} onLink={title => {
      const target = notes.find(note => note.title === title);
      if (target) openNote(target.id);
    }}/>} {page === 'notes' && !generatingJob && !selected && <Library notes={notes} onOpen={openNote} onGenerate={() => setModal('txt')} onChanged={refresh}/>} {page === 'notes' && !generatingJob && selected && <div className={`note-workspace ${noteSwitcherCollapsed ? 'switcher-collapsed' : ''}`}>
      <aside className="note-switcher">
        <div className="note-switcher-rail">
          <button title="展开笔记栏" aria-label="展开笔记栏" onClick={toggleNoteSwitcher}><FileText size={17}/></button>
          <button title="搜索笔记" aria-label="搜索笔记" onClick={() => { toggleNoteSwitcher(); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="在工作区搜索笔记"]')?.focus()); }}><Search size={17}/></button>
          <button title="返回笔记库" aria-label="返回笔记库" onClick={() => navigate('notes')}><BookOpen size={17}/></button>
        </div>
        <div className="note-switcher-heading"><Logo small/><div><strong>拾知笔记</strong><span>{notes.length} 篇</span></div></div>
        <label className="note-switcher-search"><Search size={14}/><input aria-label="在工作区搜索笔记" placeholder="搜索笔记" value={workspaceQuery} onChange={event => setWorkspaceQuery(event.target.value)}/></label>
        <div className="note-switcher-folder"><ChevronRight size={13}/>全部笔记</div>
        <nav className="note-switcher-list">{notes.filter(note => note.title.toLocaleLowerCase().includes(workspaceQuery.trim().toLocaleLowerCase())).map(note => <button key={note.id} className={note.id === selected ? 'active' : ''} onClick={() => openNote(note.id)} title={note.title}><FileText size={14}/><span>{note.title}</span></button>)}</nav>
        <button className="note-switcher-library" onClick={() => navigate('notes')}><BookOpen size={15}/>返回笔记库</button>
      </aside>
      <section className="note-workspace-main">
        <div className="note-tabbar" role="tablist" aria-label="已打开的笔记"><div className="note-tabbar-leading" role="presentation"><button className="note-switcher-toggle" title={noteSwitcherCollapsed ? '展开笔记栏' : '收起笔记栏'} aria-label={noteSwitcherCollapsed ? '展开笔记栏' : '收起笔记栏'} aria-expanded={!noteSwitcherCollapsed} onClick={toggleNoteSwitcher}>{noteSwitcherCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button></div>{openNoteIds.map(noteId => { const opened = notes.find(note => note.id === noteId); return opened ? <div key={noteId} className={`note-tab ${noteId === selected ? 'active' : ''}`}><button className="note-tab-select" role="tab" aria-selected={noteId === selected} title={opened.title} onClick={() => openNote(noteId)}><FileText size={13}/><span>{opened.title}</span></button><button className="note-tab-close" aria-label={`关闭 ${opened.title}`} onClick={() => closeNote(noteId)}><X size={13}/></button></div> : null; })}</div>
        <NoteDetail
          key={selected} id={selected} initialEdit={editNew} onDirtyChange={setDirty}
          onBack={() => navigate('notes')} onUpdated={refresh}
          onJobCreated={watchJob} notify={notify}
          onLink={title => {
            const target = notes.find(note => note.title === title);
            if (target) openNote(target.id);
            else notify('这篇关联笔记尚未导入，可以在「我的笔记」导入 Markdown');
          }}/>
      </section>
    </div>}
    {page === 'settings' && <SettingsPage onSaved={refresh} notify={notify}/>}
    </main></div>
    {modal && <CreateModal initial={modal} onClose={() => setModal(null)} onCreated={id => { setModal(null); notify('素材已收到，知识开始生长'); watchJob(id); }}/>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}{toastNote && <button className="toast-open" onClick={() => { openNote(toastNote); setToast(''); setShowJobs(false); }}>查看笔记</button>}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14}/></button></div>}
  </div>;
}
