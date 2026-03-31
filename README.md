# Metabrowse

A markdown-to-HTML static site generator for teaching materials with collapsible link groups and browser tab reuse.

## Architecture

Metabrowse separates **code** (this repository) from **content** (your link collections):

- **Code repository** (this repo): Build scripts, parsers, templates
- **Content repository** (separate): Your `text/` markdown files and generated `docs/` HTML

This separation allows:
- Multiple users to maintain their own link collections
- Code updates without touching content
- Content updates without needing build tool changes

## Quick Start

### For Users (Working with Content)

1. Create or clone your content repository:
   ```bash
   mkdir my-metabrowse-links
   cd my-metabrowse-links
   mkdir text
   # Create your README.md files in text/
   ```

2. Build your site:
   ```bash
   /path/to/metabrowse/build-metabrowse.sh
   ```

### For Developers (Working with Code)

This repository contains the build pipeline:

```
metabrowse/
├── templates/          # Jinja2 templates and CSS
├── build.py            # Main build orchestrator
├── parser.py           # Markdown parser
├── transformer.py      # Data transformer
├── generator.py        # HTML generator
└── build-metabrowse.sh # User-facing build script
```

## Markdown Syntax

### Links

```markdown
- https://example.com
- Link title https://example.com
- [Link text](https://example.com)
- [Link text](https://example.com){target="_custom"}
- <a href="https://example.com">Raw HTML</a>
```

### Groups (Collapsible Sections)

```markdown
- Group Name
  - https://link1.com
  - https://link2.com
  - Another link https://link3.com
```

Groups are created automatically when a line starts with `- ` but contains no URL.

## Features

- **Collapsible groups**: Organize links into expandable sections
- **Browser tab reuse**: Each unique URL gets a deterministic target attribute
- **Multiple link formats**: Plain URLs, markdown links, HTML pass-through
- **Custom targets**: Override default targets with `{target="..."}` syntax
- **GitHub Pages ready**: Outputs to `docs/` for local testing; typically deployed to `gh-pages` branch via CI/CD

## Building

The `build-metabrowse.sh` script processes all `README.md` files in the content repository's `text/` directory and generates corresponding `index.html` files in `docs/`.

**Usage:**
```bash
# Run from your content directory
cd my-metabrowse-links
/path/to/metabrowse/build-metabrowse.sh
```

**Environment Variables:**
- `METABROWSE_CODE_DIR`: Override code repository location (default: script directory)
- `METABROWSE_PYTHON`: Override Python interpreter (default: `~/.local/bin/python3`)

**Direct Python invocation** (for development):
```bash
# Must be in content directory with text/ and docs/
~/.local/bin/python3 /path/to/metabrowse/build.py
```

## Local Testing

After building, preview the generated site locally with the built-in web server:

```bash
# Run from your content directory (containing docs/)
cd my-metabrowse-links
/path/to/metabrowse/serve-metabrowse.sh

# Visit http://localhost:3000 in your browser
# Press Ctrl+C to stop the server
```

**Custom port:**
```bash
# Use -p flag or METABROWSE_PORT environment variable
/path/to/metabrowse/serve-metabrowse.sh -p 8080
```

**Note:** The `docs/` directory is for local testing only and is typically gitignored. Production deployments use GitHub Actions to build and deploy to the `gh-pages` branch.

## Requirements

- Python 3.6+
- jinja2 (install with: `~/.local/bin/python3 -m pip install jinja2`)

## Implementation Details

See [DRAFT-SPEC.md](DRAFT-SPEC.md) for the complete specification.
