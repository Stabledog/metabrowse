/** Workspace support: capture, open, and update browser tab sessions via barouse. */

import { generateTarget } from './transformer.ts';
import { getFileContent, updateFileContent, createFile } from './github.ts';
import { removeCachedContent } from './cache.ts';
import { logInfo, logError } from './logging-client.ts';
import type { Route } from './router.ts';
import { pushModal, popModal } from './modal-stack.ts';
import { showToast, errorMessage } from './utils.ts';

// ── Types ──────────────────────────────────────────────────────────

export interface Tab {
  url: string;
  title: string;
  index: number;
  pinned: boolean;
}

// ── Barouse communication ──────────────────────────────────────────

const PING_TIMEOUT_MS = 500;
const API_TIMEOUT_MS = 5000;

function sendBarouseMessage<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = type === 'barouse:ping' ? PING_TIMEOUT_MS : API_TIMEOUT_MS;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`barouse ${type} timed out`));
    }, timeout);

    function handler(event: MessageEvent) {
      if (event.data?.type !== type + '-result') return;
      cleanup();
      if (event.data.error) {
        reject(new Error(`barouse ${type} failed`));
      } else {
        resolve(event.data.payload as T);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('message', handler);
    }

    window.addEventListener('message', handler);
    window.postMessage({ type, payload }, '*');
  });
}

export async function detectBarouse(): Promise<boolean> {
  try {
    const result = await sendBarouseMessage<{ installed: boolean; version: string }>('barouse:ping');
    return !!result?.installed;
  } catch {
    return false;
  }
}

function isCapturableUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}

export async function queryTabs(windowId?: number): Promise<Tab[]> {
  const tabs = await sendBarouseMessage<Tab[]>('barouse:query-tabs', windowId != null ? { windowId } : undefined);
  const self = location.href;
  return tabs.filter((t) => t.url !== self && isCapturableUrl(t.url));
}

interface OpenWorkspaceResult {
  windowId: number;
  tabCount: number;
}

// Map content path → windowId for workspace windows opened in this session
const workspaceWindows = new Map<string, number>();

export function getWorkspaceWindowId(contentPath: string): number | undefined {
  return workspaceWindows.get(contentPath);
}

export async function openAsWorkspace(urls: string[], contentPath?: string): Promise<OpenWorkspaceResult> {
  const result = await sendBarouseMessage<OpenWorkspaceResult>('barouse:open-workspace', { urls });
  if (contentPath && result?.windowId) {
    workspaceWindows.set(contentPath, result.windowId);
  }
  return result;
}

// ── URL extraction from lines ──────────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s<>"')}\]]+/;

function extractUrl(line: string): string | null {
  const m = line.match(URL_RE);
  return m ? m[0] : null;
}

// ── Line cache: urlHash → original line text ───────────────────────
// Populated as the user browses metabrowse pages. When a tab was opened
// via metabrowse, the cache lets capture/update preserve the user's
// anchor text and comments instead of using the browser's page title.

const lineCache = new Map<string, string>();

/** Scan raw markdown content and cache every line that contains a URL. */
export function cachePageLines(content: string): void {
  for (const line of content.split('\n')) {
    const url = extractUrl(line);
    if (url) {
      lineCache.set(generateTarget(url), line);
    }
  }
}

/** Look up a cached line by URL hash. */
function getCachedLine(hash: string): string | undefined {
  return lineCache.get(hash);
}

// ── Merge logic ────────────────────────────────────────────────────

export function mergeWorkspace(existingContent: string, incomingTabs: Tab[]): string {
  const lines = existingContent.split('\n');

  // Build map of existing keyed lines: hash → {lineText, originalIndex}
  const existingByHash = new Map<string, string>();
  const isKeyed: boolean[] = [];

  for (const line of lines) {
    const url = extractUrl(line);
    if (url) {
      const hash = generateTarget(url);
      existingByHash.set(hash, line);
      isKeyed.push(true);
    } else {
      isKeyed.push(false);
    }
  }

  // Build incoming keyed set: hash → formatted line (for new entries only)
  // Check the line cache first — if the user opened this tab from a metabrowse
  // page, we can preserve their anchor text and comments.
  const incomingHashes: string[] = [];
  const incomingNewLines = new Map<string, string>();
  for (const tab of incomingTabs) {
    const hash = generateTarget(tab.url);
    incomingHashes.push(hash);
    if (!existingByHash.has(hash)) {
      const cached = getCachedLine(hash);
      incomingNewLines.set(hash, cached ?? `- ${tab.title} ${tab.url}`);
    }
  }

  const incomingSet = new Set(incomingHashes);

  // Collect surviving keyed lines (verbatim) and new lines, in incoming order
  const orderedKeyed: string[] = [];
  for (const hash of incomingHashes) {
    if (existingByHash.has(hash)) {
      orderedKeyed.push(existingByHash.get(hash)!);
    } else {
      orderedKeyed.push(incomingNewLines.get(hash)!);
    }
  }

  // Detect the typical indent for keyed lines (for new entries)
  let typicalIndent = '';
  for (let i = 0; i < lines.length; i++) {
    if (isKeyed[i]) {
      const match = lines[i].match(/^(\s*)/);
      if (match) { typicalIndent = match[1]; break; }
    }
  }

  // Apply indent to new entries that don't have one
  for (let i = 0; i < orderedKeyed.length; i++) {
    const hash = incomingHashes[i];
    if (incomingNewLines.has(hash) && typicalIndent) {
      orderedKeyed[i] = typicalIndent + orderedKeyed[i];
    }
  }

  // Interleave: unkeyed lines stay anchored, keyed lines placed in new order.
  // Strategy: walk existing lines, keep unkeyed lines in place, replace keyed
  // slots with ordered keyed lines (consuming from the front), then append
  // any remaining keyed lines at the end.
  const result: string[] = [];
  let keyedIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!isKeyed[i]) {
      result.push(lines[i]);
    } else {
      const url = extractUrl(lines[i])!;
      const hash = generateTarget(url);
      if (incomingSet.has(hash) && keyedIdx < orderedKeyed.length) {
        result.push(orderedKeyed[keyedIdx++]);
      }
      // Removed keyed lines (not in incoming set) are simply skipped
    }
  }

  // Append any remaining keyed lines (new tabs that had no existing slot)
  while (keyedIdx < orderedKeyed.length) {
    result.push(orderedKeyed[keyedIdx++]);
  }

  return result.join('\n');
}

// ── Update diff computation ───────────────────────────────────────

interface UpdateDiff {
  kept: Array<{ url: string; title: string }>;
  added: Array<{ url: string; title: string }>;
  removed: Array<{ url: string; title: string }>;
}

function computeUpdateDiff(existingContent: string, incomingTabs: Tab[]): UpdateDiff {
  const existingByHash = new Map<string, { url: string; title: string }>();
  for (const line of existingContent.split('\n')) {
    const url = extractUrl(line);
    if (url) {
      const hash = generateTarget(url);
      const titleText = line.replace(url, '').replace(/^\s*-\s*/, '').replace(/\s*#.*$/, '').trim();
      existingByHash.set(hash, { url, title: titleText || url });
    }
  }

  const incomingByHash = new Map<string, { url: string; title: string }>();
  for (const tab of incomingTabs) {
    const hash = generateTarget(tab.url);
    incomingByHash.set(hash, { url: tab.url, title: tab.title || tab.url });
  }

  const kept: UpdateDiff['kept'] = [];
  const added: UpdateDiff['added'] = [];
  const removed: UpdateDiff['removed'] = [];

  for (const [hash, info] of incomingByHash) {
    if (existingByHash.has(hash)) {
      kept.push(info);
    } else {
      added.push(info);
    }
  }

  for (const [hash, info] of existingByHash) {
    if (!incomingByHash.has(hash)) {
      removed.push(info);
    }
  }

  return { kept, added, removed };
}

// ── Update confirmation modal ─────────────────────────────────────

function showUpdateConfirmModal(
  contentPath: string,
  diff: UpdateDiff,
  tabCount: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'drop-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'drop-modal';
    panel.style.width = '500px';
    panel.style.maxHeight = '80vh';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    const header = document.createElement('div');
    header.className = 'drop-modal-header';
    header.textContent = `Update Workspace (${tabCount} tabs)`;
    panel.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'flex:1; overflow-y:auto; padding:8px 14px; font-size:12px; color:#ccc;';

    const targetEl = document.createElement('div');
    targetEl.style.cssText = 'color:#aaa; padding:4px 0; font-size:11px;';
    targetEl.textContent = `Target: ${contentPath}`;
    body.appendChild(targetEl);

    const warning = document.createElement('div');
    warning.className = 'update-confirm-warning';
    warning.textContent = 'This will add new links and remove old links from the target page.';
    body.appendChild(warning);

    function addSection(
      label: string, items: Array<{ url: string; title: string }>,
      color: string, extraClass?: string,
    ): void {
      const heading = document.createElement('div');
      heading.style.cssText = `color:${color}; font-weight:bold; padding:6px 0 2px;`;
      heading.textContent = `${label} (${items.length}):`;
      body.appendChild(heading);
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
        if (extraClass) row.classList.add(extraClass);
        row.textContent = item.title;
        row.title = item.url;
        body.appendChild(row);
      }
    }

    if (diff.removed.length > 0) {
      addSection('Will be removed', diff.removed, '#f38ba8', 'update-confirm-removed');
    }
    if (diff.added.length > 0) {
      addSection('Will be added', diff.added, '#a6e3a1');
    }
    if (diff.kept.length > 0) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.style.cssText = 'color:#888; font-size:12px; padding:6px 0 2px; cursor:pointer;';
      summary.textContent = `Unchanged (${diff.kept.length})`;
      details.appendChild(summary);
      for (const item of diff.kept) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#888;';
        row.textContent = item.title;
        row.title = item.url;
        details.appendChild(row);
      }
      body.appendChild(details);
    }

    panel.appendChild(body);

    const form = document.createElement('form');
    form.className = 'drop-modal-form';
    form.innerHTML = `
      <div class="drop-modal-buttons">
        <button type="submit" class="drop-modal-ok">Update</button>
        <button type="button" class="drop-modal-cancel">Cancel</button>
      </div>
    `;
    panel.appendChild(form);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    pushModal(overlay);

    const cancelBtn = panel.querySelector('.drop-modal-cancel') as HTMLButtonElement;
    cancelBtn.focus();

    function dismiss(result: boolean) {
      popModal(overlay);
      overlay.remove();
      resolve(result);
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); dismiss(true); });
    cancelBtn.addEventListener('click', () => dismiss(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(false); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(false); });
  });
}

// ── Tab → markdown formatting ──────────────────────────────────────

export function formatTabsAsMarkdown(name: string, tabs: Tab[]): string {
  const lines = [`# ${name}`];
  for (const tab of tabs) {
    const hash = generateTarget(tab.url);
    const cached = getCachedLine(hash);
    lines.push(cached ?? `- ${tab.title} ${tab.url}`);
  }
  return lines.join('\n') + '\n';
}

// ── Collect page link URLs from the DOM ────────────────────────────

export function collectPageUrls(container: HTMLElement): string[] {
  const anchors = container.querySelectorAll<HTMLAnchorElement>(
    '.links a, .group-links a, .sublevel-links a'
  );
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    const href = a.href;
    if (href && !seen.has(href)) {
      seen.add(href);
      urls.push(href);
    }
  }
  return urls;
}

// ── Capture modal ──────────────────────────────────────────────────

function showCaptureModal(tabs: Tab[]): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'drop-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'drop-modal';
    panel.style.width = '450px';
    panel.style.maxHeight = '70vh';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    const header = document.createElement('div');
    header.className = 'drop-modal-header';
    header.textContent = `Capture Workspace (${tabs.length} tabs)`;
    panel.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = 'flex:1; overflow-y:auto; padding:8px 14px; font-size:12px; color:#ccc; max-height:40vh;';
    for (const tab of tabs) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
      row.textContent = tab.title || tab.url;
      row.title = tab.url;
      list.appendChild(row);
    }
    panel.appendChild(list);

    const form = document.createElement('form');
    form.className = 'drop-modal-form';
    form.innerHTML = `
      <label>Workspace name
        <input type="text" id="ws-name" placeholder="my-workspace" required />
      </label>
      <div class="drop-modal-buttons">
        <button type="submit" class="drop-modal-ok">Create</button>
        <button type="button" class="drop-modal-cancel">Cancel</button>
      </div>
    `;
    panel.appendChild(form);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    pushModal(overlay);

    const nameInput = panel.querySelector('#ws-name') as HTMLInputElement;
    nameInput.focus();

    function dismiss(result: string | null) {
      popModal(overlay);
      overlay.remove();
      resolve(result);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (name) dismiss(name);
    });

    panel.querySelector('.drop-modal-cancel')!.addEventListener('click', () => dismiss(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(null); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(null); });
  });
}

// ── Workspace actions ──────────────────────────────────────────────

export interface WorkspaceConfig {
  host: string;
  token: string;
  owner: string;
  repo: string;
  route: Route;
  onSaved: () => void;
  refreshTree: () => Promise<string[]>;
}

export async function handleOpenAll(container: HTMLElement, config: WorkspaceConfig): Promise<void> {
  const urls = collectPageUrls(container);
  if (urls.length === 0) {
    showToast('No links found on this page');
    return;
  }
  logInfo(`Workspace: Opening ${urls.length} links in new window`);
  try {
    const result = await openAsWorkspace(urls, config.route.contentPath);
    logInfo(`Workspace: Opened window ${result.windowId} with ${result.tabCount} tabs`);
    showToast(`Opened ${urls.length} tabs in new window`);
  } catch (err) {
    const msg = errorMessage(err);
    logError(`Workspace: Failed to open: ${msg}`);
    showToast(`Failed to open workspace: ${msg}`);
  }
}

export async function handleCapture(config: WorkspaceConfig): Promise<void> {
  logInfo('Workspace: Starting capture');
  let tabs: Tab[];
  try {
    tabs = await queryTabs();
  } catch (err) {
    const msg = errorMessage(err);
    logError(`Workspace: Failed to query tabs: ${msg}`);
    showToast(`Failed to query tabs: ${msg}`);
    return;
  }

  if (tabs.length === 0) {
    showToast('No tabs to capture');
    return;
  }

  const name = await showCaptureModal(tabs);
  if (!name) return;

  const dirPath = config.route.dirPath;
  const newPath = dirPath ? `text/${dirPath}/${name}/README.md` : `text/${name}/README.md`;
  const content = formatTabsAsMarkdown(name.replace(/[-_]/g, ' '), tabs);

  try {
    logInfo(`Workspace: Creating ${newPath}`);
    await createFile(
      config.host, config.token, config.owner, config.repo,
      newPath, content, `Capture workspace: ${name}`,
    );
    removeCachedContent(newPath);
    await config.refreshTree();
    const navPath = dirPath ? `${dirPath}/${name}` : name;
    location.hash = `#/${navPath}`;
    showToast(`Workspace "${name}" created`);
  } catch (err) {
    const msg = errorMessage(err);
    logError(`Workspace: Failed to create: ${msg}`);
    showToast(`Failed to create workspace: ${msg}`);
  }
}

export async function handleUpdate(config: WorkspaceConfig): Promise<void> {
  const storedWindowId = getWorkspaceWindowId(config.route.contentPath);
  logInfo(`Workspace: Starting update${storedWindowId ? ` (window ${storedWindowId})` : ' (current window)'}`);
  let tabs: Tab[];
  try {
    tabs = await queryTabs(storedWindowId);
  } catch {
    // Window may have been closed — fall back to current window
    if (storedWindowId) {
      logInfo('Workspace: Stored window not found, falling back to current window');
      try {
        tabs = await queryTabs();
      } catch (err) {
        const msg = errorMessage(err);
        logError(`Workspace: Failed to query tabs: ${msg}`);
        showToast(`Failed to query tabs: ${msg}`);
        return;
      }
    } else {
      showToast('Failed to query tabs');
      return;
    }
  }

  if (tabs.length === 0) {
    showToast('No tabs to update from');
    return;
  }

  const contentPath = config.route.contentPath;
  try {
    logInfo(`Workspace: Updating ${contentPath}`);
    const { content, sha } = await getFileContent(
      config.host, config.token, config.owner, config.repo, contentPath,
    );
    const diff = computeUpdateDiff(content, tabs);
    const confirmed = await showUpdateConfirmModal(contentPath, diff, tabs.length);
    if (!confirmed) return;
    const merged = mergeWorkspace(content, tabs);
    await updateFileContent(
      config.host, config.token, config.owner, config.repo,
      contentPath, merged, sha, `Update workspace from browser tabs`,
    );
    removeCachedContent(contentPath);
    showToast(`Workspace updated (${tabs.length} tabs)`);
    config.onSaved();
  } catch (err) {
    const msg = errorMessage(err);
    logError(`Workspace: Failed to update: ${msg}`);
    showToast(`Failed to update workspace: ${msg}`);
  }
}
