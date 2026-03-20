# Metabrowse

[![Spaces](https://spaces.dx.bloomberg.com/badge.svg)](https://spaces.dx.bloomberg.com/badges/create?org=lmatheson4&repo=metabrowse)

A markdown-to-HTML static site generator for teaching materials with collapsible link groups and browser tab reuse.

## Quick Start

```bash
# Build the site
make build

# Clean generated files
make clean
```

## Project Structure

```
metabrowse/
├── text/              # Source markdown files
│   ├── README.md      # Root index
│   └── <course>/      # Course directories
│       └── README.md  # Course links and resources
├── docs/              # Generated HTML (GitHub Pages ready)
├── templates/         # Jinja2 templates and CSS
├── build.py           # Main build script
├── parser.py          # Markdown parser
├── transformer.py     # Data transformer
└── generator.py       # HTML generator
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
- **GitHub Pages ready**: Static HTML output in `docs/` directory

## Building

The build script processes all `README.md` files in the `text/` directory and generates corresponding `index.html` files in `docs/` with the same directory structure.

```bash
# Using make
make build

# Or directly with Python
~/.local/bin/python3 build.py
```

## Requirements

- Python 3.6+
- jinja2 (install with: `~/.local/bin/python3 -m pip install jinja2`)

## Implementation Details

See [DRAFT-SPEC.md](DRAFT-SPEC.md) for the complete specification.
