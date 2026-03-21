#!/usr/bin/env bash
# metabrowse-wiz.sh - Wizard for creating metabrowse content directories
#
# This script helps users set up metabrowse content structure with template files.

set -euo pipefail

# PS4 provides good diagnostics when -x is turned on
#shellcheck disable=2154
PS4='$( _0=$?; exec 2>/dev/null; realpath -- "${BASH_SOURCE[0]:-?}:${LINENO} ^$_0 ${FUNCNAME[0]:-?}()=>" ) '
[[ -n "${DEBUGSH:-}" ]] && set -x

scriptName="${scriptName:-"$(command readlink -f -- "$0")"}"

die() {
    builtin echo "ERROR($(basename "${scriptName}")): $*" >&2
    builtin exit 1
}

{  # outer scope braces

    usage() {
        cut -c 12- <<'EOF'
            Usage: metabrowse-wiz.sh COMMAND [ARGS]

            Wizard for creating metabrowse content directories and templates.

            COMMANDS:
              mkdir NAME              Create subdirectory with template README.md
              mktree PATTERN [...]    Create multiple directories using brace expansion
              -h, --help              Show this help message

            EXAMPLES:
              # Create a single directory with template (relative to $PWD)
              cd text
              metabrowse-wiz.sh mkdir python-basics

              # Create multiple directories at once
              metabrowse-wiz.sh mktree math/{algebra,geometry,calculus}

              # Create nested structure
              metabrowse-wiz.sh mktree courses/{intro,advanced}/{week1,week2}

              # Multiple patterns
              metabrowse-wiz.sh mktree science/{physics,chemistry} history/modern

            TEMPLATE:
              Each created directory contains a README.md with sample links and groups
              demonstrating metabrowse syntax. Edit these templates to add your content.

            NOTE:
              All directories are created relative to the current working directory.
EOF
        builtin exit 2
    }

    get_template_content() {
        cut -c 13- <<'EOF'
            # Page Title

            Edit this file to add your links and organize them into groups.

            ## Sample Links

            - https://example.com
            - Example Site https://example.org
            - [Markdown Link](https://wikipedia.org)

            ## Sample Groups

            - Learning Resources # Resources for getting started
              - [Khan Academy](https://khanacademy.org) # Free online courses
              - [MDN Web Docs](https://developer.mozilla.org) # Comprehensive web documentation
              - MIT OpenCourseWare https://ocw.mit.edu

            - Tools and Utilities
              - [GitHub](https://github.com)
              - Stack Overflow https://stackoverflow.com # Programming Q&A community
              - [Regex101](https://regex101.com) # Test regular expressions

            - Documentation # Official documentation links
              - [Python Docs](https://docs.python.org)
              - [Bash Manual](https://gnu.org/software/bash/manual/)

            ## Notes

            - Lines starting with `- ` and no URL create collapsible groups
            - Indent child links with more spaces than the group header
            - Add `# comment` at the end of any link or group for context
            - External URLs automatically open in reusable tabs
            - Child directories are auto-detected and displayed as navigation buttons
EOF
    }

    create_directory_with_template() {
        local dir_path="$1"
        local full_path="${dir_path}"

        # Create the directory with parents if needed
        if ! mkdir -p "${full_path}"; then
            die "Failed to create directory: ${full_path}"
        fi

        # Create README.md if it doesn't exist
        local readme_path="${full_path}/README.md"
        if [[ -f "${readme_path}" ]]; then
            echo "==> Skipped ${dir_path} (README.md already exists)" >&2
        else
            get_template_content > "${readme_path}" || die "Failed to create ${readme_path}"
            echo "==> Created ${dir_path}/README.md" >&2
        fi
    }

    cmd_mktree() {
        if [[ "$#" -eq 0 ]]; then
            die "mktree requires at least one PATTERN argument (use -h for help)"
        fi

        # Process each pattern
        for pattern in "$@"; do
            # Use bash to expand braces
            # We need to be careful here - we want to expand the pattern but not execute anything
            local expanded
            # Use eval with echo to expand the braces safely
            # shellcheck disable=SC2207
            expanded=($(bash -c "echo ${pattern}"))

            # Create each expanded path
            for dir_path in "${expanded[@]}"; do
                create_directory_with_template "${dir_path}"
            done
        done

        echo "" >&2
        echo "==> Template creation complete!" >&2
        echo "    Edit the README.md files to add your links." >&2
    }

    cmd_mkdir() {
        if [[ "$#" -ne 1 ]]; then
            die "mkdir requires exactly one NAME argument (use -h for help)"
        fi

        local name="$1"

        # Validate name doesn't contain problematic characters
        if [[ "${name}" =~ [[:space:]] ]]; then
            die "Directory name cannot contain spaces: '${name}'"
        fi

        # mkdir is just a simplified wrapper around mktree
        cmd_mktree "${name}"
    }

}

main() {
    # Parse command
    local command="${1:-}"

    if [[ -z "${command}" ]] || [[ "${command}" = "-h" ]] || [[ "${command}" = "--help" ]]; then
        usage
    fi

    shift  # Remove command from args

    case "${command}" in
        mkdir)
            cmd_mkdir "$@"
            ;;
        mktree)
            cmd_mktree "$@"
            ;;
        *)
            die "Unknown command: ${command} (use -h for help)"
            ;;
    esac
}

if [[ -z "${sourceMe:-}" ]]; then
    main "$@"
    builtin exit
fi
command true
