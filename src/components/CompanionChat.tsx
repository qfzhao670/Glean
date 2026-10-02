import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AtSign, BookOpen, Check, ChevronUp, Expand, FileText, Heart, LoaderCircle, Minimize2, Paperclip, Send, Settings2, Trash2, X } from 'lucide-react';
import { api, streamJsonLines, type RagMessage, type RagSource } from '../api';
import Markdown from './Markdown';

type StreamEvent =
  | { type: 'sources'; sources: RagSource[]; grounded: boolean }
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

const suggestions = [
  '总结一下我最近笔记里反复出现的主题',
  '我关于 Agent 的笔记主要讲了什么？',
  '根据笔记，帮我梳理一份下一步行动清单',
];

type CompanionTheme = 'chuntang' | 'yuexia' | 'feiyan' | 'yunqu' | 'bilan';
const companionThemes: { id: CompanionTheme; name: string; description: string }[] = [
  { id: 'chuntang', name: '春棠', description: '春日花亭，在明媚山水间陪你舒展思绪' },
  { id: 'yuexia', name: '月华', description: '月下倚窗，在清冷夜色里陪你静心思考' },
  { id: 'feiyan', name: '绯颜', description: '红衣临水，在烂漫春光里陪你捕捉灵感' },
  { id: 'yunqu', name: '云阙', description: '月照云海，在澄澈仙境里陪你悠然畅想' },
  { id: 'bilan', name: '碧岚', description: '蝶栖指尖，在青山飞瀑间陪你自在遐思' },
];

type CompanionChatProps = {
  onOpenNote: (id: string) => void;
  wallpaperMode: boolean;
  onWallpaperModeChange: (active: boolean) => void;
};

export default function CompanionChat({ onOpenNote, wallpaperMode, onWallpaperModeChange }: CompanionChatProps) {
  const [messages, setMessages] = useState<RagMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<RagSource[]>([]);
  const [grounded, setGrounded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [theme, setTheme] = useState<CompanionTheme>(() => {
    const saved = localStorage.getItem('glean-companion-theme');
    return saved === 'yuexia' || saved === 'feiyan' || saved === 'yunqu' || saved === 'bilan' ? saved : 'chuntang';
  });
  const [previousTheme, setPreviousTheme] = useState<CompanionTheme | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api<RagMessage[]>('/rag/history').then(value => {
      if (!active) return;
      setMessages(value);
      const latest = [...value].reverse().find(item => item.role === 'assistant');
      if (latest) { setSources(latest.sources || []); setGrounded(latest.grounded); }
    }).catch(reason => active && setError((reason as Error).message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: answer ? 'auto' : 'smooth' });
  }, [messages, pendingQuestion, answer]);

  useEffect(() => {
    if (!previousTheme) return;
    const timer = window.setTimeout(() => setPreviousTheme(null), 550);
    return () => window.clearTimeout(timer);
  }, [previousTheme, theme]);

  useEffect(() => {
    if (!wallpaperMode) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onWallpaperModeChange(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onWallpaperModeChange, wallpaperMode]);

  async function ask(text: string) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setQuestion('');
    setPendingQuestion(prompt);
    setAnswer('');
    setSources([]);
    setGrounded(null);
    setError('');
    setBusy(true);
    let finalAnswer = '';
    let finalSources: RagSource[] = [];
    let finalGrounded = false;
    let completed = false;
    try {
      await streamJsonLines<StreamEvent>('/rag/chat/stream', { message: prompt }, event => {
        if (event.type === 'sources') {
          finalSources = event.sources;
          finalGrounded = event.grounded;
          setSources(event.sources);
          setGrounded(event.grounded);
        } else if (event.type === 'delta') {
          finalAnswer += event.content;
          setAnswer(finalAnswer);
        } else if (event.type === 'error') throw new Error(event.message);
        else completed = true;
      });
      if (!completed) throw new Error('流式回答意外中断，请重试。');
      const now = new Date().toISOString();
      setMessages(previous => [...previous,
        { id: `local-user-${now}`, role: 'user', content: prompt, sources: [], grounded: false, created_at: now },
        { id: `local-assistant-${now}`, role: 'assistant', content: finalAnswer, sources: finalSources, grounded: finalGrounded, created_at: now },
      ]);
      setPendingQuestion('');
      setAnswer('');
    } catch (reason) {
      setError((reason as Error).message);
      setQuestion(prompt);
      setPendingQuestion('');
      setAnswer('');
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(question); }
  function useComposerKeys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(question); }
  }
  async function clearHistory() {
    try {
      await api('/rag/history', { method: 'DELETE' });
      setMessages([]); setSources([]); setGrounded(null); setConfirmClear(false); setSettingsOpen(false);
    } catch (reason) { setError((reason as Error).message); }
  }

  function chooseTheme(next: CompanionTheme) {
    if (next === theme) return;
    setPreviousTheme(theme);
    setTheme(next);
    localStorage.setItem('glean-companion-theme', next);
  }

  function showWallpaper() {
    setSettingsOpen(false);
    onWallpaperModeChange(true);
  }

  function hideWallpaper() {
    onWallpaperModeChange(false);
  }

  const hasConversation = messages.length > 0 || Boolean(pendingQuestion);
  const referenceState = grounded === false ? 'missing' : sources.length ? 'grounded' : 'idle';

  const avatarClass = `companion-avatar theme-${theme}`;

  return <section className={`companion-page page-enter theme-${theme} ${wallpaperMode ? 'wallpaper-mode' : ''}`} aria-label={wallpaperMode ? '红颜知音全屏壁纸' : '红颜知音笔记问答'}>
    {previousTheme && <div className={`companion-background previous theme-${previousTheme}`} aria-hidden="true"/>}
    <div key={theme} className={`companion-background current theme-${theme}`} aria-hidden="true" onAnimationEnd={() => setPreviousTheme(null)}/>
    <button className="companion-wallpaper-exit" onClick={hideWallpaper} aria-label="退出壁纸模式" aria-hidden={!wallpaperMode} tabIndex={wallpaperMode ? 0 : -1} title="退出壁纸模式（Esc）"><Minimize2 size={18}/><span>退出壁纸</span></button>
    <div className="companion-interface" aria-hidden={wallpaperMode} inert={wallpaperMode ? true : undefined}>
    <div className="companion-shade"/>
    <div className="companion-title"><Heart size={15}/><span>红颜知音</span><small>与你共读每一页心事</small></div>
    <button className="companion-wallpaper-button" onClick={showWallpaper} title="隐藏界面，全屏欣赏当前背景"><Expand size={16}/>欣赏壁纸</button>
    <button className="companion-settings-button" onClick={() => setSettingsOpen(true)}><Settings2 size={16}/>对话设置</button>

    <div className="companion-conversation" ref={scrollRef}>
      {!hasConversation && !loading && <div className="companion-welcome">
        <div key={theme} className={avatarClass} aria-hidden="true"/>
        <div className="companion-bubble assistant"><strong>有什么想问的吗？</strong><p>我会结合你的个人笔记，与你一起思考。</p></div>
        <div className="companion-suggestions">{suggestions.map(item => <button key={item} onClick={() => void ask(item)}>{item}</button>)}</div>
      </div>}
      {loading && <div className="companion-loading"><LoaderCircle className="spin" size={20}/>正在翻阅你的笔记…</div>}
      {messages.map(message => message.role === 'user'
        ? <div className="companion-turn user-turn" key={message.id}><div className="companion-bubble user">{message.content}</div><span className="companion-user-avatar">拾</span></div>
        : <div className="companion-turn assistant-turn" key={message.id}><span key={theme} className={`${avatarClass} small`}/><div className="companion-bubble assistant answer"><Markdown text={message.content}/>{message.grounded ? <span className="knowledge-state"><BookOpen size={12}/>已参考 {message.sources.length} 篇个人笔记</span> : <span className="knowledge-state missing">知识库未命中 · 本回答来自模型通用知识</span>}</div></div>)}
      {pendingQuestion && <div className="companion-turn user-turn"><div className="companion-bubble user">{pendingQuestion}</div><span className="companion-user-avatar">拾</span></div>}
      {pendingQuestion && <div className="companion-turn assistant-turn"><span key={theme} className={`${avatarClass} small`}/><div className="companion-bubble assistant answer">{answer ? <Markdown text={answer}/> : <div className="companion-thinking"><i/><i/><i/><span>正在查阅笔记…</span></div>}</div></div>}
    </div>

    {hasConversation && !loading && <aside className={`companion-sources ${referenceState}`} aria-label="参考来源">
      <header><span>参考来源</span>{sources.length > 0 && <b>{sources.length}</b>}<ChevronUp size={15}/></header>
      {sources.map((source, index) => <button className="companion-source-card" key={source.note_id} onClick={() => onOpenNote(source.note_id)}>
        <span className="source-file-icon"><FileText size={18}/><i>{index + 1}</i></span>
        <span><strong>{source.title}</strong><p>{source.excerpt}</p><small>{source.section || '笔记正文'}</small></span>
      </button>)}
      {referenceState === 'missing' && <div className="companion-no-source"><BookOpen size={20}/><strong>知识库中没有相关内容</strong><p>本次由大模型基于通用知识回答，不会伪造笔记来源。</p></div>}
      {referenceState === 'idle' && <div className="companion-no-source idle"><BookOpen size={20}/><p>回答所依据的个人笔记会显示在这里。</p></div>}
    </aside>}

    <form className="companion-composer" onSubmit={submit}>
      <textarea aria-label="向红颜知音提问" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={useComposerKeys} placeholder="输入你的问题，或直接求助我…" rows={2} disabled={busy}/>
      <footer><span><button type="button" title="附件功能即将开放" disabled><Paperclip size={18}/></button><button type="button" title="提及功能即将开放" disabled><AtSign size={18}/></button><em><BookOpen size={17}/>基于我的笔记<ChevronUp size={13}/></em></span><button className="companion-send" type="submit" disabled={busy || !question.trim()} aria-label="发送"><Send size={18}/></button></footer>
    </form>
    {error && <div className="companion-error" role="alert">{error}<button onClick={() => setError('')}><X size={13}/></button></div>}

    {settingsOpen && <div className="companion-settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section className="companion-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="companion-settings-title">
        <header><div><span>对话设置</span><h2 id="companion-settings-title">选择陪你读笔记的红颜</h2></div><button onClick={() => setSettingsOpen(false)} aria-label="关闭"><X size={18}/></button></header>
        <div className="companion-character-list">{companionThemes.map(item => <button key={item.id} className={`companion-character ${theme === item.id ? 'selected' : ''}`} aria-pressed={theme === item.id} onClick={() => chooseTheme(item.id)}><span className={`companion-avatar portrait theme-${item.id}`}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{theme === item.id ? <Check size={18}/> : <span/>}</button>)}</div>
        <div className="companion-coming-soon"><span>更多红颜与专属背景</span><small>后续可以在这里直接切换图片与陪伴风格</small></div>
        <footer>{confirmClear ? <><span>确定清空全部对话吗？</span><button className="danger" onClick={() => void clearHistory()}>确认清空</button><button onClick={() => setConfirmClear(false)}>取消</button></> : <button className="clear-chat" onClick={() => setConfirmClear(true)}><Trash2 size={15}/>清空对话记录</button>}</footer>
      </section>
    </div>}
    </div>
  </section>;
}
