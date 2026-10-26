/** Favorites: turn a parsed page into a folder tree for barouse's favorites bar. */

import type { ParsedDocument, Link, Group } from './parser.ts';

export interface FavoriteBookmark {
  title: string;
  url: string;
  divider?: boolean;
}

export interface FavoriteFolder {
  title: string;
  children: FavoriteNode[];
}

export type FavoriteNode = FavoriteBookmark | FavoriteFolder;

/** Chromium bookmarks have no separator type, so a divider is a do-nothing bookmark. */
export const DIVIDER_URL = 'javascript:void(0)';

/** Root folder name: the page's directory name, or "Metabrowse" for the top-level page. */
export function favoritesRootName(dirPath: string): string {
  return dirPath ? dirPath.split('/').pop()! : 'Metabrowse';
}

function divider(title: string): FavoriteBookmark {
  return { title, url: DIVIDER_URL, divider: true };
}

/** Bookmarks need an absolute URL; skips orphan-sublevel placeholders ('#') and relative links. */
function isBookmarkable(link: Link): boolean {
  try {
    new URL(link.url);
    return true;
  } catch {
    return false;
  }
}

function bookmark(link: Link): FavoriteBookmark {
  return { title: link.text ?? link.url, url: link.url };
}

/** A group flattens to a divider plus its links; empty groups and sublevels produce nothing. */
function groupNodes(group: Group): FavoriteBookmark[] {
  const out: FavoriteBookmark[] = [];
  for (const child of group.children) {
    if (child.type === 'link') {
      if (isBookmarkable(child)) out.push(bookmark(child));
    } else {
      const links = child.links.filter(isBookmarkable);
      if (links.length === 0) continue;
      out.push(divider(`· ${child.name} ·`), ...links.map(bookmark));
    }
  }
  if (out.length === 0) return [];
  return [divider(`━━ ${group.name.toUpperCase()} ━━`), ...out];
}

function itemNodes(items: Array<Link | Group>): FavoriteBookmark[] {
  const out: FavoriteBookmark[] = [];
  for (const item of items) {
    if (item.type === 'link') {
      if (isBookmarkable(item)) out.push(bookmark(item));
    } else {
      out.push(...groupNodes(item));
    }
  }
  return out;
}

export function countLinks(nodes: FavoriteNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if ('children' in node) n += countLinks(node.children);
    else if (!node.divider) n++;
  }
  return n;
}

/**
 * Build the favorites folder for a page from metabrowse's own parsed document,
 * so the bar matches what metabrowse shows. Sections become subfolders; items
 * before the first section sit directly in the root.
 */
export function buildFavoritesTree(doc: ParsedDocument, dirPath: string): FavoriteFolder {
  const children: FavoriteNode[] = [];
  for (const item of doc.items) {
    if (item.type === 'section') {
      children.push({ title: item.name, children: itemNodes(item.items) });
    } else {
      children.push(...itemNodes([item]));
    }
  }
  return { title: favoritesRootName(dirPath), children };
}
