/** Renderer: Build DOM from transformed HTMLDocument, replicating the Jinja2 template structure. */

import type { HTMLDocument, HTMLLink, HTMLSublevel, HTMLGroup, HTMLLinkGroup, HTMLSection } from './transformer.ts';
import type { Route } from './router.ts';
import { createLogViewer } from './logging-client.ts';
import { el } from './dom.ts';
import { createStatusBar } from './status-bar.ts';
import { formatDirName, getChildDirs, basename } from './utils.ts';

export interface RenderConfig {
  contentPaths: string[];
  owner: string;
  repo: string;
  host: string;
  onTreePanel?: () => void;
  onSettings?: () => void;
  onOpenAll?: (container: HTMLElement) => void;
  onCapture?: () => void;
  onUpdate?: () => void;
}

/** Build breadcrumb data from a route path. */
function buildBreadcrumbs(dirPath: string): Array<{ name: string; hash: string }> {
  if (!dirPath) return [];
  const parts = dirPath.split('/');
  const crumbs: Array<{ name: string; hash: string }> = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const path = parts.slice(0, i + 1).join('/');
    crumbs.push({ name: formatDirName(parts[i]), hash: `#/${path}` });
  }
  return crumbs;
}

// ── Copy-to-clipboard ───────────────────────────────────────────────

function setupCopyHandler(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const url = btn.getAttribute('data-url');
    if (!url) return;
    // Resolve relative URLs to absolute
    const a = document.createElement('a');
    a.href = url;
    navigator.clipboard.writeText(a.href).then(() => {
      btn.textContent = '\u2705';
      setTimeout(() => { btn.textContent = '\uD83D\uDCCB'; }, 1500);
    });
  });
}

// ── Link rendering ──────────────────────────────────────────────────

function renderLink(link: HTMLLink): HTMLLIElement {
  const li = el('li');

  if (link.rawHtml) {
    // HTML pass-through
    const span = document.createElement('span');
    span.innerHTML = link.rawHtml;
    li.appendChild(span);
  } else {
    // Favicon placeholder (Phase 4 will load these)
    if (link.urlHash) {
      li.appendChild(el('img', {
        src: '', alt: '', class: 'link-favicon',
        'data-link-url': link.url,
        'data-url-hash': link.urlHash,
      }));
    }
    li.appendChild(el('a', { href: link.url, target: link.target }, link.text));
  }

  // Copy button
  li.appendChild(el('button', {
    class: 'copy-btn', 'data-url': link.url, title: 'Copy URL',
  }, '\uD83D\uDCCB'));

  // Comment
  if (link.comment) {
    li.appendChild(el('span', { class: 'link-comment' }, '\u2139 ' + link.comment));
  }

  return li;
}

// ── Sublevel rendering ──────────────────────────────────────────────

function renderSublevel(sublevel: HTMLSublevel): HTMLDivElement {
  const div = el('div', { class: 'sublevel' });

  const header = el('div', { class: 'sublevel-header' }, sublevel.name);
  if (sublevel.comment) {
    header.appendChild(el('span', { class: 'group-comment' }, '\u2139 ' + sublevel.comment));
  }
  div.appendChild(header);

  const ul = el('ul', { class: 'sublevel-links' });
  for (const link of sublevel.links) {
    ul.appendChild(renderLink(link));
  }
  div.appendChild(ul);

  return div;
}

// ── Group rendering ─────────────────────────────────────────────────

function renderGroup(group: HTMLGroup): HTMLDivElement {
  const div = el('div', { class: 'subgroup' });

  const header = el('div', { class: 'subgroup-header' }, group.name);
  if (group.comment) {
    header.appendChild(el('span', { class: 'group-comment' }, '\u2139 ' + group.comment));
  }
  div.appendChild(header);

  let pendingLinks: HTMLLink[] = [];
  function flushLinks() {
    if (pendingLinks.length === 0) return;
    const ul = el('ul', { class: 'group-links' });
    for (const link of pendingLinks) ul.appendChild(renderLink(link));
    div.appendChild(ul);
    pendingLinks = [];
  }

  for (const child of group.children) {
    if (child.type === 'sublevel') {
      flushLinks();
      div.appendChild(renderSublevel(child));
    } else {
      pendingLinks.push(child);
    }
  }
  flushLinks();

  return div;
}

// ── Link group rendering ────────────────────────────────────────────

function renderLinkGroup(linkGroup: HTMLLinkGroup): HTMLUListElement {
  const ul = el('ul', { class: 'links' });
  for (const link of linkGroup.links) {
    ul.appendChild(renderLink(link));
  }
  return ul;
}

// ── Section rendering ───────────────────────────────────────────────

function renderSection(section: HTMLSection): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'section';
  details.open = true;

  const summary = el('summary', {}, section.name);
  if (section.comment) {
    summary.appendChild(el('span', { class: 'section-comment' }, '\u2139 ' + section.comment));
  }
  details.appendChild(summary);

  const content = el('div', { class: 'section-content' });
  for (const item of section.items) {
    content.appendChild(renderSubitem(item));
  }
  details.appendChild(content);

  return details;
}

// ── Subitem dispatch ────────────────────────────────────────────────

function renderSubitem(item: HTMLGroup | HTMLLinkGroup | HTMLSection): HTMLElement {
  switch (item.type) {
    case 'group': return renderGroup(item);
    case 'link_group': return renderLinkGroup(item);
    case 'section': return renderSection(item);
  }
}

// ── Children nav ────────────────────────────────────────────────────

function renderChildren(dirPath: string, contentPaths: string[]): HTMLDivElement | null {
  const childDirs = getChildDirs(dirPath, contentPaths);
  if (childDirs.length === 0) return null;

  const nav = el('div', { class: 'children-nav' });
  for (const dir of childDirs) {
    const name = formatDirName(basename(dir));
    const hash = `#/${dir}`;
    const wrap = el('span', { class: 'child-link-wrap' });
    wrap.appendChild(el('a', { href: hash, class: 'child-link', target: '_self' }, name));
    wrap.appendChild(el('button', {
      class: 'copy-btn child-copy-btn', 'data-url': hash, title: 'Copy URL',
    }, '\uD83D\uDCCB'));
    nav.appendChild(wrap);
  }
  return nav;
}

// ── Breadcrumbs ─────────────────────────────────────────────────────

function renderBreadcrumbsEl(dirPath: string): HTMLHeadingElement {
  const h1 = el('h1', { class: 'breadcrumbs' });

  // Always add "Metabrowse" as root link
  h1.appendChild(el('a', { href: '#/', class: 'breadcrumb-link', target: '_self' }, 'Metabrowse'));

  if (dirPath) {
    const crumbs = buildBreadcrumbs(dirPath);
    for (const crumb of crumbs) {
      h1.appendChild(el('span', { class: 'breadcrumb-separator' }, '/'));
      h1.appendChild(el('a', { href: crumb.hash, class: 'breadcrumb-link', target: '_self' }, crumb.name));
    }
    // Current page name
    const currentName = formatDirName(basename(dirPath));
    h1.appendChild(el('span', { class: 'breadcrumb-separator' }, '/'));
    h1.appendChild(el('span', { class: 'breadcrumb-current' }, currentName));
  } else {
    // Root page — "Metabrowse" is the current page, make it bold
    // Remove the link we just added and replace with current
    h1.innerHTML = '';
    h1.appendChild(el('span', { class: 'breadcrumb-current' }, 'Metabrowse'));
  }

  return h1;
}

// ── Main page render ────────────────────────────────────────────────

export function renderPage(
  target: HTMLElement,
  doc: HTMLDocument,
  route: Route,
  config: RenderConfig,
): void {
  target.innerHTML = '';

  const container = el('div', { class: 'container' });

  // Fixed header
  const fixedHeader = el('div', { class: 'fixed-header' });

  // Header bar with breadcrumbs + edit link + logs button
  const headerBar = el('div', { class: 'header-bar' });
  headerBar.appendChild(renderBreadcrumbsEl(route.dirPath));

  const headerActions = el('div', { class: 'header-actions' });

  const editHash = route.dirPath ? `#/edit/${route.dirPath}` : '#/edit/';
  headerActions.appendChild(el('a', { href: editHash, class: 'edit-link icon-btn', title: 'Edit (e)', tabindex: '-1' }, '✎'));

  const treeBtn = el('button', { class: 'tree-btn icon-btn', title: 'Tree (t)', tabindex: '-1' }, '🌳');
  treeBtn.addEventListener('click', () => config.onTreePanel?.());
  headerActions.appendChild(treeBtn);

  const logsBtn = el('button', { class: 'logs-btn icon-btn', title: 'View logs', tabindex: '-1' }, '📜');
  logsBtn.addEventListener('click', () => document.body.appendChild(createLogViewer()));
  headerActions.appendChild(logsBtn);

  const settingsBtn = el('button', { class: 'settings-btn icon-btn', title: 'Settings', tabindex: '-1' }, '⚙');
  settingsBtn.addEventListener('click', () => config.onSettings?.());
  headerActions.appendChild(settingsBtn);

  const collapseBtn = el('button', { class: 'collapse-btn icon-btn', title: 'Collapse/restore (x)', tabindex: '-1' }, '⊟');
  collapseBtn.addEventListener('click', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
  });
  headerActions.appendChild(collapseBtn);

  const wsOpenBtn = el('button', { class: 'workspace-btn icon-btn', title: 'Open Workspace (w)', disabled: '', tabindex: '-1' }, '🔗');
  wsOpenBtn.addEventListener('click', () => config.onOpenAll?.(container));
  headerActions.appendChild(wsOpenBtn);

  const wsCaptureBtn = el('button', { class: 'workspace-btn icon-btn', title: 'Create Workspace (c)', disabled: '', tabindex: '-1' }, '📷');
  wsCaptureBtn.addEventListener('click', () => config.onCapture?.());
  headerActions.appendChild(wsCaptureBtn);

  const wsUpdateBtn = el('button', { class: 'workspace-btn icon-btn', title: 'Update Workspace', disabled: '', tabindex: '-1' }, '🔄');
  wsUpdateBtn.addEventListener('click', () => config.onUpdate?.());
  headerActions.appendChild(wsUpdateBtn);

  headerBar.appendChild(headerActions);

  fixedHeader.appendChild(headerBar);

  // Search bar
  const searchBar = el('div', { class: 'search-bar', role: 'search' });
  searchBar.appendChild(el('span', { class: 'search-icon' }, '\uD83D\uDD0D'));
  searchBar.appendChild(el('input', {
    type: 'text', id: 'unified-search', class: 'search-input',
    placeholder: '/ (this page) | ^K (global)',
    'aria-label': 'Search',
  }));
  const clearBtn = el('button', {
    type: 'button', id: 'clear-search-btn', class: 'clear-search-btn',
    title: 'Clear search', style: 'display:none', tabindex: '-1',
  }, '\u00D7');
  searchBar.appendChild(clearBtn);
  const modeLabel = el('label', { class: 'search-mode-toggle' });
  const modeCheckbox = el('input', { type: 'checkbox', id: 'global-mode-checkbox', tabindex: '-1' });
  (modeCheckbox as HTMLInputElement).checked = true;
  modeLabel.appendChild(modeCheckbox);
  modeLabel.appendChild(el('span', {}, 'Global'));
  searchBar.appendChild(modeLabel);
  fixedHeader.appendChild(searchBar);

  container.appendChild(fixedHeader);

  // Scrollable content
  const scrollable = el('div', { class: 'scrollable-content' });

  // Global search results panel
  const resultsPanel = el('div', { id: 'search-results-panel', class: 'search-results-panel', style: 'display:none' });
  resultsPanel.appendChild(el('div', { id: 'search-results-content', class: 'search-results' }));
  scrollable.appendChild(resultsPanel);

  // Children navigation
  const childrenNav = renderChildren(route.dirPath, config.contentPaths);
  if (childrenNav) scrollable.appendChild(childrenNav);

  // Render document items
  for (const item of doc.items) {
    scrollable.appendChild(renderSubitem(item));
  }

  container.appendChild(scrollable);
  target.appendChild(container);

  target.appendChild(createStatusBar());

  // Wire up copy-to-clipboard
  setupCopyHandler(target);
}
