#!/usr/bin/env python3
"""
Main build script for the Metabrowse toolchain.

Walks the text/ directory tree, processes each README.md file,
and generates corresponding index.html files in the docs/ directory.
"""

import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urlparse
from parser import MarkdownParser
from transformer import Transformer, HTMLSection, HTMLGroup, HTMLLinkGroup
from generator import HTMLGenerator


def calculate_css_path(output_file: Path, docs_root: Path) -> str:
    """
    Calculate the relative path from an HTML file to the root style.css.

    Args:
        output_file: Path to the HTML file being generated
        docs_root: Path to the docs/ root directory

    Returns:
        Relative path string to style.css
    """
    # Get the directory containing the HTML file
    html_dir = output_file.parent

    # Calculate how many levels up we need to go
    try:
        relative = html_dir.relative_to(docs_root)
        depth = len(relative.parts)
    except ValueError:
        # If html_dir is the docs_root itself
        depth = 0

    # Build the path: "../" for each level, then "style.css"
    cache_bust = "?v=" + str(int(time.time()))
    if depth == 0:
        return "style.css" + cache_bust
    else:
        return "../" * depth + "style.css" + cache_bust


def calculate_favicon_path(output_file: Path, docs_root: Path) -> str:
    """
    Calculate the relative path from an HTML file to the root favicon.png.

    Args:
        output_file: Path to the HTML file being generated
        docs_root: Path to the docs/ root directory

    Returns:
        Relative path string to favicon.png
    """
    # Get the directory containing the HTML file
    html_dir = output_file.parent

    # Calculate how many levels up we need to go
    try:
        relative = html_dir.relative_to(docs_root)
        depth = len(relative.parts)
    except ValueError:
        # If html_dir is the docs_root itself
        depth = 0

    # Build the path: "../" for each level, then "favicon.png"
    if depth == 0:
        return "favicon.png"
    else:
        return "../" * depth + "favicon.png"


def get_breadcrumbs_from_path(readme_path: Path, text_root: Path, docs_root: Path, output_file: Path) -> tuple[list[dict[str, str]], str]:
    """
    Generate breadcrumb navigation data from the README.md file path.

    Args:
        readme_path: Path to the README.md file
        text_root: Path to the text/ root directory
        docs_root: Path to the docs/ root directory
        output_file: Path to the output HTML file

    Returns:
        Tuple of (breadcrumbs list, current_page_name)
        Each breadcrumb is a dict with 'name' and 'url' keys
    """
    # Get the directory containing the README
    readme_dir = readme_path.parent

    # If it's the root README
    if readme_dir == text_root:
        return ([], "Metabrowse /")

    # Build breadcrumb trail
    try:
        relative = readme_dir.relative_to(text_root)
        path_parts = list(relative.parts)

        breadcrumbs = []

        # Add root link
        depth = len(path_parts)
        root_url = "../" * depth + "index.html"
        breadcrumbs.append({"name": "Metabrowse", "url": root_url})

        # Add intermediate breadcrumbs
        for i, part in enumerate(path_parts[:-1]):
            # Calculate relative URL to this level
            levels_up = depth - i - 1
            if levels_up > 0:
                url = "../" * levels_up + "index.html"
            else:
                url = "index.html"
            breadcrumbs.append({"name": part.title(), "url": url})

        # Current page name (last part, not a link)
        current_name = path_parts[-1].title()

        return (breadcrumbs, current_name)
    except ValueError:
        return ([], "Metabrowse")


def calculate_parent_url(output_file: Path, docs_root: Path) -> str:
    """
    Calculate the relative URL to the parent index.html.

    Args:
        output_file: Path to the HTML file being generated
        docs_root: Path to the docs/ root directory

    Returns:
        Relative URL to parent index.html, or empty string if at root
    """
    html_dir = output_file.parent

    # If we're at the root, there's no parent
    try:
        relative = html_dir.relative_to(docs_root)
        if len(relative.parts) == 0:
            return ""
    except ValueError:
        return ""

    # Parent is one level up
    return "../index.html"


def find_child_directories(readme_path: Path) -> list[dict[str, str]]:
    """
    Find child directories that contain README.md files.

    Args:
        readme_path: Path to the current README.md file

    Returns:
        List of dicts with 'name' and 'url' keys for each child
    """
    parent_dir = readme_path.parent
    children = []

    # Look for subdirectories containing README.md
    for item in sorted(parent_dir.iterdir()):
        if item.is_dir():
            child_readme = item / "README.md"
            if child_readme.exists():
                # Use directory name as display name (capitalized)
                name = item.name.replace('_', ' ').replace('-', ' ').title()
                # Relative URL is just the directory name
                url = item.name + "/"
                children.append({"name": name, "url": url})

    return children


def read_edit_base_url(content_root: Path) -> str:
    """
    Read the edit base URL from .metabrowse.conf config file.

    Args:
        content_root: Path to the content repository root

    Returns:
        Base URL for edit links

    Raises:
        SystemExit: If config file is missing or EDIT_BASE_URL is not set
    """
    config_file = content_root / ".metabrowse.conf"
    print(f"Reading edit config from: {config_file}")

    if not config_file.exists():
        print(f"ERROR: Required config file not found: {config_file}")
        print()
        print("Create .metabrowse.conf in your content repository root with:")
        print("  EDIT_BASE_URL=https://your-git-host.com/org/repo/blob/main")
        print()
        print("Examples:")
        print("  EDIT_BASE_URL=https://github.com/your-org/your-repo/blob/main")
        print("  EDIT_BASE_URL=https://gitlab.com/your-org/your-repo/-/blob/main")
        raise SystemExit(1)

    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('#') or not line:
                    continue
                if line.startswith('EDIT_BASE_URL='):
                    base_url = line.split('=', 1)[1].strip()
                    if not base_url:
                        print("ERROR: EDIT_BASE_URL is empty in .metabrowse.conf")
                        raise SystemExit(1)
                    # Remove trailing slash if present
                    base_url = base_url.rstrip('/')
                    print(f"Edit base URL: {base_url}")
                    return base_url

        print(f"ERROR: EDIT_BASE_URL not found in {config_file}")
        print()
        print("Add this line to your .metabrowse.conf:")
        print("  EDIT_BASE_URL=https://your-git-host.com/org/repo/blob/main")
        raise SystemExit(1)
    except SystemExit:
        raise
    except Exception as e:
        print(f"ERROR: Could not read .metabrowse.conf: {e}")
        raise SystemExit(1)


def generate_edit_url(readme_path: Path, text_root: Path, base_url: str) -> str:
    """
    Generate edit URL for a README.md file using the configured base URL.

    Args:
        readme_path: Path to the README.md file
        text_root: Path to the text/ root directory
        base_url: Base URL from config file (e.g., "https://host.com/org/repo/blob/main")

    Returns:
        URL to edit the file in the git web interface
    """
    # Calculate relative path from content root
    try:
        rel_path = readme_path.relative_to(text_root.parent)
        # Convert Path to forward-slash string for URL
        path_str = str(rel_path).replace('\\', '/')
        return f"{base_url}/{path_str}"
    except ValueError:
        print(f"ERROR: Could not calculate relative path for {readme_path}")
        raise SystemExit(1)


def parse_edit_base_url(edit_base_url: str) -> dict:
    """
    Parse EDIT_BASE_URL to extract host, owner, and repo.

    Args:
        edit_base_url: e.g. "https://foo.dev.enterprise.com/[userOrg]/my-metabrowse-links/edit/main"

    Returns:
        dict with keys: host, owner, repo
    """
    parsed = urlparse(edit_base_url)
    host = parsed.hostname
    # path like: /my-repo/my-metabrowse-links/edit/main
    parts = parsed.path.strip('/').split('/')
    owner = parts[0]
    repo = parts[1]
    return {'host': host, 'owner': owner, 'repo': repo}


def calculate_editor_url(output_file: Path, docs_root: Path, repo_info: dict,
                         readme_path: Path, text_root: Path) -> str:
    """
    Calculate the relative URL to the editor SPA with query params.

    Args:
        output_file: Path to the HTML file being generated
        docs_root: Path to the docs/ root directory
        repo_info: dict with host, owner, repo keys
        readme_path: Path to the source README.md file
        text_root: Path to the text/ root directory

    Returns:
        Relative URL to editor/index.html with query params
    """
    html_dir = output_file.parent

    try:
        relative = html_dir.relative_to(docs_root)
        depth = len(relative.parts)
    except ValueError:
        depth = 0

    editor_base = "../" * depth + "editor/index.html"

    # Calculate file path relative to repo root (e.g. text/foo/README.md)
    rel_path = readme_path.relative_to(text_root.parent)
    file_path = str(rel_path).replace('\\', '/')

    params = f"?host={repo_info['host']}&owner={repo_info['owner']}&repo={repo_info['repo']}&path={file_path}"
    return editor_base + params


def build():
    """Main build function."""
    # Setup paths
    # Code directory (where build.py and templates live)
    code_root = Path(__file__).parent
    template_dir = code_root / "templates"

    # Content directory (current working directory - where text/ and docs/ live)
    content_root = Path.cwd()
    text_root = content_root / "text"
    docs_root = content_root / "docs"

    # Initialize components
    parser = MarkdownParser()
    transformer = Transformer()
    generator = HTMLGenerator(template_dir, docs_root)

    # Read edit base URL from config file and parse repo info for editor SPA
    edit_base_url = read_edit_base_url(content_root)
    repo_info = parse_edit_base_url(edit_base_url)

    # Copy static assets first
    print("Copying static assets...")
    generator.copy_static_assets(code_root)

    # Find all README.md files in text/ directory
    readme_files = list(text_root.rglob("README.md"))

    if not readme_files:
        print(f"No README.md files found in {text_root}")
        return

    print(f"Found {len(readme_files)} README.md file(s)")

    # Collect search index entries as we process pages
    search_index = []

    # Process each README.md
    for readme_path in readme_files:
        print(f"Processing: {readme_path}")

        # Parse the markdown file
        parsed_doc = parser.parse_file(readme_path)

        # Calculate output path (mirror structure in docs/)
        try:
            relative_path = readme_path.parent.relative_to(text_root)
            output_dir = docs_root / relative_path
        except ValueError:
            output_dir = docs_root

        output_file = output_dir / "index.html"

        # Generate breadcrumbs and current page name
        breadcrumbs, current_name = get_breadcrumbs_from_path(readme_path, text_root, docs_root, output_file)

        # Build full title for <title> tag
        if breadcrumbs:
            title_parts = [bc["name"] for bc in breadcrumbs] + [current_name]
            title = " / ".join(title_parts)
        else:
            title = current_name

        # Transform to HTML-ready structure
        html_doc = transformer.transform(parsed_doc, title)

        # Calculate CSS path
        css_path = calculate_css_path(output_file, docs_root)

        # Calculate favicon path
        favicon_path = calculate_favicon_path(output_file, docs_root)

        # Find child directories
        children = find_child_directories(readme_path)

        # Generate editor URL (points to editor SPA with query params)
        edit_url = calculate_editor_url(output_file, docs_root, repo_info, readme_path, text_root)
        edit_target = hashlib.sha256(edit_url.encode('utf-8')).hexdigest()[:8]

        # Generate GitHub web editor URL (for mobile / fallback)
        github_edit_url = generate_edit_url(readme_path, text_root, edit_base_url)

        # Calculate relative path for this page (used in search index)
        try:
            page_rel = str(output_file.relative_to(docs_root)).replace('\\', '/')
        except ValueError:
            page_rel = "index.html"

        # Calculate search index path for this page
        try:
            page_depth = len(output_file.parent.relative_to(docs_root).parts)
        except ValueError:
            page_depth = 0
        search_index_path = "../" * page_depth + "search-index.json"
        root_path = "../" * page_depth

        # Generate HTML
        generator.generate_html(html_doc, output_file, css_path, favicon_path, breadcrumbs, current_name, children, edit_url, edit_target, search_index_path, root_path, github_edit_url)

        print(f"  -> Generated: {output_file}")

        # Build search index entry for this page
        breadcrumb_str = " / ".join([bc["name"] for bc in breadcrumbs] + [current_name])
        index_links = []
        section_names = []
        group_names = []

        def collect_links_from_items(items, section_name=None, group_name=None):
            for item in items:
                if isinstance(item, HTMLSection):
                    section_names.append(item.name)
                    collect_links_from_items(item.items, section_name=item.name)
                elif isinstance(item, HTMLGroup):
                    group_names.append(item.name)
                    for link in item.links:
                        if link.raw_html:
                            continue
                        entry = {"text": link.text, "url": link.url}
                        if section_name:
                            entry["section"] = section_name
                        entry["group"] = item.name
                        if link.comment:
                            entry["comment"] = link.comment
                        index_links.append(entry)
                elif isinstance(item, HTMLLinkGroup):
                    for link in item.links:
                        if link.raw_html:
                            continue
                        entry = {"text": link.text, "url": link.url}
                        if section_name:
                            entry["section"] = section_name
                        if link.comment:
                            entry["comment"] = link.comment
                        index_links.append(entry)

        collect_links_from_items(html_doc.items)

        search_index.append({
            "path": page_rel,
            "title": title,
            "breadcrumbs": breadcrumb_str,
            "links": index_links,
            "sections": section_names,
            "groups": group_names,
            "children": [c["name"] for c in children]
        })

    # Write search index
    search_index_path = docs_root / "search-index.json"
    with open(search_index_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(search_index, f, ensure_ascii=False)
    print(f"Generated search index: {search_index_path}")

    print("\nBuild complete!")
    print(f"Output directory: {docs_root}")


if __name__ == "__main__":
    build()
