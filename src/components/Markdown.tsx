import { useEffect, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiBlob } from '../api';

function NoteImage({ src, alt, noteId }: { src?: string; alt?: string; noteId?: string }) {
  const [url, setUrl] = useState('');
  const match = noteId && src?.match(new RegExp(`^assets/${noteId}/([0-9a-f]{32}\\.(?:png|jpe?g|gif|webp))$`, 'i'));
  useEffect(() => {
    if (!match || !noteId) return;
    let active = true;
    let objectUrl = '';
    apiBlob(`/notes/${noteId}/images/${encodeURIComponent(match[1])}`).then(blob => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) setUrl(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [noteId, src]);
  if (!match) return <img className="note-image" src={src} alt={alt || '笔记图片'} data-markdown-src={src}/>;
  return url
    ? <img className="note-image" src={url} alt={alt || '笔记图片'} data-markdown-src={src}/>
    : <span className="image-ref" data-markdown-src={src} data-markdown-alt={alt || '笔记图片'}>图片：{alt || '资源保留在笔记仓库中'}</span>;
}

export default function Markdown({ text, onLink, noteId }: { text: string; onLink?: (title: string) => void; noteId?: string }) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => `[${alias || target}](glean:${encodeURIComponent(target)})`)
    .replace(/> \[!\w+\][-+]?\s*(.*)/g, '> **$1**')
    .replace(/==([^=\n]+)==/g, '**$1**');
  return <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url.startsWith('glean:') ? url : defaultUrlTransform(url)} components={{ a: ({ href, children }) => href?.startsWith('glean:') ? <button className="wikilink" data-wikilink-target={decodeURIComponent(href.slice(6))} onClick={() => onLink?.(decodeURIComponent(href.slice(6)).split('#')[0])}>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ src, alt }) => <NoteImage src={src} alt={alt} noteId={noteId}/> }}>{body}</ReactMarkdown>;
}
