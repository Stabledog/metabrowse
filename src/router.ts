/** Hash-based router. Maps #/path → text/path/README.md */

import { contentPathFor } from './utils.ts';

export type RouteKind = 'browse' | 'edit';

export interface Route {
  kind: RouteKind;
  /** Directory path relative to text/, e.g. "teach/CPP". Empty string for root. */
  dirPath: string;
  /** Full API path, e.g. "text/teach/CPP/README.md" */
  contentPath: string;
}

type RouteHandler = (route: Route) => void;

let handler: RouteHandler | null = null;

/** Parse the current hash into a Route. */
export function parseHash(hash: string): Route {
  // Remove leading # and /
  let path = hash.replace(/^#\/?/, '');

  // Detect edit route
  let kind: RouteKind = 'browse';
  if (path.startsWith('edit/')) {
    kind = 'edit';
    path = path.slice('edit/'.length);
  } else if (path === 'edit') {
    kind = 'edit';
    path = '';
  }

  // Remove trailing slashes
  path = path.replace(/\/+$/, '');

  // Decode percent-encoding (browser encodes spaces in fragments as %20)
  try { path = decodeURIComponent(path); } catch { /* leave as-is if malformed */ }

  const contentPath = contentPathFor(path);

  return { kind, dirPath: path, contentPath };
}

/** Get the current route from window.location.hash. */
export function getCurrentRoute(): Route {
  return parseHash(window.location.hash);
}

/** Navigate to a directory path. */
export function navigateTo(dirPath: string): void {
  window.location.hash = dirPath ? `#/${dirPath}` : '#/';
}

/** Register a handler and start listening. Fires immediately for current route. */
export function startRouter(onRoute: RouteHandler): void {
  handler = onRoute;
  window.addEventListener('hashchange', () => {
    handler?.(getCurrentRoute());
  });
  // Fire for initial route
  handler(getCurrentRoute());
}
