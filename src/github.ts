/** GitHub API client — merged from editor/src/github.ts + Trees API for SPA. */

export const DEFAULT_HOST = (import.meta.env.VITE_DEFAULT_HOST as string | undefined) ?? 'github.com';

function apiBase(host: string): string {
  if (host === 'github.com') return 'https://api.github.com';
  return `https://${host}/api/v3`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

/** A non-2xx GitHub API response: the HTTP status and GitHub's own error message. */
export class ApiError extends Error {
  readonly status: number;
  readonly githubMessage: string;

  constructor(status: number, githubMessage: string) {
    super(`GitHub API ${status}: ${githubMessage}`);
    this.name = 'ApiError';
    this.status = status;
    this.githubMessage = githubMessage;
  }
}

/** Build an ApiError from a failed response. GitHub's error body is JSON with a `message`; fall back to the raw text. */
async function apiError(res: Response): Promise<ApiError> {
  const text = await res.text();
  let message = text;
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch { /* not JSON */ }
  return new ApiError(res.status, message);
}

async function apiFetch<T>(host: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase(host)}${path}`;
  console.log(`[github] ${init?.method ?? 'GET'} ${url}`);
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(token), ...init?.headers },
  });
  if (!res.ok) throw await apiError(res);
  return res.json() as Promise<T>;
}

// --- Auth ---

export interface GitHubUser {
  login: string;
}

export function validateToken(host: string, token: string): Promise<GitHubUser> {
  return apiFetch<GitHubUser>(host, token, '/user');
}

// --- Repos and branches ---

/** Check the repo is readable with this token. Throws ApiError (404 when it doesn't exist or the token can't see it). */
export async function checkRepo(host: string, token: string, owner: string, repo: string): Promise<void> {
  await apiFetch<unknown>(host, token, `/repos/${owner}/${repo}`);
}

/** Whether `name` is a branch of the repo. Other failures throw ApiError. */
export async function branchExists(
  host: string, token: string, owner: string, repo: string, name: string,
): Promise<boolean> {
  try {
    await apiFetch<unknown>(host, token, `/repos/${owner}/${repo}/branches/${encodePath(name)}`);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false;
    throw err;
  }
}

// --- Trees API ---

export interface TreeEntry {
  path: string;
  type: string; // "blob" or "tree"
  sha: string;
}

interface TreeResponse {
  tree: Array<{ path: string; type: string; sha: string }>;
  truncated: boolean;
}

/** Fetch the full recursive tree for a branch. Returns all entries. */
export async function getTree(
  host: string, token: string,
  owner: string, repo: string, branch = 'main',
): Promise<TreeEntry[]> {
  const data = await apiFetch<TreeResponse>(
    host, token,
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { cache: 'no-store' },
  );
  return data.tree;
}

/**
 * Extract content paths from a tree.
 * Finds all text/.../README.md paths and returns the directory paths
 * (e.g., "text/teach/CPP/README.md" → "teach/CPP").
 */
export function extractContentPaths(tree: TreeEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    if (!entry.path.startsWith('text/')) continue;
    if (!entry.path.endsWith('/README.md') && entry.path !== 'text/README.md') continue;

    // "text/README.md" → "" (root)
    // "text/teach/README.md" → "teach"
    // "text/teach/CPP/README.md" → "teach/CPP"
    const dir = entry.path.slice('text/'.length).replace(/\/README\.md$/, '');
    paths.push(dir === 'README.md' ? '' : dir);
  }
  return paths;
}

// --- Contents API ---

interface ContentsResponse {
  type: string; // "file", "dir", "symlink" or "submodule"
  content: string;
  sha: string;
  name: string;
  path: string;
  encoding: string;
}

interface UpdateResponse {
  content: { sha: string };
}

/**
 * Decode base64 file content as UTF-8. A BOM is kept as a leading \uFEFF so it
 * round-trips through encodeBase64. Anything that isn't valid UTF-8 (binary,
 * another encoding) throws rather than decoding lossily.
 */
export function decodeBase64(b64: string): string {
  const binaryStr = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('Not a UTF-8 text file (binary or another encoding).');
  }
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binaryStr = '';
  for (const b of bytes) {
    binaryStr += String.fromCharCode(b);
  }
  return btoa(binaryStr);
}

export interface FileContent {
  content: string;
  sha: string;
}

export interface GetFileOptions {
  /** Branch, tag or SHA to read from. Default: the repo's default branch. */
  ref?: string;
  /** Bypass the browser HTTP cache (GitHub sends max-age=60), so a re-read sees the current sha. */
  noStore?: boolean;
}

/** Fetch a file's content and SHA (needed for editing). */
export async function getFileContent(
  host: string, token: string,
  owner: string, repo: string, path: string,
  opts: GetFileOptions = {},
): Promise<FileContent> {
  const query = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : '';
  const data = await apiFetch<ContentsResponse>(
    host, token,
    `/repos/${owner}/${repo}/contents/${encodePath(path)}${query}`,
    opts.noStore ? { cache: 'no-store' } : undefined,
  );
  // A directory comes back as an array; a symlink or submodule has another type.
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Not a file: ${path}`);
  }
  // Over 1 MB the content is omitted (encoding "none"). An empty file is "" with encoding "base64".
  if (data.encoding !== 'base64') {
    throw new Error('File too large for Contents API. Only files under 1MB are supported.');
  }
  return {
    content: decodeBase64(data.content),
    sha: data.sha,
  };
}

/** Fetch a file's raw content as a string (read-only, no SHA tracking). A BOM is dropped: it only matters when writing back. */
export async function getRawContent(
  host: string, token: string,
  owner: string, repo: string, path: string,
): Promise<string> {
  const file = await getFileContent(host, token, owner, repo, path);
  return file.content.replace(/^\uFEFF/, '');
}

export interface UpdateFileOptions {
  /** Branch to commit to. Default: the repo's default branch. */
  branch?: string;
}

/** Update a file's content. Returns the new SHA. Failures throw ApiError (409: sha mismatch or branch rules; 403/404: no write access). */
export async function updateFileContent(
  host: string, token: string,
  owner: string, repo: string, path: string,
  content: string, sha: string, message: string,
  opts: UpdateFileOptions = {},
): Promise<string> {
  const res = await fetch(`${apiBase(host)}/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message,
      content: encodeBase64(content),
      sha,
      ...(opts.branch ? { branch: opts.branch } : {}),
    }),
  });
  if (!res.ok) throw await apiError(res);
  const data = await res.json() as UpdateResponse;
  return data.content.sha;
}

/** Create a new file. Returns the new SHA. Throws 422 if file already exists. */
export async function createFile(
  host: string, token: string,
  owner: string, repo: string, path: string,
  content: string, message: string,
): Promise<string> {
  const res = await fetch(`${apiBase(host)}/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message,
      content: encodeBase64(content),
    }),
  });
  if (!res.ok) throw await apiError(res);
  const data = await res.json() as UpdateResponse;
  return data.content.sha;
}

/** Delete a file. Requires the file's current SHA. */
export async function deleteFile(
  host: string, token: string,
  owner: string, repo: string, path: string,
  sha: string, message: string,
): Promise<void> {
  const res = await fetch(`${apiBase(host)}/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    headers: headers(token),
    body: JSON.stringify({
      message,
      sha,
    }),
  });
  if (!res.ok) throw await apiError(res);
}
