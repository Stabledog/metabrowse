/** App shell: auth, data fetching, routing. */

import { validateToken, getTree, getRawContent, extractContentPaths, DEFAULT_HOST } from './github.ts';
import type { TreeEntry } from './github.ts';
import { getCachedTree, setCachedTree, getCachedContent, setCachedContent } from './cache.ts';
import { logError, logWarn, logInfo, logDebug } from './logging-client.ts';
import { startRouter, parseHash } from './router.ts';
import type { Route } from './router.ts';
import { parseContent } from './parser.ts';
import { transform } from './transformer.ts';
import { renderPage } from './renderer.ts';
import { loadFavicons } from './favicon.ts';
import { initSearch, buildEntry } from './search.ts';
import type { SearchEntry } from './search.ts';
import { initKeyboard } from './keyboard.ts';
import { initLinkNav } from './link-nav.ts';
import { showEditor } from './editor.ts';
import { showTreePanel } from './tree-panel.ts';
import { initDropZone, handleSingleLink } from './drop-handler.ts';
import { startNavigation } from './lifecycle.ts';
import { detectBarouse, handleOpenAll, handleCapture, handleUpdate, cachePageLines } from './workspace.ts';
import { escapeHtml, escapeAttr, errorMessage } from './utils.ts';
import type { WorkspaceConfig } from './workspace.ts';

const LS_TOKEN = 'notehub:token';
const LS_HOST = 'notehub:host';
const LS_OWNER = 'metabrowse:owner';
const LS_REPO = 'metabrowse:repo';

const app = document.getElementById('app')!;

let token = '';
let host = DEFAULT_HOST;
let owner = '';
let repo = '';
let tree: TreeEntry[] = [];
let contentPaths: string[] = [];
let searchIndex: SearchEntry[] = [];

export async function init(): Promise<void> {
  host = localStorage.getItem(LS_HOST) || DEFAULT_HOST;
  owner = localStorage.getItem(LS_OWNER) || '';
  repo = localStorage.getItem(LS_REPO) || '';

  const savedToken = localStorage.getItem(LS_TOKEN);
  if (savedToken && owner && repo) {
    try {
      logInfo(`Auth: Attempting to validate token for host=${host}`);
      await validateToken(host, savedToken);
      logInfo(`Auth: Authenticated`);
      token = savedToken;
      await loadApp();
    } catch (err) {
      logError(`Auth: Token validation failed: ${errorMessage(err)}`);
      showAuth();
    }
  } else {
    showAuth();
  }
}

function showAuth(error?: string): void {
  const savedHost = localStorage.getItem(LS_HOST) || DEFAULT_HOST;
  const savedOwner = localStorage.getItem(LS_OWNER) || '';
  const savedRepo = localStorage.getItem(LS_REPO) || '';
  const savedToken = localStorage.getItem(LS_TOKEN) || '';

  app.innerHTML = `
    <div class="auth-screen">
      <h1>metabrowse</h1>
      <p>Authenticate to access your links.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form id="auth-form">
        <label>GitHub Host
          <input type="text" id="host" value="${escapeAttr(savedHost)}" required />
        </label>
        <label>Content Owner
          <input type="text" id="owner" value="${escapeAttr(savedOwner)}" placeholder="org-or-user" required />
        </label>
        <label>Content Repo
          <input type="text" id="repo" value="${escapeAttr(savedRepo)}" placeholder="bb-metabrowse-links" required />
        </label>
        <label>Personal Access Token
          <input type="password" id="pat" value="${escapeAttr(savedToken)}" placeholder="ghp_..." required />
        </label>
        <button type="submit">Connect</button>
      </form>
    </div>
  `;

  document.getElementById('auth-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hostInput = (document.getElementById('host') as HTMLInputElement).value.trim();
    const ownerInput = (document.getElementById('owner') as HTMLInputElement).value.trim();
    const repoInput = (document.getElementById('repo') as HTMLInputElement).value.trim();
    const pat = (document.getElementById('pat') as HTMLInputElement).value.trim();

    try {
      logInfo(`Auth: Attempting to validate token for host=${hostInput}`);
      await validateToken(hostInput, pat);
      logInfo(`Auth: Authenticated`);
      localStorage.setItem(LS_HOST, hostInput);
      localStorage.setItem(LS_OWNER, ownerInput);
      localStorage.setItem(LS_REPO, repoInput);
      localStorage.setItem(LS_TOKEN, pat);
      token = pat;
      host = hostInput;
      owner = ownerInput;
      repo = repoInput;
      await loadApp();
    } catch (err) {
      const msg = errorMessage(err);
      logError(`Auth: Token validation failed: ${msg}`);
      showAuth(`Authentication failed: ${msg}`);
    }
  });
}

async function loadApp(): Promise<void> {
  app.innerHTML = '<div class="loading">Loading...</div>';

  logDebug(`Tree: Config: host=${host} owner=${owner} repo=${repo}`);

  // Fetch tree (use cache as fallback)
  try {
    logInfo(`Tree: Fetching directory tree for ${owner}/${repo}`);
    const entries = await getTree(host, token, owner, repo);
    tree = entries;
    setCachedTree(entries);
  } catch (err) {
    const cached = getCachedTree();
    if (cached) {
      tree = cached;
      logWarn(`Tree: Using cached tree due to network error`);
    } else {
      const msg = errorMessage(err);
      logError(`Tree: Failed to fetch tree: ${msg}`);
      app.innerHTML = `<div class="error">Failed to load content tree: ${escapeHtml(msg)}</div>`;
      return;
    }
  }

  contentPaths = extractContentPaths(tree);
  logInfo(`Tree: Loaded ${contentPaths.length} pages indexed`);

  // Start routing — fires immediately for current hash
  startRouter(handleRoute);

  // Build search index in background (fetch all pages)
  buildSearchIndex();
}

async function buildSearchIndex(): Promise<void> {
  logInfo(`Search: Building index for ${contentPaths.length} pages...`);
  const entries: SearchEntry[] = [];

  // Fetch all pages in parallel
  const results = await Promise.allSettled(
    contentPaths.map(async (dirPath) => {
      const contentPath = dirPath ? `text/${dirPath}/README.md` : 'text/README.md';
      let content = getCachedContent(contentPath);
      if (!content) {
        content = await getRawContent(host, token, owner, repo, contentPath);
        setCachedContent(contentPath, content);
      }
      return { dirPath, content };
    })
  );

  let failed = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      entries.push(buildEntry(result.value.dirPath, result.value.content, contentPaths));
    } else {
      failed++;
    }
  }

  if (failed > 0) {
    logWarn(`Search: Failed to index some pages (${failed}/${contentPaths.length})`);
  }

  searchIndex = entries;
  logInfo(`Search: Search index built: ${entries.length} pages indexed`);
}

async function handleRoute(route: Route): Promise<void> {
  const signal = startNavigation();

  if (route.kind === 'edit') {
    logInfo(`Edit: Opening editor for ${route.contentPath}`);
    await showEditor(app, host, token, owner, repo, route.dirPath, contentPaths);
    return;
  }

  // Check if the path exists in the tree
  if (route.dirPath && !contentPaths.includes(route.dirPath)) {
    logError(`Route: Page not found: ${route.dirPath}`);
    app.innerHTML = `<div class="error">Page not found: ${escapeHtml(route.dirPath)}</div>`;
    return;
  }

  logInfo(`Route: Navigating to #/${route.dirPath || ''}`);

  // Show cached content immediately if available
  const cached = getCachedContent(route.contentPath);
  if (cached) {
    logDebug(`Content: Using cached content for ${route.contentPath}`);
    doRender(route, cached, signal);
  } else {
    app.innerHTML = `<div class="loading">Loading ${escapeHtml(route.dirPath || 'home')}...</div>`;
  }

  // Fetch fresh content
  try {
    logInfo(`Content: Fetching page ${route.dirPath || 'home'} from ${route.contentPath}`);
    const content = await getRawContent(host, token, owner, repo, route.contentPath);
    logInfo(`Content: Loaded ${route.contentPath}`);
    setCachedContent(route.contentPath, content);
    if (content !== cached) {
      doRender(route, content, signal);
    }
  } catch (err) {
    const msg = errorMessage(err);
    if (!cached) {
      logError(`Content: Failed to load ${route.contentPath}: ${msg}`);
      app.innerHTML = `<div class="error">Failed to load: ${escapeHtml(msg)}</div>`;
    } else {
      logWarn(`Content: Failed to refresh ${route.contentPath}, using cache`);
    }
  }
}

function doRender(route: Route, content: string, signal: AbortSignal): void {
  cachePageLines(content);
  const parsed = parseContent(content);
  const title = route.dirPath
    ? route.dirPath.split('/').pop()!.replace(/[-_]/g, ' ')
    : 'Home';
  const doc = transform(parsed, title);

  const handleTreePanel = () => {
    showTreePanel(getAppState(), refreshTree, route.dirPath);
  };

  const wsConfig: WorkspaceConfig = {
    host, token, owner, repo, route,
    onSaved: () => handleRoute(route),
    refreshTree,
  };

  renderPage(app, doc, route, {
    contentPaths,
    owner,
    repo,
    host,
    onTreePanel: handleTreePanel,
    onSettings: () => showAuth(),
    onOpenAll: (container) => handleOpenAll(container, wsConfig),
    onCapture: () => handleCapture(wsConfig),
    onUpdate: () => handleUpdate(wsConfig),
  });

  // Post-render setup
  loadFavicons(app);
  initSearch(app, () => searchIndex);
  initKeyboard(app, { onTreePanel: handleTreePanel }, signal);
  initLinkNav(app, signal);

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type !== 'barouse:activate') return;
    const link = app.querySelector<HTMLLIElement>(
      '.links > li, .group-links > li, .sublevel-links > li',
    );
    if (link) {
      app.querySelector('.link-selected')?.classList.remove('link-selected');
      link.classList.add('link-selected');
      link.scrollIntoView({ block: 'nearest' });
    }
  }, { signal });

  const dropConfig = {
    host, token, owner, repo, route,
    onSaved: () => handleRoute(route),
  };
  initDropZone(app, dropConfig, signal);

  // Listen for barouse tab-capture messages
  if (route.kind === 'browse') {
    window.addEventListener('message', async (e: MessageEvent) => {
      if (e.data?.type !== 'barouse:tab-capture') return;
      const url = e.data.payload?.url;
      if (!url) return;
      (e.source as Window)?.postMessage({ type: 'barouse:tab-capture-ack' }, '*');
      await handleSingleLink(url, dropConfig, 'Barouse');
    }, { signal });

    detectBarouse().then((available) => {
      if (!available || signal.aborted) return;
      for (const btn of app.querySelectorAll<HTMLButtonElement>('.workspace-btn')) {
        btn.disabled = false;
      }
    });
  }
}

/** Export current app state for tree panel. */
export function getAppState() {
  return { token, host, owner, repo, contentPaths, tree };
}

/** Refresh tree, content paths, and search index. Re-renders current route. */
export async function refreshTree(): Promise<string[]> {
  const entries = await getTree(host, token, owner, repo);
  tree = entries;
  setCachedTree(entries);
  contentPaths = extractContentPaths(tree);
  buildSearchIndex();
  handleRoute(parseHash(location.hash));
  return contentPaths;
}
