import { describe, it, expect } from 'vitest';
import {
  DRAFT_MAX_AGE_MS, draftKey, readDraft, writeDraft, pruneDrafts, draftDecision,
} from '../drafts.ts';
import type { Draft } from '../drafts.ts';

/** In-memory Storage; `quota` (in characters) makes setItem throw like a full localStorage. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  private quota: number;
  constructor(quota = Infinity) { this.quota = quota; }
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const DAY = 24 * 60 * 60 * 1000;
const draft = (over: Partial<Draft> = {}): Draft => ({ text: 'edited', baseSha: 's1', savedAt: 1000, ...over });

describe('draftKey', () => {
  it('is veditor-draft:<host>/<owner>/<repo>/<ref>/<path>', () => {
    expect(draftKey({ host: 'ghes.example.com', owner: 'o', repo: 'r', ref: 'feature/x', path: 'docs/a.md' }))
      .toBe('veditor-draft:ghes.example.com/o/r/feature/x/docs/a.md');
  });
});

describe('readDraft / writeDraft', () => {
  it('round-trips', () => {
    const s = new MemoryStorage();
    expect(writeDraft(s, 'k', draft())).toBe(true);
    expect(readDraft(s, 'k')).toEqual(draft());
  });

  it('reads missing, unparsable or wrong-shaped entries as null', () => {
    const s = new MemoryStorage();
    expect(readDraft(s, 'k')).toBeNull();
    s.setItem('k', '{not json');
    expect(readDraft(s, 'k')).toBeNull();
    s.setItem('k', JSON.stringify({ text: 'x' }));
    expect(readDraft(s, 'k')).toBeNull();
  });

  it('reports a full storage instead of throwing', () => {
    const s = new MemoryStorage(10);
    expect(writeDraft(s, 'k', draft())).toBe(false);
    expect(s.getItem('k')).toBeNull();
  });
});

describe('pruneDrafts', () => {
  it('deletes drafts older than 30 days and broken ones, and nothing else', () => {
    const now = 100 * DAY;
    const s = new MemoryStorage();
    writeDraft(s, 'veditor-draft:old', draft({ savedAt: now - DRAFT_MAX_AGE_MS - 1 }));
    writeDraft(s, 'veditor-draft:fresh', draft({ savedAt: now - DAY }));
    writeDraft(s, 'veditor-draft:edge', draft({ savedAt: now - DRAFT_MAX_AGE_MS }));
    s.setItem('veditor-draft:broken', 'nope');
    s.setItem('metabrowse:cache', JSON.stringify({ savedAt: 0 }));
    s.setItem('notehub:token', 'secret');

    expect(pruneDrafts(s, now)).toBe(2);
    expect(readDraft(s, 'veditor-draft:old')).toBeNull();
    expect(s.getItem('veditor-draft:broken')).toBeNull();
    expect(readDraft(s, 'veditor-draft:fresh')).not.toBeNull();
    expect(readDraft(s, 'veditor-draft:edge')).not.toBeNull();
    expect(s.getItem('metabrowse:cache')).not.toBeNull();
    expect(s.getItem('notehub:token')).toBe('secret');
  });
});

describe('draftDecision', () => {
  it('none without a draft, or when the draft matches the file', () => {
    expect(draftDecision(null, 's1', 'text')).toBe('none');
    expect(draftDecision(draft({ text: 'text' }), 's1', 'text')).toBe('none');
    expect(draftDecision(draft({ text: 'text', baseSha: 'old' }), 's1', 'text')).toBe('none');
  });

  it('restore when made on the current version', () => {
    expect(draftDecision(draft(), 's1', 'text')).toBe('restore');
  });

  it('stale when made on an older version: never loaded into the buffer', () => {
    expect(draftDecision(draft({ baseSha: 'old' }), 's1', 'text')).toBe('stale');
  });
});
