import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronRight, FileText, FileVideo, FolderOpen, Leaf, Link2, LoaderCircle, Plus, Settings2, Sparkles, Sprout, X } from 'lucide-react';
import { api, post, type Job, type Note, type Settings, type Stats } from './api';
import { currentJobs } from './jobs';
import Garden from './components/Garden';
import CreateModal from './components/CreateModal';
import SettingsPage from './components/SettingsPage';
import NoteDetail from './components/NoteDetail';
import Library from './components/Library';
import ActivityChart from './components/ActivityChart';
const emptyStats: Stats = { generated: 0, curated: 0, manual: 0, notes: 0, links: 0, minutes: 0, patches: 0, streak: 0, active_days: 0, activity: [], graph: [] };

function Logo({ small = false }: { small?: boolean }) { return <svg viewBox="0 0 36 40" width={small ? 23 : 31} height={small ? 27 : 35} fill="none" aria-hidden="true"><path d="M18 36V14M18 25C6 26 2 16 4 7C15 8 21 13 18 25ZM18 18C29 19 35 9 31 2C22 4 18 8 18 18Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M9 15L18 25M27 9L18 18" stroke="currentColor" strokeWidth="1.2"/></svg>; }
export default function App() {
  const [page, setPage] = useState<'home' | 'notes' | 'settings'>('home'); const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(emptyStats); const [notes, setNotes] = useState<Note[]>([]); const [jobs, setJobs] = useState<Job[]>([]); const [settings, setSettings] = useState<Settings | null>(null);
  const [modal, setModal] = useState<'txt' | 'mp4' | 'curate' | null>(null); const [toast, setToast] = useState(''); const [error, setError] = useState(''); const [showJobs, setShowJobs] = useState(false); const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set()); const [toastNote, setToastNote] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchedJobs = useRef(new Set<string>());
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
  useEffect(() => { refresh(); const interval = setInterval(refresh, 3000); return () => { clearInterval(interval); if (toastTimer.current) clearTimeout(toastTimer.current); }; }, [refresh]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (dirty && !window.confirm('还有未保存的修改，确定离开吗？')) return; setDirty(false); setPage('notes'); setSelected(null); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="搜索笔记"]')?.focus(), 50); } if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setModal('txt'); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [dirty]);
  const canLeave = () => !dirty || window.confirm('还有未保存的修改，确定离开吗？');
  const navigate = (next: typeof page) => { if (!canLeave()) return; setDirty(false); setPage(next); setSelected(null); };
  const openNote = (id: string, edit = false) => { if (!canLeave()) return; setDirty(false); setEditNew(edit); setPage('notes'); setSelected(id); };
  const watchJob = (id: string) => { watchedJobs.current.add(id); setShowJobs(true); refresh(); };
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
  const dateLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  return <div className="app-shell"><aside className="sidebar"><div className="window-space"/><button className="brand" onClick={() => navigate('home')}><Logo/><span>拾知<small>Glean</small></span></button><div className="sidebar-caption">在这里，知识慢慢生长</div><button className="new-note-button" onClick={() => setModal('txt')}><Plus size={18}/>拾取新知<span>⌘ N</span></button><nav><button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}><Sprout size={19}/>知识花园<ChevronRight size={14}/></button><button className={page === 'notes' ? 'active' : ''} onClick={() => navigate('notes')}><BookOpen size={19}/>我的笔记<span className="nav-count">{notes.length.toString().padStart(2, '0')}</span></button></nav>
    <div className="sidebar-bottom"><div className="sidebar-quote"><Leaf size={21} strokeWidth={1.1}/><p>不必急着成为森林。<br/>今天，长出一片新叶就好。</p><span>一点一滴，皆有所获。</span></div><button className={`sidebar-settings ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>设置</button><button className="vault-indicator" title="选择本地笔记仓库" onClick={chooseRepository}><FolderOpen size={16}/><span>{settings?.repository_path ? '本地笔记仓库' : '选择本地笔记仓库'}<small>{settings?.repository_path ? settings.repository_path.split(/[\\/]/).filter(Boolean).pop() : '点击选择保存文件夹'}</small></span><ArrowUpRight size={15}/></button></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">我的空间 <span>/</span> <strong>{page === 'home' ? '知识花园' : page === 'settings' ? '设置' : selected ? '笔记详情' : '我的笔记'}</strong></div><div className="topbar-right"><button className={`task-indicator ${ongoing.length ? 'working' : ''}`} onClick={() => setShowJobs(!showJobs)}>{ongoing.length ? <LoaderCircle size={13} className="spin"/> : <span className="status-dot"/>}{ongoing.length ? `${ongoing.length} 份知识正在生长` : visibleJobs.length ? '当前任务未完成' : '拾知，日有所长'}</button><span className="topbar-separator"/><button className="profile" title="学习者的本地空间" onClick={() => navigate('settings')}>拾</button></div></header>
    {error && <div className="connection-error" role="alert">{error}<button onClick={refresh}>重新连接</button></div>}
    {showJobs && <div className="jobs-panel"><div className="section-heading"><h3>拾知进度</h3><button className="icon-button" aria-label="关闭进度" onClick={() => setShowJobs(false)}><X size={18}/></button></div>{visibleJobs.length === 0 ? <p className="muted">当前没有进行中的任务。完成的内容可在「我的笔记」查看。</p> : visibleJobs.map(j => <div className="job-item" key={j.id}><div><strong>{j.title}</strong><span>{j.status === 'failed' ? '未完成' : j.stage}</span></div>{j.status === 'failed' ? <><p className="job-error">{j.error}</p><div className="job-actions"><button className="button subtle small" onClick={async () => { try { await post(`/jobs/${j.id}/retry`); watchJob(j.id); } catch (e) { notify((e as Error).message); } }}>重试</button><button className="button text-button small" onClick={() => setDismissedJobs(previous => new Set(previous).add(j.id))}>收起任务</button></div></> : <div className="progress-track"><span style={{ width: `${j.progress}%` }}/></div>}</div>)}</div>}
    <main>{page === 'home' && <div className="dashboard page-enter"><div className="home-topline"><span><span className="tiny-star">✳</span> 让每一次学习，都有回响。</span><time>{dateLabel}</time></div><section className="hero"><div className="hero-copy"><div className="hero-greeting">你好，探索者。</div><h1>让好奇心，<br/>长成自己的森林。</h1><p className="hero-description">从一份字幕、一个想法开始。<br/>拾起零散的知识，连接成属于你的世界。</p><div className="hero-stats"><div><strong>{stats.notes.toString().padStart(2, '0')}<span>篇</span></strong><p>已沉淀笔记 <FileText size={12}/></p></div><div><strong>{stats.links.toString().padStart(2, '0')}<span>个</span></strong><p>知识连接 <Link2 size={12}/></p></div><div><strong>{stats.active_days.toString().padStart(2, '0')}<span>天</span></strong><p>与知识相遇 <Sprout size={12}/></p></div></div><button className="hero-cta" onClick={() => setModal('txt')}><Plus size={18}/>拾取今天的新知<ArrowUpRight size={18}/></button><div className="hero-footnote"><span className="thin-line"/>每一份积累，都算数。</div></div><Garden stats={stats} onNote={openNote}/></section>
      <div className="dashboard-bottom garden-activity"><section className="activity-section"><div className="section-heading"><h2>学习的足迹</h2><span>最近半年</span></div><div className="activity-label"><span>每一次拾知，都留下一点绿。</span><strong>{stats.streak}<small> 天连续积累</small></strong></div><ActivityChart activity={stats.activity}/><div className="activity-footer"><span>慢慢来，也是在向前。</span><div>少 {[0, 1, 2, 3, 4].map(n => <i key={n} className={`level-${n}`}/>)} 多</div></div><div className="mini-totals"><span><FileVideo size={14}/>{stats.minutes} 分钟视频沉淀</span><span><Sparkles size={14}/>{stats.patches} 份知识补丁</span></div></section></div><footer className="dashboard-footer"><Logo small/><span>知识不止收藏，更在生长。</span><span>拾知 Glean</span></footer>
    </div>}
    {page === 'notes' && !selected && <Library notes={notes} onOpen={openNote} onGenerate={() => setModal('txt')} onChanged={refresh}/>}
    {page === 'notes' && selected && <NoteDetail
      key={selected} id={selected} initialEdit={editNew} onDirtyChange={setDirty}
      onBack={() => navigate('notes')} onUpdated={refresh}
      onJobCreated={watchJob} notify={notify}
      onLink={title => {
        const target = notes.find(note => note.title === title);
        if (target) openNote(target.id);
        else notify('这篇关联笔记尚未导入，可以在「我的笔记」导入 Markdown');
      }}/>}
    {page === 'settings' && <SettingsPage onSaved={refresh} notify={notify}/>}
    </main></div>
    {modal && <CreateModal initial={modal} onClose={() => setModal(null)} onCreated={id => { setModal(null); notify('素材已收到，知识开始生长'); watchJob(id); }}/>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}{toastNote && <button className="toast-open" onClick={() => { openNote(toastNote); setToast(''); setShowJobs(false); }}>查看笔记</button>}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14}/></button></div>}
  </div>;
}
