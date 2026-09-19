import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, RotateCcw, Sparkles } from 'lucide-react';
import { post, streamJobOutput, type Job, type JobOutputEvent } from '../api';
import Markdown from './Markdown';

export default function GeneratingNote({ jobId, onBack, onCompleted, onLink }: {
  jobId: string;
  onBack: () => void;
  onCompleted: (noteId: string) => void;
  onLink: (title: string) => void;
}) {
  const [content, setContent] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const documentRef = useRef<HTMLElement>(null);
  const followOutput = useRef(true);
  const completedRef = useRef(onCompleted);
  useEffect(() => { completedRef.current = onCompleted; }, [onCompleted]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    streamJobOutput(jobId, (event: JobOutputEvent) => {
      if (event.type === 'job') setJob(event.job);
      if (event.type === 'snapshot') setContent(event.content);
      if (event.type === 'delta') setContent(previous => previous + event.content);
      if (event.type === 'failed' || event.type === 'error') setError(event.message || '笔记生成意外中断。');
      if (event.type === 'done' && event.note_id) completedRef.current(event.note_id);
    }, controller.signal).catch(reason => {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError((reason as Error).message);
    });
    return () => controller.abort();
  }, [attempt, jobId]);

  useEffect(() => {
    if (!followOutput.current) return;
    const element = documentRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [content]);

  const progress = job?.progress || 0;
  return <div className="note-detail generation-detail page-enter">
    <div className="note-toolbar">
      <button className="button text-button" onClick={onBack}><ArrowLeft size={17}/>所有笔记</button>
      <div className="generation-toolbar-status"><Sparkles size={15}/><span>{job?.stage || '正在准备笔记 Agent'}</span><strong>{progress}%</strong></div>
    </div>
    <div className="generation-progress"><span style={{ width: `${progress}%` }}/></div>
    <section ref={documentRef} className="note-document generation-document" onScroll={event => {
      const element = event.currentTarget;
      followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    }}>
      {!content && !error && <div className="generation-waiting"><span className="agent-orbit"><Sparkles size={25}/></span><h2>笔记 Agent 正在阅读字幕</h2><p>{job?.stage || '准备素材与规划写作路径…'}</p></div>}
      {content && <article className="markdown generation-markdown"><Markdown text={content} onLink={onLink}/>{!error && <span className="stream-cursor" aria-label="正在生成"/>}</article>}
      {error && <div className="generation-error"><strong>本次生成停在这里</strong><p>{error}</p><button className="button secondary small" onClick={async () => {
        setError('');
        setContent('');
        await post(`/jobs/${jobId}/retry`);
        setAttempt(value => value + 1);
      }}><RotateCcw size={14}/>从缓存字幕重新生成</button></div>}
      {job?.status === 'completed' && <div className="generation-complete"><Check size={16}/>笔记已完成，正在打开最终版本…</div>}
    </section>
  </div>;
}
