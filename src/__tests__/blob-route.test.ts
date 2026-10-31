import { describe, it, expect } from 'vitest';
import {
  isBlobHash, parseBlobHash, resolveRef,
  detectLineEndings, toEditorText, toFileText,
  describeSaveError, UPSTREAM_CHANGED,
} from '../blob-route.ts';
import type { SaveContext } from '../blob-route.ts';
import { ApiError } from '../github.ts';
import { parseHash } from '../router.ts';

// ── parseBlobHash ───────────────────────────────────────────────────

describe('parseBlobHash', () => {
  it('splits owner, repo and the rest', () => {
    expect(parseBlobHash('#/blob/o/r/main/docs/a.md')).toEqual({ owner: 'o', repo: 'r', rest: ['main', 'docs', 'a.md'] });
  });

  it('decodes each segment, keeping encoded slashes inside a segment', () => {
    expect(parseBlobHash('#/blob/o/r/main/my%20file%2Fx.md')!.rest).toEqual(['main', 'my file/x.md']);
  });

  it('drops a ?query or #anchor from the GitHub URL', () => {
    expect(parseBlobHash('#/blob/o/r/main/a.md#L10')!.rest).toEqual(['main', 'a.md']);
    expect(parseBlobHash('#/blob/o/r/main/a.md?plain=1')!.rest).toEqual(['main', 'a.md']);
  });

  it('needs a ref and a path', () => {
    expect(parseBlobHash('#/blob/o/r/main')).toBeNull();
    expect(parseBlobHash('#/blob/o/r')).toBeNull();
    expect(parseBlobHash('#/blob/o/r/main/%E0%A4%A')).toBeNull(); // malformed escape
  });

  it('only matches #/blob/', () => {
    expect(isBlobHash('#/blob/o/r/main/a.md')).toBe(true);
    expect(isBlobHash('#/edit/blob')).toBe(false);
    expect(isBlobHash('#/blobs')).toBe(false);
    expect(parseBlobHash('#/edit/o/r/main/a.md')).toBeNull();
  });
});

describe('browse router', () => {
  it('reserves blob/ so it is never read as a content directory', () => {
    expect(parseHash('#/blob/o/r/main/a.md').kind).toBe('blob');
    expect(parseHash('#/blob').kind).toBe('blob');
    expect(parseHash('#/blobby').kind).toBe('browse');
    expect(parseHash('#/edit/teach').kind).toBe('edit');
  });
});

// ── resolveRef ──────────────────────────────────────────────────────

describe('resolveRef', () => {
  function branches(...names: string[]) {
    const asked: string[] = [];
    const isBranch = async (n: string) => { asked.push(n); return names.includes(n); };
    return { isBranch, asked };
  }

  it('costs one call for a single-segment branch', async () => {
    const b = branches('main');
    expect(await resolveRef(['main', 'docs', 'a.md'], b.isBranch)).toEqual({ ref: 'main', path: 'docs/a.md' });
    expect(b.asked).toEqual(['main']);
  });

  it('finds a branch with slashes, shortest prefix first', async () => {
    const b = branches('feature/x');
    expect(await resolveRef(['feature', 'x', 'src', 'a.ts'], b.isBranch)).toEqual({ ref: 'feature/x', path: 'src/a.ts' });
    expect(b.asked).toEqual(['feature', 'feature/x']);
  });

  it('never takes the whole thing as the ref (the path must be non-empty)', async () => {
    const b = branches('a/b');
    expect(await resolveRef(['a', 'b'], b.isBranch)).toBeNull();
    expect(b.asked).toEqual(['a']);
  });

  it('returns null for a SHA, tag or permalink', async () => {
    const b = branches('main');
    expect(await resolveRef(['0123abcd', 'a.md'], b.isBranch)).toBeNull();
  });

  it('lets API failures through', async () => {
    const boom = async () => { throw new ApiError(500, 'oops'); };
    await expect(resolveRef(['main', 'a.md'], boom)).rejects.toThrow('oops');
  });
});

// ── Line endings ────────────────────────────────────────────────────

describe('line endings', () => {
  it('detects LF, CRLF and mixed', () => {
    expect(detectLineEndings('')).toBe('lf');
    expect(detectLineEndings('one line')).toBe('lf');
    expect(detectLineEndings('a\nb\n')).toBe('lf');
    expect(detectLineEndings('a\r\nb\r\n')).toBe('crlf');
    expect(detectLineEndings('a\r\nb')).toBe('crlf');
    expect(detectLineEndings('a\r\nb\n')).toBe('mixed');
    expect(detectLineEndings('a\rb')).toBe('mixed');
    expect(detectLineEndings('a\r\r\nb')).toBe('mixed');
  });

  it('round-trips CRLF files through LF editor text', () => {
    const file = '\uFEFF# t\r\n\r\nbody\r\n';
    const editor = toEditorText(file, 'crlf');
    expect(editor).toBe('\uFEFF# t\n\nbody\n');
    expect(toFileText(editor, 'crlf')).toBe(file);
    expect(toFileText(editor + 'more\n', 'crlf')).toBe(file + 'more\r\n');
  });

  it('leaves LF files alone', () => {
    expect(toEditorText('a\nb', 'lf')).toBe('a\nb');
    expect(toFileText('a\nb', 'lf')).toBe('a\nb');
  });
});

// ── describeSaveError ───────────────────────────────────────────────

describe('describeSaveError', () => {
  function ctx(currentSha: () => Promise<string>): SaveContext {
    return { owner: 'o', repo: 'r', ref: 'main', baseSha: 'old', currentSha };
  }
  const same = async () => 'old';
  const moved = async () => 'new';
  const unreadable = async () => { throw new Error('offline'); };

  it('409/422 with a moved sha: changed upstream', async () => {
    expect(await describeSaveError(new ApiError(409, 'a.md does not match old'), ctx(moved))).toBe(UPSTREAM_CHANGED);
    expect(await describeSaveError(new ApiError(422, 'x'), ctx(moved))).toBe(UPSTREAM_CHANGED);
  });

  it('409/422 with the same sha: GitHub\'s own reason, never a guess', async () => {
    expect(await describeSaveError(new ApiError(409, 'Protected branch update failed'), ctx(same)))
      .toBe("Can't commit to main: Protected branch update failed");
    expect(await describeSaveError(new ApiError(422, 'Invalid request'), ctx(unreadable)))
      .toBe("Can't commit to main: Invalid request");
  });

  it('403/404: no write access', async () => {
    expect(await describeSaveError(new ApiError(404, 'Not Found'), ctx(same))).toBe('No write access to o/r: Not Found');
    expect(await describeSaveError(new ApiError(403, 'Resource not accessible'), ctx(same)))
      .toBe('No write access to o/r: Resource not accessible');
  });

  it('anything else: the error as is', async () => {
    expect(await describeSaveError(new ApiError(500, 'boom'), ctx(same))).toBe('Save failed: GitHub API 500: boom');
    expect(await describeSaveError(new TypeError('Failed to fetch'), ctx(same))).toBe('Save failed: Failed to fetch');
  });
});
