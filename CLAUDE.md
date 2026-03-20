# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Metabrowse is a markdown-to-HTML static site generator designed for teaching materials. It converts README.md files in `text/` to HTML in `docs/` with these key features:
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
7. **Edit links** - "Edit" button on every page links to source README.md in BBGitHub
   - Auto-detects repository from git remote
   - Opens in new tab to preserve navigation state
8. **Inline comments** - add `# comment text` to any link or group for context
   - Displayed as small gray italic text below the link/group
   - Plain text only, no markup interpretation

## Build Commands

```bash
# Build the entire site
make build
# or directly:
~/.local/bin/python3 build.py

# Clean generated files
make clean

# Install dependencies
~/.local/bin/python3 -m pip install -r requirements.txt
```

Note: This project uses `~/.local/bin/python3` as the Python interpreter path.

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
- Walks `text/` directory tree to find all README.md files (unlimited depth)
- Mirrors directory structure: `text/foo/bar/README.md` → `docs/foo/bar/index.html`
- Generates clickable breadcrumb navigation via `get_breadcrumbs_from_path()`
- Calculates relative CSS and favicon paths based on nesting depth
- Auto-detects child directories containing README.md files via `find_child_directories()`
- Extracts git repository info via `get_git_info()` and generates BBGitHub edit URLs via `generate_edit_url()`

## Directory Structure

```
metabrowse/
├── text/              # Source markdown files (input)
│   ├── README.md      # Root index
│   ├── <course>/
│   │   └── README.md  # Course-specific links
│   └── <course>/<topic>/
│       └── README.md  # Nested topic links (unlimited depth supported)
├── docs/              # Generated HTML (output, GitHub Pages)
├── templates/         # Jinja2 templates
│   ├── index.html     # Main template
│   └── style.css      # Shared stylesheet
├── parser.py          # Stage 1: Extract links/groups
├── transformer.py     # Stage 2: Generate targets, prepare HTML data
├── generator.py       # Stage 3: Render templates
└── build.py           # Main orchestrator
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

**Comments**: Add `# comment text` at the end of any link or group line:
- Comments are displayed as small, gray, italic text below the link/group
- Plain text only - no markup or special formatting
- Comments are optional - links/groups without comments work as before
- Example: `- [Khan Academy](https://khanacademy.org) # Great for learning math`

**Group detection rule**: A line starting with `- ` that contains no URL is treated as a group header. Links indented with more spaces than the group header become children of that group.

**Child directory auto-linking**: When a directory contains subdirectories with README.md files (e.g., `text/calcrt/` contains `text/calcrt/basics/README.md`), the subdirectories are automatically displayed as horizontal navigation buttons. Directory names are formatted with title case (underscores and hyphens converted to spaces).

## Key Implementation Details

1. **Target generation**: The transformer distinguishes between navigation and payload links:
   - **External URLs** (starting with http:// or https://): Use `hashlib.sha256(url.encode()).hexdigest()[:8]` for deterministic 8-character targets (enables tab reuse)
   - **Internal URLs** (relative paths): Use `target="_self"` to keep navigation in the same tab
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

8. **Edit link generation**: `get_git_info()` parses `git remote get-url origin` to extract organization, repository, and branch. `generate_edit_url()` constructs BBGitHub URLs in the format: `https://bbgithub.dev.bloomberg.com/{org}/{repo}/blob/{branch}/text/{path}/README.md`. Edit links open in new tabs (target="_blank").

## Development Workflow

When modifying the pipeline:
1. Parser changes affect link/group extraction from markdown
2. Transformer changes affect target generation or data structure
3. Generator changes affect HTML rendering or template usage
4. Build script changes affect file discovery or path handling

After changes, run `make build` to regenerate all HTML files.

## GitHub Pages Deployment

The `docs/` directory is configured for GitHub Pages:
- `.nojekyll` file disables Jekyll processing
- All paths are relative for portability
- Static HTML requires no build step on GitHub's end
