import { describe, it, expect } from 'vitest';
import { parseContent } from '../parser.ts';
import type { Section, Group } from '../parser.ts';
import { resolveTarget } from '../drop-handler.ts';

const DOC = `# Root

- https://root-a.com
- https://root-b.com

## Music

- Theory
  - https://theory-a.com
  - https://theory-b.com
  * Scales
    - https://scales-a.com
- Practice
  - https://practice-a.com

## Cooking

- Recipes
  - https://recipes-a.com
`;

function lines(): string[] {
  return DOC.split('\n');
}

describe('resolveTarget', () => {
  it('resolves a top-level link run', () => {
    const t = resolveTarget(parseContent(DOC), 'l0')!;
    expect(t).not.toBeNull();
    // insert after the last root link (line 3), indent 0
    expect(t.insertAt).toBe(4);
    expect(t.indent).toBe(0);
  });

  it('resolves a section', () => {
    const t = resolveTarget(parseContent(DOC), 's0')!;
    expect(t.label).toBe('Music');
    const ls = lines();
    // last line belonging to Music section is "  - https://practice-a.com" (line 13)
    expect(ls[t.insertAt - 1].trim()).toBe('- https://practice-a.com');
    expect(t.indent).toBe(0);
  });

  it('resolves a group inside a section', () => {
    const t = resolveTarget(parseContent(DOC), 's0/g0')!;
    expect(t.label).toBe('Music / Theory');
    const ls = lines();
    // last line of Theory group is the scales link (line 9)
    expect(ls[t.insertAt - 1].trim()).toBe('- https://scales-a.com');
    expect(t.indent).toBe(2);
  });

  it('resolves a sublevel', () => {
    const t = resolveTarget(parseContent(DOC), 's0/g0/v0')!;
    expect(t.label).toBe('Music / Theory / Scales');
    const ls = lines();
    expect(ls[t.insertAt - 1].trim()).toBe('- https://scales-a.com');
    expect(t.indent).toBe(4);
  });

  it('resolves the second section', () => {
    const t = resolveTarget(parseContent(DOC), 's1')!;
    expect(t.label).toBe('Cooking');
  });

  it('returns null for a stale path', () => {
    expect(resolveTarget(parseContent(DOC), 's5')).toBeNull();
    expect(resolveTarget(parseContent(DOC), 's0/g9')).toBeNull();
    expect(resolveTarget(parseContent(DOC), 'bogus')).toBeNull();
  });

  it('inserting at insertAt keeps the document parseable with the new link in the right group', () => {
    const doc = parseContent(DOC);
    const t = resolveTarget(doc, 's0/g1')!;
    expect(t.label).toBe('Music / Practice');
    const ls = lines();
    ls.splice(t.insertAt, 0, `${' '.repeat(t.indent)}- New https://new.com`);
    const doc2 = parseContent(ls.join('\n'));
    const sec = doc2.items.filter((i): i is Section => i.type === 'section').find(s => s.name === 'Music')!;
    const grp = sec.items.filter((i): i is Group => i.type === 'group').find(g => g.name === 'Practice')!;
    const urls = grp.children.map(c => c.type === 'link' ? c.url : '(sublevel)');
    expect(urls).toContain('https://new.com');
  });
});
