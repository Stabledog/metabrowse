"""Parser module: Read README.md files, identify groups/links, extract metadata."""

import re
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Link:
    """Represents a single link with its metadata."""
    url: str
    text: Optional[str] = None
    target: Optional[str] = None  # Explicit target from {target="..."}
    raw_html: Optional[str] = None  # If this is a pass-through HTML link
    indent_level: int = 0
    comment: Optional[str] = None  # Comment after # on the same line


@dataclass
class Group:
    """Represents a collapsible group of links."""
    name: str
    links: List[Link]
    indent_level: int
    comment: Optional[str] = None  # Comment after # on the same line


@dataclass
class ParsedDocument:
    """Represents the parsed structure of a README.md file."""
    ungrouped_links: List[Link]
    groups: List[Group]


class MarkdownParser:
    """Parse markdown files and extract links and groups."""

    # Regex patterns for different link formats
    PATTERN_HTML_LINK = re.compile(r'<a\s+href="([^"]+)"[^>]*>.*?</a>', re.IGNORECASE)
    PATTERN_MD_LINK_WITH_TARGET = re.compile(r'\[([^\]]+)\]\(([^)]+)\)\{target="([^"]+)"\}')
    PATTERN_MD_LINK = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
    # Match URLs with :// (http, https, ftp, chrome, edge, vscode, ssh, etc.)
    # and specific schemes without :// (mailto:, tel:, about:)
    PATTERN_BARE_URL = re.compile(r'[a-zA-Z][a-zA-Z0-9+.-]*://[^\s]+|(?:mailto|tel|about):[^\s]+')

    @staticmethod
    def _extract_comment(text: str) -> tuple[str, Optional[str]]:
        """
        Extract comment from a line (everything after #).

        Args:
            text: The text to extract comment from

        Returns:
            Tuple of (text_without_comment, comment_or_none)
        """
        # Find the last # in the line (to handle URLs with fragments)
        # But be careful not to split on # inside URLs
        parts = text.split('#')

        # If no # or only one part, no comment
        if len(parts) <= 1:
            return (text.strip(), None)

        # Try to find a # that's not part of a URL
        # Look for # that comes after a space
        comment_pos = -1
        for i in range(len(text)):
            if text[i] == '#' and (i == 0 or text[i-1].isspace()):
                comment_pos = i
                break

        if comment_pos == -1:
            # No valid comment marker found
            return (text.strip(), None)

        content = text[:comment_pos].strip()
        comment = text[comment_pos+1:].strip()

        return (content, comment if comment else None)

    def parse_file(self, filepath: str) -> ParsedDocument:
        """Parse a markdown file and return structured data."""
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        ungrouped_links = []
        groups = []
        current_group = None
        current_group_indent = -1

        for line in lines:
            # Measure indentation
            indent = len(line) - len(line.lstrip(' '))
            stripped = line.strip()

            if not stripped:
                continue

            # Try to parse the line as a link first
            link = self._parse_link_line(line, indent)

            if link:
                # Check if this link belongs to current group
                if current_group and indent > current_group_indent:
                    current_group.links.append(link)
                else:
                    # This is an ungrouped link or we exited the group
                    if current_group:
                        groups.append(current_group)
                        current_group = None
                        current_group_indent = -1
                    ungrouped_links.append(link)
            elif stripped.startswith('- '):
                # Not a link, but starts with "- " -> it's a group header
                # Save previous group if exists
                if current_group:
                    groups.append(current_group)

                # Start new group - extract name and comment
                group_text = stripped[2:].strip()  # Remove "- " prefix
                group_name, group_comment = self._extract_comment(group_text)
                current_group = Group(name=group_name, links=[], indent_level=indent, comment=group_comment)
                current_group_indent = indent

        # Don't forget the last group
        if current_group:
            groups.append(current_group)

        return ParsedDocument(ungrouped_links=ungrouped_links, groups=groups)

    def _parse_link_line(self, line: str, indent: int) -> Optional[Link]:
        """Parse a single line and extract link information."""
        stripped = line.strip()

        # Remove leading "- " if present
        if stripped.startswith('- '):
            stripped = stripped[2:].strip()

        # Extract comment from the line (before parsing link formats)
        stripped, comment = self._extract_comment(stripped)

        # 1. Check for HTML pass-through
        html_match = self.PATTERN_HTML_LINK.search(stripped)
        if html_match:
            return Link(
                url=html_match.group(1),
                raw_html=html_match.group(0),
                indent_level=indent,
                comment=comment
            )

        # 2. Check for markdown link with explicit target
        md_target_match = self.PATTERN_MD_LINK_WITH_TARGET.search(stripped)
        if md_target_match:
            return Link(
                url=md_target_match.group(2),
                text=md_target_match.group(1),
                target=md_target_match.group(3),
                indent_level=indent,
                comment=comment
            )

        # 3. Check for regular markdown link
        md_match = self.PATTERN_MD_LINK.search(stripped)
        if md_match:
            return Link(
                url=md_match.group(2),
                text=md_match.group(1),
                indent_level=indent,
                comment=comment
            )

        # 4. Check for bare URL or "Title text URL" format
        url_match = self.PATTERN_BARE_URL.search(stripped)
        if url_match:
            url = url_match.group(0)
            # Extract title if there's text before the URL
            text_before = stripped[:url_match.start()].strip()
            title = text_before if text_before else None

            return Link(
                url=url,
                text=title,
                indent_level=indent,
                comment=comment
            )

        return None
