// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fake from './fake-veditor.ts';

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
