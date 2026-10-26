import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseContent } from '../parser.ts';
import { buildFavoritesTree, countLinks, favoritesRootName, toBookmarksHtml, DIVIDER_URL } from '../favorites.ts';
import type { FavoriteNode } from '../favorites.ts';

const fixturesDir = join(import.meta.dirname, 'fixtures');

// The CPP page lives in the sibling content repo; it is not copied here because
// it is full of enterprise URLs and this repo is mirrored publicly.
const cppPath = join(import.meta.dirname, '../../../bb-metabrowse-links/text/teach/CPP/README.md');
const hasCpp = existsSync(cppPath);

/** Render a tree as indented lines: folders end in '/', links show their title. */
function outline(nodes: FavoriteNode[], indent = ''): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    if ('children' in node) {
      lines.push(`${indent}${node.title}/`);
      lines.push(...outline(node.children, indent + '  '));
    } else {
      lines.push(`${indent}${node.title}`);
    }
  }
  return lines;
}

// ── favoritesRootName ───────────────────────────────────────────────

describe('favoritesRootName', () => {
  it('uses the last directory component', () => {
    expect(favoritesRootName('teach/CPP')).toBe('CPP');
  });

  it('names the top-level page Metabrowse', () => {
    expect(favoritesRootName('')).toBe('Metabrowse');
  });
});

// ── CPP page (spec example) ─────────────────────────────────────────

describe.skipIf(!hasCpp)('buildFavoritesTree: teach/CPP', () => {
  const cpp = hasCpp ? readFileSync(cppPath, 'utf-8') : '';
  // URLs are read from the page rather than written here, to keep enterprise hosts out of this repo.
  const urlOnLine = (re: RegExp) => cpp.match(re)?.[1] ?? '<missing>';
  const untitledUrl = urlOnLine(/^\s*- (https:\/\/\S+)\s*$/m);
  const spacesUrl = urlOnLine(/^\s*- Spaces (\S+)/m);

  // The spec example shows "IMPORTED"; the page says "Imported:", and group names
  // are kept as written, so the colon stays.
  it('matches the spec example once "# Other / unsorted" is a ## section', () => {
    const fixed = cpp.replace(/^# Other \/ unsorted$/m, '## Other / unsorted');
    const tree = buildFavoritesTree(parseContent(fixed), 'teach/CPP');
    expect(outline([tree])).toEqual([
      'CPP/',
      '  ━━ IMPORTED: ━━',
      '  Spaces',
      `  ${untitledUrl}`,
      '  Teach-patch tutorials C++',
      '  Classmgr Checklist 2026',
      '  Apr 20 2026 CPP Compliance Monitor heatmap',
      "  John Lakos' book",
      '  Main/',
      '    ━━ CANONICAL ━━',
      '    C++ notehub',
      '    Slides ELT',
      '    C++ class management gist',
      '    BDE API',
      '    C++ teach-patch',
      '    Zoom CPP NY 1',
      '    ━━ TESTING, MOCKING ━━',
      '    Testing teach-patch',
      '    📖trnma.cpp-unit-testing',
      '    C++ unit testing slides index',
      '  Cohorts/',
      '    All cohorts home',
      '    ━━ APR 20 ━━',
      '    Heatmap',
      '  Maintenance/',
      '    Jenkins cpp-project-monitor',
      '  Other / unsorted/',
      '    Compliance monitor stretch goals',
      '    Old Q&A sheet',
    ]);
    expect(countLinks(tree.children)).toBe(20);
  });

  it('follows metabrowse on the H1 quirk: "# Other / unsorted" is dropped, its links join Maintenance', () => {
    const tree = buildFavoritesTree(parseContent(cpp), 'teach/CPP');
    const titles = tree.children.filter((n) => 'children' in n).map((n) => n.title);
    expect(titles).toEqual(['Main', 'Cohorts', 'Maintenance']);
    const maintenance = tree.children.find((n) => n.title === 'Maintenance')!;
    expect(outline([maintenance])).toEqual([
      'Maintenance/',
      '  Jenkins cpp-project-monitor',
      '  Compliance monitor stretch goals',
      '  Old Q&A sheet',
    ]);
    expect(countLinks(tree.children)).toBe(20);
  });

  it('keeps link URLs exactly as parsed', () => {
    const tree = buildFavoritesTree(parseContent(cpp), 'teach/CPP');
    const spaces = tree.children.find((n) => n.title === 'Spaces');
    expect(spaces).toEqual({ title: 'Spaces', url: spacesUrl });
    const untitled = tree.children.find((n) => n.title === untitledUrl);
    expect(untitled).toEqual({ title: untitledUrl, url: untitledUrl });
  });
});

// ── Edge cases (synthetic fixture) ──────────────────────────────────

describe('buildFavoritesTree: edge cases', () => {
  const doc = parseContent(readFileSync(join(fixturesDir, 'favorites-edge.md'), 'utf-8'));
  const tree = buildFavoritesTree(doc, 'misc/edge-page');

  it('builds the expected outline', () => {
    expect(outline([tree])).toEqual([
      'edge-page/',
      '  Before any section',
      '  https://untitled.example.com/path?q=1',
      '  Groups/',
      '    ━━ HAS SUBLEVELS ━━',
      '    · Tools ·',
      '    Vite',
      '    Direct',
      '    ━━ 🚀 L A U N C H ━━',
      '    https://launch.example.com',
      '  Empty section/',
    ]);
  });

  it('puts links before the first section directly in the root, untitled ones as the raw URL', () => {
    expect(tree.children.slice(0, 2)).toEqual([
      { title: 'Before any section', url: 'https://before.example.com' },
      { title: 'https://untitled.example.com/path?q=1', url: 'https://untitled.example.com/path?q=1' },
    ]);
  });

  it('names section folders without their comment', () => {
    expect(tree.children[2].title).toBe('Groups');
  });

  it('makes dividers no-op bookmarks flagged as dividers', () => {
    const groups = tree.children[2] as { children: FavoriteNode[] };
    expect(groups.children[0]).toEqual({ title: '━━ HAS SUBLEVELS ━━', url: DIVIDER_URL, divider: true });
    expect(groups.children[1]).toEqual({ title: '· Tools ·', url: DIVIDER_URL, divider: true });
  });

  it('skips empty groups, empty sublevels, and groups with only non-absolute links', () => {
    const titles = outline([tree]).join('\n');
    expect(titles).not.toContain('EMPTY GROUP');
    expect(titles).not.toContain('Empty sublevel');
    expect(titles).not.toContain('ONLY PLACEHOLDERS');
    expect(titles).not.toContain('Relative');
  });

  it('counts links but not dividers', () => {
    expect(countLinks(tree.children)).toBe(5);
  });

  it('skips orphan sublevel placeholders', () => {
    const orphan = buildFavoritesTree(parseContent('* Orphan text\n- https://a.example.com\n'), '');
    expect(orphan).toEqual({
      title: 'Metabrowse',
      children: [{ title: 'https://a.example.com', url: 'https://a.example.com' }],
    });
  });
});

// ── Bookmarks file (no-barouse fallback) ────────────────────────────

describe('toBookmarksHtml', () => {
  const tree = buildFavoritesTree(
    parseContent('- Q&A <one> https://a.example.com/?x=1&y="2"\n## Sec\n- Grp\n  - https://b.example.com\n'),
    'misc/page',
  );
  const html = toBookmarksHtml(tree);

  it('is a Netscape bookmarks file with the folder inside the toolbar folder', () => {
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>\n')).toBe(true);
    expect(html).toContain('<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Favorites bar</H3>');
    expect(html.indexOf('PERSONAL_TOOLBAR_FOLDER')).toBeLessThan(html.indexOf('<H3>page</H3>'));
  });

  it('keeps tree order and nesting, dividers included', () => {
    const tags = html.split('\n').map((l) => l.trim()).filter((l) => /^<DT>|^<\/?DL>/.test(l));
    expect(tags).toEqual([
      '<DL><p>',
      '<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Favorites bar</H3>',
      '<DL><p>',
      '<DT><H3>page</H3>',
      '<DL><p>',
      '<DT><A HREF="https://a.example.com/?x=1&amp;y=&quot;2&quot;">Q&amp;A &lt;one&gt;</A>',
      '<DT><H3>Sec</H3>',
      '<DL><p>',
      `<DT><A HREF="${DIVIDER_URL}">━━ GRP ━━</A>`,
      '<DT><A HREF="https://b.example.com">https://b.example.com</A>',
      '</DL><p>',
      '</DL><p>',
      '</DL><p>',
      '</DL><p>',
    ]);
  });
});
