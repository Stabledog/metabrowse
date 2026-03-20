# Workspace System Summary

Here’s the distilled state of things — decisions made vs. open questions.

Original chatgpt conversation:
https://chatgpt.com/c/69b943c8-5d48-832f-b651-fbc022c1e9af

## Decisions

### 1. Architecture direction
You’re building a workspace system independent of Edge.

Split:

- **Local app (primary)**
  - source of truth
  - storage + sync
  - UI for browsing workspaces
  - launches URLs

- **Extension (optional)**
  - captures browser state (tabs, groups, pinned)
  - possibly enhances launch behavior

This avoids dependence on:
- Edge Workspaces
- Microsoft sync
- browser UI stability

### 2. Storage model
- Workspaces stored as structured data (JSON / markdown)
- Not relying on bookmarks or browser storage
- Cloud-backed (GitHub / Drive / etc.)

Key idea:
> browser is just a renderer, not the system of record

### 3. Capture strategy
- **Extension required** to properly capture:
  - tabs
  - tab groups
  - pinned state

- Output format:
  - markdown (portable)
  - or JSON (canonical)

This is the only reliable way to extract structure.

### 4. Deployment constraint strategy
You must support:

- machines where:
  - extensions may not be installable
  - registry may be restricted
  - only a standalone EXE is allowed

So:

> everything must degrade to “single executable works alone”

### 5. Local app approach
- Single binary (Go preferred)
- Minimal dependencies
- No installer required

Capabilities:

- read/write workspace data
- sync to cloud
- open URLs in browser
- provide workspace UI

### 6. Authentication approach
- OAuth is required for cloud storage
- **Device flow** is the preferred method

Why:
- works without embedded browser
- works in locked-down environments
- simple UX

### 7. Sync backend (initial choice)
Order of practicality:

1. **GitHub (best first target)**
2. Google Drive
3. OneDrive (most enterprise friction)

## Known constraints

- Cannot reliably:
  - control tab groups
  - pin tabs
  - read browser state

Without an extension.

- Native messaging:
  - requires extension + registry
  - not universally viable

- Browser automation (DevTools):
  - possible but not primary path

## Unresolved questions

### 1. Extension viability
- Can you install extensions on any of your machines?
- Can you enable developer mode?
- Will extensions persist?

This determines whether capture is:
- easy (extension)
- painful/manual (fallback)

### 2. Native messaging viability
- Can you write to HKCU registry?
- Are user-level native hosts allowed?

This determines whether:
- extension ↔ app integration is smooth
- or must use clipboard / localhost bridge

### 3. Storage backend choice
You haven’t committed yet:

- GitHub → structured, versioned, simple
- Drive → file-like UX
- OneDrive → maybe required in corp context

This affects auth complexity and UX.

### 4. Auth friction in your environment
- Will OAuth/device flow actually work?
- Are external auth flows blocked?

This is a critical risk still untested.

### 5. Launch quality vs simplicity
How far do you go?

Baseline:
- open URLs via OS

Advanced:
- new window per workspace
- ordering
- staged loading

Unclear:
- how close you want to get to “true workspaces”

### 6. Data model depth
How rich should a workspace be?

Current idea includes:
- groups
- tab order
- pinned/core tabs

Open question:
- do you track transient vs permanent tabs?
- notes? metadata? tags?

### 7. UX surface
Where do you spend effort?

Options:
- simple launcher (fast, minimal)
- full workspace manager UI
- hybrid with extension sidebar

Not yet decided.

## What matters next

### Step 1 — de-risk auth + storage
- Write Go CLI
- GitHub device flow
- read/write one JSON file

This is the biggest unknown.

### Step 2 — prove launch model
- open 10–20 URLs reliably
- measure UX pain

### Step 3 — build capture extension
- dump tabs + groups → JSON/markdown

Everything else is refinement.

## One-line summary

You are building a portable, cloud-backed workspace system with a local launcher app, optionally enhanced by a browser extension for capture, designed to survive locked-down enterprise environments.
