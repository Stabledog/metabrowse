# Markdown to HTML Toolchain Specification

## 1. Input Structure

- **Source**: `text/` directory tree
- **Organization**:
  - `text/README.md` - Root index linking to courses
  - `text/<course>/README.md` - Course-specific link collections
- **Link formats to support**:
  - Plain URLs: `- https://example.com`
  - Markdown links: `[Title](URL)` 
  - Raw HTML `<a>` tags (pass-through)
  - Optional inline text before link acts as link title

## 2. Group Syntax

- **Group header**: `- GroupName` (dash, space, text with no URL)
- **Group children**: Links indented with 2+ spaces beneath header
- **Ungrouped links**: Links at root indentation level (0 spaces)
- **Detection**: A line starting with `- ` that doesn't contain a URL is treated as a group header

## 3. Parsing Rules

- Any text that is not recognizable as an item for translation is passed through verbatim.

### Link extraction

- Line starts with 0+ spaces, then optional `- `, then content
- Content types:
  1. `- GroupName` → Group header (no URL found in line)
  2. `[Text](URL)` → Markdown link
  3. `[Text](URL){target="..."}` → Markdown link with attributes
  4. `<a href="...">...</a>` → Pass-through HTML
  5. `https://...` or bare URL → Auto-link
  6. `Title text https://...` → Extract title + URL

### Indentation hierarchy

- Count leading spaces to determine nesting level
- Children have more spaces than parent group header
- Group ends when indentation returns to header level or less

### Target name generation

- Each link in the output must have a `target=[name]` attribute in the `<a>` tag
- If the raw input contains a `{target=...}` spec, it will be passed through to output
- If the input contains no `{target=...}` spec, the tool will hash the entire URL and use the hash as the target
- Hash should be short (first 8-10 chars of SHA256 or MD5) and deterministic


## 4. Output Structure

- **Target**: `docs/` directory (GitHub Pages compatible)
- **Mirrored structure**: `docs/index.html`, `docs/<course>/index.html`
- **Static HTML** with:
  - CSS for styling groups (collapsible sections)
  - JavaScript for collapse/expand functionality
  - Responsive design

## 5. HTML Generation

### For each README.md

Generate `docs/<path>/index.html` containing:
- Page header (course name from directory)
- Ungrouped links (flat list)
- Grouped sections:
  - Collapsible `<details>`/`<summary>` or custom div
  - Group name as header
  - Child links as nested list

### Link rendering

- Extract or generate link text (title or URL)
- Generate `target` attribute per section 3 (hash-based or explicit from input)
- Pass through existing HTML `<a>` tags unchanged

## 6. Key Features

### Must have

- Parse indentation-based grouping
- Generate collapsible group sections
- Preserve link titles or default to URL
- Support mixed link formats
- Mirror directory structure
- GitHub Pages compatible output

### Nice to have

- Back navigation breadcrumbs
- Index page with course list
- Syntax highlighting for inline code
- Dark/light theme toggle
- Search functionality across all links
- Link validation/checking

## 7. Implementation Approach

### Technology Stack

Python-based toolchain with:

**Core libraries**:
- **Markdown parsing**: `markdown` or `mistune` for basic link extraction
- **Template engine**: `Jinja2` for HTML generation
- **Hashing**: `hashlib` (stdlib) for target name generation
- **File operations**: `pathlib` (stdlib) for directory traversal and mirroring

**Architecture**:
1. **Parser module**: Read README.md files, identify groups/links, extract metadata
2. **Transformer module**: Convert parsed structure to HTML-ready data
3. **Generator module**: Apply Jinja2 templates, write output files
4. **CLI script**: Orchestrate the pipeline, mirror `text/` → `docs/` structure

**Entry point**:
- Single command: `python build.py` or `make build`
- Walks `text/` directory tree
- Processes each `README.md` → generates corresponding `index.html`
- Copies/generates shared CSS/JS assets to `docs/`

## 8. Example Output HTML Structure

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <h1>Course: Rapid</h1>

  <!-- Ungrouped links -->
  <ul class="links">
    <li><a href="https://example.com" target="a1b2c3d4">Example Link</a></li>
  </ul>

  <!-- Groups -->
  <details class="group">
    <summary>Canonical</summary>
    <ul class="group-links">
      <li><a href="https://docs.example.com" target="e5f6g7h8">Documentation</a></li>
    </ul>
  </details>
</body>
</html>
```

## 9. Edge Cases to Handle

- Empty groups
- Multiple nesting levels (groups within groups?)
- Mixed indentation (tabs vs spaces)
- Malformed URLs
- Special characters in group names
- Relative vs absolute URLs
