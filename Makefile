.PHONY: build clean help

PYTHON := ~/.local/bin/python3

help:
	@echo "Metabrowse build commands:"
	@echo "  make build  - Generate HTML from markdown files"
	@echo "  make clean  - Remove generated docs/ directory"
	@echo "  make help   - Show this help message"

build:
	$(PYTHON) build.py

clean:
	rm -rf docs/
