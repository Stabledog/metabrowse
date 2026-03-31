#!/usr/bin/env bash
# serve-metabrowse.sh - Serve metabrowse docs/ for local testing
#
# This script starts a local web server to preview the generated HTML.
# Run from a metabrowse content directory (containing docs/).

set -euo pipefail

# PS4 provides good diagnostics when -x is turned on
#shellcheck disable=2154
PS4='$( _0=$?; exec 2>/dev/null; realpath -- "${BASH_SOURCE[0]:-?}:${LINENO} ^$_0 ${FUNCNAME[0]:-?}()=>" ) '
[[ -n "${DEBUGSH:-}" ]] && set -x

scriptName="${scriptName:-"$(command readlink -f -- "$0")"}"

export METABROWSE_PYTHON=${METABROWSE_PYTHON:-"${HOME}/.local/bin/python3"}
export METABROWSE_PORT=${METABROWSE_PORT:-3000}

die() {
    builtin echo "ERROR($(basename "${scriptName}")): $*" >&2
    builtin exit 1
}

{  # outer scope braces

    usage() {
        cut -c 12- <<'EOF'
            Usage: serve-metabrowse.sh [OPTIONS]

            Serve metabrowse docs/ directory for local testing.

            This script must be run from a metabrowse content directory containing:
              - docs/     Generated HTML output (run build-metabrowse.sh first)

            OPTIONS:
              -h, --help    Show this help message
              -p, --port N  Port to serve on (default: 3000)

            ENVIRONMENT VARIABLES:
              METABROWSE_PYTHON     Python interpreter path
                                    (default: ~/.local/bin/python3)
              METABROWSE_PORT       Port to serve on
                                    (default: 3000)

            EXAMPLES:
              cd ~/my-metabrowse-links
              build-metabrowse.sh
              serve-metabrowse.sh

              # Use a different port
              serve-metabrowse.sh -p 3000

              # Or with environment variable
              METABROWSE_PORT=9000 serve-metabrowse.sh
EOF
        builtin exit 2
    }

    validate_content_dir() {
        local content_dir="$1"

        if [[ ! -d "${content_dir}/docs" ]]; then
            die "No docs/ directory found in ${content_dir}. Run build-metabrowse.sh first."
        fi

        if [[ ! -f "${content_dir}/docs/index.html" ]]; then
            die "No docs/index.html found. The docs/ directory appears empty or incomplete."
        fi
    }

    validate_python() {
        local python_path="$1"

        if [[ ! -x "${python_path}" ]]; then
            die "Python interpreter not found or not executable: ${python_path}"
        fi
    }

    run_server() {
        local content_dir="$1"
        local python_path="$2"
        local port="$3"

        echo "==> Starting local web server" >&2
        echo "    Content directory: ${content_dir}/docs/" >&2
        echo "    Server URL: http://localhost:${port}" >&2
        echo "" >&2
        echo "Press Ctrl+C to stop the server" >&2
        echo "" >&2

        cd "${content_dir}/docs" || die "Failed to change to docs directory"

        # Use Python's built-in HTTP server
        "${python_path}" -m http.server "${port}"
    }

}

main() {
    local port="${METABROWSE_PORT}"

    # Parse arguments
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            -h|--help)
                usage
                ;;
            -p|--port)
                if [[ "$#" -lt 2 ]]; then
                    die "--port requires an argument"
                fi
                port="$2"
                shift 2
                ;;
            *)
                die "Unknown option: $1 (use -h for help)"
                ;;
        esac
    done

    # Validate port is a number
    if ! [[ "${port}" =~ ^[0-9]+$ ]]; then
        die "Port must be a number: ${port}"
    fi

    # Get current directory as content directory
    local content_dir
    content_dir="$(pwd)"

    # Validate all requirements
    validate_content_dir "${content_dir}"
    validate_python "${METABROWSE_PYTHON}"

    # Run the server
    run_server "${content_dir}" "${METABROWSE_PYTHON}" "${port}"
}

if [[ -z "${sourceMe:-}" ]]; then
    main "$@"
    builtin exit
fi
command true
