/** Editor view: loads veditor.web, fetches file, handles save. */


import { getFileContent, updateFileContent } from './github.ts';
import { setVeditorVersion } from './status-bar.ts';
import { escapeHtml, errorMessage } from './utils.ts';

// veditor base URL — must be set via VITE_VEDITOR_BASE at build time.
const VEDITOR_BASE = import.meta.env.VITE_VEDITOR_BASE as string | undefined;

// veditor API — populated on first use.
let veditor: typeof import('./veditor.d.ts') | null = null;
let veditorCssLoaded = false;
const CACHE_BUST = `v=${Date.now()}`;

async function loadVeditor(): Promise<typeof import('./veditor.d.ts')> {
  if (veditor) return veditor;

  if (!VEDITOR_BASE) {
    throw new Error('VITE_VEDITOR_BASE not set at build time');
  }

  // Load CSS once
  if (!veditorCssLoaded) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${VEDITOR_BASE}/veditor.css?${CACHE_BUST}`;
    document.head.appendChild(link);
    veditorCssLoaded = true;
  }

  veditor = await import(/* @vite-ignore */ `${VEDITOR_BASE}/veditor.js?${CACHE_BUST}`);
  if (veditor!.VERSION) setVeditorVersion(veditor!.VERSION);
  return veditor!;
}

/** Show the editor for a given content path. */
export async function showEditor(
  target: HTMLElement,
  host: string,
  token: string,
  owner: string,
  repo: string,
  dirPath: string,
): Promise<void> {
  const contentPath = dirPath ? `text/${dirPath}/README.md` : 'text/README.md';

  target.innerHTML = `<div class="editor-loading">Loading editor...</div>`;

  // Load veditor + file in parallel
  let ved: typeof import('./veditor.d.ts');
  let content: string;
  let sha: string;

  try {
    const [v, file] = await Promise.all([
      loadVeditor(),
      getFileContent(host, token, owner, repo, contentPath),
    ]);
    ved = v;
    content = file.content;
    sha = file.sha;
  } catch (err) {
    target.innerHTML = `
      <div class="editor-loading" style="flex-direction:column;gap:1rem;">
        <div style="color:#f38ba8;">Failed to load editor</div>
        <div style="font-size:0.85rem;">${escapeHtml(errorMessage(err))}</div>
      </div>
    `;
    return;
  }

  let originalContent = content;
  let fileSha = sha;

  // Render editor UI
  target.innerHTML = `
    <div class="editor-screen">
      <header>
        <a class="filename" href="https://${escapeHtml(host)}/${escapeHtml(owner)}/${escapeHtml(repo)}/blob/main/${escapeHtml(contentPath)}" target="_blank" rel="noopener noreferrer">${escapeHtml(contentPath)}</a>
        <span id="status-msg"></span>
      </header>
      <div id="editor-container"></div>
    </div>
  `;

  function showStatus(msg: string, isError = false): void {
    const el = document.getElementById('status-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = isError ? 'error' : 'success';
    if (!isError) {
      setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2000);
    }
  }

  async function handleSave(): Promise<void> {
    const currentContent = ved.getEditorContent();
    if (currentContent === originalContent) {
      showStatus('No changes');
      return;
    }

    const filename = contentPath.split('/').pop() ?? contentPath;
    const message = `Update ${filename} via metabrowse editor`;

    try {
      showStatus('Saving...');
      const newSha = await updateFileContent(
        host, token, owner, repo, contentPath,
        currentContent, fileSha, message,
      );
      originalContent = currentContent;
      fileSha = newSha;
      showStatus('Saved');
    } catch (err) {
      showStatus(`Save failed: ${errorMessage(err)}`, true);
    }
  }

  function handleQuit(): void {
    const browseHash = dirPath ? `#/${dirPath}` : '#/';
    location.hash = browseHash;
  }

  ved.createEditor(document.getElementById('editor-container')!, originalContent, {
    onSave: handleSave,
    onQuit: handleQuit,
  }, {
    storagePrefix: 'metabrowse',
    autoSaveMs: ved.getAutoSaveMs(),
  });
}
