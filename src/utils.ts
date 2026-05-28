export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function basename(dirPath: string): string {
  return dirPath.split('/').pop()!;
}

export function contentPathFor(dirPath: string): string {
  return dirPath ? `text/${dirPath}/README.md` : 'text/README.md';
}

export function formatDirName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function getChildDirs(dirPath: string, contentPaths: string[]): string[] {
  return contentPaths.filter(p => {
    if (!dirPath) return p !== '' && !p.includes('/');
    return p.startsWith(dirPath + '/') && !p.slice(dirPath.length + 1).includes('/');
  }).sort();
}

export function showToast(message: string): void {
  const existing = document.querySelector('.import-toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'import-toast';
  el.textContent = message;
  document.body.appendChild(el);

  el.offsetWidth; // eslint-disable-line @typescript-eslint/no-unused-expressions
  el.classList.add('visible');

  setTimeout(() => {
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => el.remove());
  }, 3000);
}
