/** Editor view: loads veditor.web, fetches file, handles save. */


import { getFileContent, updateFileContent } from './github.ts';
import { setVeditorVersion } from './status-bar.ts';
import { escapeHtml, errorMessage, basename, contentPathFor } from './utils.ts';
import type { VEditorCallbacks } from './veditor.d.ts';

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

function dirLabel(dirPath: string): string {
  if (!dirPath) return 'home';
  return basename(dirPath);
}

/** Show the editor for a given content path. */
export async function showEditor(
  target: HTMLElement,
  host: string,
  token: string,
  owner: string,
  repo: string,
  dirPath: string,
  contentPaths: string[],
): Promise<void> {
  const contentPath = contentPathFor(dirPath);

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

  function updateHeader(id: string): void {
    const path = contentPathFor(id);
    const el = target.querySelector<HTMLAnchorElement>('.filename');
    if (!el) return;
    el.textContent = path;
    el.href = `https://${host}/${owner}/${repo}/blob/main/${path}`;
  }

  function handleQuit(): void {
    const browseHash = dirPath ? `#/${dirPath}` : '#/';
    location.hash = browseHash;
  }

  // --- Multi-buffer callbacks (shared across all buffers) ---

  const documentList = contentPaths.map(p => ({ id: p, label: dirLabel(p) }));

  async function onListDocuments() {
    return documentList;
  }

  function makeBufferCallbacks(bufDirPath: string, initialSha: string, initialContent: string): VEditorCallbacks {
    let fileSha = initialSha;
    let originalContent = initialContent;
    const bufContentPath = contentPathFor(bufDirPath);

    return {
      onSave: async () => {
        const currentContent = ved.getEditorContent();
        if (currentContent === originalContent) {
          showStatus('No changes');
          return;
        }
        const filename = basename(bufContentPath);
        const message = `Update ${filename} via metabrowse editor`;
        try {
          showStatus('Saving...');
          const newSha = await updateFileContent(
            host, token, owner, repo, bufContentPath,
            currentContent, fileSha, message,
          );
          originalContent = currentContent;
          fileSha = newSha;
          showStatus('Saved');
        } catch (err) {
          showStatus(`Save failed: ${errorMessage(err)}`, true);
        }
      },
      onQuit: handleQuit,
      onListDocuments,
      onLoadDocument,
      onBufferSwitch,
    };
  }

  async function onLoadDocument(id: string) {
    const path = contentPathFor(id);
    const file = await getFileContent(host, token, owner, repo, path);
    return {
      content: file.content,
      label: dirLabel(id),
      callbacks: makeBufferCallbacks(id, file.sha, file.content),
    };
  }

  function onBufferSwitch(id: string, _label: string): void {
    updateHeader(id);
    const hash = id ? `#/edit/${id}` : '#/edit';
    history.replaceState(null, '', hash);
  }

  // --- Create editor with initial buffer ---

  const initialCallbacks = makeBufferCallbacks(dirPath, sha, content);

  ved.createEditor(document.getElementById('editor-container')!, content, initialCallbacks, {
    storagePrefix: 'metabrowse',
    autoSaveMs: ved.getAutoSaveMs(),
    initialBufferId: dirPath,
    initialBufferLabel: dirLabel(dirPath),
  });
}
