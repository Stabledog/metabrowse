"""Generator module: Apply Jinja2 templates and write output files."""

from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from transformer import HTMLDocument
import shutil


class HTMLGenerator:
    """Generate HTML files from transformed data."""

    def __init__(self, template_dir: Path, output_dir: Path):
        """
        Initialize the generator.

        Args:
            template_dir: Path to the directory containing Jinja2 templates
            output_dir: Path to the output directory (docs/)
        """
        self.template_dir = template_dir
        self.output_dir = output_dir
        self.env = Environment(loader=FileSystemLoader(str(template_dir)))

    def generate_html(self, html_doc: HTMLDocument, output_path: Path, css_relative_path: str, favicon_relative_path: str, breadcrumbs: list, current_name: str, children: list = None, edit_url: str = ""):
        """
        Generate an HTML file from an HTMLDocument.

        Args:
            html_doc: The HTML-ready document structure
            output_path: Path where the HTML file should be written
            css_relative_path: Relative path to the CSS file from the HTML file
            favicon_relative_path: Relative path to the favicon.png file from the HTML file
            breadcrumbs: List of breadcrumb dicts with 'name' and 'url' keys
            current_name: Name of the current page (last breadcrumb, not a link)
            children: List of child directory dicts with 'name' and 'url' keys
            edit_url: URL to edit the source file in the git web interface (empty string if unavailable)
        """
        if children is None:
            children = []

        template = self.env.get_template('index.html')

        html_content = template.render(
            title=html_doc.title,
            ungrouped_links=html_doc.ungrouped_links,
            groups=html_doc.groups,
            css_path=css_relative_path,
            favicon_path=favicon_relative_path,
            breadcrumbs=breadcrumbs,
            current_name=current_name,
            children=children,
            edit_url=edit_url
        )

        # Ensure the output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write the HTML file
        with open(output_path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html_content)

    def copy_static_assets(self, project_root: Path = None):
        """Copy CSS and other static assets to the output directory."""
        css_source = self.template_dir / 'style.css'
        css_dest = self.output_dir / 'style.css'

        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Copy CSS file
        if css_source.exists():
            shutil.copy2(css_source, css_dest)

        # Copy favicon if it exists in text/
        if project_root:
            favicon_source = project_root / 'text' / 'favicon.png'
            if favicon_source.exists():
                favicon_dest = self.output_dir / 'favicon.png'
                shutil.copy2(favicon_source, favicon_dest)

        # Create .nojekyll file to disable Jekyll on GitHub Pages
        nojekyll_file = self.output_dir / '.nojekyll'
        nojekyll_file.touch()
