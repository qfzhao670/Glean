import type { BookEntry } from './api';

/** Each reviewed note summary owns a paper page. */
export function groupBookEntriesByPage(entries: BookEntry[]) {
  return entries.map(entry => [entry]);
}
