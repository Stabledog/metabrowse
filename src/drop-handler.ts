/** Drop + paste handler: drop URLs to add single links, paste text to add all links found. */

import type { Route } from './router.ts';
import { getFileContent, updateFileContent } from './github.ts';
import { removeCachedContent } from './cache.ts';
import { logInfo, logError } from './logging-client.ts';
import { pushModal, popModal } from './modal-stack.ts';
import { showToast, escapeAttr, escapeHtml, errorMessage } from './utils.ts';
import { parseContent } from './parser.ts';
import type { ParsedDocument, Link, Group, Section, Sublevel } from './parser.ts';

export interface DropConfig {
  host: string;
  token: string;
  owner: string;
  repo: string;
  route: Route;
  onSaved: () => void;
}

export interface BatchLink {
  title: string;
  url: string;
  comment: string;
}

/** Fetch the HTML <title> from a URL. Returns null on any failure (CORS, network, etc.). */
async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return null;
    const div = document.createElement('div');
    div.innerHTML = m[1];
    return div.textContent?.trim() || null;
  } catch {
    return null;
  }
}

/** Extract a human-readable title from a URL's path slug. Returns null if no descriptive segment found. */
function slugTitle(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
      .replace(/^([^.]+)\.[^.]+$/, '$1') // strip ext only from "name.ext" (not dotfiles)
      .replace(/^\./, '');               // strip leading dot from dotfiles like .vscode
    const words = seg.split(/[-_]+/).filter(Boolean);
    if (words.some(w => w.length > 20)) continue; // opaque ID/hash — skip
    if (/[a-zA-Z]{3,}/.test(seg)) {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }
  return null;
}

function defaultTitleFor(url: string): string {
  try {
    const parsed = new URL(url);
    return truncate(slugTitle(parsed) ?? parsed.hostname.replace(/^www\./, ''), 80);
  } catch {
    return url;
  }
}

/** Show the tail end of a URL (the most informative part when annotating). */
function tailUrl(url: string, max = 64): string {
  return url.length > max ? '…' + url.slice(-(max - 1)) : url;
}

/** Show a batch modal for entering link details. One row per URL. Returns null on cancel. */
function showLinkBatchModal(urls: string[], destLabel: string): Promise<BatchLink[] | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'drop-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'drop-modal drop-modal-batch';

    const rowsHtml = urls.map((u) => {
      const prefill = defaultTitleFor(u);
      return `<div class="drop-row">
        <input type="text" class="drop-title" value="${escapeAttr(prefill)}" data-prefill="${escapeAttr(prefill)}" data-url="${escapeAttr(u)}" />
        <span class="drop-url" title="${escapeAttr(u)}">${escapeHtml(tailUrl(u))}</span>
        <input type="text" class="drop-comment" placeholder="Comment (optional)" />
      </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="drop-modal-header">Add link → ${escapeHtml(destLabel)}</div>
      <form class="drop-modal-form">
        <div class="drop-grid-head"><span>Title</span><span>URL</span><span>Comment</span></div>
        <div class="drop-rows">${rowsHtml}</div>
        <div class="drop-modal-buttons">
          <button type="submit" class="drop-modal-ok">OK</button>
          <button type="button" class="drop-modal-cancel">Cancel</button>
        </div>
      </form>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    pushModal(overlay);

    const form = panel.querySelector('form')!;
    const cancelBtn = panel.querySelector('.drop-modal-cancel')!;
    const titleInputs = Array.from(panel.querySelectorAll<HTMLInputElement>('.drop-title'));

    const first = titleInputs[0];
    if (first) { first.focus(); first.select(); }

    // Upgrade each title with the fetched page title (only if untouched)
    for (const input of titleInputs) {
      const url = input.getAttribute('data-url')!;
      const prefill = input.getAttribute('data-prefill')!;
      fetchPageTitle(url).then(fetched => {
        if (fetched && input.isConnected && input.value === prefill) {
          input.value = truncate(fetched, 80);
        }
      });
    }

    function dismiss(result: BatchLink[] | null) {
      popModal(overlay);
      overlay.remove();
      resolve(result);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const rows = Array.from(panel.querySelectorAll('.drop-row'));
      const batch: BatchLink[] = rows.map(row => {
        const titleInput = row.querySelector<HTMLInputElement>('.drop-title')!;
        const commentInput = row.querySelector<HTMLInputElement>('.drop-comment')!;
        const url = titleInput.getAttribute('data-url')!;
        const title = titleInput.value.trim();
        return { title: title || url, url, comment: commentInput.value.trim() };
      });
      if (!batch.length) { dismiss(null); return; }
      dismiss(batch);
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
function buildEntryLine(title: string, url: string, comment: string | undefined, indent: number): string {
  const core = title && title !== url ? `- ${title} ${url}` : `- ${url}`;
  const line = `${' '.repeat(indent)}${core}`;
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

// ── Location-aware insertion ──────────────────────────────────────────
// The renderer stamps structural containers with data-mb ordinal paths
// (s0, s0/g2, s0/g2/v1, l0, s1/l2). The drop handler resolves the path
// against a fresh parse of the markdown and splices new lines in.

export interface DropTarget {
  insertAt: number; // 0-based line index to insert before
  indent: number;   // leading spaces for the new entry lines
  label: string;    // "Music / Theory" — for the modal header + staleness check
}
/** Consecutive Link items grouped into runs (mirrors transformer's coalesceLinks). */
function linkRuns(items: Array<Link | Group | Section>): Link[][] {
  const runs: Link[][] = [];
  let cur: Link[] = [];
  for (const it of items) {
    if (it.type === 'link') cur.push(it);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function maxLine(items: Array<Link | Group | Section | Sublevel>): number {
  let m = -1;
  for (const it of items) {
    m = Math.max(m, it.line);
    if (it.type === 'group') m = Math.max(m, maxLine(it.children));
    else if (it.type === 'section') m = Math.max(m, maxLine(it.items));
    else if (it.type === 'sublevel') m = Math.max(m, ...it.links.map(l => l.line));
  }
  return m;
}

/**
 * Resolve a data-mb ordinal path (e.g. "s0/g2/v1") against a parsed document.
 * Returns null when the path no longer resolves (stale render).
 */
export function resolveTarget(doc: ParsedDocument, path: string): DropTarget | null {
  let items: Array<Link | Group | Section> = doc.items;
  let group: Group | null = null;
  let label = '';

  const parts = path.split('/');
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const kind = part[0];
    const idx = parseInt(part.slice(1), 10);
    if (!Number.isInteger(idx) || idx < 0) return null;
    const last = pi === parts.length - 1;

    if (kind === 's') {
      const secs = items.filter((i): i is Section => i.type === 'section');
      const sec = secs[idx];
      if (!sec) return null;
      label = label ? `${label} / ${sec.name}` : sec.name;
      if (last) {
        const kids = sec.items;
        return { insertAt: (kids.length ? maxLine(kids) : sec.line) + 1, indent: 0, label };
      }
      items = sec.items;
    } else if (kind === 'g') {
      const grps = items.filter((i): i is Group => i.type === 'group');
      const grp = grps[idx];
      if (!grp) return null;
      group = grp;
      label = label ? `${label} / ${grp.name}` : grp.name;
      if (last) {
        const kids = grp.children;
        return {
          insertAt: (kids.length ? maxLine(kids) : grp.line) + 1,
          indent: grp.indentLevel + 2,
          label,
        };
      }
    } else if (kind === 'v') {
      if (!group) return null;
      const subs = group.children.filter((c): c is Sublevel => c.type === 'sublevel');
      const sub = subs[idx];
      if (!sub || !last) return null;
      return {
        insertAt: (sub.links.length ? Math.max(...sub.links.map(l => l.line)) : sub.line) + 1,
        indent: sub.indentLevel + 2,
        label: `${label} / ${sub.name}`,
      };
    } else if (kind === 'l') {
      if (!last) return null;
      const runs = linkRuns(items);
      const run = runs[idx];
      if (!run) return null;
      return {
        insertAt: Math.max(...run.map(l => l.line)) + 1,
        indent: run[0].indentLevel,
        label: label || 'Links',
      };
    } else {
      return null;
    }
  }
  return null;
}

/** Display label for the container under the drop point, from the DOM. */
function containerLabel(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    const mb: Element | null = cur.closest('[data-mb]');
    if (!mb) break;
    parts.unshift(headerName(mb));
    cur = mb.parentElement;
  }
  return parts.filter(Boolean).join(' / ');
}

/** Container name from its header element (text nodes only, skips comment spans). */
function headerName(container: Element): string {
  const h = container.querySelector(':scope > summary, :scope > .subgroup-header, :scope > .sublevel-header');
  if (!h) return '';
  let name = '';
  h.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) name += n.textContent; });
  return name.trim();
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

/**
 * Insert entries at a data-mb drop target. Returns false when the target no
 * longer resolves (stale render) or the save fails — caller falls back to
 * the Imported group.
 */
async function insertEntriesAt(
  path: string, expectedLabel: string, batch: BatchLink[], config: DropConfig,
): Promise<boolean> {
  const contentPath = config.route.contentPath;
  try {
    const { content, sha } = await getFileContent(config.host, config.token, config.owner, config.repo, contentPath);
    const target = resolveTarget(parseContent(content), path);
    if (!target || target.label !== expectedLabel) {
      logInfo(`Drop: target "${path}" no longer resolves (stale render), falling back to Imported`);
      return false;
    }
    const lines = batch.map(b => buildEntryLine(b.title, b.url, b.comment, target.indent));
    const docLines = content.split('\n');
    docLines.splice(target.insertAt, 0, ...lines);
    await updateFileContent(
      config.host, config.token, config.owner, config.repo,
      contentPath, docLines.join('\n'), sha,
      `Add ${lines.length} link(s) via drop -> ${target.label}`,
    );
    removeCachedContent(contentPath);
    const n = lines.length;
    showToast(`${n} link${n === 1 ? '' : 's'} added to ${target.label}`);
    config.onSaved();
    return true;
  } catch (err) {
    logError(`Drop: location-aware insert failed: ${errorMessage(err)}`);
    return false;
  }
}

/** Show the batch link modal for URL(s), save if confirmed. Reusable entry point for drop and barouse capture. */
export async function handleSingleLink(url: string, config: DropConfig, via: string): Promise<void> {
  const batch = await showLinkBatchModal([url], 'Imported');
  if (!batch) return;
  const lines = batch.map(b => buildEntryLine(b.title, b.url, b.comment, 2));
  await insertEntries(lines, config, via);
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

    // URL drop (from address bar / bookmarks)
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (!uriList) return;
    const urls = uriList.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (!urls.length) return;

    // Resolve the drop target from the release coordinates before opening the modal
    const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-mb]') ?? null;
    const targetPath = targetEl?.getAttribute('data-mb') ?? null;
    const targetLabel = targetEl ? containerLabel(targetEl) : '';
    const destLabel = targetPath && targetLabel ? targetLabel : 'Imported';

    const batch = await showLinkBatchModal(urls, destLabel);
    if (!batch) return;

    if (targetPath && targetLabel) {
      if (await insertEntriesAt(targetPath, targetLabel, batch, config)) return;
      // Stale render or save failure — fall through to the Imported group
    }
    const lines = batch.map(b => buildEntryLine(b.title, b.url, b.comment, 2));
    await insertEntries(lines, config, 'Drop');
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
      buildEntryLine(l.text && l.text !== l.url ? l.text : l.url, l.url, undefined, 2),
    );
    await insertEntries(lines, config, 'Paste');
  }, { signal });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '...';
}
