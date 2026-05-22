/** localStorage caching layer for tree and content. */

import type { TreeEntry } from './github.ts';

const PREFIX = 'metabrowse:';
const TREE_KEY = `${PREFIX}tree`;

function contentKey(path: string): string {
  return `${PREFIX}content:${path}`;
}

// --- Tree cache ---

export function getCachedTree(): TreeEntry[] | null {
  const raw = localStorage.getItem(TREE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TreeEntry[];
  } catch {
    return null;
  }
}

export function setCachedTree(entries: TreeEntry[]): void {
  localStorage.setItem(TREE_KEY, JSON.stringify(entries));
}

// --- Content cache ---

export function getCachedContent(path: string): string | null {
  return localStorage.getItem(contentKey(path));
}

export function setCachedContent(path: string, content: string): void {
  localStorage.setItem(contentKey(path), content);
}

/** Remove cached content for a path. */
export function removeCachedContent(path: string): void {
  localStorage.removeItem(contentKey(path));
}
