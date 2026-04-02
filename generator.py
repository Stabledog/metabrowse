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

    def generate_html(self, html_doc: HTMLDocument, output_path: Path, css_relative_path: str, favicon_relative_path: str, breadcrumbs: list, current_name: str, children: list = None, edit_url: str = "", edit_target: str = "_blank", search_index_path: str = "search-index.json"):
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
            search_index_path: Relative path to search-index.json from the HTML file
        """
        if children is None:
            children = []

        template = self.env.get_template('index.html')

        html_content = template.render(
            title=html_doc.title,
            items=html_doc.items,
            css_path=css_relative_path,
            favicon_path=favicon_relative_path,
            favicon_ico_path=favicon_relative_path.replace('favicon.png', 'favicon.ico'),
            breadcrumbs=breadcrumbs,
            current_name=current_name,
            children=children,
            edit_url=edit_url,
            edit_target=edit_target,
            search_index_path=search_index_path
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

        # Copy favicon.ico if it exists in templates/
        ico_source = self.template_dir / 'favicon.ico'
        if ico_source.exists():
            ico_dest = self.output_dir / 'favicon.ico'
            shutil.copy2(ico_source, ico_dest)

        # Copy favicon if it exists in text/
        if project_root:
            favicon_source = project_root / 'text' / 'favicon.png'
            if favicon_source.exists():
                favicon_dest = self.output_dir / 'favicon.png'
                shutil.copy2(favicon_source, favicon_dest)

        # Copy editor SPA (must be pre-built via npm run build)
        code_root = self.template_dir.parent
        editor_dist = code_root / 'editor' / 'dist'
        if not editor_dist.exists():
            print(f"ERROR: Editor SPA not found at {editor_dist}")
            print("Run 'cd editor && npm ci && npm run build' to build the editor.")
            raise SystemExit(1)
        editor_dest = self.output_dir / 'editor'
        if editor_dest.exists():
            shutil.rmtree(editor_dest)
        shutil.copytree(editor_dist, editor_dest)

        # Create .nojekyll file to disable Jekyll on GitHub Pages
        nojekyll_file = self.output_dir / '.nojekyll'
        nojekyll_file.touch()
