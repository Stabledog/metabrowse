// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fake from './fake-veditor.ts';
import { draftKey, readDraft, writeDraft } from '../drafts.ts';
import type { Draft } from '../drafts.ts';
import { DEFAULT_HOST } from '../github.ts';

vi.mock('../editor.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../editor.ts')>()),
  loadVeditor: async () => fake,
}));

// ── A fake GitHub: one repo o/r, branches, files by path ───────────

const enc = (t: string) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
const dec = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)));

let branches: string[];
let files: Record<string, { text: string; sha: string }>;
let puts: Array<{ message: string; content: string; sha: string; branch: string }>;
/** When set, the next PUT fails with it. */
let putError: { status: number; message: string } | null;
/** When set, GETs of the file fail with it (used for the re-check after a failed PUT). */
let getError: { status: number; message: string } | null;
/** Resolves held PUTs, to test a :w during a commit. */
let holdPuts: Array<() => void> | null;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

async function fakeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const u = new URL(url);
  const p = decodeURIComponent(u.pathname.replace(/^\/api\/v3/, '').replace('/repos/o/r', ''));
  if (p === '') return json(200, {});
  if (p.startsWith('/branches/')) {
    return branches.includes(p.slice('/branches/'.length)) ? json(200, {}) : json(404, { message: 'Branch not found' });
  }
  if (p.startsWith('/contents/')) {
    const path = p.slice('/contents/'.length);
    const f = files[path];
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string);
      puts.push(body);
      if (holdPuts) await new Promise<void>(r => holdPuts!.push(r));
      if (putError) { const e = putError; putError = null; return json(e.status, { message: e.message }); }
      f.text = dec(body.content);
      f.sha = `s${puts.length + 1}`;
      return json(200, { content: { sha: f.sha } });
    }
    if (getError) return json(getError.status, { message: getError.message });
    return f ? json(200, { type: 'file', encoding: 'base64', content: enc(f.text), sha: f.sha }) : json(404, { message: 'Not Found' });
  }
  return json(500, { message: `unexpected ${p}` });
}

// ── Helpers ─────────────────────────────────────────────────────────

const app = () => document.getElementById('app')!;
const status = () => document.getElementById('status-msg')?.textContent ?? '';
const tick = () => new Promise(r => setTimeout(r, 0));
const commitInput = () => document.querySelector<HTMLInputElement>('.commit-prompt input');

function pressInPrompt(key: string): void {
  commitInput()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

/** :w, then answer the commit bar with Enter (or Escape). */
async function save(answer: 'Enter' | 'Escape' = 'Enter'): Promise<boolean> {
  const done = fake.requestSave();
  await tick();
  pressInPrompt(answer);
  return done;
}

// initFileEditor adds window listeners for the page's lifetime; a test is one page.
const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const addListener = window.addEventListener.bind(window);
window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
  listeners.push([type, fn]);
  addListener(type, fn, opts);
}) as typeof window.addEventListener;

let initFileEditor: typeof import('../file-editor.ts').initFileEditor;

async function load(opts: { parent?: Window } = {}): Promise<void> {
  vi.resetModules();
  if (opts.parent) Object.defineProperty(window, 'parent', { value: opts.parent, configurable: true });
  ({ initFileEditor } = await import('../file-editor.ts'));
}

async function open(hash = '#/blob/o/r/feature/x/docs/a.md'): Promise<void> {
  location.hash = hash;
  await initFileEditor(app());
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('notehub:token', 't');
  branches = ['feature/x'];
  files = { 'docs/a.md': { text: 'one\ntwo\n', sha: 's1' } };
  puts = [];
  putError = getError = null;
  holdPuts = null;
  fake.reset();
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(window, 'close').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  await load();
});

afterEach(() => {
  // pagehide makes each editor flush, which cancels its pending draft timer; left
  // running, it fires in a later test and writes a draft that test can't delete.
  window.dispatchEvent(new Event('pagehide'));
  for (const [type, fn] of listeners.splice(0)) window.removeEventListener(type, fn);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'parent', { value: window, configurable: true });
});

// ── Tests ───────────────────────────────────────────────────────────

describe('file editor: opening', () => {
  it('refuses veditor older than 0.45', async () => {
    fake.reset('0.44.2');
    await open();
    expect(app().textContent).toMatch(/veditor 0\.44\.2 is too old/);
    expect(fake.isOpen()).toBe(false);
  });

  it('opens a slashed branch with the file on it', async () => {
    await open();
    expect(app().querySelector('.file-ref')!.textContent).toBe('o/r @ feature/x');
    expect(fake.getEditorContent()).toBe('one\ntwo\n');
  });
});

describe('file editor: saving', () => {
  it('commits with branch and sha, then uses the new sha', async () => {
    await open();
    fake.type('three\n');
    expect(await save()).toBe(true);
    expect(puts[0]).toMatchObject({ message: 'Update a.md via veditor', sha: 's1', branch: 'feature/x' });
    expect(files['docs/a.md'].text).toBe('one\ntwo\nthree\n');
    expect(fake.isDirty()).toBe(false);
    expect(status()).toBe('Committed to feature/x');

    fake.type('four\n');
    await save();
    expect(puts[1].sha).toBe('s2');
  });

  it('converts back to CRLF on save', async () => {
    files['docs/a.md'].text = 'one\r\ntwo\r\n';
    await open();
    expect(fake.getEditorContent()).toBe('one\ntwo\n');
    fake.type('three\n');
    await save();
    expect(files['docs/a.md'].text).toBe('one\r\ntwo\r\nthree\r\n');
  });

  it('returns false on Esc at the commit bar: nothing sent, still dirty', async () => {
    await open();
    fake.type('x');
    expect(await save('Escape')).toBe(false);
    expect(puts).toHaveLength(0);
    expect(fake.isDirty()).toBe(true);
    expect(status()).toBe('Not committed');
  });

  it('returns false when the commit fails, with the reason', async () => {
    await open();
    fake.type('x');
    putError = { status: 409, message: 'Protected branch update failed' };
    expect(await save()).toBe(false);
    expect(fake.isDirty()).toBe(true);
    expect(status()).toBe("Can't commit to feature/x: Protected branch update failed");
  });

  it('reports a failed re-check as such, not as a branch rule', async () => {
    await open();
    fake.type('x');
    putError = { status: 409, message: 'does not match' };
    getError = { status: 404, message: 'Not Found' };
    expect(await save()).toBe(false);
    expect(status()).toMatch(/deleted or moved upstream/);
  });

  it('refuses a second :w while the commit bar is open, and the first still settles', async () => {
    await open();
    fake.type('x');
    const first = fake.requestSave();
    await tick();
    expect(await fake.requestSave()).toBe(false);
    expect(document.querySelectorAll('.commit-prompt')).toHaveLength(1);
    pressInPrompt('Enter');
    expect(await first).toBe(true);
    expect(puts).toHaveLength(1);
  });

  it('focuses the commit bar after the vim ex dialog hands focus back to the editor', async () => {
    await open();
    fake.type('x');
    const done = fake.requestSave();
    // What the vim ex dialog does once :w returns: refocus the editor.
    const editorStandIn = document.createElement('button');
    document.body.appendChild(editorStandIn);
    editorStandIn.focus();
    await tick();
    expect(document.activeElement).toBe(commitInput());
    pressInPrompt('Enter');
    expect(await done).toBe(true);
  });

  it('refuses a second :w during the PUT, so it never sends a stale sha', async () => {
    await open();
    fake.type('x');
    holdPuts = [];
    const first = save();
    await tick();
    fake.type('y');
    expect(await fake.requestSave()).toBe(false);
    expect(puts).toHaveLength(1);
    holdPuts.forEach(r => r());
    holdPuts = null;
    expect(await first).toBe(true);
    expect(fake.isDirty()).toBe(true); // 'y' was typed after the snapshot
    await save();
    expect(puts[1].sha).toBe('s2');
  });
});

describe('file editor: quitting in a window', () => {
  it('closes the window on :q', async () => {
    await open();
    fake.requestQuit();
    expect(window.close).toHaveBeenCalled();
    expect(app().textContent).toMatch(/You can close this tab/);
  });
});

describe('file editor: quitting in a barouse frame', () => {
  let parentFrame: HTMLIFrameElement;
  let parentWin: Window;
  let posted: unknown[];

  beforeEach(async () => {
    parentFrame = document.createElement('iframe');
    document.body.appendChild(parentFrame);
    parentWin = parentFrame.contentWindow!;
    posted = [];
    vi.spyOn(parentWin, 'postMessage').mockImplementation((m: unknown) => { posted.push(m); });
    await load({ parent: parentWin });
  });

  const requestQuit = (source: Window) =>
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'barouse:request-quit' }, source }));

  it('posts editor-closed to the parent on :q, and never closes the window', async () => {
    await open();
    fake.requestQuit();
    expect(posted).toEqual([{ type: 'barouse:editor-closed' }]);
    expect(window.close).not.toHaveBeenCalled();
  });

  it('request-quit from the parent goes through veditor, so a dirty buffer is confirmed', async () => {
    await open();
    fake.type('x');
    requestQuit(parentWin);
    expect(fake.quitBlocked).toBe(true);
    expect(posted).toEqual([]);
    fake.discardAndQuit();
    expect(posted).toEqual([{ type: 'barouse:editor-closed' }]);
  });

  it('ignores request-quit from any other window', async () => {
    await open();
    requestQuit(window);
    expect(fake.isOpen()).toBe(true);
    expect(posted).toEqual([]);
  });

  it('closes at once on request-quit while an error is shown', async () => {
    await open('#/blob/o/r/v1.0/docs/a.md');
    expect(app().textContent).toMatch(/Not a branch: v1\.0/);
    requestQuit(parentWin);
    expect(posted).toEqual([{ type: 'barouse:editor-closed' }]);
  });

  it('closes once loading ends when request-quit came during loading', async () => {
    location.hash = '#/blob/o/r/feature/x/docs/a.md';
    const loading = initFileEditor(app());
    requestQuit(parentWin);
    await loading;
    expect(posted).toEqual([{ type: 'barouse:editor-closed' }]);
    expect(fake.isOpen()).toBe(false);
  });
});

// ── Drafts ──────────────────────────────────────────────────────────

describe('file editor: drafts', () => {
  const KEY = draftKey({ host: DEFAULT_HOST, owner: 'o', repo: 'r', ref: 'feature/x', path: 'docs/a.md' });
  const stored = () => readDraft(localStorage, KEY);
  const flush = () => window.dispatchEvent(new Event('pagehide'));
  const put = (over: Partial<Draft> = {}) =>
    writeDraft(localStorage, KEY, { text: 'one\ntwo\ndraft\n', baseSha: 's1', savedAt: Date.now(), instance: 'old', ...over });
  const promptBar = () => document.querySelector<HTMLElement>('.draft-prompt');
  const pressInBar = (key: string, target: HTMLElement = promptBar()!) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  /** Open while a draft prompt is up: resolves the open once the prompt is answered. */
  async function openWithPrompt(): Promise<{ opening: Promise<void> }> {
    location.hash = '#/blob/o/r/feature/x/docs/a.md';
    const opening = initFileEditor(app());
    await vi.waitFor(() => expect(promptBar()).not.toBeNull());
    return { opening }; // wrapped: returning the promise itself would wait for the answer
  }

  it('writes a draft after edits (debounced) and on pagehide', async () => {
    await open();
    fake.type('x');
    expect(stored()).toBeNull();
    await vi.waitFor(() => expect(stored()?.text).toBe('one\ntwo\nx'), { timeout: 1500 });
    fake.type('y');
    flush();
    expect(stored()).toMatchObject({ text: 'one\ntwo\nxy', baseSha: 's1' });
  });

  it('deletes the draft on commit and on a clean quit', async () => {
    await open();
    fake.type('x');
    flush();
    await save();
    expect(stored()).toBeNull();
    fake.type('y');
    flush();
    fake.requestQuit(true);
    expect(stored()).toBeNull();
  });

  it('says so when storage is full', async () => {
    await open();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    fake.type('x');
    flush();
    expect(status()).toBe('Draft not saved: storage full');
  });

  it('keeps the draft when quitting after an upstream change, and offers it as stale next time', async () => {
    await open();
    fake.type('mine\n');
    putError = { status: 409, message: 'does not match' };
    files['docs/a.md'] = { text: 'theirs\n', sha: 'other' };
    expect(await save()).toBe(false);
    expect(status()).toMatch(/changed upstream.*kept as a draft/);
    fake.requestQuit(true); // :q!
    expect(stored()).toMatchObject({ text: 'one\ntwo\nmine\n', baseSha: 's1' });

    const { opening } = await openWithPrompt();
    expect(promptBar()!.textContent).toMatch(/based on an older version/);
    expect(fake.isOpen()).toBe(false); // nothing to type into until it's answered
    const text = document.querySelector<HTMLTextAreaElement>('.draft-text')!;
    expect(text.readOnly).toBe(true);
    expect(text.value).toBe('one\ntwo\nmine\n');
    expect(document.activeElement).toBe(text);
    pressInBar('Enter', text); // does nothing for a stale draft
    expect(promptBar()).not.toBeNull();
    pressInBar('d', text);
    await opening;
    expect(stored()).toBeNull();
    expect(fake.getEditorContent()).toBe('theirs\n');
  });

  it('file deleted upstream: no draft promised, the edits shown to copy now', async () => {
    await open();
    fake.type('mine\n');
    putError = { status: 409, message: 'does not match' };
    getError = { status: 404, message: 'Not Found' };
    expect(await save()).toBe(false);
    expect(status()).toMatch(/deleted or moved upstream/);
    expect(status()).not.toMatch(/draft/);
    const text = document.querySelector<HTMLTextAreaElement>('.draft-text')!;
    expect(promptBar()!.textContent).toMatch(/Copy your edits now/);
    expect(text.readOnly).toBe(true);
    expect(text.value).toBe('one\ntwo\nmine\n');
    expect(document.activeElement).toBe(text);
    pressInBar('Escape', text);
    expect(promptBar()).toBeNull();
    flush();
    fake.requestQuit(true); // :q!: nothing would ever offer the draft, so it goes
    expect(stored()).toBeNull();
  });

  it('upstream change with storage full: says the edits are not kept, and shows them to copy', async () => {
    await open();
    fake.type('mine\n');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    putError = { status: 409, message: 'does not match' };
    files['docs/a.md'] = { text: 'theirs\n', sha: 'other' };
    expect(await save()).toBe(false);
    expect(status()).toMatch(/changed upstream/);
    expect(status()).not.toMatch(/kept as a draft/);
    expect(promptBar()!.textContent).toMatch(/storage full.*Copy your edits now/);
    expect(document.querySelector<HTMLTextAreaElement>('.draft-text')!.value).toBe('one\ntwo\nmine\n');
  });

  it('restores a draft made on the current version, as an unsaved edit', async () => {
    put();
    const { opening } = await openWithPrompt();
    expect(promptBar()!.textContent).toMatch(/Unsaved draft/);
    pressInBar('Enter');
    await opening;
    expect(fake.getEditorContent()).toBe('one\ntwo\ndraft\n');
    expect(fake.isDirty()).toBe(true);
    flush();
    expect(stored()!.instance).not.toBe('old'); // ours now
  });

  it('Keep leaves the old draft alone and turns new drafts off', async () => {
    put({ baseSha: 'older' });
    const { opening } = await openWithPrompt();
    pressInBar('k', document.querySelector<HTMLElement>('.draft-text')!);
    await opening;
    expect(status()).toMatch(/Older draft kept/);
    fake.type('new');
    flush();
    fake.requestQuit(true);
    expect(stored()).toMatchObject({ text: 'one\ntwo\ndraft\n', instance: 'old' });
  });

  it('never deletes a draft another editor wrote', async () => {
    await open();
    fake.type('x');
    flush();
    put({ text: 'one\ntwo\nother\n', instance: 'popup' }); // the same file, open elsewhere
    fake.requestQuit(true);
    expect(stored()!.instance).toBe('popup');
  });
});

describe('file editor: drafts in a barouse frame', () => {
  it('request-quit during the draft prompt keeps the draft and closes', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const parentWin = frame.contentWindow!;
    const posted: unknown[] = [];
    vi.spyOn(parentWin, 'postMessage').mockImplementation((m: unknown) => { posted.push(m); });
    await load({ parent: parentWin });
    const key = draftKey({ host: DEFAULT_HOST, owner: 'o', repo: 'r', ref: 'feature/x', path: 'docs/a.md' });
    writeDraft(localStorage, key, { text: 'draft', baseSha: 's1', savedAt: Date.now(), instance: 'old' });

    location.hash = '#/blob/o/r/feature/x/docs/a.md';
    const opening = initFileEditor(app());
    await vi.waitFor(() => expect(document.querySelector('.draft-prompt')).not.toBeNull());
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'barouse:request-quit' }, source: parentWin }));
    await opening;
    expect(posted).toEqual([{ type: 'barouse:editor-closed' }]);
    expect(fake.isOpen()).toBe(false);
    expect(readDraft(localStorage, key)!.text).toBe('draft');
  });

  it('request-quit while loading, with a draft: closes without offering it, and keeps it', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const parentWin = frame.contentWindow!;
    const posted: unknown[] = [];
    vi.spyOn(parentWin, 'postMessage').mockImplementation((m: unknown) => { posted.push(m); });
    await load({ parent: parentWin });
    const key = draftKey({ host: DEFAULT_HOST, owner: 'o', repo: 'r', ref: 'feature/x', path: 'docs/a.md' });
    writeDraft(localStorage, key, { text: 'draft', baseSha: 's1', savedAt: Date.now(), instance: 'old' });

    location.hash = '#/blob/o/r/feature/x/docs/a.md';
    const opening = initFileEditor(app());
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'barouse:request-quit' }, source: parentWin }));
    await opening; // would hang on the prompt without the fix
    expect(document.querySelector('.draft-prompt')).toBeNull();
    expect(posted).toEqual([{ type: 'barouse:editor-closed' }]);
    expect(fake.isOpen()).toBe(false);
    expect(readDraft(localStorage, key)!.text).toBe('draft');
  });
});
