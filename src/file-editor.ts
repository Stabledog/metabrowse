/**
 * File editor route: #/blob/<owner>/<repo>/<ref...>/<path...>
 *
 * Edits one file on any repo the token can reach, committing to its branch.
 * It skips the content-repo app entirely (no content repo, tree or index), and
 * opens in a popup window or a barouse sidebar iframe.
 */

import { ApiError, DEFAULT_HOST, branchExists, checkRepo, getFileContent, updateFileContent } from './github.ts';
import { loadVeditor, showEditorStatus } from './editor.ts';
import {
  parseBlobHash, resolveRef, detectLineEndings, toEditorText, toFileText, describeSaveError, UPSTREAM_CHANGED,
} from './blob-route.ts';
import { draftKey, readDraft, writeDraft, pruneDrafts, draftDecision } from './drafts.ts';
import type { Draft } from './drafts.ts';
import { escapeHtml, errorMessage, basename } from './utils.ts';
import { logInfo, logError } from './logging-client.ts';

const LS_TOKEN = 'notehub:token';
const LS_HOST = 'notehub:host';

const framed = window.parent !== window;

function showMessage(target: HTMLElement, title: string, detailHtml = ''): void {
  target.innerHTML = `
    <div class="editor-loading" style="flex-direction:column;gap:1rem;padding:1rem;text-align:center;">
      <div style="color:#f38ba8;">${escapeHtml(title)}</div>
      ${detailHtml ? `<div style="font-size:0.85rem;">${detailHtml}</div>` : ''}
    </div>
  `;
}

export async function initFileEditor(target: HTMLElement): Promise<void> {
  // Editing the hash in place means a different file (or the app): start over.
  window.addEventListener('hashchange', () => location.reload());

  const parsed = parseBlobHash(location.hash);
  if (!parsed) {
    showMessage(target, 'Not a file URL', 'Expected <code>#/blob/&lt;owner&gt;/&lt;repo&gt;/&lt;branch&gt;/&lt;path&gt;</code>.');
    return;
  }
  const { owner, repo } = parsed;
  const host = localStorage.getItem(LS_HOST) || DEFAULT_HOST;
  const token = localStorage.getItem(LS_TOKEN) || '';
  const signIn = `<a href="${escapeHtml(import.meta.env.BASE_URL)}" target="_blank" rel="noopener">Sign in to metabrowse</a> once, then reload.`;
  if (!token) {
    showMessage(target, 'Not signed in', signIn);
    return;
  }

  target.innerHTML = `<div class="editor-loading">Loading editor...</div>`;

  let ved: typeof import('./veditor.d.ts');
  let ref: string;
  let path: string;
  let sha: string;
  let fileText: string;
  try {
    const [v] = await Promise.all([loadVeditor(), checkRepo(host, token, owner, repo)]);
    ved = v;
    const split = await resolveRef(parsed.rest, name => branchExists(host, token, owner, repo, name));
    if (!split) {
      showMessage(target, `Not a branch: ${parsed.rest[0]}`, 'Open the file from a branch to edit it.');
      return;
    }
    ({ ref, path } = split);
    const file = await getFileContent(host, token, owner, repo, path, { ref, noStore: true });
    sha = file.sha;
    fileText = file.content;
  } catch (err) {
    logError(`FileEditor: load failed: ${errorMessage(err)}`);
    if (err instanceof ApiError && err.status === 401) {
      showMessage(target, 'Token rejected', signIn);
    } else if (err instanceof ApiError && err.status === 404) {
      showMessage(target, `Not found: ${owner}/${repo}`, 'The repo or file doesn\'t exist, or your token can\'t read it.');
    } else {
      showMessage(target, 'Failed to load editor', escapeHtml(errorMessage(err)));
    }
    return;
  }

  const eol = detectLineEndings(fileText);
  if (eol === 'mixed') {
    showMessage(target, 'Mixed line endings',
      `${escapeHtml(path)} mixes CRLF and LF (or has lone CRs). Saving from the editor would rewrite them, so it can't be edited here.`);
    return;
  }

  const name = basename(path);
  const encodeSegments = (p: string) => p.split('/').map(encodeURIComponent).join('/');
  const blobUrl = `https://${host}/${owner}/${repo}/blob/${encodeSegments(ref)}/${encodeSegments(path)}`;
  document.title = `${name} · veditor`;
  logInfo(`FileEditor: ${owner}/${repo}@${ref}:${path} (${eol})`);

  target.innerHTML = `
    <div class="editor-screen">
      <header>
        <a class="filename" href="${escapeHtml(blobUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(path)}</a>
        <span class="file-ref">${escapeHtml(`${owner}/${repo} @ ${ref}`)}</span>
        <span id="status-msg"></span>
      </header>
      <div id="editor-container"></div>
    </div>
  `;
  const screen = target.querySelector<HTMLElement>('.editor-screen')!;

  // --- Drafts: written while the buffer differs from the last commit ---

  const key = draftKey({ host, owner, repo, ref, path });
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  // True while an existing draft is being offered, or was kept: writing now would overwrite it.
  let draftsPaused = false;
  let closed = false;

  const flushDraft = (): void => {
    if (draftTimer !== null) { clearTimeout(draftTimer); draftTimer = null; }
    if (draftsPaused || closed) return;
    const text = ved.getEditorContent();
    if (toFileText(text, eol) === fileText) {
      localStorage.removeItem(key);
    } else if (!writeDraft(localStorage, key, { text, baseSha: sha, savedAt: Date.now() })) {
      showEditorStatus('Draft not saved: storage full', true);
    }
  };

  const onChange = (): void => {
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 500);
  };
  window.addEventListener('pagehide', flushDraft);

  const onSave = async (): Promise<boolean | void> => {
    const newText = toFileText(ved.getEditorContent(), eol);
    if (newText === fileText) {
      showEditorStatus('No changes');
      return;
    }
    const message = await promptCommitMessage(screen, `Update ${name} via veditor`);
    ved.focusEditor();
    if (message === null) {
      showEditorStatus('Not committed');
      return false;
    }
    try {
      showEditorStatus('Committing...');
      sha = await updateFileContent(host, token, owner, repo, path, newText, sha, message, { branch: ref });
      fileText = newText;
      flushDraft(); // deletes it, unless there were edits during the commit
      showEditorStatus(`Committed to ${ref}`);
    } catch (err) {
      logError(`FileEditor: commit failed: ${errorMessage(err)}`);
      const baseSha = sha;
      let msg = await describeSaveError(err, {
        owner, repo, ref, baseSha,
        currentSha: async () => (await getFileContent(host, token, owner, repo, path, { ref, noStore: true })).sha,
      });
      flushDraft();
      if (msg === UPSTREAM_CHANGED && draftsPaused) msg = 'File changed upstream since you opened it. Copy your edits and reload.';
      showEditorStatus(msg, true);
      return false;
    }
  };

  const onQuit = (): void => {
    // Only reached when clean, after Discard, or :q!: the draft goes too (unless it's an older one being kept).
    closed = true;
    if (draftTimer !== null) { clearTimeout(draftTimer); draftTimer = null; }
    if (!draftsPaused) localStorage.removeItem(key);
    ved.destroyEditor();
    if (framed) {
      window.parent.postMessage({ type: 'barouse:editor-closed' }, '*');
      return;
    }
    window.close();
    // Still here: the tab wasn't opened by script, so it can't close itself.
    showMessage(target, 'Editor closed', 'You can close this tab.');
  };

  if (framed) {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== 'barouse:request-quit') return;
      ved.requestQuit();
    });
  }

  const editorText = toEditorText(fileText, eol);
  ved.createEditor(document.getElementById('editor-container')!, editorText, { onSave, onQuit, onChange }, {
    storagePrefix: 'metabrowse',
    autoSaveMs: 0, // onSave commits to someone's repo: never on a timer
    initialBufferId: path,
    initialBufferLabel: name,
  });

  // --- An existing draft? ---

  pruneDrafts(localStorage, Date.now());
  const draft = readDraft(localStorage, key);
  const decision = draftDecision(draft, sha, editorText);
  if (!draft || decision === 'none') {
    localStorage.removeItem(key);
    return;
  }
  draftsPaused = true;
  const keep = () => {
    showEditorStatus('Older draft kept: new drafts are off until you reopen this file and deal with it.', true);
  };
  const when = new Date(draft.savedAt).toLocaleString();
  if (decision === 'restore') {
    const choice = await offerDraft(screen, `Unsaved draft from ${when}.`, [['r', 'Restore'], ['d', 'Discard'], ['k', 'Keep']]);
    if (choice === 'k') { keep(); return; }
    draftsPaused = false;
    if (choice === 'r') {
      ved.setEditorContent(draft.text, { markSaved: false });
      showEditorStatus('Draft restored');
    } else {
      localStorage.removeItem(key);
    }
  } else {
    const choice = await offerDraft(screen,
      `Draft from ${when} is based on an older version of this file.`, [['c', 'Copy to clipboard'], ['d', 'Discard'], ['k', 'Keep']]);
    if (choice === 'k') { keep(); return; }
    if (choice === 'c' && !(await copyDraft(draft))) return;
    draftsPaused = false;
    localStorage.removeItem(key);
    if (choice === 'c') showEditorStatus('Draft copied to clipboard');
  }
  ved.focusEditor();
}

/** Copy a stale draft to the clipboard. On failure the draft stays (drafts stay paused) and the status says so. */
async function copyDraft(draft: Draft): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(draft.text);
    return true;
  } catch (err) {
    // Sidebar iframes may lack clipboard access. Same fallback as veditor's yank: barouse picks this up
    // from our own window (never post content to the parent), but can't confirm it.
    window.postMessage({ type: 'barouse:clipboard-write', text: draft.text }, '*');
    showEditorStatus(`Couldn't confirm the copy (${errorMessage(err)}). The draft is kept; new drafts are off.`, true);
    return false;
  }
}

/**
 * Offer choices for an existing draft in a bar under the editor. Each choice is
 * [key, label]; Enter picks the first, Esc the last.
 */
function offerDraft(screen: HTMLElement, text: string, choices: Array<[string, string]>): Promise<string> {
  const bar = document.createElement('div');
  bar.className = 'commit-prompt draft-prompt';
  bar.tabIndex = -1;
  const label = document.createElement('span');
  label.textContent = text;
  bar.appendChild(label);
  screen.appendChild(bar);

  return new Promise((resolve) => {
    const finish = (k: string) => { bar.remove(); resolve(k); };
    for (const [k, name] of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'draft-prompt-btn';
      btn.innerHTML = `<u>${escapeHtml(name[0])}</u>${escapeHtml(name.slice(1))}`;
      btn.addEventListener('click', () => finish(k));
      bar.appendChild(btn);
    }
    bar.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const k = e.key === 'Enter' ? choices[0][0] : e.key === 'Escape' ? choices[choices.length - 1][0] : e.key.toLowerCase();
      if (choices.some(([c]) => c === k)) { e.preventDefault(); finish(k); }
    });
    bar.focus();
  });
}

/**
 * Ask for a commit message in a bar under the editor. Resolves the message on
 * Enter (the default if left empty), or null on Escape.
 */
function promptCommitMessage(screen: HTMLElement, defaultMessage: string): Promise<string | null> {
  screen.querySelector('.commit-prompt')?.remove();
  const bar = document.createElement('div');
  bar.className = 'commit-prompt';
  bar.innerHTML = `
    <label for="commit-message">Commit message:</label>
    <input id="commit-message" type="text" spellcheck="false" autocomplete="off" />
    <span class="commit-prompt-hint">Enter to commit · Esc to cancel</span>
  `;
  screen.appendChild(bar);
  const input = bar.querySelector<HTMLInputElement>('input')!;
  input.value = defaultMessage;
  input.focus();
  input.select();

  return new Promise((resolve) => {
    const finish = (result: string | null) => {
      bar.remove();
      resolve(result);
    };
    input.addEventListener('keydown', (e) => {
      // Keep keys away from veditor's and the page's own handlers.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value.trim() || defaultMessage);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    });
  });
}
