# Favicon Auto-Fetch with localStorage Caching

## Context

Metabrowse currently displays links without favicons, making it harder to visually distinguish between different sites. Users want to enhance the bookmark browsing experience by automatically fetching and displaying favicons for each external link.

The requirement is to implement a client-side solution that:
- Fetches favicons automatically for each external (http/https) link
- Stores favicons in browser localStorage for persistence across sessions
- Uses the existing SHA256 URL hash as the storage key for consistency
- Works entirely client-side with no build-time overhead
- Handles failures gracefully (missing favicons, CORS issues, storage limits)

## Implementation Approach: Client-Side localStorage (No External Fallback)

We'll use JavaScript to fetch favicons directly from each site's domain (`https://domain.com/favicon.ico`), cache them as base64-encoded data URLs in localStorage, and display them alongside links. **Storage is keyed by favicon URL hash** (not page URL hash) to avoid duplicating the same favicon across multiple links.

**Why this approach:**
- Fully client-side and local-only (no external services, no Python changes)
- **Efficient storage:** Multiple links to same domain share one cached favicon
  - Example: 100 GitHub links = 1 favicon stored (~5KB) instead of 100 copies (~500KB)
- Computes SHA256 hash of favicon URL for cache keys (matches existing Python hash algorithm)
- No build-time performance impact
- Works offline after initial favicon fetch
- Browser localStorage persists across sessions
- Simple implementation - if favicon fetch fails, we just don't show it

**Trade-offs:**
- Requires JavaScript (gracefully degrades if disabled)
- CORS may block some favicons (they simply won't appear - acceptable)
- localStorage 5-10MB limit (but efficient: ~1000-2000 unique domains possible)
  - Storage keyed by favicon URL, so multiple links to same domain share one favicon
- Some sites don't have `/favicon.ico` at root (won't display - acceptable)
- **90% solution is fine** - not all favicons will work, but most will

## Critical Files

1. **`/workarea/metabrowse/templates/index.html`** - Add favicon rendering and JavaScript logic
2. **`/workarea/metabrowse/templates/style.css`** - Style favicon display

**Note:** No Python changes needed! This is a purely client-side feature.

## Implementation Steps

### 1. Update HTML Template for Favicon Rendering

**File:** `templates/index.html`

#### 1a. Add favicon placeholder to link rendering

Update ungrouped links section (around line 42-52):
```html
{% if link.raw_html %}
  {{ link.raw_html|safe }}
{% else %}
  <img src="" alt="" class="link-favicon" data-link-url="{{ link.url }}" loading="lazy">
  <a href="{{ link.url }}" target="{{ link.target }}">{{ link.text }}</a>
{% endif %}
```

Update grouped links section (around line 69-78):
```html
{% if link.raw_html %}
  {{ link.raw_html|safe }}
{% else %}
  <img src="" alt="" class="link-favicon" data-link-url="{{ link.url }}" loading="lazy">
  <a href="{{ link.url }}" target="{{ link.target }}">{{ link.text }}</a>
{% endif %}
```

**Key attributes:**
- `src=""`: Empty initially, populated by JavaScript
- `data-link-url`: Full URL of the link (JavaScript will extract domain, compute hash, fetch favicon)
- `loading="lazy"`: Defers loading for performance

**Note:** We show the favicon for ALL links initially, and JavaScript will hide it (via CSS) if it's not an http/https URL.

#### 1b. Add JavaScript for favicon fetching and caching

Add before closing `</body>` tag (around line 90):

```html
<script>
(function() {
  'use strict';

  const FAVICON_CACHE_PREFIX = 'metabrowse-favicon-';
  const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Compute SHA256 hash of URL (first 8 hex chars, matching Python's generate_target)
  // Used to hash favicon URLs for cache keys
  async function computeUrlHash(url) {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 8);
  }

  // Check if URL is http/https
  function isHttpUrl(url) {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  // Extract domain from URL and construct favicon URL
  function getFaviconUrl(linkUrl) {
    try {
      const url = new URL(linkUrl);
      return url.origin + '/favicon.ico';
    } catch (e) {
      return null;
    }
  }

  // Get cached favicon from localStorage
  function getCachedFavicon(urlHash) {
    try {
      const key = FAVICON_CACHE_PREFIX + urlHash;
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const data = JSON.parse(cached);
      const age = Date.now() - data.timestamp;

      // Expire old entries
      if (age > MAX_CACHE_AGE_MS) {
        localStorage.removeItem(key);
        return null;
      }

      return data.dataUrl;
    } catch (e) {
      return null;
    }
  }

  // Cache favicon in localStorage
  function cacheFavicon(urlHash, dataUrl) {
    try {
      const key = FAVICON_CACHE_PREFIX + urlHash;
      const data = JSON.stringify({
        dataUrl: dataUrl,
        timestamp: Date.now()
      });
      localStorage.setItem(key, data);
    } catch (e) {
      // localStorage quota exceeded or disabled - silently fail
    }
  }

  // Fetch favicon and convert to base64 data URL
  function fetchFavicon(faviconUrl, urlHash) {
    return fetch(faviconUrl)
      .then(response => {
        if (!response.ok) throw new Error('Fetch failed');
        return response.blob();
      })
      .then(blob => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })
      .then(dataUrl => {
        cacheFavicon(urlHash, dataUrl);
        return dataUrl;
      });
  }

  // Load all favicons on page
  async function loadFavicons() {
    const faviconImages = document.querySelectorAll('.link-favicon[data-link-url]');

    for (const img of faviconImages) {
      const linkUrl = img.getAttribute('data-link-url');
      if (!linkUrl || !isHttpUrl(linkUrl)) {
        img.style.display = 'none';  // Hide non-http/https favicons
        continue;
      }

      try {
        // Construct favicon URL from link domain
        const faviconUrl = getFaviconUrl(linkUrl);
        if (!faviconUrl) {
          img.style.display = 'none';
          continue;
        }

        // Compute hash of FAVICON URL (not page URL) for cache key
        // This way all links to same domain share one cached favicon
        const faviconHash = await computeUrlHash(faviconUrl);

        // Try cache first
        const cached = getCachedFavicon(faviconHash);
        if (cached) {
          img.src = cached;
          continue;
        }

        // Fetch and cache (silently fail if CORS/404/etc)
        fetchFavicon(faviconUrl, faviconHash)
          .then(dataUrl => {
            img.src = dataUrl;
          })
          .catch(() => {
            // Silently fail - hide favicon
            img.style.display = 'none';
          });
      } catch (e) {
        // Hash computation failed - hide favicon
        img.style.display = 'none';
      }
    }
  }

  // Load favicons when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFavicons);
  } else {
    loadFavicons();
  }
})();
</script>
```

**JavaScript logic:**
1. Loop through all favicon placeholder images
2. Check if link URL is http/https (hide favicon if not)
3. Extract domain and construct favicon URL `https://domain.com/favicon.ico`
4. **Compute SHA256 hash of FAVICON URL** (not page URL) for cache key
   - This means all links to same domain share one cached favicon
   - Example: 100 GitHub links → 1 cache entry instead of 100
5. Check localStorage cache using `metabrowse-favicon-{faviconHash}` key
6. If cached and not expired (7 days), use cached base64 data URL
7. If not cached, fetch favicon from origin, convert to base64, and cache it
8. **If fetch fails (CORS, 404, network), silently hide the favicon**
9. No fallbacks, no external services, no Python dependencies

### 2. Add CSS Styling

**File:** `templates/style.css` (append to end)

```css
/* Favicon styling */
.link-favicon {
  width: 16px;
  height: 16px;
  margin-right: 6px;
  vertical-align: text-bottom;
  display: inline-block;
  flex-shrink: 0;
}

/* Hide broken/missing favicons */
.link-favicon:not([src]),
.link-favicon[src=""] {
  display: none;
}
```

**Styling notes:**
- 16x16px is standard favicon size
- `vertical-align: text-bottom` aligns with link text baseline
- `flex-shrink: 0` prevents favicon from shrinking in flex layouts
- Hidden if src is empty (before JavaScript loads)

## Error Handling & Edge Cases

1. **localStorage disabled/unavailable:** Silently fails, no favicon displayed
2. **localStorage quota exceeded:** Silently fails, no caching, no favicon displayed
3. **CORS blocks fetch:** Silently fails, no favicon displayed (acceptable - most sites allow it)
4. **Missing favicon (404):** Silently fails, no favicon displayed
5. **Stale cache:** 7-day expiration refreshes old favicons automatically
6. **JavaScript disabled:** Favicons hidden (graceful degradation, links still work perfectly)
7. **Non-HTTP URLs:** JavaScript detects and hides favicon for non-http/https URLs (mailto:, chrome://, etc.)

**Philosophy:** If we can't fetch and cache a favicon locally, we simply don't show it. No warnings, no fallbacks, no external dependencies. The user interface remains clean and functional.

## Performance Considerations

- **Lazy loading:** `loading="lazy"` defers favicon requests until visible
- **Parallel fetches:** All visible favicons fetch concurrently
- **localStorage caching:** After first load, no network requests (100% offline)
- **Async execution:** JavaScript runs after DOMContentLoaded, doesn't block rendering
- **Cache expiry:** 7-day expiration balances freshness vs. network requests
- **Silent failures:** Failed fetches don't impact page performance or user experience

## Verification Steps

After implementation:

1. **Build test content:**
   ```bash
   cd /path/to/test-content
   ~/.local/bin/python3 /path/to/metabrowse/build.py
   ```

2. **Create test README.md with diverse links:**
   ```markdown
   # Test Links

   - https://github.com
   - https://stackoverflow.com
   - https://developer.mozilla.org
   - mailto:test@example.com  # Should have no favicon
   - chrome://settings  # Should have no favicon

   - External Sites
     - https://python.org
     - https://docs.python.org
   ```

3. **Open generated HTML in browser:**
   - Verify favicons appear for http/https links
   - Check browser DevTools → Application → Local Storage
   - Confirm entries like `metabrowse-favicon-a1b2c3d4` exist
   - Verify favicons are base64 data URLs in cache

4. **Test caching:**
   - Reload page (should load from cache, no network requests)
   - Clear localStorage, reload (should fetch and re-cache)
   - Disable JavaScript (should hide favicons, links still work)

5. **Test error handling:**
   - Add link to non-existent domain (should show no favicon)
   - Add link with CORS restrictions (should show no favicon)
   - Fill localStorage to quota (should silently fail to cache new favicons)

6. **Performance check:**
   - Open DevTools → Network tab
   - Verify lazy loading (only visible favicons fetch)
   - Check localStorage size (DevTools → Application)
   - Verify no external service requests (all requests to origin domains only)
