/** Drop + paste handler: drop URLs to add single links, paste text to add all links found. */

import type { Route } from './router.ts';
import { getFileContent, updateFileContent } from './github.ts';
import { removeCachedContent } from './cache.ts';
import { logInfo, logError } from './logging-client.ts';
import { pushModal, popModal } from './modal-stack.ts';
import { showToast, escapeAttr, errorMessage } from './utils.ts';

export interface DropConfig {
  host: string;
  token: string;
  owner: string;
  repo: string;
  route: Route;
  onSaved: () => void;
}

/** Show a modal for entering link details. Returns null on cancel. */
function showLinkModal(url: string): Promise<{ title: string; url: string; comment: string } | null> {
  return new Promise((resolve) => {
    // Default title: hostname from URL
    let defaultTitle = url;
    try {
      defaultTitle = new URL(url).hostname.replace(/^www\./, '');
    } catch { /* keep full URL as fallback */ }

    const overlay = document.createElement('div');
    overlay.className = 'drop-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'drop-modal';

    panel.innerHTML = `
      <div class="drop-modal-header">Add Link</div>
      <form class="drop-modal-form">
        <label>Title
          <input type="text" id="drop-title" value="${escapeAttr(defaultTitle)}" />
        </label>
        <label>URL
          <input type="text" id="drop-url" value="${escapeAttr(url)}" />
        </label>
        <label>Comment
          <input type="text" id="drop-comment" placeholder="Optional" />
        </label>
        <div class="drop-modal-buttons">
          <button type="submit" class="drop-modal-ok">OK</button>
          <button type="button" class="drop-modal-cancel">Cancel</button>
        </div>
      </form>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    pushModal(overlay);

    const titleInput = panel.querySelector('#drop-title') as HTMLInputElement;
    const urlInput = panel.querySelector('#drop-url') as HTMLInputElement;
    const commentInput = panel.querySelector('#drop-comment') as HTMLInputElement;
    const form = panel.querySelector('form')!;
    const cancelBtn = panel.querySelector('.drop-modal-cancel')!;

    titleInput.focus();
    titleInput.select();

    function dismiss(result: { title: string; url: string; comment: string } | null) {
      popModal(overlay);
      overlay.remove();
      resolve(result);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      const u = urlInput.value.trim();
      if (!u) return;
      dismiss({ title: title || u, url: u, comment: commentInput.value.trim() });
    });

    cancelBtn.addEventListener('click', () => dismiss(null));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss(null);
    });

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dismiss(null);
    });
  });
}

/** Build a markdown entry line from link data. */
function buildEntryLine(title: string, url: string, comment?: string): string {
  const line = `- ${title} ${url}`;
  return comment ? `${line} # ${comment}` : line;
}

/** Extract URLs from plain text. Returns array of { text, url }. */
function parseLinksFromText(text: string): Array<{ text: string; url: string }> {
  const results: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();

  // Match HTML <a> tags first
  const anchorRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(text)) !== null) {
    const url = m[1];
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ text: truncate(m[2].trim(), 50) || url, url });
    }
  }

  // Match bare URLs
  const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?)]+$/, ''); // strip trailing punctuation
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ text: url, url });
    }
  }

  return results;
}

/** Insert entry lines under an "- Imported:" group, creating it if needed. */
function insertIntoImported(content: string, newLines: string[]): string {
  const lines = content.split('\n');
  const indented = newLines.map(l => `  ${l}`);

  // Look for an existing "- Imported:" group
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === '- Imported:') {
      // Find the end of its indented children
      let end = i + 1;
      while (end < lines.length && /^\s+\S/.test(lines[end])) {
        end++;
      }
      const before = lines.slice(0, end);
      const after = lines.slice(end);
      return [...before, ...indented, ...after].join('\n');
    }
  }

  // No existing group — create one after the page title
  let insertIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) {
      insertIdx = i + 1;
      break;
    }
  }

  const before = lines.slice(0, insertIdx);
  const after = lines.slice(insertIdx);
  return [...before, '', '- Imported:', ...indented, ...after].join('\n');
}

/** Save new entries to GitHub and trigger re-render. */
async function insertEntries(entryLines: string[], config: DropConfig, via: string): Promise<void> {
  const contentPath = config.route.contentPath;
  try {
    logInfo(`${via}: Saving ${entryLines.length} link(s) to ${contentPath}`);
    const { content, sha } = await getFileContent(config.host, config.token, config.owner, config.repo, contentPath);
    const updated = insertIntoImported(content, entryLines);
    await updateFileContent(
      config.host, config.token, config.owner, config.repo,
      contentPath, updated, sha,
      `Add ${entryLines.length} link(s) via ${via.toLowerCase()}`,
    );
    removeCachedContent(contentPath);
    logInfo(`${via}: Saved successfully`);
    const n = entryLines.length;
    const pageName = contentPath.replace(/^text\//, '').replace(/\/README\.md$/, '') || 'root';
    showToast(`${n} link${n === 1 ? '' : 's'} imported into ${pageName}`);
    config.onSaved();
  } catch (err) {
    const msg = errorMessage(err);
    logError(`${via}: Failed to save: ${msg}`);
    alert(`Failed to save link(s): ${msg}`);
  }
}

/** Show link modal for a single URL, save if confirmed. Reusable entry point for drop and barouse capture. */
export async function handleSingleLink(url: string, config: DropConfig, via: string): Promise<void> {
  const result = await showLinkModal(url);
  if (!result) return;
  const line = buildEntryLine(result.title, result.url, result.comment);
  await insertEntries([line], config, via);
}

import { isInputFocused } from './lifecycle.ts';

/** Initialize drag-and-drop (URL only) and paste (text with links) on the page. */
export function initDropZone(container: HTMLElement, config: DropConfig, signal: AbortSignal): void {
  const scrollable = container.querySelector('.scrollable-content') as HTMLElement | null;
  if (!scrollable) return;

  // Only enable on browse pages, not edit pages
  if (config.route.kind !== 'browse') return;

  // --- URL drag-and-drop ---
  //
  // Listeners are registered with capture:true so they fire before <a> elements'
  // native drag-and-drop behavior (which would otherwise navigate to the dropped URL).

  let dragCounter = 0;

  scrollable.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    scrollable.classList.add('drop-target');
  }, { capture: true });

  scrollable.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, { capture: true });

  scrollable.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      scrollable.classList.remove('drop-target');
    }
  }, { capture: true });

  scrollable.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    scrollable.classList.remove('drop-target');

    if (!e.dataTransfer) return;

    // URL drop (from address bar)
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
      const url = uriList.split('\n').find(l => l && !l.startsWith('#'))?.trim();
      if (!url) return;

      await handleSingleLink(url, config, 'Drop');
    }
  }, { capture: true });

  // --- Paste handler (Ctrl+V with text containing links) ---

  document.addEventListener('paste', async (e: ClipboardEvent) => {
    if (isInputFocused()) return;

    const html = e.clipboardData?.getData('text/html') ?? '';
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!html && !text) return;

    // Try HTML first (preserves <a href> tags), fall back to plain text
    const links = parseLinksFromText(html || text);
    if (links.length === 0) {
      showToast('No links found in pasted text');
      return;
    }

    e.preventDefault();
    const lines = links.map(l =>
      l.text && l.text !== l.url ? `- ${l.text} ${l.url}` : `- ${l.url}`,
    );
    await insertEntries(lines, config, 'Paste');
  }, { signal });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '...';
}
