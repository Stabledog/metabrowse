#!/usr/bin/env python3
"""
Main build script for the Metabrowse toolchain.

Walks the text/ directory tree, processes each README.md file,
and generates corresponding index.html files in the docs/ directory.
"""

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


def get_title_from_path(readme_path: Path, text_root: Path) -> str:
    """
    Generate a page title from the README.md file path.

    Args:
        readme_path: Path to the README.md file
        text_root: Path to the text/ root directory

    Returns:
        A formatted title string
    """
    # Get the directory containing the README
    readme_dir = readme_path.parent

    # If it's the root README
    if readme_dir == text_root:
        return "Metabrowse /"

    # Otherwise, use the directory name as course name
    try:
        relative = readme_dir.relative_to(text_root)
        course_name = relative.parts[0] if relative.parts else "Unknown"
        return f"Course: {course_name.title()}"
    except ValueError:
        return "Metabrowse"


def build():
    """Main build function."""
    # Setup paths
    project_root = Path(__file__).parent
    text_root = project_root / "text"
    docs_root = project_root / "docs"
    template_dir = project_root / "templates"

    # Initialize components
    parser = MarkdownParser()
    transformer = Transformer()
    generator = HTMLGenerator(template_dir, docs_root)

    # Copy static assets first
    print("Copying static assets...")
    generator.copy_static_assets()

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

        # Generate title
        title = get_title_from_path(readme_path, text_root)

        # Transform to HTML-ready structure
        html_doc = transformer.transform(parsed_doc, title)

        # Calculate output path (mirror structure in docs/)
        try:
            relative_path = readme_path.parent.relative_to(text_root)
            output_dir = docs_root / relative_path
        except ValueError:
            output_dir = docs_root

        output_file = output_dir / "index.html"

        # Calculate CSS path
        css_path = calculate_css_path(output_file, docs_root)

        # Generate HTML
        generator.generate_html(html_doc, output_file, css_path)

        print(f"  → Generated: {output_file}")

    print("\nBuild complete!")
    print(f"Output directory: {docs_root}")


if __name__ == "__main__":
    build()
