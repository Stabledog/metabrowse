/** Keyboard shortcuts. Must be re-initialized after each page render. */

import { isInputFocused } from './lifecycle.ts';
import { isModalOpen } from './modal-stack.ts';
import { getCurrentRoute, navigateTo } from './router.ts';

export interface KeyboardOpts {
  onTreePanel?: () => void;
}

/** Initialize keyboard shortcuts. Call after each render. */
export function initKeyboard(container: HTMLElement, opts: KeyboardOpts | undefined, signal: AbortSignal): void {
  const sections = container.querySelectorAll<HTMLDetailsElement>('.section');
  let savedStates: boolean[] = [];
  let allCollapsed = false;

  function handler(e: KeyboardEvent): void {
    if (isModalOpen()) return;
    // "t" — open tree panel
    if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      e.preventDefault();
      opts?.onTreePanel?.();
    }

    // "/" — local search, focus input
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      e.preventDefault();
      const checkbox = document.getElementById('global-mode-checkbox') as HTMLInputElement | null;
      const input = document.getElementById('unified-search') as HTMLInputElement | null;
      if (checkbox) checkbox.checked = false;
      if (checkbox) checkbox.dispatchEvent(new Event('change'));
      if (input) { input.focus(); input.select(); }
    }

    // Ctrl+K / Cmd+K — toggle global mode
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const checkbox = document.getElementById('global-mode-checkbox') as HTMLInputElement | null;
      const input = document.getElementById('unified-search') as HTMLInputElement | null;
      if (checkbox) { checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event('change')); }
      if (input) { input.focus(); input.select(); }
    }

    // "e" — open edit link
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      const editLink = container.querySelector<HTMLAnchorElement>('.edit-link');
      if (editLink) { e.preventDefault(); editLink.click(); }
    }

    // "r" — reload current page
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      e.preventDefault();
      location.reload();
    }

    // "x" — collapse/restore all sections
    if (e.key === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      if (sections.length === 0) return;
      e.preventDefault();
      if (!allCollapsed) {
        savedStates = Array.from(sections, s => s.open);
        sections.forEach(s => { s.open = false; });
        allCollapsed = true;
      } else {
        sections.forEach((s, i) => { s.open = i < savedStates.length ? savedStates[i] : true; });
        allCollapsed = false;
      }
    }

    // "w" — Open Workspace
    if (e.key === 'w' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      const btn = container.querySelector<HTMLButtonElement>('.workspace-btn:not([disabled])');
      if (btn?.title.startsWith('Open Workspace')) { e.preventDefault(); btn.click(); }
    }

    // "c" — Create Workspace
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      for (const btn of container.querySelectorAll<HTMLButtonElement>('.workspace-btn:not([disabled])')) {
        if (btn.title.startsWith('Create Workspace')) { e.preventDefault(); btn.click(); break; }
      }
    }

    // Ctrl+Alt+U — copy selected link URL to clipboard
    if (e.key === 'u' && e.ctrlKey && e.altKey) {
      e.preventDefault();
      const selected = container.querySelector<HTMLElement>('.link-selected');
      if (!selected) return;
      const a = selected.querySelector<HTMLAnchorElement>('a');
      if (!a) return;
      navigator.clipboard.writeText(a.href).then(() => {
        const btn = selected.querySelector<HTMLButtonElement>('.copy-btn');
        if (btn) {
          btn.textContent = '✅';
          setTimeout(() => { btn.textContent = '📋'; }, 1500);
        }
      });
      return;
    }

    // "u" — navigate up to parent directory
    if (e.key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isInputFocused()) return;
      const { dirPath } = getCurrentRoute();
      if (!dirPath) return;
      e.preventDefault();
      const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
      navigateTo(parentPath);
    }
  }

  document.addEventListener('keydown', handler, { signal });
}
