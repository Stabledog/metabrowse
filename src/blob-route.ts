/** Pure logic for the #/blob/<owner>/<repo>/<ref...>/<path...> file-editor route. */

import { ApiError } from './github.ts';

// The router strips an optional leading slash (#blob/... and #/blob/... are the
// same route), so this must too, or main.ts and the router disagree.
const BLOB_RE = /^#\/?blob(\/|$)/;

export interface BlobHash {
  owner: string;
  repo: string;
  /** Everything after owner/repo, one entry per path segment: the ref's segments, then the file path's. */
  rest: string[];
}

/** The one test for the file-editor route, used by main.ts and the router alike. */
export function isBlobHash(hash: string): boolean {
  return BLOB_RE.test(hash);
}

/**
 * Parse #/blob/<owner>/<repo>/<ref...>/<path...> (the tail of a GitHub blob URL).
 * Each segment is percent-decoded. Returns null unless there is at least one
 * ref segment and one path segment.
 */
export function parseBlobHash(hash: string): BlobHash | null {
  if (!isBlobHash(hash)) return null;
  const segments = hash.replace(BLOB_RE, '').split(/[?#]/)[0].split('/').filter(Boolean);
  let decoded: string[];
  try {
    decoded = segments.map(decodeURIComponent);
  } catch {
    return null;
  }
  if (decoded.length < 4) return null;
  const [owner, repo, ...rest] = decoded;
  return { owner, repo, rest };
}

export interface RefAndPath {
  ref: string;
  path: string;
}

/**
 * Split segments into branch and file path. Git can't hold both `a` and `a/b`
 * as branches, so at most one prefix is a branch and the search order only
 * affects cost: shortest first, which is one call for `main`. Null when no
 * prefix is a branch (a SHA, a tag, or a permalink).
 */
export async function resolveRef(
  rest: string[], isBranch: (name: string) => Promise<boolean>,
): Promise<RefAndPath | null> {
  for (let n = 1; n < rest.length; n++) {
    const ref = rest.slice(0, n).join('/');
    if (await isBranch(ref)) return { ref, path: rest.slice(n).join('/') };
  }
  return null;
}

// ── veditor version ────────────────────────────────────────────────

/** The file editor relies on veditor 0.45's onSave result and onChange. */
export const MIN_VEDITOR = [0, 45] as const;

/** Whether a veditor VERSION string ("0.45.0") is new enough. Anything unparseable is not. */
export function veditorSupported(version: unknown): boolean {
  const m = typeof version === 'string' ? /^(\d+)\.(\d+)(\.|$)/.exec(version) : null;
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > MIN_VEDITOR[0] || (major === MIN_VEDITOR[0] && minor >= MIN_VEDITOR[1]);
}

// ── Line endings ────────────────────────────────────────────────────

/** 'lf' covers files with no line breaks. 'mixed' includes any lone CR. */
export type LineEndings = 'lf' | 'crlf' | 'mixed';

export function detectLineEndings(text: string): LineEndings {
  const lf = (text.match(/\n/g) ?? []).length;
  const cr = (text.match(/\r/g) ?? []).length;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  if (cr === 0) return 'lf';
  if (crlf === cr && crlf === lf) return 'crlf';
  return 'mixed';
}

/** File text → editor text. The editor works in LF only. */
export function toEditorText(text: string, eol: LineEndings): string {
  return eol === 'crlf' ? text.replace(/\r\n/g, '\n') : text;
}

/** Editor text → file text, restoring the file's line endings. */
export function toFileText(text: string, eol: LineEndings): string {
  return eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
}

// ── Save errors ─────────────────────────────────────────────────────

export interface SaveContext {
  owner: string;
  repo: string;
  ref: string;
  /** The sha the failed PUT was based on. */
  baseSha: string;
  /** Re-read the file's current sha on the branch, bypassing the HTTP cache. Throws ApiError. */
  currentSha: () => Promise<string>;
}

export const UPSTREAM_CHANGED = 'File changed upstream since you opened it. Copy your edits and reload.';
export const UPSTREAM_DELETED = 'File was deleted or moved upstream since you opened it. Copy your edits.';

/**
 * The message for a failed commit. 409/422 can mean a sha mismatch or a branch
 * rule, so re-read the sha rather than matching on GitHub's wording.
 */
export async function describeSaveError(err: unknown, ctx: SaveContext): Promise<string> {
  if (!(err instanceof ApiError)) return `Save failed: ${err instanceof Error ? err.message : String(err)}`;
  const { status, githubMessage } = err;
  if (status === 409 || status === 422) {
    let current: string;
    try {
      current = await ctx.currentSha();
    } catch (recheck) {
      if (recheck instanceof ApiError && recheck.status === 404) return UPSTREAM_DELETED;
      const why = recheck instanceof Error ? recheck.message : String(recheck);
      return `Commit failed (${githubMessage}), and couldn't re-check the file: ${why}`;
    }
    if (current !== ctx.baseSha) return UPSTREAM_CHANGED;
    return `Can't commit to ${ctx.ref}: ${githubMessage}`;
  }
  if (status === 403 || status === 404) {
    // 404 is GitHub's answer to a PUT with a token that can only read.
    return `No write access to ${ctx.owner}/${ctx.repo}: ${githubMessage}`;
  }
  return `Save failed: ${err.message}`;
}
