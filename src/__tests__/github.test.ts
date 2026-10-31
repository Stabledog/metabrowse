import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError, decodeBase64, encodeBase64,
  getFileContent, getRawContent, updateFileContent, createFile, validateToken,
  branchExists, checkRepo,
} from '../github.ts';

const HOST = 'ghes.example.com';

interface Call { url: string; init: RequestInit }
let calls: Call[];
let nextResponse: () => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fileResponse(text: string, extra: Record<string, unknown> = {}): Response {
  return json(200, { type: 'file', encoding: 'base64', content: encodeBase64(text), sha: 'abc', name: 'f', path: 'f', ...extra });
}

beforeEach(() => {
  calls = [];
  nextResponse = () => json(200, {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return nextResponse();
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (err) { return err; }
  throw new Error('expected a rejection');
}

// ── ApiError ────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('carries the status and GitHub\'s message from a JSON error body', async () => {
    nextResponse = () => json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com' });
    const err = await caught(validateToken(HOST, 't'));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).githubMessage).toBe('Not Found');
    expect((err as ApiError).message).toBe('GitHub API 404: Not Found');
  });

  it('falls back to the raw body when it isn\'t JSON', async () => {
    nextResponse = () => new Response('Bad gateway', { status: 502 });
    const err = await caught(validateToken(HOST, 't')) as ApiError;
    expect(err.status).toBe(502);
    expect(err.githubMessage).toBe('Bad gateway');
  });

  it('is thrown by PUTs too, with no special 409 wording', async () => {
    nextResponse = () => json(409, { message: 'f does not match abc' });
    const err = await caught(updateFileContent(HOST, 't', 'o', 'r', 'f', 'x', 'abc', 'm')) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.githubMessage).toBe('f does not match abc');

    nextResponse = () => json(422, { message: 'Invalid request' });
    const err2 = await caught(createFile(HOST, 't', 'o', 'r', 'f', 'x', 'm')) as ApiError;
    expect(err2.status).toBe(422);
  });
});

// ── getFileContent ──────────────────────────────────────────────────

describe('getFileContent', () => {
  it('reads the default branch, cacheable, when no options are given', async () => {
    nextResponse = () => fileResponse('hi');
    const file = await getFileContent(HOST, 't', 'o', 'r', 'dir/a b.md');
    expect(file).toEqual({ content: 'hi', sha: 'abc' });
    expect(calls[0].url).toBe(`https://${HOST}/api/v3/repos/o/r/contents/dir/a%20b.md`);
    expect(calls[0].init.cache).toBeUndefined();
  });

  it('passes ref (encoded) and no-store when asked', async () => {
    nextResponse = () => fileResponse('hi');
    await getFileContent(HOST, 't', 'o', 'r', 'f.md', { ref: 'feature/x&y', noStore: true });
    expect(calls[0].url).toBe(`https://${HOST}/api/v3/repos/o/r/contents/f.md?ref=feature%2Fx%26y`);
    expect(calls[0].init.cache).toBe('no-store');
  });

  it('reads an empty file as ""', async () => {
    nextResponse = () => fileResponse('');
    expect((await getFileContent(HOST, 't', 'o', 'r', 'f')).content).toBe('');
  });

  it('refuses files over 1 MB (content omitted, encoding "none")', async () => {
    nextResponse = () => json(200, { type: 'file', encoding: 'none', content: '', sha: 'abc' });
    expect(String(await caught(getFileContent(HOST, 't', 'o', 'r', 'f')))).toMatch(/too large/);
  });

  it('refuses directories and other non-file entries', async () => {
    nextResponse = () => json(200, [{ type: 'file', name: 'a' }]);
    expect(String(await caught(getFileContent(HOST, 't', 'o', 'r', 'dir')))).toMatch(/Not a file: dir/);
    nextResponse = () => json(200, { type: 'symlink', target: 'x', sha: 'abc' });
    expect(String(await caught(getFileContent(HOST, 't', 'o', 'r', 'link')))).toMatch(/Not a file/);
  });

  it('keeps a BOM in the text, and getRawContent drops it', async () => {
    nextResponse = () => fileResponse('\uFEFF# hi\r\n');
    expect((await getFileContent(HOST, 't', 'o', 'r', 'f')).content).toBe('\uFEFF# hi\r\n');
    nextResponse = () => fileResponse('\uFEFF# hi\r\n');
    expect(await getRawContent(HOST, 't', 'o', 'r', 'f')).toBe('# hi\r\n');
  });
});

// ── updateFileContent ───────────────────────────────────────────────

describe('updateFileContent', () => {
  function body(): Record<string, unknown> {
    return JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
  }

  it('omits branch by default', async () => {
    nextResponse = () => json(200, { content: { sha: 'new' } });
    expect(await updateFileContent(HOST, 't', 'o', 'r', 'f', 'x', 'abc', 'msg')).toBe('new');
    expect(calls[0].init.method).toBe('PUT');
    expect(body()).toEqual({ message: 'msg', content: encodeBase64('x'), sha: 'abc' });
  });

  it('sends branch when given', async () => {
    nextResponse = () => json(200, { content: { sha: 'new' } });
    await updateFileContent(HOST, 't', 'o', 'r', 'f', 'x', 'abc', 'msg', { branch: 'feature/x' });
    expect(body().branch).toBe('feature/x');
  });
});

// ── decodeBase64 / encodeBase64 ─────────────────────────────────────

describe('decodeBase64', () => {
  it('round-trips UTF-8 text, including a BOM and non-ASCII', () => {
    for (const text of ['', 'plain', '\uFEFFwith bom', 'naïve — ✓ 日本\r\n', '\uFEFF']) {
      expect(decodeBase64(encodeBase64(text))).toBe(text);
    }
  });

  it('ignores the newlines GitHub puts in base64', () => {
    const b64 = encodeBase64('a longer line of text').replace(/(.{8})/g, '$1\n');
    expect(decodeBase64(b64)).toBe('a longer line of text');
  });

  it('refuses bytes that aren\'t valid UTF-8', () => {
    const latin1 = btoa('caf\xe9');              // "café" in Latin-1
    const binary = btoa('\x89PNG\r\n\x1a\n\x00\xff');
    expect(() => decodeBase64(latin1)).toThrow(/Not a UTF-8 text file/);
    expect(() => decodeBase64(binary)).toThrow(/Not a UTF-8 text file/);
  });
});

// ── branchExists / checkRepo ────────────────────────────────────────

describe('branchExists', () => {
  it('is true on 200, false on 404, and throws on anything else', async () => {
    nextResponse = () => json(200, { name: 'feature/x' });
    expect(await branchExists(HOST, 't', 'o', 'r', 'feature/x')).toBe(true);
    expect(calls[0].url).toBe(`https://${HOST}/api/v3/repos/o/r/branches/feature/x`);

    nextResponse = () => json(404, { message: 'Branch not found' });
    expect(await branchExists(HOST, 't', 'o', 'r', 'nope')).toBe(false);

    nextResponse = () => json(401, { message: 'Bad credentials' });
    expect(await caught(branchExists(HOST, 't', 'o', 'r', 'main'))).toBeInstanceOf(ApiError);
  });
});

describe('checkRepo', () => {
  it('throws ApiError when the repo can\'t be read', async () => {
    nextResponse = () => json(404, { message: 'Not Found' });
    expect(((await caught(checkRepo(HOST, 't', 'o', 'r'))) as ApiError).status).toBe(404);
  });
});
