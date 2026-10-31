# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Metabrowse is a browser-side single-page application (SPA) for organizing and browsing bookmarks. It fetches markdown content from a GitHub repository at runtime via the GitHub API, parses it in the browser, and renders interactive HTML with collapsible sections, grouped links, search, and inline editing.

**Architecture**: Code and content are separated into different repositories:
- **Code repository** (this repo): TypeScript SPA built with Vite, deployed to GitHub Pages
- **Content repositories** (e.g., `metabrowse-links`): Contain `text/` directories with markdown files. No build step — the SPA reads them directly via the GitHub Contents API.

Key features:
1. **Collapsible sections** - `## headers` render as expandable `<details>` sections; groups and standalone links organize content within them
2. **Smart tab reuse** - deterministic SHA256-based targets for external URLs; internal navigation stays in the same tab
3. **Multi-level hierarchy** - client-side hash router maps paths like `#/topic/subtopic` to `text/topic/subtopic/README.md`
4. **Clickable breadcrumb navigation** - generated from the current hash path
5. **Auto-generated child navigation** - discovers subdirectories via the GitHub Trees API
6. **Inline editing** - launches veditor.web in a new tab to edit content files via the GitHub Contents API
7. **Favicon fetching** - loads and caches favicons for external links
8. **Unified search** - local in-page filter (`/` key) and global cross-page search (`Ctrl+K`)
9. **Keyboard shortcuts** - `/` search, `Ctrl+K` global search, `e` edit, `c` collapse all, `r` reload

## Build Commands

```bash
cd metabrowse
npm install                                    # First time only
VITE_BASE=/ npm run dev                        # Dev server at http://localhost:3000
VITE_BASE=/metabrowse/ npm run build           # Production build for GitHub Pages
npm test                                       # Run vitest tests
npm run test:watch                             # Watch mode
```

**Environment variables:**
- `VITE_BASE` (required): Base path for deployment (e.g., `/metabrowse/` for GitHub Pages, `/` for local dev)
- `VITE_VEDITOR_BASE`: Override veditor.web URL (default: `https://stabledog.github.io/veditor.web/`; required for GHES)

## Architecture

The SPA implements a modular pipeline that runs entirely in the browser:

### Entry Point
- **`main.ts`** (4 lines) — Imports CSS, calls `init()` from app.ts

### App Shell (`app.ts`)
- Orchestrates auth flow (GitHub PAT via localStorage), data fetching, and rendering
- On each navigation: fetches README.md via GitHub API → parses → transforms → renders
- Discovers child directories via the GitHub Trees API

### Parser (`parser.ts`)
- Extracts structured data (sections, groups, links) from markdown text
- **Sections**: `## Header` lines create collapsible containers that hold groups and links
- **Groups**: `- Text` lines containing no URL become group headers; indented lines below are children
- **Links**: plain URLs, markdown links, `{target="..."}` overrides, raw HTML `<a>` tags, title+URL format
- Extracts inline comments: `# comment text` after links/groups/sections
- `# Title` (H1) lines are silently ignored
- Returns `ParsedDocument` with top-level items (sections, groups, and standalone links)

### Transformer (`transformer.ts`)
- Converts parsed data to render-ready structures
- Generates deterministic SHA256-based targets (first 8 hex chars) for external URLs
- Internal/relative URLs get `target="_self"`
- Explicit `{target="..."}` attributes override both behaviors

### Renderer (`renderer.ts`)
- Builds DOM elements from transformed data
- **Sections** render as collapsible `<details>`/`<summary>` (open by default)
- **Groups** render as non-collapsible `<div class="subgroup">` with a header and child link list
- **Link groups** (consecutive standalone links) render as a flat `<ul class="links">`
- Renders breadcrumbs, child directory buttons, edit links

### Router (`router.ts`)
- Client-side hash-based routing
- Maps `#/path/to/topic` → fetches `text/path/to/topic/README.md`
- Listens for `hashchange` events

### Search (`search.ts`)
- **Local mode**: Filters current page content in-place (links, groups, child buttons)
- **Global mode**: Builds a search index by fetching all README.md files, searches across all pages
- Search state persists in localStorage across navigations

### Editor Integration (`editor.ts`)
- Launches veditor.web (CodeMirror 6 + vim mode) in a new tab
- Loaded at runtime from GitHub Pages via dynamic `import()`

### File Editor Route (`file-editor.ts`, `blob-route.ts`)
- `#/blob/<owner>/<repo>/<ref...>/<path...>` edits one file on any repo the token can reach. `main.ts` dispatches to it before `init()`, so it never needs a content repo; the browse router reserves `blob/` like `edit/`. Both use `isBlobHash`: if they disagreed, `handleRoute`'s reload would loop
- Needs veditor >= 0.45 (`onSave` result, `onChange`); `initFileEditor` refuses older versions
- The ref is the shortest prefix of the segments that is a branch; anything else (SHA, tag) is refused
- `:w` → commit-message bar → PUT with `branch` and `sha`; `onSave` returns `false` when cancelled or failed so veditor keeps the buffer dirty. Autosave is off
- Opened by barouse in a popup or a sidebar iframe: `onQuit` closes the window, or posts `barouse:editor-closed` to the parent when framed; the parent can send `barouse:request-quit`, which is honoured in every state (loading, editing, or an error shown). While framed it also posts `barouse:editor-dirty {dirty}` whenever the buffer starts or stops differing from the last commit (barouse marks its editor button)
- One commit at a time: a `:w` while the commit bar is open or a PUT is in flight returns `false`
- `file-editor.test.ts` runs under jsdom against `fake-veditor.ts`, a stand-in with veditor's 0.45 save/quit contract
- Drafts (`drafts.ts`): veditor's `onChange` → debounced `localStorage` write, also on `pagehide`. An existing draft is offered before the editor opens (restore, or for one made on an older sha, show it read-only to copy from). Each draft records the editor instance that wrote it, and an editor only deletes its own. Quitting deletes it, except after a commit failed because the file changed upstream. When a failed commit can't leave the edits in a draft (file deleted upstream, drafts off, storage full), they're shown at once in the same read-only textarea to copy. With text to copy, the bar takes most of the screen (all of it before the editor exists) and uses the editor's font
- Pure logic lives in `blob-route.ts` and `drafts.ts` and is unit tested

### Supporting Modules
- **`github.ts`** — GitHub API client (token validation, tree fetching, content retrieval)
- **`favicon.ts`** — Fetches and caches favicons for external links via localStorage
- **`keyboard.ts`** — Keyboard shortcut bindings
- **`cache.ts`** — localStorage-based cache layer

## Directory Structure

```
metabrowse/
├── .github/workflows/
│   └── deploy.yml          # Build + deploy SPA to gh-pages
├── index.html              # Minimal SPA entry point
├── vite.config.ts          # Vite config (requires VITE_BASE)
├── tsconfig.json           # TypeScript strict mode
├── package.json            # npm deps: vite, vitest, typescript, gh-pages
├── Makefile                # Dev commands (npm-based)
├── metabrowse-wiz.sh       # Content wizard for creating directories
├── public/
│   ├── favicon.ico
│   └── favicon.png
└── src/
    ├── main.ts             # Entry: import CSS, call init()
    ├── app.ts              # App shell: auth, fetch, orchestration
    ├── parser.ts           # Markdown → structured data
    ├── transformer.ts      # Structured data → render-ready
    ├── renderer.ts         # Render-ready → DOM
    ├── router.ts           # Hash-based client-side routing
    ├── search.ts           # Local filter + global cross-page search
    ├── editor.ts           # veditor.web integration
    ├── github.ts           # GitHub API client
    ├── favicon.ts          # Favicon loading/caching
    ├── keyboard.ts         # Keyboard shortcuts
    ├── cache.ts            # localStorage cache
    ├── style.css           # All styles
    ├── veditor.d.ts        # Type declarations for veditor.web
    └── __tests__/
        ├── parser.test.ts
        ├── transformer.test.ts
        └── fixtures/       # Test markdown files
```

**Content repository** (e.g., `metabrowse-links`):
```
metabrowse-links/
├── text/                   # Source markdown files
│   ├── README.md           # Root index
│   ├── <topic>/
│   │   └── README.md
│   └── <topic>/<subtopic>/
│       └── README.md       # Unlimited nesting
└── .gitignore
```

No build step in the content repo — the metabrowse SPA reads `text/` directly via the GitHub API.

## Markdown Syntax for Content Files

The parser recognizes three entity types: **sections**, **groups**, and **links**.

### Sections (collapsible)

Lines starting with `## ` create collapsible `<details>` sections (open by default). Everything following a `## ` header until the next `## ` header (or end of file) belongs to that section.

```markdown
## Section Name # Optional comment
- https://link1.com
- Group Name
  - https://link2.com
```

### Groups (non-collapsible)

A bullet line (`- `) containing no URL becomes a group header. Indented lines below it are its children. Groups render as a labeled block with a header and a child link list -- they are **not** collapsible.

```markdown
- Group Name # Optional comment
  - https://link1.com # Optional comment
  - Link title https://link2.com
  - [Link text](https://link3.com)
```

A group ends when indentation returns to the group's level or lower (e.g., the next top-level `- ` line or a new `## ` header).

### Sublevels (subdivisions within a group)

A `* ` line inside a group creates a sublevel — a titled, non-collapsible subdivision. Indented lines below are its child links.

```markdown
- Group Name
    * Sublevel Title # Optional comment
        - https://link1.com
        - https://link2.com
    * Another Sublevel
        - https://link3.com
    - https://direct-group-link.com
```

Sublevels close when indentation changes from the established child level, a new `* ` or `- ` marker appears at the same level, or a new section starts. A `* ` line outside a group (orphan) renders as `<code>` to signal an editing error. Sublevels do not nest.

### Links

Links can appear standalone (at top level or inside a section) or as children inside a group. Consecutive standalone links are rendered together as a flat list.

**Supported link formats**:
- Plain URL: `- https://example.com`
- With title: `- Link title https://example.com`
- Markdown: `- [Link text](https://example.com)`
- With explicit target: `- [Link text](https://example.com){target="_custom"}`
- Raw HTML: `- <a href="https://example.com">Text</a>`
- Any scheme: `- chrome://settings`, `- mailto:user@example.com`

### Comments

Any entity (section, group, or link) can have an inline comment after ` # ` (space-hash-space). The `#` must be preceded by whitespace to distinguish from URL fragments like `page#section`.

### Other

- `# Title` (H1) lines are silently ignored by the parser
- Blank lines are skipped
- **Child directories**: Subdirectories containing README.md are automatically discovered and displayed as navigation buttons. No manual linking needed.

## Development Workflow

1. Parser changes (`parser.ts`) affect markdown extraction
2. Transformer changes (`transformer.ts`) affect target generation
3. Renderer changes (`renderer.ts`) affect DOM output
4. App changes (`app.ts`) affect auth, data fetching, routing orchestration

Run `npm test` after changes to verify parser/transformer behavior.

**Shell script coding standards:**
- `metabrowse-wiz.sh` MUST pass the `check-bash` skill from `~/.local/bin/bashics`
- Run `~/.local/bin/bashics/check-bash metabrowse-wiz.sh` before committing

## Deployment

The metabrowse SPA deploys via GitHub Actions (`.github/workflows/deploy.yml`):
- Triggered on push to `main` when `src/`, `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, or `.github/workflows/` change
- Builds with `VITE_BASE=/metabrowse/` and deploys `dist/` to the `gh-pages` branch via `npx gh-pages`
- Served at `https://stabledog.github.io/metabrowse/`

Content repos (e.g., `metabrowse-links`) have no CI — the SPA fetches their `text/` files at runtime via the GitHub API. Pushing content changes to the content repo makes them immediately visible (no rebuild needed).
