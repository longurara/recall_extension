# Contributing Guide

Guide for developers who want to work on the Recall extension codebase.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Development Workflow](#development-workflow)
- [Code Conventions](#code-conventions)
- [Adding a New Feature](#adding-a-new-feature)
- [Adding a New Message Type](#adding-a-new-message-type)
- [Adding a New Database Store](#adding-a-new-database-store)
- [Adding a New UI Page](#adding-a-new-ui-page)
- [Debugging](#debugging)
- [Testing](#testing)
- [Common Pitfalls](#common-pitfalls)
- [File Size Reference](#file-size-reference)

---

## Development Setup

### Prerequisites

- **Google Chrome** 116 or later
- **Text editor** with JavaScript support (VS Code recommended)
- **No build tools required** - the project uses vanilla JS with ES Modules

### Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `Extension_recall` directory
5. The extension is now loaded and active

### Reloading After Changes

- **Service worker changes**: Click the refresh icon on the extension card at `chrome://extensions/`
- **Content script changes**: Reload the extension AND refresh the web page
- **Extension page changes** (popup, manager, viewer, etc.): Just refresh the page
- **Manifest changes**: Always reload the extension

> **Tip**: You can also press `Ctrl+Shift+I` on any extension page to open DevTools for that context.

---

## Project Architecture

The extension follows a clear separation of concerns:

```
lib/           → Shared modules (imported everywhere)
background/    → Service worker (message handling, capture, watch)
content/       → Content scripts (injected into web pages)
popup/         → Toolbar popup UI
sidepanel/     → Chrome side panel UI
manager/       → Full-page snapshot management UI
viewer/        → Snapshot rendering UI
diff/          → Page comparison UI
settings/      → Settings UI
icons/         → Extension icons
```

### Key Principles

1. **Message-passing architecture**: UI pages communicate with the service worker via `chrome.runtime.sendMessage()`. Never access `chrome.tabs`, `chrome.debugger`, etc. directly from UI pages.

2. **Shared constants**: All message types, DB names, and settings are defined in `lib/constants.js`. Always use these constants instead of raw strings.

3. **Database layer**: All IndexedDB access goes through `lib/db.js`. Never use `indexedDB.open()` directly.

4. **No external dependencies**: Everything is built from scratch. No npm, no bundlers, no frameworks.

5. **Content script isolation**: Content scripts use IIFEs and Shadow DOM for complete isolation from host pages.

---

## Development Workflow

### Making Changes

1. Edit the source files directly
2. Reload the extension at `chrome://extensions/`
3. Test the changes manually
4. Check the console for errors

### Console Locations

| Context | How to Access Console |
|---------|----------------------|
| Service worker | `chrome://extensions/` → click "Inspect views: service worker" |
| Content scripts | Page DevTools (F12) → Console tab (filter by extension) |
| Popup | Right-click extension icon → "Inspect popup" |
| Extension pages | Open the page → F12 |

### Useful Chrome URLs

- `chrome://extensions/` - Extension management
- `chrome://extensions/shortcuts` - Keyboard shortcut configuration
- `chrome://serviceworker-internals/` - Service worker debugging
- `chrome://indexeddb-internals/` - IndexedDB inspection

---

## Code Conventions

### JavaScript Style

- **ES Modules**: Use `import`/`export` for all shared code
- **Async/await**: Prefer async/await over raw Promises
- **Const by default**: Use `const` unless reassignment is needed, then `let`. Never `var`.
- **Template literals**: Use backtick strings for interpolation
- **Arrow functions**: Prefer for callbacks and short functions
- **Error handling**: Always wrap async operations in try/catch
- **Console logging**: Use `console.log('[Recall] ...')` prefix for all log messages
- **No semicolons controversy**: This project uses semicolons

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Constants | UPPER_SNAKE_CASE | `DB_NAME`, `MSG`, `CAPTURE_AUTO` |
| Functions | camelCase | `captureTab`, `getSnapshot` |
| Classes | PascalCase | `StorageManager` |
| Files | kebab-case | `service-worker.js`, `capture-manager.js` |
| CSS classes | kebab-case | `snapshot-card`, `btn-primary` |
| HTML IDs | kebab-case | `snapshot-grid`, `search-input` |
| Message types | UPPER_SNAKE_CASE | `CAPTURE_PAGE`, `GET_SNAPSHOTS` |

### CSS Conventions

- All UI pages support dark mode via `[data-theme="dark"]` selectors
- Use CSS custom properties for colors when possible
- BEM-like class naming (but not strict BEM)
- Each page has its own CSS file - no global stylesheet

### Comment Style

```javascript
// Single-line comments for brief explanations

/**
 * JSDoc-style for function documentation.
 * @param {number} tabId - Chrome tab ID
 * @returns {Promise<Object|null>} Snapshot metadata or null
 */

// ============================================================
// SECTION HEADERS for major code sections
// ============================================================
```

---

## Adding a New Feature

### Step-by-Step Guide

#### 1. Define Message Types (if needed)

Add new message type constants to `lib/constants.js`:

```javascript
export const MSG = {
  // ... existing types
  MY_NEW_ACTION: 'MY_NEW_ACTION',
};
```

#### 2. Add Database Operations (if needed)

Add new functions to `lib/db.js`:

```javascript
export async function myNewDbOperation(params) {
  return withStore(STORE_SNAPSHOTS, 'readonly', (store) => {
    // ... database operation
  });
}
```

If you need a new store, see [Adding a New Database Store](#adding-a-new-database-store).

#### 3. Handle Messages in Service Worker

Add a case to the `handleMessage()` switch in `background/service-worker.js`:

```javascript
case MSG.MY_NEW_ACTION: {
  // Perform the action
  const result = await someOperation(message.param);
  return result;
}
```

#### 4. Call from UI

Send messages from extension pages:

```javascript
const response = await chrome.runtime.sendMessage({
  type: 'MY_NEW_ACTION',
  param: 'value',
});

if (response.success) {
  const data = response.data;
  // Use the result
} else {
  console.error('Failed:', response.error);
}
```

#### 5. Update UI

Add the necessary HTML, CSS, and JavaScript for the feature's user interface.

---

## Adding a New Message Type

1. **Define** in `lib/constants.js`:
   ```javascript
   export const MSG = {
     // ...
     NEW_TYPE: 'NEW_TYPE',
   };
   ```

2. **Handle** in `service-worker.js` `handleMessage()`:
   ```javascript
   case MSG.NEW_TYPE: {
     return doSomething(message.data);
   }
   ```

3. **Send** from UI:
   ```javascript
   import { MSG } from '../lib/constants.js';
   const resp = await chrome.runtime.sendMessage({
     type: MSG.NEW_TYPE,
     data: payload,
   });
   ```

4. **Document** in `docs/API_REFERENCE.md` message types table.

---

## Adding a New Database Store

### 1. Increment DB Version

In `lib/constants.js`:
```javascript
export const DB_VERSION = 4; // Was 3
export const STORE_MY_NEW_STORE = 'myNewStore';
```

### 2. Add Migration

In `lib/db.js`, inside the `onupgradeneeded` handler:

```javascript
// ---- v3 -> v4: My new store ----
if (oldVersion < 4) {
  const store = db.createObjectStore(STORE_MY_NEW_STORE, { keyPath: 'id' });
  store.createIndex('someField', 'someField', { unique: false });
}
```

### 3. Add CRUD Functions

In `lib/db.js`:

```javascript
export async function saveMyThing(entry) {
  return withStore(STORE_MY_NEW_STORE, 'readwrite', (store) => store.put(entry));
}

export async function getMyThing(id) {
  return withStore(STORE_MY_NEW_STORE, 'readonly', (store) => store.get(id));
}

export async function deleteMyThing(id) {
  return withStore(STORE_MY_NEW_STORE, 'readwrite', (store) => store.delete(id));
}
```

### 4. Important Notes

- **Never modify existing store schemas in-place** - always create a new version
- **Handle migration gracefully** - users may upgrade from any version
- **Test with fresh install AND upgrade** from previous version

---

## Adding a New UI Page

### 1. Create Directory

```
mynewpage/
├── mynewpage.html
├── mynewpage.css
└── mynewpage.js
```

### 2. HTML Template

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My New Page - Recall</title>
  <link rel="stylesheet" href="mynewpage.css">
</head>
<body>
  <header class="header">
    <h1>My New Page</h1>
    <div class="header-actions" id="header-actions"></div>
  </header>
  <main class="main">
    <!-- Content -->
  </main>
  <script type="module" src="mynewpage.js"></script>
</body>
</html>
```

### 3. JavaScript Entry

```javascript
import { initTheme, createThemeToggle } from '../lib/theme.js';
import { MSG } from '../lib/constants.js';

// Initialize theme
const theme = initTheme();
createThemeToggle(document.getElementById('header-actions'));

// Your page logic
async function init() {
  const response = await chrome.runtime.sendMessage({
    type: MSG.GET_SNAPSHOTS,
  });

  if (response.success) {
    render(response.data);
  }
}

init();
```

### 4. CSS with Dark Mode

```css
/* Light mode (default) */
body {
  background: #ffffff;
  color: #1a1a1a;
}

/* Dark mode */
[data-theme="dark"] body {
  background: #1a1a2e;
  color: #e0e0e0;
}
```

### 5. Register in Manifest (if needed)

If the page should be accessible via chrome-extension:// URL, no manifest change is needed. Just link to it from other pages.

---

## Debugging

### Service Worker Debugging

1. Go to `chrome://extensions/`
2. Find "Recall - Web Page Snapshots"
3. Click "Inspect views: service worker"
4. Console, Network, and Sources tabs are available

### Content Script Debugging

1. Open DevTools on the page (F12)
2. In Console, look for `[Recall]` prefixed messages
3. In Sources → Content scripts → Recall, set breakpoints

### IndexedDB Inspection

1. Open DevTools for any extension page
2. Application tab → IndexedDB → RecallDB
3. Browse all 4 stores and their contents

### Message Debugging

Add temporary logging to `service-worker.js`:

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Recall] Message received:', message.type, message);
  // ...
});
```

### Common Debug Scenarios

**Capture not working:**
1. Check service worker console for errors
2. Verify content script is loaded (check `window.__recallSnapshotInjected`)
3. Check if URL is excluded

**UI not updating:**
1. Check that broadcast messages are being sent
2. Verify listener is set up in the UI page
3. Check that the message type matches

**Storage issues:**
1. Inspect IndexedDB contents
2. Check `getStorageUsage()` output
3. Verify `maxStorageMB` setting

---

## Testing

### Manual Testing Checklist

#### Auto-Capture
- [ ] Navigate to a new page → snapshot appears in manager
- [ ] Navigate to the same URL within 5 min → no duplicate
- [ ] Disable auto-capture → no snapshots on navigation
- [ ] SPA navigation → snapshot captured

#### Manual Capture
- [ ] Ctrl+Shift+S → snapshot captured
- [ ] Popup capture button → works
- [ ] Context menu capture → works
- [ ] Captures even with auto-capture disabled

#### Deep Capture
- [ ] Popup deep capture → debugging banner appears → snapshot saved
- [ ] Resources are inlined (CSS, images)
- [ ] Viewer renders deep capture correctly

#### Spotlight
- [ ] Ctrl+Space → overlay appears
- [ ] Type query → results appear
- [ ] Arrow keys → navigate results
- [ ] Enter → opens viewer
- [ ] Escape → closes overlay

#### Manager
- [ ] Grid/list/flow/watch views switch correctly
- [ ] Search filters snapshots
- [ ] Domain filter works
- [ ] Multi-select + bulk delete
- [ ] Tags can be added/edited
- [ ] Star toggle works
- [ ] Compare opens diff view

#### Viewer
- [ ] Snapshot renders in sandbox iframe
- [ ] Notes save automatically
- [ ] Annotations highlight text
- [ ] Flow navigation (prev/next) works
- [ ] Export downloads file

#### Page Watching
- [ ] Watch a page → initial check runs
- [ ] Modify the page → change detected
- [ ] Notification appears on change
- [ ] Pause/resume works

#### Settings
- [ ] All settings save correctly
- [ ] Ctrl+S saves
- [ ] Unsaved changes warning appears
- [ ] Domain exclusions work

#### Dark Mode
- [ ] Toggle works on all pages
- [ ] System preference detection works
- [ ] Preference persists across sessions

---

## Common Pitfalls

### 1. Blob Serialization

**Problem**: Blobs cannot be sent via `chrome.runtime.sendMessage()`.

**Solution**: Convert to data URL strings before sending. See `migrateThumbnail()` in `service-worker.js`.

### 2. Service Worker Lifecycle

**Problem**: Service workers can be terminated at any time. In-memory state is lost.

**Solution**: Only use in-memory state for ephemeral data (like `tabSessions`). Persist important state in IndexedDB.

### 3. Content Script Re-injection

**Problem**: Content scripts may be injected multiple times (e.g., after extension reload).

**Solution**: Always use injection guards:
```javascript
if (window.__recallMyScriptInjected) return;
window.__recallMyScriptInjected = true;
```

### 4. Cross-Origin Restrictions

**Problem**: Content scripts can't read cross-origin images (tainted canvas).

**Solution**: Catch canvas errors gracefully. Use `image.crossOrigin = 'anonymous'` where possible. Accept that some images will be placeholders.

### 5. IndexedDB Version Conflicts

**Problem**: Multiple extension contexts may try to open different DB versions simultaneously.

**Solution**: Handle `onversionchange` by closing the connection (`db.js:68-71`).

### 6. Extension Page Navigation

**Problem**: Calling `chrome.tabs.create()` from popup closes the popup.

**Solution**: This is expected behavior. The popup is meant for quick actions.

### 7. CSS Isolation in Content Scripts

**Problem**: Host page CSS bleeds into injected UI.

**Solution**: Use closed Shadow DOM for all content script UI (see spotlight.js, you-were-here.js).

### 8. Async sendResponse

**Problem**: `chrome.runtime.onMessage` listener must return `true` for async responses.

**Solution**: Always `return true` from the listener if using async `sendResponse`:
```javascript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleAsync(msg).then(sendResponse);
  return true; // Required for async
});
```

---

## File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| `lib/constants.js` | 100 | Constants and defaults |
| `lib/db.js` | 684 | IndexedDB wrapper |
| `lib/utils.js` | 225 | Utility functions |
| `lib/theme.js` | 79 | Theme system |
| `lib/storage-manager.js` | 171 | Storage management |
| `background/service-worker.js` | 670 | Main service worker |
| `background/capture-manager.js` | 350 | Capture orchestration |
| `background/deep-capture.js` | 487 | CDP deep capture |
| `background/watcher.js` | 303 | Page change monitoring |
| `content/snapshot.js` | 400 | DOM capture |
| `content/spotlight.js` | 871 | Spotlight search overlay |
| `content/you-were-here.js` | 237 | Revisit notification |
| `manager/manager.js` | ~984 | Manager UI logic |
| `viewer/viewer.js` | ~1100 | Viewer UI logic |
| `diff/diff.js` | ~463 | Diff UI logic |
| `settings/settings.js` | ~227 | Settings UI logic |
| **Total** | **~6,000+** | |
