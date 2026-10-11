import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Highlighter } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiBlob, uploadNoteImage } from '../api';
import { resolveEditorMarkdown } from '../editorChanges';
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
  if (tag === 'MARK') return `==${content()}==`;
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
    [/~~([^~\n]+)~~$/, 'del'], [/`([^`\n]+)`$/, 'code'], [/==([^=\n]+)==$/, 'mark'],
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

type SelectedText = { node: Text; start: number; end: number };

function selectedTextInRange(range: Range, root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const selected: SelectedText[] = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (range.intersectsNode(node)) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (end > start) selected.push({ node, start, end });
    }
    current = walker.nextNode();
  }

  return selected;
}

function highlightRange(range: Range, root: HTMLElement) {
  const selected = selectedTextInRange(range, root).filter(({ node }) => !node.parentElement?.closest('mark'));
  for (const { node, start, end } of selected.reverse()) {
    if (end < node.length) node.splitText(end);
    const highlighted = start ? node.splitText(start) : node;
    const mark = document.createElement('mark');
    highlighted.replaceWith(mark);
    mark.append(highlighted);
  }
  return selected.length > 0;
}

function removeHighlightRange(range: Range, root: HTMLElement) {
  const selected = selectedTextInRange(range, root).filter(({ node }) => !!node.parentElement?.closest('mark'));
  for (const { node, start, end } of selected.reverse()) {
    if (end < node.length) node.splitText(end);
    const plain = start ? node.splitText(start) : node;
    const mark = plain.parentElement?.closest('mark');
    if (!mark || plain.parentNode !== mark) continue;

    const suffix = mark.cloneNode(false) as HTMLElement;
    while (plain.nextSibling) suffix.append(plain.nextSibling);
    mark.after(plain);
    if (suffix.hasChildNodes()) plain.after(suffix);
    if (!mark.hasChildNodes()) mark.remove();
  }
  return selected.length > 0;
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
  onEdit?: () => void;
  onImagePreview?: (src: string, alt: string) => void;
}>(({ value, noteId, disabled, onCommit, onDirtyChange, onFocusChange, onUploadingChange, onError, notify, onLink, onEdit, onImagePreview }, forwardedRef) => {
  const editor = useRef<HTMLElement>(null);
  const objectUrls = useRef<string[]>([]);
  const pendingUploads = useRef(0);
  const baseline = useRef('');
  const dirty = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; range: Range; canHighlight: boolean; canRemoveHighlight: boolean } | null>(null);

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
    baseline.current = editorMarkdown(root);
    dirty.current = false;
    void loadLocalImages();
  }, [value, noteId]);

  function editorState() {
    return resolveEditorMarkdown(value, baseline.current, editorMarkdown(editor.current));
  }

  function updateDirty() {
    const { changed } = editorState();
    dirty.current = changed;
    onDirtyChange(changed);
    if (changed) onEdit?.();
  }

  const flush = () => {
    const { changed, markdown } = editorState();
    dirty.current = false;
    if (changed) onCommit(markdown);
    onDirtyChange(false);
    return markdown;
  };
  useImperativeHandle(forwardedRef, () => ({ getMarkdown: () => editorState().markdown, flush }));
  useEffect(() => () => revokeObjectUrls(), []);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', escape);
    };
  }, [contextMenu]);

  function input(_event: FormEvent<HTMLElement>) {
    replaceBlockShortcut(editor.current!) || replaceInlineShortcut();
    updateDirty();
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== ' ' || event.nativeEvent.isComposing) return;
    if (!replaceBlockShortcutOnSpace(editor.current!)) return;
    event.preventDefault();
    updateDirty();
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
    updateDirty();
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
    updateDirty();
    notify(images.length === 1 ? '图片已插入光标位置' : `${images.length} 张图片已插入光标位置`);
  }

  function click(event: MouseEvent<HTMLElement>) {
    const image = (event.target as HTMLElement).closest<HTMLImageElement>('img.note-image');
    if (image && onImagePreview) {
      event.preventDefault();
      onImagePreview(image.currentSrc || image.src, image.alt || '笔记图片');
      return;
    }
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-wikilink-target]');
    if (!link) return;
    event.preventDefault();
    onLink((link.dataset.wikilinkTarget || '').split('#')[0]);
  }

  function openContextMenu(event: MouseEvent<HTMLElement>) {
    const root = editor.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const selected = selectedTextInRange(range, root);
    const canHighlight = selected.some(({ node }) => !node.parentElement?.closest('mark'));
    const canRemoveHighlight = selected.some(({ node }) => !!node.parentElement?.closest('mark'));
    if (!canHighlight && !canRemoveHighlight) return;
    event.preventDefault();
    const menuHeight = canHighlight && canRemoveHighlight ? 91 : 52;
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 132),
      y: Math.min(event.clientY, window.innerHeight - menuHeight),
      range: range.cloneRange(),
      canHighlight,
      canRemoveHighlight,
    });
  }

  function applyHighlight() {
    const root = editor.current;
    if (!root || !contextMenu || !highlightRange(contextMenu.range, root)) {
      setContextMenu(null);
      return;
    }
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
    updateDirty();
    root.focus({ preventScroll: true });
  }

  function removeHighlight() {
    const root = editor.current;
    if (!root || !contextMenu || !removeHighlightRange(contextMenu.range, root)) {
      setContextMenu(null);
      return;
    }
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
    updateDirty();
    root.focus({ preventScroll: true });
  }

  return <>
    <article
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
      onContextMenu={openContextMenu}
      onFocus={() => onFocusChange(true)}
      onBlur={() => { flush(); onFocusChange(false); }}
    />
    {contextMenu && createPortal(<div className="note-selection-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={event => event.stopPropagation()}>
      {contextMenu.canHighlight && <button type="button" role="menuitem" onClick={applyHighlight}><Highlighter size={15}/>高亮</button>}
      {contextMenu.canRemoveHighlight && <button type="button" role="menuitem" onClick={removeHighlight}><Eraser size={15}/>取消高亮</button>}
    </div>, document.body)}
  </>;
});

export default RichMarkdownEditor;
