/** Pure logic for the #/blob/<owner>/<repo>/<ref...>/<path...> file-editor route. */

import { ApiError } from './github.ts';

export const BLOB_PREFIX = '#/blob/';

export interface BlobHash {
  owner: string;
  repo: string;
  /** Everything after owner/repo, one entry per path segment: the ref's segments, then the file path's. */
  rest: string[];
}

export function isBlobHash(hash: string): boolean {
  return hash.startsWith(BLOB_PREFIX);
}

/**
 * Parse #/blob/<owner>/<repo>/<ref...>/<path...> (the tail of a GitHub blob URL).
 * Each segment is percent-decoded. Returns null unless there is at least one
 * ref segment and one path segment.
 */
export function parseBlobHash(hash: string): BlobHash | null {
  if (!isBlobHash(hash)) return null;
  const segments = hash.slice(BLOB_PREFIX.length).split(/[?#]/)[0].split('/').filter(Boolean);
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
  /** Re-read the file's current sha on the branch, bypassing the HTTP cache. */
  currentSha: () => Promise<string>;
}

export const UPSTREAM_CHANGED = 'File changed upstream since you opened it. Reload; your edits are kept as a draft.';

/**
 * The message for a failed commit. 409/422 can mean a sha mismatch or a branch
 * rule, so re-read the sha rather than matching on GitHub's wording.
 */
export async function describeSaveError(err: unknown, ctx: SaveContext): Promise<string> {
  if (!(err instanceof ApiError)) return `Save failed: ${err instanceof Error ? err.message : String(err)}`;
  const { status, githubMessage } = err;
  if (status === 409 || status === 422) {
    let changed = false;
    try {
      changed = (await ctx.currentSha()) !== ctx.baseSha;
    } catch { /* can't tell: report GitHub's message */ }
    if (changed) return UPSTREAM_CHANGED;
    return `Can't commit to ${ctx.ref}: ${githubMessage}`;
  }
  if (status === 403 || status === 404) {
    // 404 is GitHub's answer to a PUT with a token that can only read.
    return `No write access to ${ctx.owner}/${ctx.repo}: ${githubMessage}`;
  }
  return `Save failed: ${err.message}`;
}
