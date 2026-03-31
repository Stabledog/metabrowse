# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Metabrowse is a markdown-to-HTML static site generator designed for teaching materials.

**Architecture**: Code and content are separated into different repositories:
- **Code repository** (this repo): Build pipeline, parsers, transformers, templates
- **Content repositories**: User's `text/` markdown files; `docs/` is a local build artifact (gitignored), deployed to `gh-pages` branch via GitHub Actions

The build script (`build-metabrowse.sh`) is run from a content directory and invokes the build pipeline to convert README.md files in `text/` to HTML in `docs/` with these key features:
1. **Collapsible link groups** - organize links into expandable sections
2. **Smart tab behavior** - distinguishes between navigation and content:
   - External URLs (http/https) get deterministic hash-based targets for tab reuse
   - Internal navigation links stay in the same tab (target="_self")
3. **Multi-level hierarchy** - supports unlimited directory nesting (e.g., `text/course/topic/subtopic/README.md`)
4. **Clickable breadcrumb navigation** - displays full path with each segment clickable
   - Example: "Metabrowse / Calcrt / Basics" where "Metabrowse" and "Calcrt" are links
   - Current page shown in bold, not clickable
5. **Auto-generated child navigation** - automatically detects and displays child directories with README.md files
   - Displayed as horizontal buttons with wrapping support
   - Sorted alphabetically, directory names formatted with title case
6. **Favicon support** - automatically copies `text/favicon.png` to `docs/` and links it in all pages
7. **Edit links** - "Edit" button on every page links to source README.md in the git web interface
   - Auto-detects repository host, organization, and branch from git remote
   - Supports GitHub, GitLab, and other git hosting services
   - Opens in new tab to preserve navigation state
8. **Inline comments** - add `# comment text` to any link or group for context
   - Displayed as small gray italic text below the link/group
   - Plain text only, no markup interpretation
9. **Unified search** - single search box with local/global mode toggle:
   - **Global mode** (default): searches across all pages using build-time JSON index, results shown in dropdown panel below search box
   - **Local mode**: filters current page content (links, groups, child buttons) in-place
   - Toggle between modes with checkbox, or use keyboard shortcuts: `/` for local, `Ctrl+K` for global
   - Search term and mode persist across page navigations via localStorage
   - Clear button (×) appears when search has content

## Build Commands

**Content setup** (creating directories with templates):
```bash
cd /path/to/my-metabrowse-links
/path/to/metabrowse/metabrowse-wiz.sh mkdir python-basics
/path/to/metabrowse/metabrowse-wiz.sh mktree math/{algebra,geometry} science/physics
```

**User workflow** (from content directory):
```bash
cd /path/to/my-metabrowse-links
/path/to/metabrowse/build-metabrowse.sh

# Preview locally (optional - docs/ is gitignored, only for local testing)
/path/to/metabrowse/serve-metabrowse.sh
# Visit http://localhost:3000 to preview
# Press Ctrl+C to stop server
```

**Developer workflow** (testing changes to build pipeline):
```bash
# From a content directory
cd /path/to/test-content
~/.local/bin/python3 /path/to/metabrowse/build.py

# Preview locally
/path/to/metabrowse/serve-metabrowse.sh -p 9000
```

**Dependencies:**
```bash
~/.local/bin/python3 -m pip install -r requirements.txt
```

**Environment variables:**
- `METABROWSE_CODE_DIR`: Override location of code repository (default: directory containing build-metabrowse.sh)
- `METABROWSE_PYTHON`: Override Python interpreter (default: `~/.local/bin/python3`)
- `METABROWSE_PORT`: Port for local web server (default: 3000, used by serve-metabrowse.sh)

Note: This project uses `~/.local/bin/python3` as the default Python interpreter path.

## Architecture

The codebase implements a three-stage pipeline:

### 1. Parser (`parser.py`)
- Reads README.md files and extracts structured data
- Uses regex patterns to identify different link formats:
  - Plain URLs: `https://example.com`
  - Markdown links: `[text](url)` or `[text](url){target="..."}`
  - Raw HTML `<a>` tags (passed through unchanged)
  - Title + URL: `Title text https://example.com`
- Detects groups: lines starting with `- ` but containing no URL
- Extracts comments: everything after `#` on the same line (via `_extract_comment()`)
  - Handles URL fragments correctly by looking for `#` preceded by whitespace
- Returns `ParsedDocument` containing ungrouped links and groups

Key classes:
- `Link`: Represents a single link with metadata (url, text, target, indent_level, comment)
- `Group`: Represents a collapsible group with name, child links, and optional comment
- `ParsedDocument`: Contains ungrouped_links and groups

### 2. Transformer (`transformer.py`)
- Converts parsed data to HTML-ready structures
- **Critical feature**: Generates deterministic target names using SHA256 hash (first 8 chars)
  - External URLs (http/https) get hash-based targets → enables tab reuse
  - Internal/relative URLs get `target="_self"` → metabrowse navigation stays in same tab
  - Explicit `{target="..."}` attributes override both behaviors
- Returns `HTMLDocument` with title, ungrouped_links, and groups

Key method: `generate_target(url)` - creates hash-based target for external URLs

### 3. Generator (`generator.py`)
- Uses Jinja2 templates to render final HTML
- Template location: `templates/index.html`
- Copies static assets (CSS, favicon.png) to docs/
- Creates `.nojekyll` file for GitHub Pages compatibility
- Calculates relative CSS and favicon paths for nested directories

### 4. Build Script (`build.py`)
- Orchestrates the pipeline
- **Uses current working directory as content root** (text/ and docs/ locations)
- Code location (templates, modules) determined from script's parent directory
- Walks `text/` directory tree to find all README.md files (unlimited depth)
- Mirrors directory structure: `text/foo/bar/README.md` → `docs/foo/bar/index.html`
- Generates clickable breadcrumb navigation via `get_breadcrumbs_from_path()`
- Calculates relative CSS and favicon paths based on nesting depth
- Auto-detects child directories containing README.md files via `find_child_directories()`
- Extracts git repository info via `get_git_info()` and generates edit URLs via `generate_edit_url()`

### 5. Build Wrapper (`build-metabrowse.sh`)
- User-facing entry point for building content
- **Follows bashics coding standards** (see `~/.local/bin/bashics/docs/`)
- Run from content directory (containing text/ and docs/)
- Validates content directory structure
- Locates metabrowse code repository
- Invokes build.py with proper environment
- Provides helpful error messages for common issues

### 6. Content Wizard (`metabrowse-wiz.sh`)
- User-facing wizard for creating content directories with templates
- **Follows bashics coding standards** (see `~/.local/bin/bashics/docs/`)
- Run from content directory (containing text/)
- Commands:
  - `mkdir NAME`: Create single directory with template README.md
  - `mktree PATTERN [...]`: Create multiple directories using brace expansion
- Template README.md includes:
  - Sample links in various formats (plain URL, markdown, with title)
  - Example collapsible groups with comments
  - Usage notes explaining metabrowse syntax
- Supports nested brace expansion: `courses/{intro,advanced}/{week1,week2}`
- Automatically creates parent directories as needed
- Skips directories that already contain README.md files

## Directory Structure

**Code repository** (this repo):
```
metabrowse/
├── templates/            # Jinja2 templates
│   ├── index.html        # Main template
│   └── style.css         # Shared stylesheet
├── parser.py             # Stage 1: Extract links/groups
├── transformer.py        # Stage 2: Generate targets, prepare HTML data
├── generator.py          # Stage 3: Render templates
├── build.py              # Main orchestrator
├── build-metabrowse.sh   # User-facing build wrapper
├── serve-metabrowse.sh   # Local preview server for testing
├── metabrowse-wiz.sh     # Content wizard for creating directories
└── requirements.txt      # Python dependencies
```

**Content repository** (user's separate repo):
```
my-metabrowse-links/
├── .github/workflows/
│   └── build.yml         # GitHub Actions: build + deploy to gh-pages
├── text/                 # Source markdown files (input)
│   ├── README.md         # Root index
│   ├── <course>/
│   │   └── README.md     # Course-specific links
│   └── <course>/<topic>/
│       └── README.md     # Nested topic links (unlimited depth)
└── docs/                 # Local build artifact (gitignored, not committed)
```

**`gh-pages` branch** (auto-managed by GitHub Actions, never edited manually):
```
index.html
style.css
favicon.png
search-index.json
.nojekyll
<course>/index.html
...
```

## Markdown Syntax for text/ Files

**Important**: Child directories are automatically detected and displayed - you do NOT need to manually add links to child README.md files in the parent README.md.

**Groups** (collapsible sections):
```markdown
- Group Name # Optional comment about this group
  - https://link1.com # Optional comment about this link
  - Link title https://link2.com
  - [Link text](https://link3.com) # Comments work with all link formats
```

**Link formats supported**:
- Plain URL: `- https://example.com`
- With title: `- Link title https://example.com`
- Markdown: `- [Link text](https://example.com)`
- With explicit target: `- [Link text](https://example.com){target="_custom"}`
- Raw HTML: `- <a href="https://example.com">Text</a>`
- Any `scheme://` URL: `- chrome://settings` or `- edge://favorites`
- Mailto/tel/about: `- mailto:user@example.com` or `- tel:+1234567890`

**Comments**: Add `# comment text` at the end of any link or group line:
- Comments are displayed as small, gray, italic text below the link/group
- Plain text only - no markup or special formatting
- Comments are optional - links/groups without comments work as before
- Example: `- [Khan Academy](https://khanacademy.org) # Great for learning math`

**Group detection rule**: A line starting with `- ` that contains no URL is treated as a group header. Links indented with more spaces than the group header become children of that group.

**Child directory auto-linking**: When a directory contains subdirectories with README.md files (e.g., `text/calcrt/` contains `text/calcrt/basics/README.md`), the subdirectories are automatically displayed as horizontal navigation buttons. Directory names are formatted with title case (underscores and hyphens converted to spaces).

## Key Implementation Details

1. **Target generation**: The transformer distinguishes between navigation and payload links:
   - **External URLs** (any URL with a scheme — `://` or `mailto:`/`tel:`/`about:`): Use `hashlib.sha256(url.encode()).hexdigest()[:8]` for deterministic 8-character targets (enables tab reuse). Supported schemes include http, https, ftp, chrome, edge, brave, vscode, ssh, mailto, tel, about, and any other `word://` pattern.
   - **Internal URLs** (relative paths without a scheme): Use `target="_self"` to keep navigation in the same tab
   - **Explicit targets**: User-specified `{target="..."}` attributes override both behaviors

2. **Indentation handling**: The parser tracks indent levels (spaces before content) to determine group membership. Children must have more spaces than their parent group header.

3. **Path calculations**: Multiple functions compute relative paths based on directory depth:
   - `calculate_css_path()`: Relative path to style.css
   - `calculate_favicon_path()`: Relative path to favicon.png
   - Both use `../` multiplied by nesting depth

4. **Breadcrumb generation**: `get_breadcrumbs_from_path()` creates clickable navigation:
   - Returns tuple of (breadcrumbs_list, current_page_name)
   - Each breadcrumb has 'name' and 'url' keys with relative paths
   - Root always accessible from any depth via calculated `../` paths

5. **HTML rendering**: Uses `<details>` and `<summary>` elements for collapsible groups (no JavaScript needed). Breadcrumbs rendered in an `<h1>` tag for proper semantic structure and accessibility.

6. **Child directory auto-detection**: `find_child_directories()` scans for subdirectories containing README.md files. Children are sorted alphabetically and displayed as horizontal buttons using flexbox with wrapping.

7. **Favicon handling**: If `text/favicon.png` exists, it's copied to `docs/favicon.png` during build and linked with appropriate relative paths in all generated HTML files.

8. **Edit link generation**: `get_git_info()` parses `git remote get-url origin` to extract the git host, organization, repository, and branch. `generate_edit_url()` constructs edit URLs appropriate for the detected git hosting service:
   - **GitHub/GitHub Enterprise**: `https://{host}/{org}/{repo}/blob/{branch}/text/{path}/README.md`
   - **GitLab**: `https://{host}/{org}/{repo}/-/blob/{branch}/text/{path}/README.md`
   Edit links open in new tabs (target="_blank").

9. **Search index generation**: `build.py` generates `docs/search-index.json` containing all pages' links, groups, children, and breadcrumbs. Each page entry includes path, title, breadcrumbs string, links array (with text, url, group, comment), group names, and child names. The index is loaded lazily by the global search modal on first use.

10. **In-page filter**: Client-side JavaScript hides non-matching links, groups, and child buttons as the user types. Matches against link text, URLs, group names, and comments. Groups auto-expand when they contain matches. Keyboard shortcut `/` focuses the filter input.

11. **Global cross-page search**: A modal overlay (`Ctrl+K`) fetches `search-index.json` and searches across all pages. Results are grouped by page with breadcrumb paths, matching text highlighted with `<mark>`. Supports searching link text, URLs, comments, group names, child names, and page titles.

## Development Workflow

When modifying the pipeline:
1. Parser changes affect link/group extraction from markdown
2. Transformer changes affect target generation or data structure
3. Generator changes affect HTML rendering or template usage
4. Build script changes affect file discovery or path handling

After changes, run `make build` to regenerate all HTML files.

**Shell script coding standards:**
- All shell scripts MUST pass the `check-bash` skill from `~/.local/bin/bashics`
- Run `~/.local/bin/bashics/check-bash script-name.sh` before committing
- See `~/.local/bin/bashics/docs/` for detailed coding standards

## GitHub Pages Deployment

Content repositories deploy via GitHub Actions to a `gh-pages` branch:
- On push to `main` (when `text/**` or `.github/workflows/**` change), the workflow builds the site and deploys using `peaceiris/actions-gh-pages@v4`
- GitHub Pages is configured to serve from the `gh-pages` branch at root (`/`)
- `docs/` is gitignored on `main` — it exists only as a local build artifact
- The `gh-pages` branch is fully managed by the action; never edit it manually
- `.nojekyll` file disables Jekyll processing
- All paths are relative for portability
