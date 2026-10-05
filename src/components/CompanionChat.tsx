import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AtSign, BookOpen, Check, ChevronUp, Expand, FileText, Heart, ImagePlus, Images, LoaderCircle, Minimize2, Moon, Paperclip, Send, Settings2, Sun, Trash2, X } from 'lucide-react';
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
type BackgroundChoice = 'default' | string;
type CustomBackgroundUrls = Partial<Record<CompanionTheme, Record<string, string>>>;
const companionThemes: { id: CompanionTheme; name: string; description: string }[] = [
  { id: 'chuntang', name: '春棠', description: '春日花亭，在明媚山水间陪你舒展思绪' },
  { id: 'yuexia', name: '月华', description: '月下倚窗，在清冷夜色里陪你静心思考' },
  { id: 'feiyan', name: '绯颜', description: '红衣临水，在烂漫春光里陪你捕捉灵感' },
  { id: 'yunqu', name: '云阙', description: '月照云海，在澄澈仙境里陪你悠然畅想' },
  { id: 'bilan', name: '碧岚', description: '蝶栖指尖，在青山飞瀑间陪你自在遐思' },
  { id: 'chayan', name: '茶烟', description: '花亭品茗，在山光水色间陪你细品灵思' },
];

type CompanionChatProps = {
  colorMode: 'light' | 'dark';
  onColorModeToggle: () => void;
  onOpenNote: (id: string) => void;
  wallpaperMode: boolean;
  onWallpaperModeChange: (active: boolean) => void;
};

const emptyBackgrounds = (): CompanionBackgrounds => ({
  chuntang: { items: [] }, yuexia: { items: [] }, feiyan: { items: [] },
  yunqu: { items: [] }, bilan: { items: [] }, chayan: { items: [] },
});

const savedBackgroundChoices = () => Object.fromEntries(companionThemes.map(item => [
  item.id, localStorage.getItem(`glean-companion-background-${item.id}`) || 'custom',
])) as Record<CompanionTheme, BackgroundChoice>;

export default function CompanionChat({ colorMode, onColorModeToggle, onOpenNote, wallpaperMode, onWallpaperModeChange }: CompanionChatProps) {
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
    return saved === 'yuexia' || saved === 'feiyan' || saved === 'yunqu' || saved === 'bilan' || saved === 'chayan' ? saved : 'chuntang';
  });
  const [previousTheme, setPreviousTheme] = useState<CompanionTheme | null>(null);
  const [previousBackground, setPreviousBackground] = useState<{ variant: BackgroundVariant; url?: string } | null>(null);
  const [backgrounds, setBackgrounds] = useState<CompanionBackgrounds>(emptyBackgrounds);
  const [backgroundsResolved, setBackgroundsResolved] = useState(false);
  const [backgroundChoices, setBackgroundChoices] = useState<Record<CompanionTheme, BackgroundChoice>>(savedBackgroundChoices);
  const [customBackgroundUrls, setCustomBackgroundUrls] = useState<CustomBackgroundUrls>({});
  const [uploadingBackground, setUploadingBackground] = useState<CompanionTheme | null>(null);
  const customBackgroundUrlsRef = useRef<CustomBackgroundUrls>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api<CompanionBackgrounds>('/companions/backgrounds').then(value => {
      if (!active) return;
      setBackgrounds(value);
      setBackgroundChoices(previous => Object.fromEntries(companionThemes.map(companion => {
        const items = value[companion.id].items;
        const saved = previous[companion.id];
        const next = saved === 'default' ? 'default'
          : items.some(item => item.id === saved) ? saved
          : items[0]?.id || 'default';
        if (next === 'default') localStorage.setItem(`glean-companion-background-${companion.id}`, 'default');
        else localStorage.setItem(`glean-companion-background-${companion.id}`, next);
        return [companion.id, next];
      })) as Record<CompanionTheme, BackgroundChoice>);
    }).catch(reason => active && setError((reason as Error).message))
      .finally(() => active && setBackgroundsResolved(true));
    return () => {
      active = false;
      Object.values(customBackgroundUrlsRef.current).forEach(urls => Object.values(urls).forEach(url => URL.revokeObjectURL(url)));
    };
  }, []);

  useEffect(() => {
    let active = true;
    const unloaded = backgrounds[theme].items.filter(item => !customBackgroundUrlsRef.current[theme]?.[item.id]);
    if (!unloaded.length) return;
    Promise.all(unloaded.map(async item => {
      const blob = await apiBlob(`/companions/${theme}/background/${item.id}`);
      return [item.id, URL.createObjectURL(blob)] as const;
    })).then(loaded => {
      if (!active) {
        loaded.forEach(([, url]) => URL.revokeObjectURL(url));
        return;
      }
      const companionUrls = { ...customBackgroundUrlsRef.current[theme] };
      loaded.forEach(([id, url]) => { companionUrls[id] = url; });
      const next = { ...customBackgroundUrlsRef.current, [theme]: companionUrls };
      customBackgroundUrlsRef.current = next;
      setCustomBackgroundUrls(next);
    }).catch(reason => active && setError((reason as Error).message));
    return () => { active = false; };
  }, [backgrounds, theme]);

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

  function chooseBackground(next: BackgroundChoice) {
    if (next === backgroundChoices[theme] || (next !== 'default' && !backgrounds[theme].items.some(item => item.id === next))) return;
    setPreviousTheme(theme);
    setPreviousBackground({ variant: activeBackgroundVariant, url: activeBackgroundUrl });
    setBackgroundChoices(previous => ({ ...previous, [theme]: next }));
    localStorage.setItem(`glean-companion-background-${theme}`, next);
  }

  function replaceCustomBackgroundUrl(companion: CompanionTheme, id: string, url?: string) {
    const previousUrl = customBackgroundUrlsRef.current[companion]?.[id];
    if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl);
    const companionUrls = { ...customBackgroundUrlsRef.current[companion] };
    if (url) companionUrls[id] = url; else delete companionUrls[id];
    const next = { ...customBackgroundUrlsRef.current, [companion]: companionUrls };
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
      replaceCustomBackgroundUrl(companion, result.id, URL.createObjectURL(file));
      setBackgrounds(previous => ({
        ...previous, [companion]: { items: [...previous[companion].items, result] },
      }));
      setBackgroundChoices(previous => ({ ...previous, [companion]: result.id }));
      localStorage.setItem(`glean-companion-background-${companion}`, result.id);
    } catch (reason) { setError((reason as Error).message); }
    finally { setUploadingBackground(null); }
  }

  async function removeBackground(companion: CompanionTheme, backgroundId: string) {
    setUploadingBackground(companion); setError('');
    try {
      await api(`/companions/${companion}/background/${backgroundId}`, { method: 'DELETE' });
      replaceCustomBackgroundUrl(companion, backgroundId);
      const remaining = backgrounds[companion].items.filter(item => item.id !== backgroundId);
      setBackgrounds(previous => ({ ...previous, [companion]: { items: remaining } }));
      if (backgroundChoices[companion] === backgroundId) {
        const next = remaining[0]?.id || 'default';
        setBackgroundChoices(previous => ({ ...previous, [companion]: next }));
        localStorage.setItem(`glean-companion-background-${companion}`, next);
      }
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
  const activeBackgroundId = colorMode === 'dark' && backgroundChoices[theme] !== 'default'
    && backgrounds[theme].items.some(item => item.id === backgroundChoices[theme]) ? backgroundChoices[theme] : undefined;
  const activeBackgroundVariant: BackgroundVariant = activeBackgroundId ? 'custom' : 'default';
  const activeBackgroundUrl = activeBackgroundId ? customBackgroundUrls[theme]?.[activeBackgroundId] : undefined;
  const customBackgroundReady = activeBackgroundVariant === 'custom' && Boolean(activeBackgroundUrl);
  const currentBackgroundReady = colorMode === 'light'
    || backgroundChoices[theme] === 'default'
    || customBackgroundReady
    || (backgroundsResolved && activeBackgroundVariant === 'default');

  return <section className={`companion-page theme-${theme} ${wallpaperMode ? 'wallpaper-mode' : ''}`} aria-label={wallpaperMode ? '红颜知音全屏壁纸' : '红颜知音笔记问答'}>
    {previousTheme && <div className={`companion-background previous theme-${previousTheme}`} style={previousBackground?.variant === 'custom' && previousBackground.url ? { backgroundImage: `url("${previousBackground.url}")` } : undefined} aria-hidden="true"/>}
    {currentBackgroundReady && <div
      key={`${theme}-${activeBackgroundVariant}-${activeBackgroundUrl || ''}`}
      className={`companion-background current theme-${theme} ${customBackgroundReady ? 'custom' : ''}`}
      style={customBackgroundReady ? { backgroundImage: `url("${activeBackgroundUrl}")` } : undefined}
      aria-hidden="true"
      onAnimationEnd={() => { setPreviousTheme(null); setPreviousBackground(null); }}
    />}
    <button className="companion-wallpaper-exit" onClick={hideWallpaper} aria-label="退出壁纸模式" aria-hidden={!wallpaperMode} tabIndex={wallpaperMode ? 0 : -1} title="退出壁纸模式（Esc）"><Minimize2 size={18}/><span>退出壁纸</span></button>
    <div className="companion-interface" aria-hidden={wallpaperMode} inert={wallpaperMode ? true : undefined}>
    <div className="companion-shade"/>
    <div className="companion-title"><Heart size={15}/><span>红颜知音</span><small>与你共读每一页心事</small></div>
    <button className="companion-theme-toggle" onClick={onColorModeToggle} title={`切换为${colorMode === 'dark' ? '浅色' : '深色'}模式`} aria-label={`切换为${colorMode === 'dark' ? '浅色' : '深色'}模式`}>{colorMode === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
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
            <header><span><Images size={15}/><strong>深色背景</strong></span><small>可添加多张专属图片</small></header>
            <div className="companion-background-options">
              <button className={activeBackgroundVariant === 'default' ? 'selected' : ''} onClick={() => chooseBackground('default')} aria-pressed={activeBackgroundVariant === 'default'}><i className={`theme-${theme}`}/><span>原始图片</span>{activeBackgroundVariant === 'default' && <Check size={13}/>}</button>
              {backgrounds[theme].items.map((background, index) => <div className="companion-background-slot" key={background.id}>
                <button className={activeBackgroundId === background.id ? 'selected' : ''} disabled={!customBackgroundUrls[theme]?.[background.id]} onClick={() => chooseBackground(background.id)} aria-pressed={activeBackgroundId === background.id}>
                  <i style={customBackgroundUrls[theme]?.[background.id] ? { backgroundImage: `url("${customBackgroundUrls[theme]?.[background.id]}")` } : undefined}/>
                  <span>专属图片 {index + 1}</span>{activeBackgroundId === background.id && <Check size={13}/>}
                </button>
                <button className="companion-background-remove" disabled={Boolean(uploadingBackground)} onClick={() => void removeBackground(theme, background.id)} aria-label={`移除专属图片 ${index + 1}`} title="移除这张图片"><Trash2 size={12}/></button>
              </div>)}
              <label className={`companion-background-upload ${uploadingBackground ? 'disabled' : ''}`}>
                <i className="empty">{uploadingBackground === theme ? <LoaderCircle className="spin" size={20}/> : <ImagePlus size={20}/>}</i>
                <span>{uploadingBackground === theme ? '正在上传…' : '待上传'}</span>
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={Boolean(uploadingBackground)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadBackground(theme, file); }}/>
              </label>
            </div>
            <p>上传后会自动选中新图，并在末尾补上新的待上传槽位；浅色模式始终使用原始图片。</p>
          </section>}
        </div>)}</div>
        <footer>{confirmClear ? <><span>确定清空全部对话吗？</span><button className="danger" onClick={() => void clearHistory()}>确认清空</button><button onClick={() => setConfirmClear(false)}>取消</button></> : <button className="clear-chat" onClick={() => setConfirmClear(true)}><Trash2 size={15}/>清空对话记录</button>}</footer>
      </section>
    </div>}
    </div>
  </section>;
}
