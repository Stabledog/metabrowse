/**
 * Local drafts for the file editor route: the safety net for every way an
 * editor can vanish (side panel closed, iframe destroyed, window closed, crash).
 *
 * localStorage is shared by every Pages app on the origin (~5 MB), so writes
 * can fail; callers must surface that.
 */

export const DRAFT_PREFIX = 'veditor-draft:';
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface Draft {
  /** Editor text (LF line endings). */
  text: string;
  /** The file sha the edits were made on. */
  baseSha: string;
  /** Epoch ms. */
  savedAt: number;
  /** The editor instance that wrote it (see newInstanceId). */
  instance: string;
}

export interface DraftLocation {
  host: string;
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

/** The ref is encoded so that `feature/x` + `a.md` and `feature` + `x/a.md` get different keys. */
export function draftKey(loc: DraftLocation): string {
  return `${DRAFT_PREFIX}${loc.host}/${loc.owner}/${loc.repo}/${encodeURIComponent(loc.ref)}/${loc.path}`;
}

/**
 * An id for one open editor. The same file can be open twice (sidebar and
 * popup), and they share a key; each must only delete a draft it wrote.
 */
export function newInstanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDraft(v: unknown): v is Draft {
  const d = v as Draft;
  return !!d && typeof d.text === 'string' && typeof d.baseSha === 'string' && typeof d.savedAt === 'number'
    && typeof d.instance === 'string';
}

export function readDraft(storage: Storage, key: string): Draft | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isDraft(v) ? v : null;
  } catch {
    return null;
  }
}

/** Returns false when storage refused the write (quota). */
export function writeDraft(storage: Storage, key: string, draft: Draft): boolean {
  try {
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Delete the draft only if this instance wrote it. */
export function removeOwnDraft(storage: Storage, key: string, instance: string): void {
  if (readDraft(storage, key)?.instance === instance) storage.removeItem(key);
}

/** Delete drafts older than maxAgeMs, and any that don't parse. Returns how many were deleted. */
export function pruneDrafts(storage: Storage, now: number, maxAgeMs = DRAFT_MAX_AGE_MS): number {
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(DRAFT_PREFIX)) continue;
    const draft = readDraft(storage, key);
    if (!draft || now - draft.savedAt > maxAgeMs) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
  return doomed.length;
}

/**
 * What to do with a draft found when the file opens:
 * - 'none': nothing to offer (no draft, or it matches the file); delete it.
 * - 'restore': made on the current version; offer to load it into the buffer.
 * - 'stale': made on an older version. Never load it into the buffer (the next
 *   save would silently overwrite the upstream change); offer to copy it.
 */
export type DraftDecision = 'none' | 'restore' | 'stale';

export function draftDecision(draft: Draft | null, currentSha: string, currentText: string): DraftDecision {
  if (!draft) return 'none';
  if (draft.baseSha !== currentSha) return draft.text === currentText ? 'none' : 'stale';
  return draft.text === currentText ? 'none' : 'restore';
}
