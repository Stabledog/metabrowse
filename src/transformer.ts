/** Transformer module: Convert parsed structure to HTML-ready data. */

import type { ParsedDocument, Link, Group, Sublevel, Section } from './parser.ts';

export interface HTMLLink {
  line: number; // 0-based source line
  url: string;
  text: string;
  target: string;
  rawHtml: string | null;
  comment: string | null;
  urlHash: string | null; // Hash for localStorage key
  type: 'link';
}

export interface HTMLSublevel {
  line: number; // 0-based source line of the '* ' header
  name: string;
  links: HTMLLink[];
  comment: string | null;
  type: 'sublevel';
}

export interface HTMLGroup {
  line: number; // 0-based source line of the '- ' header
  name: string;
  children: Array<HTMLLink | HTMLSublevel>;
  comment: string | null;
  type: 'group';
}

export interface HTMLLinkGroup {
  links: HTMLLink[];
  type: 'link_group';
}

export interface HTMLSection {
  line: number; // 0-based source line of the '## ' header
  name: string;
  items: Array<HTMLGroup | HTMLLinkGroup | HTMLSection>;
  comment: string | null;
  type: 'section';
}

export interface HTMLDocument {
  title: string;
  items: Array<HTMLSection | HTMLGroup | HTMLLinkGroup>;
}

// URL schemes that don't use :// authority syntax
const SCHEMES_WITHOUT_AUTHORITY = ['mailto:', 'tel:', 'about:'] as const;

/** Check if a URL has a scheme (e.g., http://, chrome://, mailto:). */
function hasScheme(url: string): boolean {
  return url.includes('://') || SCHEMES_WITHOUT_AUTHORITY.some(s => url.startsWith(s));
}

/** Generate a deterministic hash-based target name for a URL (djb2). */
export function generateTarget(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Group consecutive HTMLLink items into HTMLLinkGroup objects. */
function coalesceLinks(items: Array<HTMLLink | HTMLGroup | HTMLSection>): Array<HTMLGroup | HTMLLinkGroup | HTMLSection> {
  const result: Array<HTMLGroup | HTMLLinkGroup | HTMLSection> = [];
  let pendingLinks: HTMLLink[] = [];

  function flush() {
    if (pendingLinks.length > 0) {
      result.push({ links: [...pendingLinks], type: 'link_group' });
      pendingLinks = [];
    }
  }

  for (const item of items) {
    if (item.type === 'link') {
      pendingLinks.push(item);
    } else {
      flush();
      result.push(item);
    }
  }

  flush();
  return result;
}

function transformLink(link: Link): HTMLLink {
  const isExternal = hasScheme(link.url);

  let target: string;
  if (link.target) {
    target = link.target;
  } else if (isExternal) {
    target = generateTarget(link.url);
  } else {
    target = '_self';
  }

  const text = link.text ?? link.url;

  // Generate hash for external http(s) links (for localStorage key)
  let urlHash: string | null = null;
  if (isExternal && (link.url.startsWith('http://') || link.url.startsWith('https://'))) {
    urlHash = target; // Reuse the already-computed hash
  }

  return {
    line: link.line,
    url: link.url,
    text,
    target,
    rawHtml: link.rawHtml,
    comment: link.comment,
    urlHash,
    type: 'link',
  };
}

function transformSublevel(sublevel: Sublevel): HTMLSublevel {
  return {
    line: sublevel.line,
    name: sublevel.name,
    links: sublevel.links.map(transformLink),
    comment: sublevel.comment,
    type: 'sublevel',
  };
}

function transformGroup(group: Group): HTMLGroup {
  const children = group.children.map(item =>
    item.type === 'sublevel' ? transformSublevel(item) : transformLink(item)
  );
  return {
    line: group.line,
    name: group.name,
    children,
    comment: group.comment,
    type: 'group',
  };
}

function transformItems(items: Array<Link | Group | Section>): Array<HTMLSection | HTMLGroup | HTMLLinkGroup> {
  const transformed: Array<HTMLLink | HTMLGroup | HTMLSection> = [];

  for (const item of items) {
    if (item.type === 'section') {
      const sectionItems = transformItems(item.items);
      transformed.push({
        line: item.line,
        name: item.name,
        items: sectionItems,
        comment: item.comment,
        type: 'section',
      });
    } else if (item.type === 'group') {
      transformed.push(transformGroup(item));
    } else {
      transformed.push(transformLink(item));
    }
  }

  return coalesceLinks(transformed);
}

/** Transform a parsed document into HTML-ready structure. */
export function transform(parsedDoc: ParsedDocument, title: string): HTMLDocument {
  const items = transformItems(parsedDoc.items);
  return { title, items };
}
