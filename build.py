#!/usr/bin/env python3
"""
Main build script for the Metabrowse toolchain.

Walks the text/ directory tree, processes each README.md file,
and generates corresponding index.html files in the docs/ directory.
"""

import re
import subprocess
from pathlib import Path
from parser import MarkdownParser
from transformer import Transformer
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
    if depth == 0:
        return "style.css"
    else:
        return "../" * depth + "style.css"


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


def get_git_info(project_root: Path) -> tuple[str, str, str, str]:
    """
    Extract git repository information including host.

    Args:
        project_root: Path to the project root directory

    Returns:
        Tuple of (host, org, repo, branch) or empty strings if git info unavailable
    """
    try:
        # Try "origin" first, fall back to first available remote
        remote_name = None
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            remote_name = "origin"
            remote_url = result.stdout.strip()
        else:
            # List all remotes and use the first one
            result = subprocess.run(
                ["git", "remote"],
                cwd=project_root,
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode != 0 or not result.stdout.strip():
                print("Warning: No git remotes found; edit links will be omitted")
                return ("", "", "", "")

            remote_name = result.stdout.strip().splitlines()[0]
            result = subprocess.run(
                ["git", "remote", "get-url", remote_name],
                cwd=project_root,
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode != 0:
                print(f"Warning: Could not get URL for remote '{remote_name}'; edit links will be omitted")
                return ("", "", "", "")
            remote_url = result.stdout.strip()

        # Extract host from remote URL
        # For SSH: git@github.com:org/repo.git
        # For HTTPS: https://github.com/org/repo.git
        host = ""
        if remote_url.startswith("https://") or remote_url.startswith("http://"):
            # HTTPS format
            host_match = re.search(r'https?://([^/]+)/', remote_url)
            if host_match:
                host = host_match.group(1)
        elif "@" in remote_url:
            # SSH format: git@host:org/repo.git
            host_match = re.search(r'@([^:]+):', remote_url)
            if host_match:
                host = host_match.group(1)

        # Parse org/repo from URL
        # Matches both SSH and HTTPS formats
        match = re.search(r'[:/]([^/]+)/([^/]+?)(?:\.git)?$', remote_url)
        if not match:
            print(f"Warning: Could not parse remote URL '{remote_url}'; edit links will be omitted")
            return ("", "", "", "")

        org = match.group(1)
        repo = match.group(2)

        # Get current branch
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=5
        )

        branch = result.stdout.strip() if result.returncode == 0 else "main"

        if not host:
            print(f"Warning: Could not extract host from remote URL '{remote_url}'; edit links will be omitted")
            return ("", "", "", "")

        return (host, org, repo, branch)
    except FileNotFoundError:
        print("Warning: 'git' not found on PATH; edit links will be omitted")
        return ("", "", "", "")
    except Exception as e:
        print(f"Warning: Could not get git info ({e}); edit links will be omitted")
        return ("", "", "", "")


def generate_edit_url(readme_path: Path, text_root: Path, host: str, org: str, repo: str, branch: str) -> str:
    """
    Generate edit URL for a README.md file in the git repository.

    Supports GitHub, GitLab, and other git hosting services.

    Args:
        readme_path: Path to the README.md file
        text_root: Path to the text/ root directory
        host: Git hosting service domain (e.g., "github.com", "gitlab.com")
        org: Organization or user name
        repo: Repository name
        branch: Git branch name

    Returns:
        URL to edit the file in the git web interface, or empty string if git info unavailable
    """
    if not host or not org or not repo or not branch:
        return ""

    # Calculate relative path from project root
    try:
        rel_path = readme_path.relative_to(text_root.parent)
        # Convert Path to forward-slash string for URL
        path_str = str(rel_path).replace('\\', '/')

        # GitLab uses a different URL format with /-/blob/
        # Most other hosts (GitHub, GitHub Enterprise, etc.) use /blob/
        if "gitlab" in host.lower():
            return f"https://{host}/{org}/{repo}/-/blob/{branch}/{path_str}"
        else:
            return f"https://{host}/{org}/{repo}/blob/{branch}/{path_str}"
    except ValueError:
        return ""


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

    # Get git repository information for edit links
    host, org, repo, branch = get_git_info(content_root)
    if host and org and repo:
        print(f"Git repository: {host}/{org}/{repo} (branch: {branch})")

    # Copy static assets first
    print("Copying static assets...")
    generator.copy_static_assets(code_root)

    # Find all README.md files in text/ directory
    readme_files = list(text_root.rglob("README.md"))

    if not readme_files:
        print(f"No README.md files found in {text_root}")
        return

    print(f"Found {len(readme_files)} README.md file(s)")

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

        # Generate edit URL
        edit_url = generate_edit_url(readme_path, text_root, host, org, repo, branch)

        # Generate HTML
        generator.generate_html(html_doc, output_file, css_path, favicon_path, breadcrumbs, current_name, children, edit_url)

        print(f"  → Generated: {output_file}")

    print("\nBuild complete!")
    print(f"Output directory: {docs_root}")


if __name__ == "__main__":
    build()
