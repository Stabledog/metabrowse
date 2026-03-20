"""Transformer module: Convert parsed structure to HTML-ready data."""

import hashlib
from dataclasses import dataclass
from typing import List, Optional
from parser import ParsedDocument, Link, Group


@dataclass
class HTMLLink:
    """Link prepared for HTML rendering."""
    url: str
    text: str
    target: str
    raw_html: Optional[str] = None


@dataclass
class HTMLGroup:
    """Group prepared for HTML rendering."""
    name: str
    links: List[HTMLLink]


@dataclass
class HTMLDocument:
    """Document structure ready for template rendering."""
    title: str
    ungrouped_links: List[HTMLLink]
    groups: List[HTMLGroup]


class Transformer:
    """Transform parsed data into HTML-ready structures."""

    @staticmethod
    def generate_target(url: str) -> str:
        """Generate a deterministic hash-based target name for a URL."""
        # Use SHA256 and take first 8 characters for readability
        hash_obj = hashlib.sha256(url.encode('utf-8'))
        return hash_obj.hexdigest()[:8]

    def transform(self, parsed_doc: ParsedDocument, title: str) -> HTMLDocument:
        """Transform a parsed document into HTML-ready structure."""
        html_ungrouped = [self._transform_link(link) for link in parsed_doc.ungrouped_links]
        html_groups = [self._transform_group(group) for group in parsed_doc.groups]

        return HTMLDocument(
            title=title,
            ungrouped_links=html_ungrouped,
            groups=html_groups
        )

    def _transform_link(self, link: Link) -> HTMLLink:
        """Transform a Link to HTMLLink with target generation."""
        # Use explicit target if provided, otherwise generate from URL
        target = link.target if link.target else self.generate_target(link.url)

        # Use provided text or default to URL
        text = link.text if link.text else link.url

        return HTMLLink(
            url=link.url,
            text=text,
            target=target,
            raw_html=link.raw_html
        )

    def _transform_group(self, group: Group) -> HTMLGroup:
        """Transform a Group to HTMLGroup."""
        html_links = [self._transform_link(link) for link in group.links]

        return HTMLGroup(
            name=group.name,
            links=html_links
        )
