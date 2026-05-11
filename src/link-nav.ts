/** Vim-style j/k link navigation + h/l child-button navigation. */

import { isInputFocused } from './lifecycle.ts';
import { isModalOpen } from './modal-stack.ts';

const SELECTED_CLASS = 'link-selected';
const CHILD_SELECTED_CLASS = 'child-link-selected';
const CHILDREN_ACTIVE_CLASS = 'children-nav-active';

export function initLinkNav(container: HTMLElement, signal: AbortSignal): void {
  let currentIndex = -1;
  let zone: 'children' | 'links' = 'links';
  let childIndex = 0;

  function getVisibleLinks(): HTMLElement[] {
    const all = container.querySelectorAll<HTMLElement>(
      '.links > li, .group-links > li, .sublevel-links > li, .search-result-item',
    );
    const visible: HTMLElement[] = [];
    for (const item of all) {
      if (item.style.display === 'none') continue;
      if (!item.querySelector('a')) continue;
      let hidden = false;
      let el: HTMLElement | null = item.parentElement;
      while (el && el !== container) {
        if (el.style.display === 'none') { hidden = true; break; }
        el = el.parentElement;
      }
      if (!hidden) visible.push(item);
    }
    return visible;
  }

  function getChildLinks(): HTMLAnchorElement[] {
    return Array.from(container.querySelectorAll<HTMLAnchorElement>('.children-nav .child-link'));
  }

  function getChildrenNav(): HTMLElement | null {
    return container.querySelector<HTMLElement>('.children-nav');
  }

  function clearLinkSelection(): void {
    container.querySelector(`.${SELECTED_CLASS}`)?.classList.remove(SELECTED_CLASS);
    currentIndex = -1;
  }

  function clearChildSelection(): void {
    container.querySelector(`.${CHILD_SELECTED_CLASS}`)?.classList.remove(CHILD_SELECTED_CLASS);
    getChildrenNav()?.classList.remove(CHILDREN_ACTIVE_CLASS);
  }

  function selectLink(links: HTMLElement[], index: number): void {
    clearChildSelection();
    container.querySelector(`.${SELECTED_CLASS}`)?.classList.remove(SELECTED_CLASS);
    currentIndex = index;
    const item = links[index];
    item.classList.add(SELECTED_CLASS);
    item.scrollIntoView({ block: 'nearest' });
    zone = 'links';
  }

  function selectChild(children: HTMLAnchorElement[], index: number): void {
    clearLinkSelection();
    container.querySelector(`.${CHILD_SELECTED_CLASS}`)?.classList.remove(CHILD_SELECTED_CLASS);
    childIndex = index;
    children[index].classList.add(CHILD_SELECTED_CLASS);
    getChildrenNav()?.classList.add(CHILDREN_ACTIVE_CLASS);
    zone = 'children';
  }

  function handler(e: KeyboardEvent): void {
    if (isModalOpen()) return;
    if (isInputFocused()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const down = e.key === 'j' || e.key === 'ArrowDown';
    const up = e.key === 'k' || e.key === 'ArrowUp';
    const right = e.key === 'l' || e.key === 'ArrowRight';
    const left = e.key === 'h' || e.key === 'ArrowLeft';

    if (zone === 'children') {
      if (right || left) {
        e.preventDefault();
        const children = getChildLinks();
        if (children.length === 0) return;
        const count = children.length;
        childIndex = right
          ? (childIndex + 1) % count
          : (childIndex - 1 + count) % count;
        selectChild(children, childIndex);
        return;
      }
      if (down) {
        e.preventDefault();
        const links = getVisibleLinks();
        if (links.length === 0) return;
        selectLink(links, 0);
        return;
      }
      if (e.key === 'Enter') {
        const children = getChildLinks();
        const a = children[childIndex];
        if (a) { e.preventDefault(); a.click(); }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        clearChildSelection();
        zone = 'links';
        return;
      }
      return;
    }

    // zone === 'links'
    if (down || up) {
      e.preventDefault();
      const links = getVisibleLinks();
      if (links.length === 0) return;

      const selectedEl = container.querySelector<HTMLElement>(`.${SELECTED_CLASS}`);
      if (selectedEl) {
        currentIndex = links.indexOf(selectedEl);
        if (currentIndex === -1) currentIndex = 0;
      }

      if (currentIndex === -1) {
        selectLink(links, down ? 0 : links.length - 1);
        return;
      }

      if (up && currentIndex === 0) {
        // Pass back up to children zone if it exists
        const children = getChildLinks();
        if (children.length > 0) {
          selectChild(children, childIndex);
          return;
        }
      }

      const next = down
        ? Math.min(currentIndex + 1, links.length - 1)
        : Math.max(currentIndex - 1, 0);
      selectLink(links, next);
      return;
    }

    if (e.key === 'Enter') {
      const selected = container.querySelector<HTMLElement>(`.${SELECTED_CLASS}`);
      if (!selected) return;
      const a = selected.querySelector<HTMLAnchorElement>('a');
      if (a) { e.preventDefault(); a.click(); }
      return;
    }

    if (e.key === 'Escape') {
      if (currentIndex !== -1) {
        e.preventDefault();
        clearLinkSelection();
      }
    }
  }

  // Initialize zone based on whether children-nav exists
  const children = getChildLinks();
  if (children.length > 0) {
    selectChild(children, 0);
  }

  document.addEventListener('keydown', handler, { signal });
}
