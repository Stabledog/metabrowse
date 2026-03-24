# Search Feature Plan

## Overview

Add search capability to Metabrowse with two complementary modes:

1. **In-page filter** — instantly hides non-matching links/groups on the current page
2. **Cross-page search** — searches across all pages using a build-time JSON index

Both modes work fully offline, use vanilla JS (no dependencies), and follow Metabrowse's static-site philosophy.

## Phase 1: In-Page Filter

### Behavior
- A search input appears at the top of each page, below the header bar
- As the user types, links and groups that don't match are hidden in real time
- Matching is case-insensitive substring against: link text, URL, group name, comments
- Groups auto-expand (`<details open>`) if they contain matching links
- Groups with zero matching links are hidden entirely
- Ungrouped links that don't match are hidden
- Child navigation buttons are also filtered
- Clearing the input restores original visibility and collapse state
- Keyboard shortcut `/` focuses the search input (unless already in an input)

### No build changes required
- Pure template + CSS + JS change

## Phase 2: Cross-Page Search

### Build-time index generation
`build.py` emits `docs/search-index.json` after processing all pages:

```json
[
  {
    "path": "index.html",
    "title": "Metabrowse",
    "breadcrumbs": "Metabrowse",
    "links": [
      {"text": "Khan Academy", "url": "https://khanacademy.org", "group": "Learning", "comment": "Great for math"}
    ],
    "groups": ["Learning", "Tools"],
    "children": ["Calcrt", "Physics"]
  },
  {
    "path": "calcrt/index.html",
    "title": "Calcrt",
    "breadcrumbs": "Metabrowse / Calcrt",
    "links": [...],
    "groups": [...],
    "children": [...]
  }
]
```

### Behavior
- Toggled via `Ctrl+K` keyboard shortcut (or clicking a search icon)
- Opens a modal/overlay search panel
- Loads `search-index.json` lazily on first activation (cached in memory)
- Results show: breadcrumb path → matching link text / group name
- Each result is clickable and navigates to the target page
- Indicates match type (link text, URL, comment, group, page title)
- Highlights matching substring with `<mark>`

### Implementation in build.py
- After the main processing loop, collect all page data into a list
- Serialize to JSON and write to `docs/search-index.json`
- Index path calculated relative to each page (same as CSS/favicon)

## UI Layout

```
┌─────────────────────────────────────────────────┐
│ Breadcrumbs / Current Page              [Edit]  │
├─────────────────────────────────────────────────┤
│ 🔍 [Filter this page... (/)      ] [⌘K Global] │
├─────────────────────────────────────────────────┤
│ [Child1] [Child2] [Child3]                      │
│                                                 │
│ - Link 1                                        │
│ - Link 2                                        │
│ ▸ Group A                                       │
│   - Link 3                                      │
│   - Link 4                                      │
└─────────────────────────────────────────────────┘
```

The global search opens as a centered modal overlay:

```
┌───────────────────────────────────────┐
│ 🔍 [Search all pages...            ] │
│                                       │
│ Metabrowse / Calcrt                   │
│   Khan Academy - khanacademy.org      │
│                                       │
│ Metabrowse / Physics                  │
│   MIT OCW - ocw.mit.edu              │
│                                       │
│ Press Esc to close                    │
└───────────────────────────────────────┘
```

## Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Search library | None (vanilla JS) | Matches Metabrowse's no-framework philosophy |
| Matching algorithm | Case-insensitive substring | Simple, predictable, fast for typical dataset sizes |
| Index format | JSON array | Native `fetch()` + `JSON.parse()`, no dependencies |
| Index loading | Lazy on first global search | No overhead for users who don't search |
| Keyboard shortcuts | `/` for filter, `Ctrl+K` for global | Standard conventions (Vim/GitHub for `/`, VS Code for `Ctrl+K`) |
| Highlight | `<mark>` element | Semantic HTML, styleable via CSS |

## Files Changed

| File | Change |
|---|---|
| `templates/index.html` | Add search bar HTML, in-page filter JS, global search JS |
| `templates/style.css` | Search input, results dropdown, modal, highlight styles |
| `build.py` | Generate `search-index.json` alongside HTML files |
| `generator.py` | Pass search index path to template context |
| `CLAUDE.md` | Document search feature |

## Accessibility

- Search input: `role="search"`, `aria-label="Filter links on this page"`
- Global modal: `role="dialog"`, `aria-modal="true"`, focus trap
- Results: keyboard navigable with arrow keys, Enter to select
- `Esc` closes modal and clears filter
- Screen reader announces result count via `aria-live` region
