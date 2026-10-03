import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AtSign, BookOpen, Check, ChevronUp, Expand, FileText, Heart, ImagePlus, Images, LoaderCircle, Minimize2, Paperclip, Send, Settings2, Trash2, X } from 'lucide-react';
import { api, apiBlob, streamJsonLines, uploadCompanionBackground, type CompanionBackgrounds, type CompanionId, type RagMessage, type RagSource } from '../api';
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

type CompanionTheme = CompanionId;
type BackgroundVariant = 'default' | 'custom';
const companionThemes: { id: CompanionTheme; name: string; description: string }[] = [
  { id: 'chuntang', name: '春棠', description: '春日花亭，在明媚山水间陪你舒展思绪' },
  { id: 'yuexia', name: '月华', description: '月下倚窗，在清冷夜色里陪你静心思考' },
  { id: 'feiyan', name: '绯颜', description: '红衣临水，在烂漫春光里陪你捕捉灵感' },
  { id: 'yunqu', name: '云阙', description: '月照云海，在澄澈仙境里陪你悠然畅想' },
  { id: 'bilan', name: '碧岚', description: '蝶栖指尖，在青山飞瀑间陪你自在遐思' },
];

type CompanionChatProps = {
  colorMode: 'light' | 'dark';
  onOpenNote: (id: string) => void;
  wallpaperMode: boolean;
  onWallpaperModeChange: (active: boolean) => void;
};

const emptyBackgrounds = (): CompanionBackgrounds => ({
  chuntang: { custom: false, version: '' }, yuexia: { custom: false, version: '' },
  feiyan: { custom: false, version: '' }, yunqu: { custom: false, version: '' },
  bilan: { custom: false, version: '' },
});

const savedBackgroundChoices = () => Object.fromEntries(companionThemes.map(item => [
  item.id, localStorage.getItem(`glean-companion-background-${item.id}`) === 'default' ? 'default' : 'custom',
])) as Record<CompanionTheme, BackgroundVariant>;

export default function CompanionChat({ colorMode, onOpenNote, wallpaperMode, onWallpaperModeChange }: CompanionChatProps) {
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
  const [previousBackground, setPreviousBackground] = useState<{ variant: BackgroundVariant; url?: string } | null>(null);
  const [backgrounds, setBackgrounds] = useState<CompanionBackgrounds>(emptyBackgrounds);
  const [backgroundChoices, setBackgroundChoices] = useState<Record<CompanionTheme, BackgroundVariant>>(savedBackgroundChoices);
  const [customBackgroundUrls, setCustomBackgroundUrls] = useState<Partial<Record<CompanionTheme, string>>>({});
  const [uploadingBackground, setUploadingBackground] = useState<CompanionTheme | null>(null);
  const customBackgroundUrlsRef = useRef<Partial<Record<CompanionTheme, string>>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api<CompanionBackgrounds>('/companions/backgrounds').then(async value => {
      if (!active) return;
      setBackgrounds(value);
      const loaded = await Promise.all(companionThemes.filter(item => value[item.id].custom).map(async item => {
        const blob = await apiBlob(`/companions/${item.id}/background`);
        return [item.id, URL.createObjectURL(blob)] as const;
      }));
      if (!active) {
        loaded.forEach(([, url]) => URL.revokeObjectURL(url));
        return;
      }
      const urls = Object.fromEntries(loaded) as Partial<Record<CompanionTheme, string>>;
      customBackgroundUrlsRef.current = urls;
      setCustomBackgroundUrls(urls);
    }).catch(reason => active && setError((reason as Error).message));
    return () => {
      active = false;
      Object.values(customBackgroundUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

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
    const timer = window.setTimeout(() => { setPreviousTheme(null); setPreviousBackground(null); }, 550);
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
    setPreviousBackground({ variant: activeBackgroundVariant, url: activeBackgroundUrl });
    setTheme(next);
    localStorage.setItem('glean-companion-theme', next);
  }

  function chooseBackground(next: BackgroundVariant) {
    if (next === activeBackgroundVariant || (next === 'custom' && !backgrounds[theme].custom)) return;
    setPreviousTheme(theme);
    setPreviousBackground({ variant: activeBackgroundVariant, url: activeBackgroundUrl });
    setBackgroundChoices(previous => ({ ...previous, [theme]: next }));
    localStorage.setItem(`glean-companion-background-${theme}`, next);
  }

  function replaceCustomBackgroundUrl(companion: CompanionTheme, url?: string) {
    const previousUrl = customBackgroundUrlsRef.current[companion];
    if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl);
    const next = { ...customBackgroundUrlsRef.current };
    if (url) next[companion] = url; else delete next[companion];
    customBackgroundUrlsRef.current = next;
    setCustomBackgroundUrls(next);
  }

  async function uploadBackground(companion: CompanionTheme, file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('深色背景仅支持 PNG、JPEG、GIF 或 WebP 图片。'); return;
    }
    setUploadingBackground(companion); setError('');
    try {
      const result = await uploadCompanionBackground(companion, file);
      replaceCustomBackgroundUrl(companion, URL.createObjectURL(file));
      setBackgrounds(previous => ({ ...previous, [companion]: result }));
      setBackgroundChoices(previous => ({ ...previous, [companion]: 'custom' }));
      localStorage.setItem(`glean-companion-background-${companion}`, 'custom');
    } catch (reason) { setError((reason as Error).message); }
    finally { setUploadingBackground(null); }
  }

  async function removeBackground(companion: CompanionTheme) {
    setUploadingBackground(companion); setError('');
    try {
      await api(`/companions/${companion}/background`, { method: 'DELETE' });
      replaceCustomBackgroundUrl(companion);
      setBackgrounds(previous => ({ ...previous, [companion]: { custom: false, version: '' } }));
      setBackgroundChoices(previous => ({ ...previous, [companion]: 'default' }));
      localStorage.removeItem(`glean-companion-background-${companion}`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setUploadingBackground(null); }
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
  const activeBackgroundVariant: BackgroundVariant = colorMode === 'dark' && backgrounds[theme].custom && backgroundChoices[theme] === 'custom' ? 'custom' : 'default';
  const activeBackgroundUrl = activeBackgroundVariant === 'custom' ? customBackgroundUrls[theme] : undefined;
  const customBackgroundReady = activeBackgroundVariant === 'custom' && Boolean(activeBackgroundUrl);

  return <section className={`companion-page page-enter theme-${theme} ${wallpaperMode ? 'wallpaper-mode' : ''}`} aria-label={wallpaperMode ? '红颜知音全屏壁纸' : '红颜知音笔记问答'}>
    {previousTheme && <div className={`companion-background previous theme-${previousTheme}`} style={previousBackground?.variant === 'custom' && previousBackground.url ? { backgroundImage: `url("${previousBackground.url}")` } : undefined} aria-hidden="true"/>}
    <div key={`${theme}-${activeBackgroundVariant}-${activeBackgroundUrl || ''}`} className={`companion-background current theme-${theme} ${customBackgroundReady ? 'custom' : ''}`} style={customBackgroundReady ? { backgroundImage: `url("${activeBackgroundUrl}")` } : undefined} aria-hidden="true" onAnimationEnd={() => { setPreviousTheme(null); setPreviousBackground(null); }}/>
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
        <div className="companion-character-list">{companionThemes.map(item => <div className="companion-character-entry" key={item.id}>
          <button className={`companion-character ${theme === item.id ? 'selected' : ''}`} aria-pressed={theme === item.id} onClick={() => chooseTheme(item.id)}><span className={`companion-avatar portrait theme-${item.id}`}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{theme === item.id ? <Check size={18}/> : <span/>}</button>
          {colorMode === 'dark' && theme === item.id && <section className="companion-dark-background" aria-label={`${item.name}的深色背景`}>
            <header><span><Images size={15}/><strong>深色背景</strong></span><small>可在原图和专属图片间切换</small></header>
            <div className="companion-background-options">
              <button className={activeBackgroundVariant === 'default' ? 'selected' : ''} onClick={() => chooseBackground('default')} aria-pressed={activeBackgroundVariant === 'default'}><i className={`theme-${theme}`}/><span>原始图片</span>{activeBackgroundVariant === 'default' && <Check size={13}/>}</button>
              <button className={activeBackgroundVariant === 'custom' ? 'selected' : ''} disabled={!backgrounds[theme].custom || !customBackgroundUrls[theme]} onClick={() => chooseBackground('custom')} aria-pressed={activeBackgroundVariant === 'custom'}><i className={!customBackgroundUrls[theme] ? 'empty' : ''} style={customBackgroundUrls[theme] ? { backgroundImage: `url("${customBackgroundUrls[theme]}")` } : undefined}>{!customBackgroundUrls[theme] && <ImagePlus size={20}/>}</i><span>{backgrounds[theme].custom ? '专属图片' : '待上传'}</span>{activeBackgroundVariant === 'custom' && <Check size={13}/>}</button>
            </div>
            <div className="companion-background-actions">
              <label className={uploadingBackground ? 'disabled' : ''}><ImagePlus size={14}/>{uploadingBackground === theme ? '正在上传…' : backgrounds[theme].custom ? '更换图片' : '上传图片'}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={Boolean(uploadingBackground)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadBackground(theme, file); }}/></label>
              {backgrounds[theme].custom && <button disabled={Boolean(uploadingBackground)} onClick={() => void removeBackground(theme)}>移除专属图片</button>}
            </div>
            <p>上传后会自动设为这位红颜的深色背景；浅色模式始终使用原始图片。</p>
          </section>}
        </div>)}</div>
        <footer>{confirmClear ? <><span>确定清空全部对话吗？</span><button className="danger" onClick={() => void clearHistory()}>确认清空</button><button onClick={() => setConfirmClear(false)}>取消</button></> : <button className="clear-chat" onClick={() => setConfirmClear(true)}><Trash2 size={15}/>清空对话记录</button>}</footer>
      </section>
    </div>}
    </div>
  </section>;
}
