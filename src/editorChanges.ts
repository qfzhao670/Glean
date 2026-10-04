export function resolveEditorMarkdown(source: string, baseline: string, current: string) {
  const changed = current !== baseline;
  return { changed, markdown: changed ? current : source };
}
