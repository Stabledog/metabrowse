/** Search: local in-page filter + global cross-page search. */

import { parseContent } from './parser.ts';
import { transform } from './transformer.ts';
import type { HTMLGroup, HTMLLinkGroup, HTMLSection } from './transformer.ts';
import { escapeHtml, formatDirName, getChildDirs, basename } from './utils.ts';

// ── Search index types ──────────────────────────────────────────────

export interface SearchIndexLink {
  text: string;
  url: string;
  group: string;
  comment: string;
}

export interface SearchEntry {
  path: string;       // hash path, e.g. "#/teach/CPP"
  title: string;
  breadcrumbs: string;
  links: SearchIndexLink[];
  groups: string[];
  sections: string[];
  children: string[];
}

// ── Build search index from content ─────────────────────────────────

function buildBreadcrumbString(dirPath: string): string {
  if (!dirPath) return 'Metabrowse';
  const parts = dirPath.split('/');
  return 'Metabrowse / ' + parts.map(formatDirName).join(' / ');
}

function extractLinksFromItems(
  items: Array<HTMLSection | HTMLGroup | HTMLLinkGroup>,
  currentGroup: string,
): SearchIndexLink[] {
  const links: SearchIndexLink[] = [];
  for (const item of items) {
    if (item.type === 'section') {
      links.push(...extractLinksFromItems(item.items, ''));
    } else if (item.type === 'group') {
      for (const child of item.children) {
        if (child.type === 'sublevel') {
          for (const link of child.links) {
            links.push({ text: link.text, url: link.url, group: child.name, comment: link.comment ?? '' });
          }
        } else {
          links.push({ text: child.text, url: child.url, group: item.name, comment: child.comment ?? '' });
        }
      }
    } else if (item.type === 'link_group') {
      for (const link of item.links) {
        links.push({ text: link.text, url: link.url, group: currentGroup, comment: link.comment ?? '' });
      }
    }
  }
  return links;
}

function extractNames(items: Array<HTMLSection | HTMLGroup | HTMLLinkGroup>, type: string): string[] {
  const names: string[] = [];
  for (const item of items) {
    if (item.type === type) {
      names.push((item as HTMLSection | HTMLGroup).name);
    }
    if (item.type === 'section') {
      names.push(...extractNames((item as HTMLSection).items, type));
    }
    if (item.type === 'group') {
      for (const child of item.children) {
        if (child.type === 'sublevel') names.push(child.name);
      }
    }
  }
  return names;
}

/** Build a search index entry from a content path and its raw markdown. */
export function buildEntry(
  dirPath: string,
  content: string,
  contentPaths: string[],
): SearchEntry {
  const parsed = parseContent(content);
  const title = dirPath ? formatDirName(basename(dirPath)) : 'Home';
  const doc = transform(parsed, title);

  return {
    path: dirPath ? `#/${dirPath}` : '#/',
    title,
    breadcrumbs: buildBreadcrumbString(dirPath),
    links: extractLinksFromItems(doc.items, ''),
    groups: extractNames(doc.items, 'group'),
    sections: extractNames(doc.items, 'section'),
    children: getChildDirs(dirPath, contentPaths).map(d => formatDirName(basename(d))),
  };
}

// ── Search state ────────────────────────────────────────────────────

const STORAGE_MODE = 'metabrowse-search-mode';
const STORAGE_TERM = 'metabrowse-search-term';

let cleanupFn: (() => void) | null = null;
let cancelSearchFn: (() => void) | null = null;

/** Cancel any active search from outside this module (e.g. keyboard handler). */
export function cancelSearch(): void {
  cancelSearchFn?.();
}

// ── Local filter helpers ────────────────────────────────────────────

function getSearchText(el: Element): string {
  return (el.textContent ?? '').toLowerCase();
}

function filterLinks(ul: HTMLUListElement, query: string): boolean {
  let anyMatch = false;
  for (const li of ul.querySelectorAll<HTMLLIElement>(':scope > li')) {
    let match = getSearchText(li).includes(query);
    if (!match) {
      const a = li.querySelector('a');
      if (a?.href?.toLowerCase().includes(query)) match = true;
    }
    li.style.display = match ? '' : 'none';
    if (match) anyMatch = true;
  }
  return anyMatch;
}

function filterSublevel(sl: HTMLDivElement, query: string): boolean {
  const headerEl = sl.querySelector('.sublevel-header');
  const headerMatch = headerEl ? getSearchText(headerEl).includes(query) : false;
  const linksUl = sl.querySelector<HTMLUListElement>('.sublevel-links');
  let anyLinkMatch = false;
  if (linksUl) {
    for (const li of linksUl.querySelectorAll<HTMLLIElement>(':scope > li')) {
      let match = getSearchText(li).includes(query);
      if (!match) {
        const a = li.querySelector('a');
        if (a?.href?.toLowerCase().includes(query)) match = true;
      }
      li.style.display = (match || headerMatch) ? '' : 'none';
      if (match) anyLinkMatch = true;
    }
  }
  const visible = headerMatch || anyLinkMatch;
  sl.style.display = visible ? '' : 'none';
  return visible;
}

function filterSubgroup(sg: HTMLDivElement, query: string): boolean {
  const headerEl = sg.querySelector('.subgroup-header');
  const headerMatch = headerEl ? getSearchText(headerEl).includes(query) : false;
  let anyLinkMatch = false;

  // Filter direct link lists
  sg.querySelectorAll<HTMLUListElement>(':scope > .group-links').forEach(linksUl => {
    for (const li of linksUl.querySelectorAll<HTMLLIElement>(':scope > li')) {
      let match = getSearchText(li).includes(query);
      if (!match) {
        const a = li.querySelector('a');
        if (a?.href?.toLowerCase().includes(query)) match = true;
      }
      li.style.display = (match || headerMatch) ? '' : 'none';
      if (match) anyLinkMatch = true;
    }
  });

  // Filter sublevel children
  sg.querySelectorAll<HTMLDivElement>(':scope > .sublevel').forEach(sl => {
    if (filterSublevel(sl, query)) anyLinkMatch = true;
  });

  const visible = headerMatch || anyLinkMatch;
  sg.style.display = visible ? '' : 'none';
  return visible;
}

// ── Escape + highlight helpers ──────────────────────────────────────

function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return escapeHtml(text);
  return escapeHtml(text.substring(0, idx)) +
    '<mark>' + escapeHtml(text.substring(idx, idx + query.length)) + '</mark>' +
    escapeHtml(text.substring(idx + query.length));
}

// ── Init search ─────────────────────────────────────────────────────

/** Wire up search on the rendered page. Call after each renderPage(). */
export function initSearch(container: HTMLElement, getSearchIndex: () => SearchEntry[]): void {
  if (cleanupFn) cleanupFn();

  const input = document.getElementById('unified-search') as HTMLInputElement | null;
  const checkbox = document.getElementById('global-mode-checkbox') as HTMLInputElement | null;
  const clearBtn = document.getElementById('clear-search-btn') as HTMLButtonElement | null;
  const resultsPanel = document.getElementById('search-results-panel') as HTMLDivElement | null;
  const resultsContent = document.getElementById('search-results-content') as HTMLDivElement | null;
  if (!input || !checkbox) return;

  // Collect filterable DOM elements
  const childLinks = container.querySelectorAll<HTMLElement>('.children-nav .child-link-wrap');
  const sections = container.querySelectorAll<HTMLDetailsElement>('.section');
  const topSubgroups = container.querySelectorAll<HTMLDivElement>('.scrollable-content > .subgroup');
  const topLinkGroups = container.querySelectorAll<HTMLUListElement>('.scrollable-content > .links');
  const originalOpen = Array.from(sections, s => s.open);

  function updateClearButton(): void {
    if (clearBtn) clearBtn.style.display = input!.value ? '' : 'none';
  }

  function saveState(): void {
    try {
      localStorage.setItem(STORAGE_MODE, checkbox!.checked ? 'global' : 'local');
      localStorage.setItem(STORAGE_TERM, input!.value);
    } catch { /* ignore */ }
  }

  function restorePageContent(): void {
    childLinks.forEach(el => { el.style.display = ''; });
    sections.forEach((s, i) => {
      s.style.display = '';
      s.open = originalOpen[i];
      s.querySelectorAll<HTMLDivElement>('.subgroup').forEach(sg => {
        sg.style.display = '';
        sg.querySelectorAll<HTMLLIElement>('.group-links > li').forEach(li => { li.style.display = ''; });
        sg.querySelectorAll<HTMLDivElement>('.sublevel').forEach(sl => {
          sl.style.display = '';
          sl.querySelectorAll<HTMLLIElement>('.sublevel-links > li').forEach(li => { li.style.display = ''; });
        });
      });
      s.querySelectorAll<HTMLUListElement>('.links').forEach(ul => {
        ul.style.display = '';
        ul.querySelectorAll<HTMLLIElement>(':scope > li').forEach(li => { li.style.display = ''; });
      });
    });
    topSubgroups.forEach(sg => {
      sg.style.display = '';
      sg.querySelectorAll<HTMLLIElement>('.group-links > li').forEach(li => { li.style.display = ''; });
      sg.querySelectorAll<HTMLDivElement>('.sublevel').forEach(sl => {
        sl.style.display = '';
        sl.querySelectorAll<HTMLLIElement>('.sublevel-links > li').forEach(li => { li.style.display = ''; });
      });
    });
    topLinkGroups.forEach(ul => {
      ul.style.display = '';
      ul.querySelectorAll<HTMLLIElement>(':scope > li').forEach(li => { li.style.display = ''; });
    });
  }

  function hidePageContent(): void {
    childLinks.forEach(el => { el.style.display = 'none'; });
    sections.forEach(s => { s.style.display = 'none'; });
    topSubgroups.forEach(sg => { sg.style.display = 'none'; });
    topLinkGroups.forEach(ul => { ul.style.display = 'none'; });
  }

  function filterCurrentPage(query: string): void {
    if (resultsPanel) resultsPanel.style.display = 'none';
    if (!query) { restorePageContent(); return; }

    const lq = query.toLowerCase();

    childLinks.forEach(el => {
      el.style.display = getSearchText(el).includes(lq) ? '' : 'none';
    });

    sections.forEach(s => {
      const summaryEl = s.querySelector('summary');
      const sectionMatch = summaryEl ? getSearchText(summaryEl).includes(lq) : false;
      let anyChildMatch = false;

      s.querySelectorAll<HTMLDivElement>('.section-content > .subgroup').forEach(sg => {
        if (filterSubgroup(sg, lq)) anyChildMatch = true;
      });
      s.querySelectorAll<HTMLUListElement>('.section-content > .links').forEach(ul => {
        const match = filterLinks(ul, lq);
        ul.style.display = match ? '' : 'none';
        if (match) anyChildMatch = true;
      });

      if (sectionMatch || anyChildMatch) {
        s.style.display = '';
        s.open = true;
      } else {
        s.style.display = 'none';
      }
    });

    topSubgroups.forEach(sg => { filterSubgroup(sg, lq); });
    topLinkGroups.forEach(ul => {
      const match = filterLinks(ul, lq);
      ul.style.display = match ? '' : 'none';
    });
  }

  function showGlobalResults(query: string): void {
    if (!query) {
      if (resultsPanel) resultsPanel.style.display = 'none';
      restorePageContent();
      return;
    }

    if (resultsPanel) resultsPanel.style.display = '';
    hidePageContent();

    const lq = query.toLowerCase();
    const matches: Array<{ page: SearchEntry; type: string; text: string; link?: SearchIndexLink }> = [];
    const MAX_RESULTS = 50;
    const index = getSearchIndex();

    for (const page of index) {
      if (page.breadcrumbs.toLowerCase().includes(lq)) {
        matches.push({ page, type: 'page', text: page.breadcrumbs });
      }
      for (const child of page.children) {
        if (child.toLowerCase().includes(lq)) {
          matches.push({ page, type: 'child', text: child });
        }
      }
      for (const section of page.sections) {
        if (section.toLowerCase().includes(lq)) {
          matches.push({ page, type: 'section', text: section });
        }
      }
      for (const group of page.groups) {
        if (group.toLowerCase().includes(lq)) {
          matches.push({ page, type: 'group', text: group });
        }
      }
      for (const link of page.links) {
        let matched = false;
        let matchText = link.text;
        if (link.text.toLowerCase().includes(lq)) {
          matched = true;
        } else if (link.url.toLowerCase().includes(lq)) {
          matched = true;
          matchText = link.text + ' \u2014 ' + link.url;
        } else if (link.comment && link.comment.toLowerCase().includes(lq)) {
          matched = true;
          matchText = link.text + ' \u2014 ' + link.comment;
        }
        if (matched) matches.push({ page, type: 'link', text: matchText, link });
      }
      if (matches.length >= MAX_RESULTS) break;
    }

    if (!resultsContent) return;

    if (matches.length === 0) {
      resultsContent.innerHTML = '<div class="search-no-results">No results found</div>';
      return;
    }

    // Group by page
    const byPage = new Map<string, { page: SearchEntry; items: typeof matches }>();
    const pageOrder: string[] = [];
    for (const m of matches) {
      const key = m.page.path;
      if (!byPage.has(key)) {
        byPage.set(key, { page: m.page, items: [] });
        pageOrder.push(key);
      }
      byPage.get(key)!.items.push(m);
    }

    let html = '';
    for (const key of pageOrder) {
      const group = byPage.get(key)!;
      html += '<div class="search-result-page">';
      html += `<div class="search-result-page-header"><a href="${escapeHtml(group.page.path)}" class="search-result-page-link" target="_self">${highlightMatch(group.page.breadcrumbs, query)}</a></div>`;
      for (const item of group.items) {
        const typeLabel = item.type === 'link' ? '\u2192' : item.type === 'section' ? '\u00A7' : item.type === 'group' ? '\u25B8' : item.type === 'child' ? '\u25C6' : '\uD83D\uDCC4';
        const linkHref = (item.type === 'link' && item.link) ? item.link.url : group.page.path;
        const linkTarget = (item.type === 'link' && item.link) ? '_blank' : '_self';
        html += '<div class="search-result-item">';
        html += `<span class="search-result-type">${typeLabel}</span> `;
        html += `<a href="${escapeHtml(linkHref)}" class="search-result-link" target="${linkTarget}">${highlightMatch(item.text, query)}</a>`;
        html += '</div>';
      }
      html += '</div>';
    }

    resultsContent.innerHTML = html;
  }

  function performSearch(): void {
    const query = input!.value.trim();
    updateClearButton();
    if (checkbox!.checked) {
      showGlobalResults(query);
    } else {
      filterCurrentPage(query);
    }
  }

  // Event listeners
  let debounceTimer: ReturnType<typeof setTimeout>;
  const onInput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { saveState(); performSearch(); }, 150);
  };
  const onChange = () => { saveState(); performSearch(); };
  const onClear = () => {
    input!.value = '';
    saveState();
    updateClearButton();
    performSearch();
    input!.focus();
  };

  cancelSearchFn = () => { onClear(); input!.blur(); };

  input.addEventListener('input', onInput);
  checkbox.addEventListener('change', onChange);
  if (clearBtn) clearBtn.addEventListener('click', onClear);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      const panel = document.getElementById('search-results-panel');
      if (!panel || panel.style.display === 'none') return;
      const firstLink = panel.querySelector<HTMLAnchorElement>('a');
      if (!firstLink) return;
      e.preventDefault();
      firstLink.focus();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClear();
      input!.blur();
    }
  };
  input.addEventListener('keydown', onKeyDown);

  const onResultPanelClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest('a');
    if (a && a.getAttribute('target') !== '_blank') {
      input!.value = '';
      saveState();
      updateClearButton();
    }
  };
  if (resultsPanel) resultsPanel.addEventListener('click', onResultPanelClick);

  // Restore saved state
  try {
    const savedMode = localStorage.getItem(STORAGE_MODE);
    const savedTerm = localStorage.getItem(STORAGE_TERM);
    if (savedMode === 'local') checkbox.checked = false;
    if (savedTerm) input.value = savedTerm;
  } catch { /* ignore */ }

  updateClearButton();
  performSearch();

  cleanupFn = () => {
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeyDown);
    checkbox.removeEventListener('change', onChange);
    if (clearBtn) clearBtn.removeEventListener('click', onClear);
    if (resultsPanel) resultsPanel.removeEventListener('click', onResultPanelClick);
    cancelSearchFn = null;
    clearTimeout(debounceTimer);
  };
}
