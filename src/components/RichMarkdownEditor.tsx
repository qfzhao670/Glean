import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiBlob, uploadNoteImage } from '../api';
import Markdown from './Markdown';

export interface RichMarkdownEditorHandle {
  getMarkdown: () => string;
  flush: () => string;
}

function childrenMarkdown(node: Node): string {
  return Array.from(node.childNodes).map(child => nodeMarkdown(child)).join('');
}

function listMarkdown(list: Element, depth = 0): string {
  const ordered = list.tagName === 'OL';
  let index = Number(list.getAttribute('start') || 1);
  return Array.from(list.children).filter(child => child.tagName === 'LI').map(item => {
    const nested: Element[] = [];
    const body = Array.from(item.childNodes).map(child => {
      if (child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')) {
        nested.push(child);
        return '';
      }
      return nodeMarkdown(child);
    }).join('').trim().replace(/\n{2,}/g, '\n');
    const prefix = ordered ? `${index++}. ` : '- ';
    const indent = '  '.repeat(depth);
    const continuation = body.split('\n').map((line, lineIndex) => lineIndex ? `${indent}  ${line}` : line).join('\n');
    return `${indent}${prefix}${continuation}\n${nested.map(child => listMarkdown(child, depth + 1)).join('')}`;
  }).join('') + (depth ? '' : '\n');
}

function tableMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr')).map(row =>
    Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(cell =>
      childrenMarkdown(cell).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '),
    ),
  ).filter(row => row.length);
  if (!rows.length) return '';
  const width = Math.max(...rows.map(row => row.length));
  const render = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`;
  return `${render(rows[0])}\n${render(Array.from({ length: width }, () => '---'))}\n${rows.slice(1).map(render).join('\n')}\n\n`;
}

function nodeMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').replace(/\u00a0/g, ' ');
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.tagName;
  const content = () => childrenMarkdown(node);
  if (tag === 'BR') return '\n';
  if (tag === 'P') return `${content().trimEnd()}\n\n`;
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${content().trim()}\n\n`;
  if (tag === 'STRONG' || tag === 'B') return `**${content()}**`;
  if (tag === 'EM' || tag === 'I') return `*${content()}*`;
  if (tag === 'DEL' || tag === 'S') return `~~${content()}~~`;
  if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') return `\`${content()}\``;
  if (tag === 'PRE') {
    const code = node.querySelector('code');
    const language = code?.className.match(/language-([^\s]+)/)?.[1] || '';
    return `\`\`\`${language}\n${(code?.textContent || node.textContent || '').replace(/\n$/, '')}\n\`\`\`\n\n`;
  }
  if (tag === 'UL' || tag === 'OL') return listMarkdown(node);
  if (tag === 'BLOCKQUOTE') {
    const quote = content().trim().split('\n').map(line => `> ${line}`).join('\n');
    return `${quote}\n\n`;
  }
  if (tag === 'HR') return '---\n\n';
  if (tag === 'TABLE') return tableMarkdown(node);
  if (tag === 'A') return `[${content()}](${node.getAttribute('href') || ''})`;
  if (tag === 'BUTTON' && node.dataset.wikilinkTarget) {
    const target = node.dataset.wikilinkTarget;
    const label = (node.textContent || '').trim();
    return label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`;
  }
  if (tag === 'IMG') {
    const source = node.dataset.markdownSrc || node.getAttribute('src') || '';
    return `![${node.getAttribute('alt') || '笔记图片'}](${source})`;
  }
  if (tag === 'SPAN' && node.dataset.markdownSrc) {
    return `![${node.dataset.markdownAlt || '笔记图片'}](${node.dataset.markdownSrc})`;
  }
  if (tag === 'DIV' || tag === 'SECTION') {
    const value = content();
    return value.endsWith('\n') ? value : `${value}\n`;
  }
  return content();
}

function editorMarkdown(editor: HTMLElement | null) {
  if (!editor) return '';
  return childrenMarkdown(editor)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function placeCaretAtEnd(element: Node) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function replaceBlockShortcut(editor: HTMLElement) {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  let block = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('p,div') as HTMLElement | null;
  if ((!block || block === editor) && anchor?.parentNode === editor && anchor.nodeType === Node.TEXT_NODE) {
    block = document.createElement('p');
    editor.replaceChild(block, anchor);
    block.append(anchor);
  }
  if (!block || block === editor || !editor.contains(block)) return false;
  const text = (block.textContent || '').replace(/\u00a0/g, ' ');
  const heading = text.match(/^(#{1,6})\s$/);
  const quote = text === '> ';
  const bullet = /^[-*]\s$/.test(text);
  const ordered = /^1\.\s$/.test(text);
  if (!heading && !quote && !bullet && !ordered) return false;
  let replacement: HTMLElement;
  if (heading) replacement = document.createElement(`h${heading[1].length}`);
  else if (quote) {
    replacement = document.createElement('blockquote');
    replacement.append(document.createElement('p'));
  } else {
    replacement = document.createElement(ordered ? 'ol' : 'ul');
    replacement.append(document.createElement('li'));
  }
  block.replaceWith(replacement);
  placeCaretAtEnd(replacement.querySelector('p,li') || replacement);
  return true;
}

function replaceBlockShortcutOnSpace(editor: HTMLElement) {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  let block = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('p,div') as HTMLElement | null;
  if ((!block || block === editor) && anchor?.parentNode === editor && anchor.nodeType === Node.TEXT_NODE) {
    block = document.createElement('p');
    editor.replaceChild(block, anchor);
    block.append(anchor);
  }
  if (!block || block === editor || !editor.contains(block)) return false;
  const text = (block.textContent || '').replace(/\u00a0/g, ' ');
  const heading = text.match(/^(#{1,6})$/);
  const quote = text === '>';
  const bullet = text === '-' || text === '*';
  const ordered = text === '1.';
  if (!heading && !quote && !bullet && !ordered) return false;
  let replacement: HTMLElement;
  if (heading) replacement = document.createElement(`h${heading[1].length}`);
  else if (quote) {
    replacement = document.createElement('blockquote');
    replacement.append(document.createElement('p'));
  } else {
    replacement = document.createElement(ordered ? 'ol' : 'ul');
    replacement.append(document.createElement('li'));
  }
  block.replaceWith(replacement);
  placeCaretAtEnd(replacement.querySelector('p,li') || replacement);
  return true;
}

function replaceInlineShortcut() {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  const caret = selection?.anchorOffset || 0;
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return false;
  const before = node.nodeValue.slice(0, caret);
  const patterns: Array<[RegExp, string]> = [
    [/\*\*([^*\n]+)\*\*$/, 'strong'], [/__([^_\n]+)__$/, 'strong'],
    [/~~([^~\n]+)~~$/, 'del'], [/`([^`\n]+)`$/, 'code'], [/==([^=\n]+)==$/, 'strong'],
  ];
  for (const [pattern, tag] of patterns) {
    const match = before.match(pattern);
    if (!match || match.index === undefined) continue;
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, caret);
    range.deleteContents();
    const element = document.createElement(tag);
    element.textContent = match[1];
    range.insertNode(element);
    range.setStartAfter(element);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }
  return false;
}

const RichMarkdownEditor = forwardRef<RichMarkdownEditorHandle, {
  value: string;
  noteId: string;
  disabled?: boolean;
  onCommit: (markdown: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onUploadingChange: (uploading: boolean) => void;
  onError: (message: string) => void;
  notify: (message: string) => void;
  onLink: (title: string) => void;
}>(({ value, noteId, disabled, onCommit, onDirtyChange, onFocusChange, onUploadingChange, onError, notify, onLink }, forwardedRef) => {
  const editor = useRef<HTMLElement>(null);
  const objectUrls = useRef<string[]>([]);
  const pendingUploads = useRef(0);
  const dirty = useRef(false);

  function revokeObjectUrls() {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url));
    objectUrls.current = [];
  }

  async function loadLocalImages() {
    const root = editor.current;
    if (!root) return;
    const prefix = `assets/${noteId}/`;
    for (const placeholder of root.querySelectorAll<HTMLElement>('[data-markdown-src]')) {
      const source = placeholder.dataset.markdownSrc || '';
      if (!source.startsWith(prefix) || placeholder.tagName === 'IMG') continue;
      const filename = source.slice(prefix.length);
      if (!/^[0-9a-f]{32}\.(?:png|jpe?g|gif|webp)$/i.test(filename)) continue;
      try {
        const blob = await apiBlob(`/notes/${noteId}/images/${encodeURIComponent(filename)}`);
        if (!placeholder.isConnected) continue;
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        const image = document.createElement('img');
        image.src = url;
        image.alt = placeholder.dataset.markdownAlt || '笔记图片';
        image.dataset.markdownSrc = source;
        image.className = 'note-image';
        placeholder.replaceWith(image);
      } catch { /* Keep the readable image placeholder. */ }
    }
  }

  useLayoutEffect(() => {
    const root = editor.current;
    if (!root || document.activeElement === root || dirty.current) return;
    revokeObjectUrls();
    root.innerHTML = renderToStaticMarkup(<Markdown text={value} noteId={noteId}/>);
    void loadLocalImages();
  }, [value, noteId]);

  const flush = () => {
    const markdown = editorMarkdown(editor.current);
    dirty.current = false;
    onCommit(markdown);
    onDirtyChange(false);
    return markdown;
  };
  useImperativeHandle(forwardedRef, () => ({ getMarkdown: () => editorMarkdown(editor.current), flush }));
  useEffect(() => () => revokeObjectUrls(), []);

  function input(_event: FormEvent<HTMLElement>) {
    replaceBlockShortcut(editor.current!) || replaceInlineShortcut();
    dirty.current = true;
    onDirtyChange(true);
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== ' ' || event.nativeEvent.isComposing) return;
    if (!replaceBlockShortcutOnSpace(editor.current!)) return;
    event.preventDefault();
    dirty.current = true;
    onDirtyChange(true);
  }

  async function paste(event: ClipboardEvent<HTMLElement>) {
    const images = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile()).filter((file): file is File => !!file);
    if (!images.length) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const markers = images.map(() => {
      const marker = document.createElement('span');
      marker.className = 'image-upload-placeholder';
      marker.contentEditable = 'false';
      marker.textContent = '图片保存中…';
      range.insertNode(marker);
      range.setStartAfter(marker);
      range.collapse(true);
      return marker;
    });
    selection.removeAllRanges();
    selection.addRange(range);
    dirty.current = true;
    onDirtyChange(true);
    pendingUploads.current += images.length;
    onUploadingChange(true);
    await Promise.all(images.map(async (file, index) => {
      try {
        const uploaded = await uploadNoteImage(noteId, file);
        const image = document.createElement('img');
        const objectUrl = URL.createObjectURL(file);
        objectUrls.current.push(objectUrl);
        image.src = objectUrl;
        image.alt = uploaded.alt;
        image.dataset.markdownSrc = uploaded.path;
        image.className = 'note-image';
        markers[index].replaceWith(image);
      } catch (reason) {
        markers[index].remove();
        onError((reason as Error).message);
      } finally {
        pendingUploads.current -= 1;
        if (!pendingUploads.current) onUploadingChange(false);
      }
    }));
    notify(images.length === 1 ? '图片已插入光标位置' : `${images.length} 张图片已插入光标位置`);
  }

  function click(event: MouseEvent<HTMLElement>) {
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-wikilink-target]');
    if (!link) return;
    event.preventDefault();
    onLink((link.dataset.wikilinkTarget || '').split('#')[0]);
  }

  return <article
    ref={editor}
    className="markdown editable-markdown rich-markdown-editor"
    contentEditable={!disabled}
    suppressContentEditableWarning
    role="textbox"
    aria-label="笔记正文"
    aria-multiline="true"
    spellCheck
    onInput={input}
    onKeyDown={keyDown}
    onPaste={paste}
    onClick={click}
    onFocus={() => onFocusChange(true)}
    onBlur={() => { flush(); onFocusChange(false); }}
  />;
});

export default RichMarkdownEditor;
