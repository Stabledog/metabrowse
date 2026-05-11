# Metabrowse

A client-side SPA for browsing and editing personal link collections stored as markdown in GitHub repositories.

## Architecture

Metabrowse is a **TypeScript/Vite SPA** deployed to GitHub Pages. It fetches markdown content from a separate GitHub repository at runtime via the GitHub API, parses and renders it in the browser. No build step is needed for content — push markdown, it's live immediately.

- **This repo**: The SPA (parser, renderer, editor, search)
- **Content repo** (separate): Just `text/` markdown files on `main` branch (e.g., `bb-metabrowse-links`)
- **veditor.web** (shared): CodeMirror 6 + vim editor component, loaded at runtime from CDN

### Content repo structure

```
my-metabrowse-links/
├── text/
│   ├── README.md              # Root page
│   ├── teach/
│   │   ├── README.md          # Topic page
│   │   └── CPP/
│   │       └── README.md      # Nested topic
│   └── tools/
│       └── README.md
└── (no build artifacts — the SPA reads text/ directly)
```

## Quick Start

### Local development

```bash
npm install
VITE_BASE=/ npm run dev
```

Open in browser, enter your GitHub host, content owner/repo, and PAT on the auth screen.

### Deploy to GHES

From the parent workspace:
```bash
make deploy-metabrowse
```

Or manually:
```bash
VITE_BASE=/pages/<owner>/metabrowse/ \
VITE_VEDITOR_BASE=https://<ghes-host>/pages/<veditor-owner>/veditor.web/ \
VITE_DEFAULT_HOST=<ghes-host> \
npm run build

npx gh-pages -d dist
```

### Deploy to public GitHub

Push to `main` — GitHub Actions builds and deploys to gh-pages automatically.

## Features

- **No content build step**: Push markdown, see changes immediately
- **Collapsible sections**: `## Section Name` creates expandable `<details>` blocks
- **Groups**: Non-URL `- ` lines create sub-groups with their indented links
- **Browser tab reuse**: External URLs get deterministic hash-based targets
- **In-browser editor**: Click "Edit" (or press `e`) to edit content with vim keybindings via veditor.web
- **Search**: Local in-page filter (`/`) and global cross-page search (`Ctrl+K`)
- **Favicons**: Auto-loaded for http/https links with localStorage caching
- **Keyboard shortcuts**: `/` search, `Ctrl+K` global search, `e` edit, `c` collapse/restore, `r` reload
- **Hash routing**: `#/teach/CPP` maps to `text/teach/CPP/README.md`
- **PAT authentication**: Required — content repos are private

## Markdown Syntax

### Links

```markdown
- https://example.com
- Link title https://example.com
- [Link text](https://example.com)
- [Link text](https://example.com){target="_custom"}
- <a href="https://example.com">Raw HTML</a>
- chrome://settings
- mailto:user@example.com
```

### Comments

```markdown
- https://example.com # This comment appears below the link
- Group Name # Comments work on groups too
```

### Sections (collapsible)

```markdown
## Section Name
- https://link1.com
- https://link2.com
```

### Groups (non-collapsible)

```markdown
- Group Name
  - https://link1.com
  - https://link2.com
```

Groups are created when a `- ` line contains no URL. Indented lines below become children.

## Project Structure

```
metabrowse/
├── src/
│   ├── main.ts          # Entry point
│   ├── app.ts           # Auth, data flow, routing
│   ├── github.ts        # GitHub API (Trees + Contents)
│   ├── parser.ts        # Markdown → structured data
│   ├── transformer.ts   # Structured data → HTML-ready data
│   ├── renderer.ts      # DOM construction
│   ├── search.ts        # Local filter + global search
│   ├── favicon.ts       # Favicon loading + caching
│   ├── keyboard.ts      # Keyboard shortcuts
│   ├── editor.ts        # Editor view (veditor.web)
│   ├── cache.ts         # localStorage caching
│   ├── router.ts        # Hash-based routing
│   ├── veditor.d.ts     # veditor.web type declarations
│   └── style.css        # All styles
├── src/__tests__/       # Vitest tests
├── public/              # Favicon assets
├── index.html           # SPA entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .github/workflows/
    └── deploy.yml       # Public GitHub Pages deploy
```

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `VITE_BASE` | URL base path for deployment | Yes (build + dev) |
| `VITE_VEDITOR_BASE` | CDN URL for veditor.web | For editor functionality |
| `VITE_DEFAULT_HOST` | Default GitHub host | No (defaults to github.com) |

Content owner and repo are configured on the auth screen and stored in localStorage.

## Testing

```bash
VITE_BASE=/ npm test        # Run tests
VITE_BASE=/ npm run test:watch  # Watch mode
npx tsc --noEmit            # Type check
```


## Requirements

- Node.js 20+
- npm

