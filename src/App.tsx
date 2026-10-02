import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronRight, FileText, Folder as FolderIcon, FolderOpen, Heart, Leaf, LoaderCircle, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Sprout, X } from 'lucide-react';
import { api, post, streamJobUpdates, type Folder, type Job, type Note, type Settings, type Stats } from './api';
import { currentJobs } from './jobs';
import CreateModal from './components/CreateModal';
import SettingsPage from './components/SettingsPage';
import NoteDetail from './components/NoteDetail';
import Library, { type LibraryFilter } from './components/Library';
import GeneratingNote from './components/GeneratingNote';
import HomeDashboard from './components/HomeDashboard';
import CompanionChat from './components/CompanionChat';
const emptyStats: Stats = { generated: 0, curated: 0, manual: 0, notes: 0, links: 0, minutes: 0, patches: 0, streak: 0, active_days: 0, activity: [], graph: [] };

type ScrollbarMetrics = {
  containerTop: number;
  trackHeight: number;
  thumbTop: number;
  thumbHeight: number;
  maxScroll: number;
  scrollTop: number;
  visible: boolean;
};

const emptyScrollbar: ScrollbarMetrics = { containerTop: 0, trackHeight: 0, thumbTop: 0, thumbHeight: 0, maxScroll: 0, scrollTop: 0, visible: false };

function OverlayScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const [metrics, setMetrics] = useState<ScrollbarMetrics>(emptyScrollbar);
  const [active, setActive] = useState(false);
  const dragStart = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback((autoHide = true) => {
    setActive(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = autoHide ? setTimeout(() => setActive(false), 750) : null;
  }, []);

  const update = useCallback(() => {
    const element = target.current;
    if (!element) return;
    const trackHeight = element.clientHeight;
    const maxScroll = Math.max(0, element.scrollHeight - trackHeight);
    const thumbHeight = maxScroll ? Math.max(36, trackHeight * trackHeight / element.scrollHeight) : trackHeight;
    const thumbRange = Math.max(0, trackHeight - thumbHeight);
    setMetrics({
      containerTop: element.offsetTop,
      trackHeight,
      thumbTop: maxScroll ? element.scrollTop / maxScroll * thumbRange : 0,
      thumbHeight,
      maxScroll,
      scrollTop: element.scrollTop,
      visible: maxScroll > 1,
    });
  }, [target]);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    let frame = requestAnimationFrame(update);
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const handleScroll = () => { scheduleUpdate(); reveal(); };
    element.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(element);
    Array.from(element.children).forEach(child => resizeObserver.observe(child));
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(element, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [reveal, target, update]);

  const scrollToThumbPosition = (thumbTop: number) => {
    const element = target.current;
    const thumbRange = metrics.trackHeight - metrics.thumbHeight;
    if (!element || thumbRange <= 0) return;
    element.scrollTop = Math.max(0, Math.min(thumbRange, thumbTop)) / thumbRange * metrics.maxScroll;
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    reveal(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointerY: event.clientY, scrollTop: target.current?.scrollTop || 0 };
  };
  const dragThumb = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = target.current;
    const start = dragStart.current;
    const thumbRange = metrics.trackHeight - metrics.thumbHeight;
    if (!element || !start || thumbRange <= 0) return;
    element.scrollTop = start.scrollTop + (event.clientY - start.pointerY) / thumbRange * metrics.maxScroll;
  };
  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    reveal();
  };
  const useKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const element = target.current;
    if (!element) return;
    const amount = event.key === 'PageDown' ? element.clientHeight * .85
      : event.key === 'PageUp' ? -element.clientHeight * .85
      : event.key === 'ArrowDown' ? 48
      : event.key === 'ArrowUp' ? -48
      : 0;
    if (!amount && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    element.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? metrics.maxScroll : element.scrollTop + amount;
  };

  if (!metrics.visible) return null;
  return <div
    className={`library-overlay-scrollbar ${active ? 'is-active' : ''}`}
    style={{ top: metrics.containerTop, height: metrics.trackHeight }}
    onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      const trackTop = event.currentTarget.getBoundingClientRect().top;
      scrollToThumbPosition(event.clientY - trackTop - metrics.thumbHeight / 2);
    }}
  ><div
    className="library-overlay-scrollbar-thumb"
    role="scrollbar"
    aria-label="笔记列表滚动条"
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={Math.round(metrics.maxScroll)}
    aria-valuenow={Math.round(metrics.scrollTop)}
    tabIndex={0}
    style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }}
    onPointerDown={startDrag}
    onPointerMove={dragThumb}
    onPointerUp={stopDrag}
    onPointerCancel={stopDrag}
    onKeyDown={useKeyboard}
  /></div>;
}

function Logo({ small = false }: { small?: boolean }) { return <svg viewBox="0 0 36 40" width={small ? 23 : 31} height={small ? 27 : 35} fill="none" aria-hidden="true"><path d="M18 36V14M18 25C6 26 2 16 4 7C15 8 21 13 18 25ZM18 18C29 19 35 9 31 2C22 4 18 8 18 18Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M9 15L18 25M27 9L18 18" stroke="currentColor" strokeWidth="1.2"/></svg>; }
export default function App() {
  const [page, setPage] = useState<'home' | 'notes' | 'companion' | 'settings'>('home'); const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(emptyStats); const [notes, setNotes] = useState<Note[]>([]); const [folders, setFolders] = useState<Folder[]>([]); const [jobs, setJobs] = useState<Job[]>([]); const [settings, setSettings] = useState<Settings | null>(null);
  const [modal, setModal] = useState<'txt' | 'mp4' | 'curate' | null>(null); const [toast, setToast] = useState(''); const [error, setError] = useState(''); const [showJobs, setShowJobs] = useState(false); const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set()); const [toastNote, setToastNote] = useState('');
  const [generatingJob, setGeneratingJob] = useState<string | null>(null);
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [libraryFolder, setLibraryFolder] = useState<string | null>(null);
  const [companionSidebarCollapsed, setCompanionSidebarCollapsed] = useState(() => localStorage.getItem('glean-companion-sidebar-collapsed') === '1');
  const [companionWallpaperMode, setCompanionWallpaperMode] = useState(false);
  const [noteSwitcherCollapsed, setNoteSwitcherCollapsed] = useState(() => localStorage.getItem('glean-note-switcher-collapsed') === '1');
  const [noteTreeExpanded, setNoteTreeExpanded] = useState(true);
  const [collapsedNoteFolders, setCollapsedNoteFolders] = useState<Set<string>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainScroll = useRef<HTMLElement>(null);
  const watchedJobs = useRef(new Set<string>());
  const pendingGenerationJobs = useRef(new Set<string>());
  const jobStreams = useRef(new Map<string, AbortController>());
  const [editNew, setEditNew] = useState(false); const [dirty, setDirty] = useState(false);
  const notify = useCallback((message: string, noteId = '') => { setToast(message); setToastNote(noteId); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const refresh = useCallback(async () => { try { const [s, n, f, j, config] = await Promise.all([api<Stats>('/stats'), api<Note[]>('/notes'), api<Folder[]>('/folders'), api<Job[]>('/jobs'), api<Settings>('/settings')]); setStats(s); setNotes(n); setFolders(f); setJobs(j); setSettings(config); setError('');
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
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (companionWallpaperMode) return; if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (dirty && !window.confirm('还有未保存的修改，确定离开吗？')) return; setDirty(false); setGeneratingJob(null); setPage('notes'); setSelected(null); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="搜索笔记"]')?.focus(), 50); } if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setModal('txt'); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [companionWallpaperMode, dirty]);
  useEffect(() => {
    if (page !== 'companion' && companionWallpaperMode) setCompanionWallpaperMode(false);
  }, [companionWallpaperMode, page]);
  useEffect(() => {
    if (!selected) return;
    setNoteTreeExpanded(true);
    const selectedFolder = notes.find(note => note.id === selected)?.folder_id;
    if (!selectedFolder) return;
    setCollapsedNoteFolders(previous => {
      if (!previous.has(selectedFolder)) return previous;
      const next = new Set(previous);
      next.delete(selectedFolder);
      return next;
    });
  }, [notes, selected]);
  const canLeave = () => !dirty || window.confirm('还有未保存的修改，确定离开吗？');
  const navigate = (next: typeof page) => { if (!canLeave()) return; setDirty(false); setGeneratingJob(null); setPage(next); setSelected(null); };
  const navigateToNotesHome = () => {
    if (!canLeave()) return;
    setDirty(false);
    setGeneratingJob(null);
    setPage('notes');
    setSelected(null);
    setLibraryFolder(null);
  };
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
  const toggleCompanionSidebar = () => setCompanionSidebarCollapsed(previous => {
    const next = !previous;
    localStorage.setItem('glean-companion-sidebar-collapsed', next ? '1' : '0');
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
  const normalizedWorkspaceQuery = workspaceQuery.trim().toLocaleLowerCase();
  const rootNotes = notes.filter(note => !note.folder_id && note.title.toLocaleLowerCase().includes(normalizedWorkspaceQuery));
  const noteFolderBranches = folders.map(folder => {
    const folderNotes = notes.filter(note => note.folder_id === folder.id);
    const folderMatches = folder.name.toLocaleLowerCase().includes(normalizedWorkspaceQuery);
    const visibleNotes = normalizedWorkspaceQuery && !folderMatches
      ? folderNotes.filter(note => note.title.toLocaleLowerCase().includes(normalizedWorkspaceQuery))
      : folderNotes;
    return { folder, folderNotes, visibleNotes };
  }).filter(({ folder, visibleNotes }) => !normalizedWorkspaceQuery || folder.name.toLocaleLowerCase().includes(normalizedWorkspaceQuery) || visibleNotes.length > 0);
  const hasWorkspaceResults = rootNotes.length > 0 || noteFolderBranches.length > 0;
  const toggleNoteFolder = (folderId: string) => setCollapsedNoteFolders(previous => {
    const next = new Set(previous);
    if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
    return next;
  });
  const showingLibrary = page === 'notes' && !generatingJob && !selected;
  return <div className={`app-shell ${selected ? 'note-focus' : showingLibrary ? 'notes-library' : page === 'companion' ? `companion-shell ${companionSidebarCollapsed ? 'companion-sidebar-collapsed' : ''} ${companionWallpaperMode ? 'companion-wallpaper-mode' : ''}` : ''}`}><aside className="sidebar"><div className="window-space"/><button className="brand" onClick={() => navigate('home')}><Logo/><span>拾知<small>Glean</small></span></button><div className="sidebar-caption">在这里，知识慢慢生长</div><button className="new-note-button" onClick={() => setModal('txt')}><Plus size={18}/>拾取新知<span>⌘ N</span></button><nav><button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}><Sprout size={19}/>拾知灵境<ChevronRight size={14}/></button><button className={page === 'notes' ? 'active' : ''} onClick={navigateToNotesHome}><BookOpen size={19}/>我的笔记<span className="nav-count">{notes.length.toString().padStart(2, '0')}</span></button><button className={page === 'companion' ? 'active companion-nav' : 'companion-nav'} onClick={() => navigate('companion')}><Heart size={19}/>红颜知音<ChevronRight size={14}/></button></nav>
    <div className="sidebar-bottom"><div className="sidebar-quote"><Leaf size={21} strokeWidth={1.1}/><p>不必急着成为森林。<br/>今天，长出一片新叶就好。</p><span>一点一滴，皆有所获。</span></div><button className={`sidebar-settings ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>设置</button><button className="vault-indicator" title="选择本地笔记仓库" onClick={chooseRepository}><FolderOpen size={16}/><span>{settings?.repository_path ? '本地笔记仓库' : '选择本地笔记仓库'}<small>{settings?.repository_path ? settings.repository_path.split(/[\\/]/).filter(Boolean).pop() : '点击选择保存文件夹'}</small></span><ArrowUpRight size={15}/></button></div></aside>
    {page === 'companion' && <button className="companion-sidebar-toggle" title={companionSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} aria-label={companionSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} aria-expanded={!companionSidebarCollapsed} aria-hidden={companionWallpaperMode} tabIndex={companionWallpaperMode ? -1 : 0} onClick={toggleCompanionSidebar}>{companionSidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>}
    <div className="main-shell">{page !== 'companion' && <header className="topbar"><div className="breadcrumb">我的空间 <span>/</span> <strong>{page === 'home' ? '拾知灵境' : page === 'settings' ? '设置' : generatingJob ? '笔记生成中' : selected ? '笔记详情' : '我的笔记'}</strong></div><div className="topbar-right"><button className={`task-indicator ${ongoing.length ? 'working' : ''}`} onClick={() => setShowJobs(!showJobs)}>{ongoing.length ? <LoaderCircle size={13} className="spin"/> : <span className="status-dot"/>}{ongoing.length ? `${ongoing.length} 份知识正在生长` : visibleJobs.length ? '当前任务未完成' : '拾知，日有所长'}</button><span className="topbar-separator"/><button className="profile" title="学习者的本地空间" onClick={() => navigate('settings')}>拾</button></div></header>}
    {error && <div className="connection-error" role="alert">{error}<button onClick={refresh}>重新连接</button></div>}
    {showJobs && <div className="jobs-panel"><div className="section-heading"><h3>拾知进度</h3><button className="icon-button" aria-label="关闭进度" onClick={() => setShowJobs(false)}><X size={18}/></button></div>{visibleJobs.length === 0 ? <p className="muted">当前没有进行中的任务。完成的内容可在「我的笔记」查看。</p> : visibleJobs.map(j => <div className={`job-item ${j.status === 'running' ? 'is-running' : ''}`} key={j.id}><div><strong>{j.title}</strong>{j.status !== 'failed' && <b>{j.progress}%</b>}<span>{j.status === 'failed' ? '未完成' : j.stage}</span></div>{j.status === 'failed' ? <><p className="job-error">{j.error}</p><div className="job-actions"><button className="button subtle small" onClick={async () => { try { await post(`/jobs/${j.id}/retry`); watchJob(j.id); } catch (e) { notify((e as Error).message); } }}>重试</button><button className="button text-button small" onClick={() => setDismissedJobs(previous => new Set(previous).add(j.id))}>收起任务</button></div></> : <div className="progress-track" aria-label={`任务进度 ${j.progress}%`}><span style={{ width: `${j.progress}%` }}/></div>}</div>)}</div>}
    <main ref={mainScroll}>{page === 'home' && <HomeDashboard stats={stats} notes={notes} dateLabel={dateLabel} onCreate={() => setModal('txt')} onOpen={openNote} onLibrary={() => navigate('notes')}/>} {page === 'notes' && generatingJob && <GeneratingNote jobId={generatingJob} onBack={() => navigate('notes')} onCompleted={id => { setGeneratingJob(null); setEditNew(false); setOpenNoteIds(previous => previous.includes(id) ? previous : [...previous, id]); setSelected(id); void refresh(); }} onLink={title => {
      const target = notes.find(note => note.title === title);
      if (target) openNote(target.id);
    }}/>} {page === 'notes' && !generatingJob && !selected && <Library notes={notes} folders={folders} filter={libraryFilter} selectedFolder={libraryFolder} onFilterChange={setLibraryFilter} onFolderChange={setLibraryFolder} onOpen={openNote} onGenerate={() => setModal('txt')} onChanged={refresh} notify={notify}/>} {page === 'notes' && !generatingJob && selected && <div className={`note-workspace ${noteSwitcherCollapsed ? 'switcher-collapsed' : ''}`}>
      <aside className="note-switcher">
        <div className="note-switcher-rail">
          <button title="展开笔记栏" aria-label="展开笔记栏" onClick={toggleNoteSwitcher}><FileText size={17}/></button>
          <button title="搜索笔记" aria-label="搜索笔记" onClick={() => { toggleNoteSwitcher(); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="在工作区搜索笔记"]')?.focus()); }}><Search size={17}/></button>
          <button title="返回笔记库" aria-label="返回笔记库" onClick={() => navigate('notes')}><BookOpen size={17}/></button>
        </div>
        <div className="note-switcher-heading"><Logo small/><div><strong>拾知笔记</strong><span>{notes.length} 篇</span></div></div>
        <label className="note-switcher-search"><Search size={14}/><input aria-label="在工作区搜索笔记" placeholder="搜索笔记" value={workspaceQuery} onChange={event => setWorkspaceQuery(event.target.value)}/></label>
        <nav className="note-switcher-list" aria-label="笔记文件树">
          <button className="note-switcher-folder note-switcher-root" aria-expanded={normalizedWorkspaceQuery ? true : noteTreeExpanded} onClick={() => setNoteTreeExpanded(previous => !previous)}><ChevronRight size={13}/>{normalizedWorkspaceQuery || noteTreeExpanded ? <FolderOpen size={14}/> : <FolderIcon size={14}/>}<span>全部笔记</span><b>{notes.length}</b></button>
          {(normalizedWorkspaceQuery || noteTreeExpanded) && <div className="note-switcher-tree">
            {noteFolderBranches.map(({ folder, folderNotes, visibleNotes }) => {
              const folderExpanded = normalizedWorkspaceQuery ? true : !collapsedNoteFolders.has(folder.id);
              return <div className="note-switcher-branch" key={folder.id}>
                <button className="note-switcher-folder note-switcher-tree-row" aria-expanded={folderExpanded} onClick={() => toggleNoteFolder(folder.id)} title={folder.name}><ChevronRight size={12}/>{folderExpanded ? <FolderOpen size={14}/> : <FolderIcon size={14}/>}<span>{folder.name}</span><b>{folderNotes.length}</b></button>
                {folderExpanded && <div className="note-switcher-children">{visibleNotes.map(note => <button key={note.id} className={`note-switcher-note ${note.id === selected ? 'active' : ''}`} onClick={() => openNote(note.id)} title={`${folder.name} / ${note.title}`}><FileText size={13}/><span>{note.title}</span></button>)}</div>}
              </div>;
            })}
            {rootNotes.map(note => <button key={note.id} className={`note-switcher-note note-switcher-root-note ${note.id === selected ? 'active' : ''}`} onClick={() => openNote(note.id)} title={note.title}><FileText size={13}/><span>{note.title}</span></button>)}
            {!hasWorkspaceResults && <p className="note-switcher-empty">没有匹配的笔记</p>}
          </div>}
        </nav>
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
    {page === 'companion' && <CompanionChat onOpenNote={openNote} wallpaperMode={companionWallpaperMode} onWallpaperModeChange={setCompanionWallpaperMode}/>}
    {page === 'settings' && <SettingsPage onSaved={refresh} notify={notify}/>}
    </main>{showingLibrary && <OverlayScrollbar target={mainScroll}/>}</div>
    {modal && <CreateModal initial={modal} onClose={() => setModal(null)} onCreated={id => { setModal(null); notify('素材已收到，知识开始生长'); watchJob(id); }}/>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}{toastNote && <button className="toast-open" onClick={() => { openNote(toastNote); setToast(''); setShowJobs(false); }}>查看笔记</button>}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14}/></button></div>}
  </div>;
}
