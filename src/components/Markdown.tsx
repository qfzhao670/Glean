import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
export default function Markdown({ text, onLink }: { text: string; onLink?: (title: string) => void }) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => `[${alias || target}](glean:${encodeURIComponent(target)})`)
    .replace(/> \[!\w+\][-+]?\s*(.*)/g, '> **$1**')
    .replace(/==([^=\n]+)==/g, '**$1**');
  return <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url.startsWith('glean:') ? url : defaultUrlTransform(url)} components={{ a: ({ href, children }) => href?.startsWith('glean:') ? <button className="wikilink" onClick={() => onLink?.(decodeURIComponent(href.slice(6)).split('#')[0])}>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt }) => <span className="image-ref">图片：{alt || '资源保留在原 Obsidian 仓库中'}</span> }}>{body}</ReactMarkdown>;
}
