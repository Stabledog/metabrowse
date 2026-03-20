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

    def generate_html(self, html_doc: HTMLDocument, output_path: Path, css_relative_path: str):
        """
        Generate an HTML file from an HTMLDocument.

        Args:
            html_doc: The HTML-ready document structure
            output_path: Path where the HTML file should be written
            css_relative_path: Relative path to the CSS file from the HTML file
        """
        template = self.env.get_template('index.html')

        html_content = template.render(
            title=html_doc.title,
            ungrouped_links=html_doc.ungrouped_links,
            groups=html_doc.groups,
            css_path=css_relative_path
        )

        # Ensure the output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write the HTML file
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)

    def copy_static_assets(self):
        """Copy CSS and other static assets to the output directory."""
        css_source = self.template_dir / 'style.css'
        css_dest = self.output_dir / 'style.css'

        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Copy CSS file
        if css_source.exists():
            shutil.copy2(css_source, css_dest)
