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
  parseBlobHash, resolveRef, detectLineEndings, toEditorText, toFileText, describeSaveError,
  veditorSupported, MIN_VEDITOR, UPSTREAM_CHANGED, UPSTREAM_DELETED,
} from './blob-route.ts';
import {
  draftKey, readDraft, writeDraft, removeOwnDraft, pruneDrafts, draftDecision, newInstanceId,
} from './drafts.ts';
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

/** Leave the editor: tell barouse when framed, otherwise close the window. */
function closeEditor(target: HTMLElement): void {
  if (framed) {
    window.parent.postMessage({ type: 'barouse:editor-closed' }, '*');
    return;
  }
  window.close();
  // Still here: the tab wasn't opened by script, so it can't close itself.
  showMessage(target, 'Editor closed', 'You can close this tab.');
}

export async function initFileEditor(target: HTMLElement): Promise<void> {
  // Editing the hash in place means a different file (or the app): start over.
  window.addEventListener('hashchange', () => location.reload());

  // Barouse can ask us to quit at any point. Only a live editor has anything to
  // confirm; before that (loading, or a draft prompt, which a quit answers with
  // Keep) we close as soon as we can, and after it (an error shown, or already
  // closed) straight away.
  let state: 'loading' | 'editing' | 'done' = 'loading';
  let quitRequested = false;
  let cancelOffer: (() => void) | null = null;
  let ved: typeof import('./veditor.d.ts');
  if (framed) {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== 'barouse:request-quit') return;
      if (state === 'editing') ved.requestQuit();
      else if (state === 'done') closeEditor(target);
      else { quitRequested = true; cancelOffer?.(); }
    });
  }
  const fail = (title: string, detailHtml = ''): void => {
    state = 'done';
    showMessage(target, title, detailHtml);
    if (quitRequested) closeEditor(target);
  };

  const parsed = parseBlobHash(location.hash);
  if (!parsed) {
    fail('Not a file URL', 'Expected <code>#/blob/&lt;owner&gt;/&lt;repo&gt;/&lt;branch&gt;/&lt;path&gt;</code>.');
    return;
  }
  const { owner, repo } = parsed;
  const host = localStorage.getItem(LS_HOST) || DEFAULT_HOST;
  const token = localStorage.getItem(LS_TOKEN) || '';
  const signIn = `<a href="${escapeHtml(import.meta.env.BASE_URL)}" target="_blank" rel="noopener">Sign in to metabrowse</a> once, then reload.`;
  if (!token) {
    fail('Not signed in', signIn);
    return;
  }

  target.innerHTML = `<div class="editor-loading">Loading editor...</div>`;

  let ref: string;
  let path: string;
  let sha: string;
  let fileText: string;
  try {
    const [v] = await Promise.all([loadVeditor(), checkRepo(host, token, owner, repo)]);
    ved = v;
    if (!veditorSupported(ved.VERSION)) {
      fail(`veditor ${String(ved.VERSION)} is too old`,
        `The file editor needs veditor ${MIN_VEDITOR.join('.')} or newer. Redeploy veditor.web.`);
      return;
    }
    const split = await resolveRef(parsed.rest, name => branchExists(host, token, owner, repo, name));
    if (!split) {
      fail(`Not a branch: ${parsed.rest[0]}`, 'Open the file from a branch to edit it.');
      return;
    }
    ({ ref, path } = split);
    const file = await getFileContent(host, token, owner, repo, path, { ref, noStore: true });
    sha = file.sha;
    fileText = file.content;
  } catch (err) {
    logError(`FileEditor: load failed: ${errorMessage(err)}`);
    if (err instanceof ApiError && err.status === 401) {
      fail('Token rejected', signIn);
    } else if (err instanceof ApiError && err.status === 404) {
      fail(`Not found: ${owner}/${repo}`, 'The repo or file doesn\'t exist, or your token can\'t read it.');
    } else {
      fail('Failed to load editor', escapeHtml(errorMessage(err)));
    }
    return;
  }

  const eol = detectLineEndings(fileText);
  if (eol === 'mixed') {
    fail('Mixed line endings',
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
  const editorText = toEditorText(fileText, eol);

  // --- An existing draft? Settled before the editor exists, so nothing typed goes undrafted ---

  const key = draftKey({ host, owner, repo, ref, path });
  if (quitRequested) {
    // Asked to quit while loading: nothing typed yet, and any draft is left
    // alone (Keep), rather than waiting on a prompt nobody asked for.
    state = 'done';
    closeEditor(target);
    return;
  }
  pruneDrafts(localStorage, Date.now());
  const draft = readDraft(localStorage, key);
  const decision = draftDecision(draft, sha, editorText);
  // An older draft the user chose to keep: never overwrite it.
  let draftKept = false;
  let restoreText: string | null = null;
  if (!draft || decision === 'none') {
    localStorage.removeItem(key);
  } else {
    const when = new Date(draft.savedAt).toLocaleString();
    const offer = decision === 'restore'
      ? offerDraft(screen, `Unsaved draft from ${when}.`, [['r', 'Restore'], ['d', 'Discard'], ['k', 'Keep']])
      : offerDraft(screen, `Draft from ${when} is based on an older version of this file. Copy what you need from it, then:`,
        [['d', 'Discard'], ['k', 'Keep']], draft.text);
    cancelOffer = offer.cancel;
    const choice = await offer.choice;
    cancelOffer = null;
    if (quitRequested) {
      state = 'done';
      closeEditor(target);
      return;
    }
    if (choice === 'r') restoreText = draft.text;
    else if (choice === 'd') localStorage.removeItem(key);
    else draftKept = true;
  }

  // --- Drafts: written while the buffer differs from the last commit ---

  const instance = newInstanceId();
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  // A commit failed because the file changed upstream: quitting keeps the draft.
  let baseStale = false;

  /** Returns whether the edits are safe: drafted, or nothing to draft. */
  const flushDraft = (): boolean => {
    if (draftTimer !== null) { clearTimeout(draftTimer); draftTimer = null; }
    if (draftKept || state !== 'editing') return false;
    const text = ved.getEditorContent();
    if (toFileText(text, eol) === fileText) {
      removeOwnDraft(localStorage, key, instance);
      return true;
    }
    if (!writeDraft(localStorage, key, { text, baseSha: sha, savedAt: Date.now(), instance })) {
      showEditorStatus('Draft not saved: storage full', true);
      return false;
    }
    return true;
  };

  const onChange = (): void => {
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 500);
  };
  window.addEventListener('pagehide', flushDraft);

  // One commit at a time: a second :w would send a stale sha, or replace the
  // commit bar and leave the first save's promise hanging.
  let saving = false;

  const onSave = async (): Promise<boolean | void> => {
    if (saving) {
      screen.querySelector<HTMLInputElement>('.commit-prompt input')?.focus();
      showEditorStatus('A commit is already in progress');
      return false;
    }
    saving = true;
    try {
      return await commit();
    } finally {
      saving = false;
    }
  };

  const commit = async (): Promise<boolean | void> => {
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
      baseStale = false;
      flushDraft(); // deletes it, unless there were edits during the commit
      showEditorStatus(`Committed to ${ref}`);
    } catch (err) {
      logError(`FileEditor: commit failed: ${errorMessage(err)}`);
      const baseSha = sha;
      let msg = await describeSaveError(err, {
        owner, repo, ref, baseSha,
        currentSha: async () => (await getFileContent(host, token, owner, repo, path, { ref, noStore: true })).sha,
      });
      // Changed upstream: the draft keeps the edits, and the next open offers it
      // as stale. Deleted upstream: nothing would ever offer it, so the edits
      // must be copied now. So must they when no draft could be written.
      let copyNow = '';
      if (msg === UPSTREAM_CHANGED) {
        baseStale = true;
        if (flushDraft()) msg += ' Your edits are kept as a draft; reopen the file to see the change.';
        else copyNow = draftKept ? 'Drafts are off (an older one was kept).' : 'Your edits couldn\'t be saved as a draft (storage full).';
      } else if (msg === UPSTREAM_DELETED) {
        copyNow = 'It can\'t be committed here.';
      } else {
        flushDraft();
      }
      showEditorStatus(msg, true);
      if (copyNow) {
        // Not awaited: the save settles now, and the bar stays until closed (or the next :w).
        void offerDraft(screen, `${msg} ${copyNow} Copy your edits now, then:`, [['c', 'Close']], ved.getEditorContent())
          .choice.then(() => ved.focusEditor());
      }
      return false;
    }
  };

  const onQuit = (): void => {
    // Reached when clean, after Discard, or :q!. The draft goes too, unless the
    // file changed upstream: then the next open offers it as stale.
    if (baseStale) flushDraft();
    else if (!draftKept) removeOwnDraft(localStorage, key, instance);
    if (draftTimer !== null) { clearTimeout(draftTimer); draftTimer = null; }
    state = 'done';
    ved.destroyEditor();
    closeEditor(target);
  };

  ved.createEditor(document.getElementById('editor-container')!, editorText, { onSave, onQuit, onChange }, {
    storagePrefix: 'metabrowse',
    autoSaveMs: 0, // onSave commits to someone's repo: never on a timer
    initialBufferId: path,
    initialBufferLabel: name,
  });
  state = 'editing';
  if (restoreText !== null) {
    ved.setEditorContent(restoreText, { markSaved: false });
    showEditorStatus('Draft restored');
  } else if (draftKept) {
    showEditorStatus('Older draft kept: new drafts are off until you reopen this file and deal with it.', true);
  }
  ved.focusEditor();
  if (quitRequested) ved.requestQuit();
}

/**
 * Offer choices in a bar under the editor: for an existing draft, or edits that
 * must be copied now. Each choice is [key, label]; Enter picks the first, Esc
 * the last (Keep, or Close). With `show`, that text is shown read-only and
 * selected for copying: the one way to copy, as it works in a sidebar iframe,
 * where the clipboard API may not.
 */
function offerDraft(
  screen: HTMLElement, text: string, choices: Array<[string, string]>, show?: string,
): { choice: Promise<string>; cancel: () => void } {
  const bar = document.createElement('div');
  bar.className = 'commit-prompt draft-prompt';
  bar.tabIndex = -1;
  const label = document.createElement('span');
  label.textContent = text;
  bar.appendChild(label);
  let copyFrom: HTMLTextAreaElement | null = null;
  if (show) {
    copyFrom = document.createElement('textarea');
    copyFrom.className = 'draft-text';
    copyFrom.readOnly = true;
    copyFrom.spellcheck = false;
    copyFrom.value = show;
    bar.appendChild(copyFrom);
  }
  screen.appendChild(bar);

  let finish: (k: string) => void = () => {};
  const choice = new Promise<string>((resolve) => {
    finish = (k: string) => { bar.remove(); resolve(k); };
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
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+C in the draft text
      // Enter restores; with text to copy it does nothing, so a stray Enter can't discard it.
      const last = choices[choices.length - 1][0];
      const k = e.key === 'Enter' ? (show ? '' : choices[0][0]) : e.key === 'Escape' ? last : e.key.toLowerCase();
      if (choices.some(([c]) => c === k)) { e.preventDefault(); finish(k); }
    });
  });
  if (copyFrom) {
    copyFrom.focus();
    copyFrom.select();
  } else {
    bar.focus();
  }
  return { choice, cancel: () => finish(choices[choices.length - 1][0]) };
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
  // :w runs inside the vim ex dialog, which refocuses the editor after the
  // command returns, taking focus back from the bar; reclaim it on the next tick.
  setTimeout(() => {
    if (bar.isConnected && document.activeElement !== input) {
      input.focus();
      input.select();
    }
  }, 0);

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
