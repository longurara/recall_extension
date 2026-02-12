# API Reference

Internal module API documentation for developers working on the Recall extension.

---

## Table of Contents

- [lib/constants.js](#libconstantsjs)
- [lib/db.js](#libdbjs)
- [lib/utils.js](#libutilsjs)
- [lib/theme.js](#libthemejs)
- [lib/storage-manager.js](#libstorage-managerjs)
- [background/capture-manager.js](#backgroundcapture-managerjs)
- [background/deep-capture.js](#backgrounddeep-capturejs)
- [background/watcher.js](#backgroundwatcherjs)
- [content/snapshot.js](#contentsnapshotjs)
- [Message Types Reference](#message-types-reference)

---

## lib/constants.js

Shared constants imported by all modules.

### Exports

#### `DB_NAME`
```javascript
const DB_NAME = 'RecallDB'
```
IndexedDB database name.

#### `DB_VERSION`
```javascript
const DB_VERSION = 3
```
Current schema version. Incrementing triggers `onupgradeneeded`.

#### `STORE_SNAPSHOTS`, `STORE_SNAPSHOT_DATA`, `STORE_SETTINGS`, `STORE_WATCHED_PAGES`
```javascript
const STORE_SNAPSHOTS = 'snapshots'
const STORE_SNAPSHOT_DATA = 'snapshotData'
const STORE_SETTINGS = 'settings'
const STORE_WATCHED_PAGES = 'watchedPages'
```
Object store name constants.

#### `CAPTURE_AUTO`, `CAPTURE_MANUAL`, `CAPTURE_DEEP`
```javascript
const CAPTURE_AUTO = 'auto'
const CAPTURE_MANUAL = 'manual'
const CAPTURE_DEEP = 'deep'
```
Capture type identifiers.

#### `DEFAULT_SETTINGS`
```javascript
const DEFAULT_SETTINGS = {
  maxStorageMB: 2048,
  autoCapture: true,
  captureDelay: 2000,
  excludeDomains: ['chrome.google.com', 'chromewebstore.google.com', 'extensions'],
  excludeProtocols: ['chrome:', 'chrome-extension:', 'about:', 'devtools:', 'edge:', 'brave:', 'file:', 'data:', 'blob:'],
  thumbnailQuality: 0.6,
  thumbnailMaxWidth: 320,
  thumbnailMaxHeight: 200,
  maxSnapshotSizeMB: 15,
  duplicateWindowMinutes: 5,
  autoCleanupEnabled: true,
  autoCleanupThreshold: 0.9,
  autoCleanupDays: 0,
  infoBarCollapsed: false,
}
```
Default values for all settings. Used as fallbacks when settings are not yet saved.

#### `MSG`
```javascript
const MSG = {
  CAPTURE_PAGE: 'CAPTURE_PAGE',
  CAPTURE_DOM: 'CAPTURE_DOM',
  CAPTURE_DOM_RESULT: 'CAPTURE_DOM_RESULT',
  CAPTURE_DEEP: 'CAPTURE_DEEP',
  CAPTURE_STATUS: 'CAPTURE_STATUS',
  GET_SNAPSHOTS: 'GET_SNAPSHOTS',
  GET_SNAPSHOT: 'GET_SNAPSHOT',
  DELETE_SNAPSHOT: 'DELETE_SNAPSHOT',
  DELETE_SNAPSHOTS: 'DELETE_SNAPSHOTS',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_STORAGE_USAGE: 'GET_STORAGE_USAGE',
  EXPORT_MHTML: 'EXPORT_MHTML',
  OPEN_VIEWER: 'OPEN_VIEWER',
  OPEN_MANAGER: 'OPEN_MANAGER',
  SNAPSHOT_SAVED: 'SNAPSHOT_SAVED',
  SNAPSHOT_DELETED: 'SNAPSHOT_DELETED',
  TOGGLE_AUTO_CAPTURE: 'TOGGLE_AUTO_CAPTURE',
  GET_NAVIGATION_FLOWS: 'GET_NAVIGATION_FLOWS',
  GET_FLOW_SNAPSHOTS: 'GET_FLOW_SNAPSHOTS',
  SEARCH_CONTENT: 'SEARCH_CONTENT',
  SPOTLIGHT_SEARCH: 'SPOTLIGHT_SEARCH',
  CHECK_URL_SNAPSHOTS: 'CHECK_URL_SNAPSHOTS',
  UPDATE_SNAPSHOT_TAGS: 'UPDATE_SNAPSHOT_TAGS',
  UPDATE_SNAPSHOT_NOTES: 'UPDATE_SNAPSHOT_NOTES',
  UPDATE_SNAPSHOT_ANNOTATIONS: 'UPDATE_SNAPSHOT_ANNOTATIONS',
  WATCH_PAGE: 'WATCH_PAGE',
  UNWATCH_PAGE: 'UNWATCH_PAGE',
  GET_WATCHED_PAGES: 'GET_WATCHED_PAGES',
  UPDATE_WATCH: 'UPDATE_WATCH',
  CHECK_WATCHED_NOW: 'CHECK_WATCHED_NOW',
  WATCHED_PAGE_CHANGED: 'WATCHED_PAGE_CHANGED',
}
```
All message type constants. See [Message Types Reference](#message-types-reference) for detailed usage.

#### `BADGE_COLORS`
```javascript
const BADGE_COLORS = {
  CAPTURING: '#FF9800',  // Orange
  SUCCESS: '#4CAF50',    // Green
  ERROR: '#F44336',      // Red
  DISABLED: '#9E9E9E',   // Grey
}
```

#### `PLACEHOLDER_IMAGE`
SVG data URI used as placeholder for failed image inlining.

---

## lib/db.js

IndexedDB wrapper providing all database operations. All functions are async and return Promises.

### Database Connection

#### `openDB() → Promise<IDBDatabase>`
Opens (or returns cached) IndexedDB connection. Handles schema upgrades for all 3 versions. The connection is cached as a module-level singleton. Automatically handles `onclose` and `onversionchange` events.

### Snapshot Operations

#### `saveSnapshot(metadata) → Promise<void>`
Save or update snapshot metadata.
- **metadata** `{Object}` - Full snapshot metadata object (must include `id`)

#### `getSnapshot(id) → Promise<Object|undefined>`
Get a single snapshot's metadata by ID.
- **id** `{string}` - Snapshot UUID

#### `getAllSnapshots() → Promise<Object[]>`
Get all snapshots sorted by timestamp descending (newest first). Uses the `timestamp` index with a reverse cursor.

#### `getSnapshotsPaginated(offset?, limit?) → Promise<Object[]>`
Get snapshots with pagination.
- **offset** `{number}` - Number of items to skip (default: 0)
- **limit** `{number}` - Maximum items to return (default: 50)

#### `searchSnapshots(query) → Promise<Object[]>`
Search snapshots by title, URL, or domain (case-insensitive substring match).
- **query** `{string}` - Search query

#### `getSnapshotsByDomain(domain) → Promise<Object[]>`
Get all snapshots for a specific domain, sorted by timestamp descending.
- **domain** `{string}` - Hostname to filter by

#### `getSnapshotsByUrl(url) → Promise<Object[]>`
Get all snapshots for a specific URL, sorted by timestamp descending.
- **url** `{string}` - Full URL to filter by

#### `hasRecentDuplicate(url, withinMinutes?) → Promise<boolean>`
Check if a snapshot of this URL exists within the time window.
- **url** `{string}` - URL to check
- **withinMinutes** `{number}` - Time window (default: 5)

#### `deleteSnapshot(id) → Promise<void>`
Delete a snapshot's metadata AND data in a single transaction.
- **id** `{string}` - Snapshot UUID

#### `deleteSnapshots(ids) → Promise<void>`
Delete multiple snapshots (metadata + data) in a single transaction.
- **ids** `{string[]}` - Array of snapshot UUIDs

#### `updateSnapshot(id, updates) → Promise<void>`
Partial update of snapshot metadata. Merges `updates` into existing record.
- **id** `{string}` - Snapshot UUID
- **updates** `{Object}` - Fields to update

#### `getSnapshotCount() → Promise<number>`
Get total number of snapshots.

#### `getAllDomains() → Promise<Array<{domain, count}>>`
Get all unique domains with snapshot counts, sorted by count descending.

### Snapshot Data Operations

#### `saveSnapshotData(data) → Promise<void>`
Save snapshot data (compressed HTML + optional deep bundle + text content).
- **data** `{Object}` - Must include `id`, `domSnapshot` (Blob), `textContent` (string)

#### `getSnapshotData(id) → Promise<Object|undefined>`
Get snapshot data by ID.
- **id** `{string}` - Snapshot UUID

### Settings Operations

#### `getSetting(key) → Promise<any>`
Get a single setting value. Falls back to `DEFAULT_SETTINGS[key]` if not saved.
- **key** `{string}` - Setting name

#### `getAllSettings() → Promise<Object>`
Get all settings merged with defaults. Saved values override defaults.

#### `saveSetting(key, value) → Promise<void>`
Save a single setting.
- **key** `{string}` - Setting name
- **value** `{any}` - Setting value

#### `saveSettings(settingsObj) → Promise<void>`
Save multiple settings in a single transaction.
- **settingsObj** `{Object}` - Key-value pairs to save

### Storage Operations

#### `getStorageUsage() → Promise<{totalSize, count}>`
Calculate total storage usage by summing `snapshotSize` across all snapshots.

#### `getSnapshotsBySize() → Promise<Object[]>`
Get all snapshots sorted by size (largest first). Used for cleanup decisions.

#### `getOldestSnapshots(limit?) → Promise<Object[]>`
Get oldest non-starred snapshots for cleanup.
- **limit** `{number}` - Maximum to return (default: 10)

### Navigation Flow Operations

#### `getSnapshotsBySessionId(sessionId) → Promise<Object[]>`
Get all snapshots in a navigation session, sorted by timestamp ascending.
- **sessionId** `{string}` - Session UUID

#### `getNavigationFlows() → Promise<Array<Flow>>`
Get all navigation flows (sessions with 2+ snapshots).

Returns:
```javascript
{
  sessionId: string,
  snapshots: Object[],
  startTime: number,
  endTime: number,
  pageCount: number,
}
```

### Full-Text Search Operations

#### `searchContentForIds(query) → Promise<string[]>`
Search page text content for a query string. Returns matching snapshot IDs. Uses cursor iteration to avoid loading all data into memory.
- **query** `{string}` - Search query (case-insensitive)

#### `searchSnapshotsFullText(query) → Promise<Object[]>`
Combined metadata + content search. Runs both in parallel, merges results.
- **query** `{string}` - Search query

### Watched Pages Operations

#### `saveWatchedPage(entry) → Promise<void>`
Create or update a watched page entry.

#### `getWatchedPage(id) → Promise<Object|undefined>`
Get a watched page by ID.

#### `getAllWatchedPages() → Promise<Object[]>`
Get all watched pages, sorted by `createdAt` descending.

#### `getActiveWatchedPages() → Promise<Object[]>`
Get all watched pages where `isActive === true`.

#### `getWatchedPageByUrl(url) → Promise<Object|null>`
Get a watched page by URL (unique index).

#### `updateWatchedPage(id, updates) → Promise<void>`
Partial update of a watched page entry.

#### `deleteWatchedPage(id) → Promise<void>`
Delete a watched page by ID.

#### `getWatchedPagesDueForCheck() → Promise<Object[]>`
Get active pages where `lastChecked + intervalMinutes < now`.

---

## lib/utils.js

Shared utility functions.

#### `generateId() → string`
Generate a UUID v4 using `crypto.randomUUID()` with fallback.

#### `getDomain(url) → string`
Extract hostname from URL. Returns empty string on invalid URLs.

#### `formatBytes(bytes, decimals?) → string`
Format bytes to human-readable string (e.g., `"1.5 MB"`).
- **decimals** `{number}` - Decimal places (default: 1)

#### `timeAgo(timestamp) → string`
Format timestamp to relative time (e.g., `"5m ago"`, `"2d ago"`, `"Jan 15"`).

#### `formatDate(timestamp) → string`
Format timestamp to full date string (e.g., `"Jan 15, 2026, 02:30 PM"`).

#### `compressBlob(blob) → Promise<Blob>`
Compress a Blob using gzip via `CompressionStream`. Falls back to uncompressed if API unavailable.

#### `decompressBlob(blob) → Promise<Blob>`
Decompress a gzip Blob using `DecompressionStream`.

#### `compressString(str) → Promise<Blob>`
Compress a string to a gzip Blob. Wraps string in a text/html Blob first.

#### `decompressToString(blob) → Promise<string>`
Decompress a gzip Blob to a string.

#### `debounce(fn, ms) → Function`
Standard debounce. Returns a debounced version of `fn`.

#### `throttle(fn, ms) → Function`
Standard throttle. Returns a throttled version of `fn`.

#### `truncate(str, maxLen?) → string`
Truncate string with ellipsis. Default `maxLen`: 60.

#### `escapeHtml(str) → string`
Escape HTML special characters using DOM text content trick.

#### `shouldExcludeUrl(url, settings) → boolean`
Check if a URL should be excluded from capture based on protocol and domain exclusion lists in settings.

#### `createThumbnail(dataUrl, maxWidth?, maxHeight?, quality?) → Promise<Blob>`
Create a JPEG thumbnail Blob from an image data URL. Uses Canvas API (only works in page contexts, not service worker).
- **maxWidth** `{number}` - Default: 320
- **maxHeight** `{number}` - Default: 200
- **quality** `{number}` - Default: 0.6

---

## lib/theme.js

Dark/light mode system.

#### `initTheme() → {toggle, getTheme}`
Initialize the theme system:
1. Load from `localStorage('recall-theme')`
2. Fall back to `prefers-color-scheme` media query
3. Apply `data-theme` attribute to `<html>`
4. Set up system preference listener (if no explicit preference)

Returns an object with:
- **toggle** `() → string` - Toggle theme, returns new theme name
- **getTheme** `() → string` - Returns current theme (`'dark'` or `'light'`)

#### `createThemeToggle(container) → HTMLButtonElement`
Create and inject a theme toggle button into a container element.
- **container** `{HTMLElement}` - Parent element to append button to

---

## lib/storage-manager.js

### Class: `StorageManager`

Manages storage quota, auto-cleanup, and usage statistics. Exported as a singleton `storageManager`.

#### `getSettings() → Promise<Object>`
Get settings (cached). Use `invalidateCache()` after settings change.

#### `invalidateCache() → void`
Clear the settings cache. Must be called after `db.saveSettings()`.

#### `getUsageStats() → Promise<UsageStats>`
Get current storage usage statistics.

Returns:
```javascript
{
  totalSize: number,           // Total bytes used
  totalSizeFormatted: string,  // e.g., "150.5 MB"
  count: number,               // Number of snapshots
  maxBytes: number,            // Quota in bytes
  maxFormatted: string,        // e.g., "2 GB"
  usagePercent: number,        // e.g., 75.3
  isWarning: boolean,          // >= 80%
  isCritical: boolean,         // >= 90%
  isFull: boolean,             // >= 100%
}
```

#### `hasRoom(estimatedSize?) → Promise<boolean>`
Check if there's room for a new snapshot.
- **estimatedSize** `{number}` - Estimated snapshot size in bytes (default: 0)

#### `autoCleanup(targetFreeBytes?) → Promise<number>`
Delete oldest non-starred snapshots to free space. Returns count deleted.
- **targetFreeBytes** `{number}` - Minimum bytes to free (default: 0 = use threshold)

#### `timeBasedCleanup() → Promise<number>`
Delete auto-captured, non-starred snapshots older than `autoCleanupDays`. Returns count deleted.

#### `checkAndCleanup() → Promise<{ok, message, cleaned}>`
Check quota and run cleanup if needed. Called before every capture.

Returns:
```javascript
{
  ok: boolean,        // true if capture can proceed
  message: string,    // Human-readable status (or null)
  cleaned: number,    // Number of snapshots cleaned
}
```

---

## background/capture-manager.js

### Functions

#### `captureTab(tabId, captureType?, flowMeta?) → Promise<Object|null>`
Main capture orchestration function. Coordinates DOM snapshot, screenshot, compression, and storage.
- **tabId** `{number}` - Chrome tab ID
- **captureType** `{string}` - `'auto'` or `'manual'` (default: `'auto'`)
- **flowMeta** `{Object|null}` - `{sessionId, parentSnapshotId}` for flow tracking

Returns snapshot metadata on success, `null` on skip/failure. Never throws (catches internally).

#### `exportSnapshot(snapshotId) → Promise<{format, filename}>`
Export a snapshot as MHTML (if original tab is open) or compressed HTML.
- **snapshotId** `{string}` - Snapshot UUID

Returns `{format: 'mhtml'|'html', filename: string}`.

---

## background/deep-capture.js

### Functions

#### `deepCaptureTab(tabId, flowMeta?) → Promise<Object>`
Deep capture using Chrome DevTools Protocol.
- **tabId** `{number}` - Chrome tab ID
- **flowMeta** `{Object|null}` - `{sessionId, parentSnapshotId}` for flow tracking

Returns snapshot metadata. Throws on failure (unlike `captureTab`).

### Internal Functions

- `sendCommand(tabId, method, params)` - Send CDP command via `chrome.debugger`
- `attachDebugger(tabId)` - Attach debugger (CDP v1.3)
- `detachDebugger(tabId)` - Detach debugger (ignores errors)
- `buildViewableHtml(resources, pageUrl, title)` - Rebuild self-contained HTML from CDP resources
- `base64ToBlob(base64, mimeType)` - Convert base64 string to Blob
- `escapeRegExp(str)` - Escape string for use in RegExp

---

## background/watcher.js

### Exported Functions

#### `watchPage(opts) → Promise<Object>`
Start watching a URL for changes.
- **opts.url** `{string}` - URL to watch (required)
- **opts.title** `{string}` - Page title
- **opts.intervalMinutes** `{number}` - Check interval (default: 60)
- **opts.cssSelector** `{string}` - CSS selector to scope monitoring
- **opts.notifyOnChange** `{boolean}` - Send Chrome notification (default: true)

Returns the created watch entry. If URL is already watched, returns existing or reactivates.

#### `unwatchPage(id) → Promise<{deleted: string}>`
Stop watching and delete the entry.
- **id** `{string}` - Watch entry UUID

#### `checkAllDuePages() → Promise<{checked, changed}>`
Check all pages that are due for checking. Sends notifications for changes.

#### `checkWatchedPage(entry) → Promise<{changed, entry?, error?}>`
Check a single watched page for changes.
- **entry** `{Object}` - Watched page entry from IndexedDB

### Internal Functions

- `hashText(str)` - FNV-1a 32-bit hash
- `extractTextFromHtml(html)` - Strip HTML tags, decode entities, normalize whitespace
- `extractTextForSelector(html, selector)` - Extract text for a CSS selector (regex-based)
- `fetchPage(url)` - Fetch page HTML with 30s timeout

---

## content/snapshot.js

Content script for DOM capture. Runs as an IIFE with injection guard.

### Internal Functions (not exported - content script IIFE)

#### `captureDOM() → Promise<Object>`
Main capture function. Returns:
```javascript
{
  html: string,            // Full HTML with DOCTYPE
  textContent: string,     // Plain text (max 50KB)
  title: string,           // document.title
  url: string,             // document.location.href
  scrollY: number,         // window.scrollY
  scrollX: number,         // window.scrollX
  captureTime: number,     // Date.now()
  captureElapsed: number,  // Capture duration in ms
  htmlSize: number,        // html.length
}
```

#### DOM Processing Steps (in order):
1. Clone `document.documentElement`
2. Inline `<link rel="stylesheet">` as `<style>` (fetches CSS via fetch)
3. Inline images as base64 data URIs
4. Remove `<picture>` `srcset` attributes
5. Capture `<canvas>` as static `<img>`
6. Preserve form input values
7. Inline background images (partial)
8. Remove `<script>` tags
9. Remove `on*` event handler attributes
10. Remove `<noscript>` tags
11. Add `<base href>` tag
12. Add recall metadata `<meta>` tags
13. Extract plain text via `document.body.innerText`
14. Serialize as `<!DOCTYPE html>\n` + outerHTML

### Message Listener

Listens for `{type: 'CAPTURE_DOM'}` messages and responds with the capture result.

---

## Message Types Reference

Complete reference for all message types used in `chrome.runtime.sendMessage()`.

### Capture Messages

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `CAPTURE_PAGE` | UI → SW | `{tabId?}` | Snapshot metadata |
| `CAPTURE_DOM` | SW → Content | - | `{html, textContent, ...}` |
| `CAPTURE_DEEP` | UI → SW | `{tabId?}` | Snapshot metadata |
| `CAPTURE_STATUS` | SW → UI | `{status, ...}` | - |

### Snapshot CRUD Messages

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `GET_SNAPSHOTS` | UI → SW | `{query?, domain?, offset?, limit?}` | Metadata[] |
| `GET_SNAPSHOT` | UI → SW | `{id}` | Metadata |
| `DELETE_SNAPSHOT` | UI → SW | `{id}` | `{deleted: id}` |
| `DELETE_SNAPSHOTS` | UI → SW | `{ids}` | `{deleted: ids}` |
| `UPDATE_SNAPSHOT_TAGS` | UI → SW | `{id, tags}` | `{updated}` |
| `UPDATE_SNAPSHOT_NOTES` | UI → SW | `{id, notes}` | `{updated}` |
| `UPDATE_SNAPSHOT_ANNOTATIONS` | UI → SW | `{id, annotations}` | `{updated}` |

### Settings Messages

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `GET_SETTINGS` | UI → SW | - | Settings object |
| `UPDATE_SETTINGS` | UI → SW | `{settings}` | `{updated}` |
| `TOGGLE_AUTO_CAPTURE` | UI → SW | - | `{autoCapture: bool}` |

### Search Messages

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `SEARCH_CONTENT` | UI → SW | `{query}` | Metadata[] |
| `SPOTLIGHT_SEARCH` | UI → SW | `{query, limit?}` | Result[] with snippets |
| `CHECK_URL_SNAPSHOTS` | Content → SW | `{url}` | `{snapshots, count}` |

### Navigation Messages

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `OPEN_VIEWER` | UI → SW | `{id, query?}` | `{opened}` |
| `OPEN_MANAGER` | UI → SW | - | `{opened}` |
| `GET_NAVIGATION_FLOWS` | UI → SW | - | Flow[] |
| `GET_FLOW_SNAPSHOTS` | UI → SW | `{sessionId}` | Metadata[] |

### Storage Messages

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `GET_STORAGE_USAGE` | UI → SW | - | UsageStats |
| `EXPORT_MHTML` | UI → SW | `{id}` | `{format, filename}` |

### Watch Messages

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `WATCH_PAGE` | UI → SW | `{url, title?, intervalMinutes?, cssSelector?, notifyOnChange?}` | Watch entry |
| `UNWATCH_PAGE` | UI → SW | `{id}` | `{deleted: id}` |
| `GET_WATCHED_PAGES` | UI → SW | - | WatchEntry[] |
| `UPDATE_WATCH` | UI → SW | `{id, intervalMinutes?, isActive?, cssSelector?, notifyOnChange?}` | `{updated}` |
| `CHECK_WATCHED_NOW` | UI → SW | `{id?}` | Check result |

### Broadcast Events (SW → All Listeners)

| Type | Data |
|------|------|
| `SNAPSHOT_SAVED` | `{snapshot: metadata}` |
| `SNAPSHOT_DELETED` | `{id}` or `{ids}` |
| `WATCHED_PAGE_CHANGED` | `{entry: watchEntry}` |

### Content Script Messages

| Type | Direction | Parameters |
|------|-----------|------------|
| `TOGGLE_SPOTLIGHT` | SW → Content | - |

**Legend:**
- **SW** = Service Worker (background)
- **UI** = Extension pages (popup, sidepanel, manager, viewer, diff, settings)
- **Content** = Content scripts (snapshot.js, spotlight.js, you-were-here.js)
