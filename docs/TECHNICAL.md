# Technical Architecture

This document provides a deep-dive into the internal architecture, data model, design decisions, and code organization of the Recall extension.

---

## Table of Contents

- [System Overview](#system-overview)
- [Execution Contexts](#execution-contexts)
- [Data Model](#data-model)
- [Message Protocol](#message-protocol)
- [Capture Pipeline](#capture-pipeline)
- [Deep Capture Pipeline](#deep-capture-pipeline)
- [Search Architecture](#search-architecture)
- [Navigation Flow Tracking](#navigation-flow-tracking)
- [Page Change Watching](#page-change-watching)
- [Storage Management](#storage-management)
- [Security Model](#security-model)
- [Theme System](#theme-system)
- [Performance Considerations](#performance-considerations)
- [Design Decisions](#design-decisions)

---

## System Overview

Recall operates across four distinct Chrome extension execution contexts, communicating primarily through Chrome's message passing API:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Service Worker (Background)                  │
│                                                                  │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ service-worker  │  │ capture-manager │  │  deep-capture    │  │
│  │ .js             │  │ .js             │  │  .js             │  │
│  │                 │  │                 │  │                  │  │
│  │ - Message router│  │ - DOM capture   │  │ - CDP commands   │  │
│  │ - Nav tracking  │  │ - Screenshot    │  │ - Resource fetch │  │
│  │ - Alarms        │  │ - Thumbnail     │  │ - MHTML capture  │  │
│  │ - Context menus │  │ - Compression   │  │ - Bundle build   │  │
│  │ - Commands      │  │ - Export        │  │ - HTML rebuild   │  │
│  └────────┬───────┘  └────────┬────────┘  └────────┬─────────┘  │
│           │                   │                     │            │
│  ┌────────┴───────┐  ┌───────┴─────────┐                        │
│  │ watcher.js     │  │ storage-manager │                        │
│  │                │  │ .js             │                        │
│  │ - Page fetch   │  │ - Quota check   │                        │
│  │ - FNV-1a hash  │  │ - Auto cleanup  │                        │
│  │ - Change detect│  │ - Time cleanup  │                        │
│  │ - Notifications│  │ - Usage stats   │                        │
│  └────────────────┘  └─────────────────┘                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              chrome.runtime.sendMessage / onMessage
                            │
        ┌───────────────────┼───────────────────────┐
        │                   │                       │
        ▼                   ▼                       ▼
┌──────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│Content Scripts│  │Extension Pages   │  │IndexedDB (RecallDB) │
│              │  │                  │  │                     │
│ snapshot.js  │  │ popup/           │  │ snapshots           │
│ spotlight.js │  │ sidepanel/       │  │ snapshotData        │
│ you-were-    │  │ manager/         │  │ settings            │
│ here.js      │  │ viewer/          │  │ watchedPages        │
│              │  │ diff/            │  │                     │
│              │  │ settings/        │  │                     │
└──────────────┘  └──────────────────┘  └─────────────────────┘
```

---

## Execution Contexts

### 1. Service Worker (`background/`)

The service worker is the central hub. It runs as a **Manifest V3 module service worker** (`"type": "module"`) and handles:

- **Message routing**: All `chrome.runtime.onMessage` handlers dispatch to the `handleMessage()` switch in `service-worker.js:374`
- **Auto-capture**: Listens to `webNavigation.onCompleted` and `webNavigation.onHistoryStateUpdated` events
- **Navigation flow tracking**: Maintains an in-memory `Map<tabId, {sessionId, lastSnapshotId, lastUrl}>` to link sequential captures into browsing sessions
- **Alarms**: Two periodic alarms:
  - `recall-time-cleanup` (every 6 hours): deletes old auto-captures
  - `recall-page-watch` (every 15 minutes): checks watched pages for changes
- **Context menus**: Creates 4 context menu items on install
- **Keyboard commands**: Handles `capture-page`, `open-manager`, `toggle-spotlight`

**Key file**: `service-worker.js` (670 lines)

### 2. Content Scripts (`content/`)

Three content scripts are injected into every `http://` and `https://` page:

| Script | Size | Purpose | Isolation |
|--------|------|---------|-----------|
| `snapshot.js` | 400 lines | DOM cloning and serialization | IIFE with `window.__recallSnapshotInjected` guard |
| `spotlight.js` | 871 lines | Spotlight search overlay | Shadow DOM (closed) |
| `you-were-here.js` | 237 lines | Revisit notification bar | Shadow DOM (closed) |

All three use injection guards (`window.__recallXxxInjected`) to prevent duplicate initialization. Spotlight and You-Were-Here use **closed Shadow DOM** to ensure complete CSS isolation from the host page.

### 3. Extension Pages (`popup/`, `sidepanel/`, `manager/`, `viewer/`, `diff/`, `settings/`)

Each page is a standalone HTML+CSS+JS bundle. They communicate with the service worker via messages and can also access IndexedDB directly (viewer and diff do this for performance).

### 4. Shared Libraries (`lib/`)

ES modules imported by both the service worker and extension pages:

| Module | Lines | Exports |
|--------|-------|---------|
| `constants.js` | 100 | `DB_NAME`, `DB_VERSION`, `STORE_*`, `MSG`, `DEFAULT_SETTINGS`, `BADGE_COLORS`, `CAPTURE_*` |
| `db.js` | 684 | Full IndexedDB CRUD for all 4 stores + search + flows |
| `utils.js` | 225 | `generateId`, `getDomain`, `formatBytes`, `timeAgo`, `compressString`, `decompressToString`, `debounce`, `throttle`, `shouldExcludeUrl`, `createThumbnail` |
| `theme.js` | 79 | `initTheme`, `createThemeToggle` |
| `storage-manager.js` | 171 | `StorageManager` class (singleton) |

---

## Data Model

### IndexedDB Schema: `RecallDB` (version 3)

#### Store: `snapshots` (keyPath: `id`)

Snapshot metadata. Kept lightweight for fast listing and search.

```typescript
interface SnapshotMetadata {
  id: string;                    // UUID v4
  url: string;                   // Original page URL
  title: string;                 // Page title
  domain: string;                // Hostname extracted from URL
  favicon: string;               // Favicon as data URL or URL
  timestamp: number;             // Capture time (Date.now())
  captureType: 'auto' | 'manual' | 'deep';
  snapshotSize: number;          // Compressed blob size in bytes
  thumbnailDataUrl: string|null; // JPEG thumbnail as data URL string
  scrollPosition: number;        // window.scrollY at capture time
  tags: string[];                // User-defined tags
  isStarred: boolean;            // Protected from auto-cleanup
  notes: string;                 // User notes (from viewer)
  annotations: Annotation[];    // Text highlight annotations
  sessionId: string|null;        // Navigation flow session UUID
  parentSnapshotId: string|null; // Previous snapshot in flow
}
```

**Indexes:**
- `url` (non-unique) - Duplicate detection, URL-based queries
- `domain` (non-unique) - Domain filtering
- `timestamp` (non-unique) - Chronological sorting
- `captureType` (non-unique) - Filter by capture method
- `isStarred` (non-unique) - Filter starred items
- `sessionId` (non-unique) - Navigation flow queries

#### Store: `snapshotData` (keyPath: `id`)

Large binary data, separated from metadata for performance.

```typescript
interface SnapshotData {
  id: string;                   // Same ID as metadata
  domSnapshot: Blob;            // Gzip-compressed HTML
  deepBundle: Blob|null;        // Gzip-compressed JSON (deep capture only)
  textContent: string;          // Plain text for full-text search (max 50KB)
}
```

#### Store: `settings` (keyPath: `key`)

Key-value settings store.

```typescript
interface SettingEntry {
  key: string;    // Setting name (e.g., 'autoCapture')
  value: any;     // Setting value
}
```

#### Store: `watchedPages` (keyPath: `id`) [Added in v3]

Page change monitoring entries.

```typescript
interface WatchedPage {
  id: string;                       // UUID
  url: string;                      // URL to monitor
  title: string;                    // Page title
  domain: string;                   // Hostname
  intervalMinutes: number;          // Check interval (default: 60)
  isActive: boolean;                // Whether monitoring is active
  lastChecked: number|null;         // Last check timestamp
  lastContentHash: string|null;     // FNV-1a hash of extracted text
  lastTextContent: string|null;     // Last extracted text (max 30KB)
  changeCount: number;              // Total changes detected
  lastChangedAt: number|null;       // Last change timestamp
  createdAt: number;                // Entry creation timestamp
  cssSelector: string|null;         // Optional CSS selector to scope monitoring
  notifyOnChange: boolean;          // Send Chrome notification on change
  lastError: string|null;           // Last fetch error message
  lastChangePreview: string|null;   // First 200 chars of changed content
  previousContentHash: string|null; // Hash before last change
}
```

**Indexes:**
- `url` (unique) - Prevent duplicate watches
- `isActive` (non-unique) - Filter active watches
- `lastChecked` (non-unique) - Find pages due for checking
- `domain` (non-unique) - Domain grouping

### Schema Migration

The database uses versioned upgrades in `db.js:24-58`:

- **v0 → v1**: Initial schema (snapshots, snapshotData, settings stores)
- **v1 → v2**: Added `sessionId` index to snapshots for navigation flow tracking
- **v2 → v3**: Added `watchedPages` store for page change monitoring

---

## Message Protocol

All inter-context communication uses `chrome.runtime.sendMessage()` with a typed message protocol. Message types are defined in `lib/constants.js` as the `MSG` object.

### Message Flow

```
Sender                          Service Worker                    Response
──────                          ──────────────                    ────────
{type: MSG.CAPTURE_PAGE}    →   captureTab()                  →   metadata
{type: MSG.CAPTURE_DEEP}    →   deepCaptureTab()              →   metadata
{type: MSG.GET_SNAPSHOTS}   →   db.getAllSnapshots()           →   metadata[]
{type: MSG.GET_SNAPSHOT}    →   db.getSnapshot(id)             →   metadata
{type: MSG.DELETE_SNAPSHOT}  →   db.deleteSnapshot(id)         →   {deleted: id}
{type: MSG.GET_SETTINGS}    →   db.getAllSettings()            →   settings
{type: MSG.UPDATE_SETTINGS} →   db.saveSettings(obj)          →   {updated}
{type: MSG.SPOTLIGHT_SEARCH}→   fulltext search + snippets     →   results[]
{type: MSG.WATCH_PAGE}      →   watcher.watchPage(opts)       →   entry
{type: MSG.CHECK_URL_SNAPSHOTS}→ db.getSnapshotsByUrl()       →   {snapshots, count}
```

### Response Envelope

All responses are wrapped in a standard envelope:

```javascript
// Success
{ success: true, data: <result> }

// Error
{ success: false, error: "error message" }
```

### Broadcast Events

The service worker broadcasts events to all listeners (popup, sidepanel, manager):

```javascript
{ type: MSG.SNAPSHOT_SAVED,   snapshot: metadata }
{ type: MSG.SNAPSHOT_DELETED, id: string }
{ type: MSG.SNAPSHOT_DELETED, ids: string[] }
{ type: MSG.WATCHED_PAGE_CHANGED, entry: watchedPage }
```

---

## Capture Pipeline

### Standard Capture (`capture-manager.js`)

```
1. Check guards
   ├── Tab already being captured? → skip
   ├── URL excluded by protocol/domain? → skip
   ├── Auto-capture: recent duplicate exists? → skip
   └── Storage quota exceeded? → auto-cleanup or skip

2. Parallel capture
   ├── DOM Snapshot (via content script message)
   │   ├── Clone document.documentElement
   │   ├── Inline <link rel="stylesheet"> → <style>
   │   ├── Inline images as base64 data URIs
   │   ├── Capture <canvas> → <img>
   │   ├── Preserve form input values
   │   ├── Remove <script>, <noscript>, event handlers
   │   ├── Add <base href> for relative URLs
   │   ├── Extract plain text (innerText, max 50KB)
   │   └── Return { html, textContent, title, url, ... }
   │
   └── Screenshot (chrome.tabs.captureVisibleTab)
       └── JPEG at 60% quality

3. Post-processing
   ├── Check size limit (default 15MB)
   ├── Compress HTML → gzip Blob (CompressionStream)
   ├── Create thumbnail (OffscreenCanvas, 320x200, JPEG 60%)
   │   └── Convert to data URL string (not Blob)
   └── Generate UUID

4. Save to IndexedDB
   ├── Metadata → snapshots store
   └── Compressed HTML + textContent → snapshotData store
   (both in parallel)

5. Notify
   ├── Badge: "OK" (green, 2s)
   └── Broadcast: SNAPSHOT_SAVED
```

### Key Design: Thumbnails as Data URL Strings

Thumbnails are stored as base64 data URL strings (not Blobs) because Blobs cannot survive Chrome's message serialization between the service worker and extension pages. The `migrateThumbnail()` function in `service-worker.js:358` handles legacy Blob-based thumbnails by converting them on read.

---

## Deep Capture Pipeline

Deep Capture (`deep-capture.js`) uses the Chrome DevTools Protocol (CDP) via `chrome.debugger` for comprehensive page archival:

```
1. Attach debugger (CDP v1.3)
2. Enable CDP domains: Page, DOM, CSS
3. Get resource tree (Page.getResourceTree)
   └── Recursively collect ALL resources from all frames
       ├── Document HTML (via Page.getResourceContent)
       ├── Stylesheets
       ├── Scripts
       ├── Images
       ├── Fonts
       └── Other sub-resources
4. Capture DOM snapshot with computed styles
   └── DOMSnapshot.captureSnapshot with 24 CSS properties
5. Capture MHTML archive (Page.captureSnapshot format:'mhtml')
6. Capture high-quality screenshot (Page.captureScreenshot)
7. Detach debugger
8. Build deep capture bundle (JSON)
   ├── Resource metadata + contents (URL → content map)
   ├── DOM snapshot with computed styles
   ├── MHTML data
   └── Screenshot data
9. Build viewable HTML
   ├── Start with main document HTML
   ├── Inline CSS: replace <link> with <style>
   ├── Inline images as base64 data URIs
   ├── Remove scripts and event handlers
   └── Add <base> tag and metadata
10. Compress both bundle (JSON) and viewable HTML (gzip)
11. Save to IndexedDB (same schema as standard capture)
```

**Resource Collection**: The `collectResources()` function recursively traverses the frame tree, fetching each resource's content via `Page.getResourceContent`. Frame documents are fetched explicitly since `getResourceTree` only lists sub-resources, not the frame's own document.

---

## Search Architecture

### Three Search Layers

1. **Metadata Search** (`db.searchSnapshots`)
   - In-memory filter over all snapshots
   - Matches against `title`, `url`, `domain` (case-insensitive includes)
   - Fast but limited to metadata fields

2. **Full-Text Content Search** (`db.searchContentForIds`)
   - IndexedDB cursor iteration over `snapshotData` store
   - Matches against `textContent` field (case-insensitive includes)
   - Returns only matching IDs (not full records)

3. **Combined Search** (`db.searchSnapshotsFullText`)
   - Runs metadata + content search in parallel
   - Merges and deduplicates results
   - Returns full metadata objects sorted by timestamp

### Spotlight Search (`service-worker.js:513`)

The Spotlight search handler extends combined search with:
- Result limit (default 20)
- **Context snippet extraction**: For content matches, reads the `textContent` from `snapshotData`, finds the match position, and extracts ~120 chars of surrounding context
- Match type classification: `'meta'`, `'content'`, or `'both'`
- Includes thumbnails and favicons for rich UI

---

## Navigation Flow Tracking

### In-Memory Session Map

The service worker maintains a `Map<tabId, SessionInfo>` (`service-worker.js:24`):

```javascript
tabSessions: Map<number, {
  sessionId: string,        // UUID shared by all captures in this tab
  lastSnapshotId: string,   // Most recent capture (becomes parentSnapshotId)
  lastUrl: string,          // Last captured URL (dedup check)
  lastCaptureTime: number   // Timestamp of last capture (SPA dedup)
}>
```

### Session Lifecycle

1. **First navigation in tab**: Creates new session with fresh UUID
2. **Subsequent navigations**: Reuses session, chains snapshots via `parentSnapshotId`
3. **Tab close**: Session data deleted (`tabs.onRemoved`)

### SPA Deduplication

For `webNavigation.onHistoryStateUpdated` events (SPA route changes):
- 3-second dedup window to avoid double-captures from rapid pushState calls
- Additional check against the settings-configured `duplicateWindowMinutes`
- Shorter capture delay (1s instead of 2s) since SPA content is already partially loaded

### Flow Queries

`db.getNavigationFlows()` groups snapshots by `sessionId`, filters to sessions with 2+ snapshots, and returns ordered flow objects. The viewer provides prev/next navigation within a flow.

---

## Page Change Watching

### Architecture

```
Alarm (every 15 min)
    │
    ▼
checkAllDuePages()
    │
    ├── Get active watches where lastChecked + interval < now
    │
    ├── For each due page:
    │   ├── fetchPage(url) with 30s timeout
    │   ├── extractTextForSelector(html, cssSelector)
    │   │   ├── If CSS selector: attempt regex-based extraction
    │   │   └── If no selector: strip tags, normalize whitespace
    │   ├── hashText(text) using FNV-1a
    │   ├── Compare with lastContentHash
    │   │   ├── Different → changed! Update changeCount, notify
    │   │   └── Same → no change, update lastChecked
    │   └── Save updates to IndexedDB
    │
    └── Send Chrome notifications for changes
```

### FNV-1a Hashing

Uses the FNV-1a 32-bit hash algorithm for fast, non-cryptographic comparison:

```javascript
function hashText(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
```

This is chosen over crypto hashes for speed — we only need change detection, not security.

### CSS Selector Extraction

Since the service worker lacks DOM APIs, selector-based extraction uses regex matching:
- `#id` selectors: Regex finds the element and extracts a 50KB chunk
- Other selectors: Falls back to full-page text extraction
- This is documented as a best-effort approach

---

## Storage Management

### StorageManager Class (`lib/storage-manager.js`)

Singleton pattern managing storage quota:

```
┌─────────────────────────────────────────┐
│ checkAndCleanup() - called before       │
│ every capture                           │
│                                         │
│ 1. getUsageStats()                      │
│    ├── totalSize (sum of snapshotSize)  │
│    ├── count                            │
│    ├── maxBytes (from settings)         │
│    ├── usagePercent                     │
│    ├── isWarning (≥80%)                 │
│    ├── isCritical (≥90%)               │
│    └── isFull (≥100%)                   │
│                                         │
│ 2. If critical → autoCleanup()          │
│    ├── Get oldest non-starred snapshots │
│    ├── Delete until below 80% capacity  │
│    └── Return count of deleted          │
│                                         │
│ 3. If still full after cleanup → reject │
└─────────────────────────────────────────┘
```

### Time-Based Cleanup

Separate from quota-based cleanup. Runs every 6 hours via alarm:
- Only deletes auto-captured, non-starred snapshots
- Deletes snapshots older than `autoCleanupDays` (0 = disabled)
- Manual captures and starred snapshots are always preserved

### Settings Cache

Settings are cached in the `StorageManager` instance to avoid repeated IndexedDB reads. The cache is invalidated via `invalidateCache()` when settings change.

---

## Security Model

### Content Script Isolation

- **Spotlight** and **You-Were-Here** use **closed Shadow DOM** to prevent host page CSS from affecting the UI and to prevent the host page from accessing the overlay's internals
- Content scripts use `window.__recallXxxInjected` guards to prevent duplicate injection

### Snapshot Rendering (Viewer)

The viewer uses multiple layers of security:

1. **Script removal**: All `<script>` tags stripped during capture (`snapshot.js:235`)
2. **Event handler removal**: All `on*` attributes removed (`snapshot.js:241`)
3. **`<noscript>` removal**: Removed since scripts are stripped (`snapshot.js:256`)
4. **DOMParser sanitization**: Viewer parses HTML with DOMParser before rendering
5. **Sandboxed iframe**: Rendered in `sandbox.html` which has `sandbox` attribute, preventing script execution even if scripts somehow survive sanitization
6. **CSP**: The sandbox page has no script permissions

### Deep Capture Security

Deep capture uses `chrome.debugger` which shows a "debugging" banner to the user. The extension must have the `debugger` permission. Resource content is stored as-is but rendered through the same sanitization pipeline.

---

## Theme System

### Implementation (`lib/theme.js`)

```
initTheme()
├── Check localStorage for 'recall-theme'
├── If not set: detect system preference via prefers-color-scheme
├── Apply theme via data-theme attribute on <html>
└── If auto-detected: listen for system preference changes

toggleTheme()
├── Read current data-theme
├── Flip dark ↔ light
├── Apply to <html>
└── Save to localStorage
```

All CSS files use `[data-theme="dark"]` selectors for dark mode styles. The theme toggle button is injected via `createThemeToggle(container)`.

---

## Performance Considerations

### Thumbnail Format

Thumbnails are stored as data URL strings (base64-encoded JPEG) rather than Blobs. This costs ~33% more storage but eliminates serialization failures when passing thumbnails through Chrome's message API. A migration function handles legacy Blob thumbnails.

### IndexedDB Access Patterns

- **Metadata and data separation**: The `snapshots` and `snapshotData` stores are separate so that listing operations only read lightweight metadata, not multi-MB HTML blobs
- **Cursor-based content search**: Full-text search iterates via IndexedDB cursor to avoid loading all data into memory at once
- **Direct DB access**: The viewer and diff pages access IndexedDB directly (bypassing the service worker) to avoid serializing large HTML through Chrome's message API
- **Paginated queries**: `getSnapshotsPaginated()` supports offset/limit for large collections

### Compression

- HTML is compressed with gzip via `CompressionStream` before storage
- Typical compression ratio: 60-80% size reduction
- Decompression happens on-demand when viewing (via `DecompressionStream`)
- Deep capture bundles (JSON with all resources) are also gzip-compressed

### Capture Parallelism

- DOM snapshot and screenshot are captured in parallel via `Promise.allSettled`
- Metadata and data saves are done in parallel via `Promise.all`
- Screenshot/thumbnail failure doesn't block the capture (degraded gracefully)

---

## Design Decisions

### Why No Build System?

The extension uses vanilla JavaScript with ES Modules, which Chrome natively supports. This eliminates:
- Build step complexity
- Source map management
- Bundler configuration
- Development server requirements

The trade-off is no TypeScript, no JSX, no tree-shaking. For this project's scale (~5000 lines), the simplicity benefit outweighs these losses.

### Why IndexedDB Over chrome.storage?

- `chrome.storage.local` has a 10MB quota (or unlimited with permission, but slow for large objects)
- IndexedDB supports Blob storage natively (compressed HTML)
- IndexedDB supports indexes for efficient queries
- IndexedDB supports cursor-based iteration for memory-efficient search
- IndexedDB supports transactions for atomic operations

### Why Data URL Strings for Thumbnails?

Chrome's message serialization (`chrome.runtime.sendMessage`) cannot transfer Blob objects. Options considered:
1. **Object URLs**: Can't be used cross-context
2. **ArrayBuffer transfer**: Requires structured clone, complex
3. **Data URL strings**: Just works everywhere, at the cost of ~33% size overhead

The data URL approach was chosen for simplicity and reliability.

### Why FNV-1a for Page Watching?

- Only need change detection, not cryptographic security
- FNV-1a is extremely fast (single pass, simple arithmetic)
- 32-bit hash is sufficient for detecting text content changes
- No external crypto library needed

### Why Shadow DOM for Content Script UI?

Content scripts inject UI into arbitrary web pages. Without isolation:
- Host page CSS could break Recall's UI
- Host page JavaScript could interfere with Recall's event handlers
- Recall's CSS could affect the host page layout

Closed Shadow DOM provides complete bidirectional isolation.

### Why Separate Capture Types?

- **Auto capture**: Lightweight, runs on every page, uses content script DOM cloning. Good for most pages but misses dynamically-loaded resources.
- **Manual capture**: Same as auto but explicitly triggered, skips deduplication.
- **Deep capture**: Uses CDP for complete resource extraction. Much slower and requires debugger attachment (shows banner) but produces vastly more faithful reproductions.

This tiered approach balances coverage (auto captures everything) with fidelity (deep capture when you need it).
