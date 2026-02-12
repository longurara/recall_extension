# Recall - Web Page Snapshots

**Auto-save & recall web pages. View snapshots anytime, even offline.**

Recall is a Chrome extension that automatically captures DOM snapshots of every web page you visit and stores them locally in IndexedDB with gzip compression. No cloud. No accounts. No telemetry. Everything stays on your machine.

**Author:** [longurara](https://github.com/longurara)

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [FAQ](#faq)
- [License](#license)

---

## Features

### Core Capture

- **Auto-Capture** - Automatically snapshots every page you visit after a configurable delay (default 2s). Handles both traditional navigation and SPA (Single Page Application) route changes via `history.pushState` detection.
- **Manual Capture** - One-click capture from popup, context menu, or keyboard shortcut (`Ctrl+Shift+S`).
- **Deep Capture** - Uses Chrome DevTools Protocol (CDP) via `chrome.debugger` to capture ALL page resources (CSS, JS, images, fonts), computed styles, MHTML archive, and high-quality screenshots. Produces a fully self-contained snapshot.
- **Smart Deduplication** - Skips capturing the same URL within a configurable time window (default 5 minutes) to avoid redundant snapshots.
- **Gzip Compression** - All HTML snapshots are compressed using the native `CompressionStream` API before storage, typically achieving 60-80% size reduction.

### Search & Discovery

- **Spotlight Search** (`Ctrl+Space`) - A macOS Spotlight-inspired overlay that appears on any page. Full-text search across all snapshot titles, URLs, domains, and **page content** with context snippets. Navigate results with arrow keys and open directly.
- **Full-Text Content Search** - Searches the extracted plain text of every captured page, not just metadata. Powered by IndexedDB cursor iteration.
- **"You Were Here" Notifications** - When you revisit a page that has saved snapshots, a subtle notification bar appears showing how many snapshots exist and when the last one was taken. Click to view them instantly.

### Organization & Management

- **Snapshot Manager** - A full-page management interface with 4 view modes:
  - **Grid View** - Thumbnail cards with hover preview
  - **List View** - Compact table layout
  - **Flow View** - Navigation session timelines showing your browsing paths
  - **Watch View** - Monitor pages for changes
- **Tagging System** - Add custom tags to any snapshot for organization
- **Star/Favorite** - Star important snapshots to protect them from auto-cleanup
- **Multi-Select & Bulk Delete** - Select multiple snapshots and delete them at once
- **Domain Filtering** - Filter snapshots by domain
- **Sort Options** - Sort by date, title, domain, or size

### Viewing & Annotation

- **Snapshot Viewer** - Renders captured HTML in a sandboxed iframe with full DOMParser-based sanitization. Features:
  - Collapsible info bar showing capture metadata
  - Notes panel with auto-save
  - Text annotations with 5-color highlight picker
  - Search term highlighting (from Spotlight queries)
  - Flow navigation (previous/next in browsing session)
  - Star, export, and delete actions
- **Page Diff Comparator** - Side-by-side comparison of two snapshots with:
  - Synchronized scroll between both frames
  - Draggable divider for resizing
  - Text diff view with line-based LCS (Longest Common Subsequence) algorithm
  - Color-coded additions and deletions

### Page Change Watching

- **Watch Pages** - Monitor any URL for content changes at configurable intervals (15 min to 24 hours)
- **CSS Selector Targeting** - Watch only a specific section of a page using CSS selectors (e.g., `#price`, `.news-feed`)
- **Change Notifications** - Chrome notifications when watched pages change, with click-to-open
- **Change History** - Track how many times a page has changed and when

### Storage & Settings

- **Storage Management** - Visual storage usage bar, configurable quota (default 2GB), auto-cleanup when threshold is reached (default 90%)
- **Time-Based Cleanup** - Optionally auto-delete auto-captured snapshots older than N days (manual captures and starred items are always preserved)
- **Domain Exclusions** - Configure domains to never capture
- **Export** - Export snapshots as MHTML or compressed HTML files
- **Data Management** - Export all data or delete everything from settings
- **Dark Mode** - Full dark/light theme support with system preference detection

### Chrome Integration

- **Side Panel** - Quick-access snapshot list in Chrome's built-in side panel
- **Context Menus** - Right-click to capture, deep capture, open manager, or toggle auto-capture
- **Badge Indicators** - Extension icon shows capture status (orange = capturing, green = success, red = error)
- **Navigation Flow Tracking** - Automatically groups snapshots by browsing session per tab, creating navigable timelines

---

## Installation

### From Source (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/user/Extension_recall.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the `Extension_recall` directory

5. The Recall icon will appear in your Chrome toolbar

> **Note:** No build step is required. The extension uses vanilla JavaScript with ES Modules and has zero external dependencies.

---

## Quick Start

1. **Install the extension** following the steps above
2. **Browse normally** - Recall automatically captures pages in the background
3. **Press `Ctrl+Space`** on any page to search your snapshots
4. **Press `Ctrl+Shift+R`** to open the Snapshot Manager
5. **Right-click** on any page for capture options
6. **Click the Recall icon** in the toolbar to see quick actions

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` (`Cmd+Shift+S` on Mac) | Capture current page |
| `Ctrl+Shift+R` (`Cmd+Shift+R` on Mac) | Open Snapshot Manager |
| `Ctrl+Space` (`Ctrl+Space` on Mac) | Toggle Spotlight Search |
| `Esc` | Close Spotlight / dismiss dialogs |
| `Ctrl+S` | Save settings (in Settings page) |

> Shortcuts can be customized at `chrome://extensions/shortcuts`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
├──────────────┬──────────────────────┬────────────────────┤
│              │                      │                    │
│  Content     │  Service Worker      │  Extension Pages   │
│  Scripts     │  (Background)        │  (UI)              │
│              │                      │                    │
│ ┌──────────┐ │ ┌──────────────────┐ │ ┌────────────────┐ │
│ │snapshot  │ │ │service-worker.js │ │ │popup           │ │
│ │.js       │◄├─┤  Message Router  │◄├─┤sidepanel       │ │
│ └──────────┘ │ │  Nav Tracking    │ │ │manager         │ │
│ ┌──────────┐ │ │  Context Menus   │ │ │viewer          │ │
│ │spotlight │ │ │  Alarms          │ │ │diff            │ │
│ │.js       │ │ └────────┬─────────┘ │ │settings        │ │
│ └──────────┘ │          │           │ └────────────────┘ │
│ ┌──────────┐ │ ┌────────┴─────────┐ │                    │
│ │you-were  │ │ │capture-manager   │ │                    │
│ │-here.js  │ │ │deep-capture      │ │                    │
│ └──────────┘ │ │watcher           │ │                    │
│              │ │storage-manager   │ │                    │
│              │ └────────┬─────────┘ │                    │
│              │          │           │                    │
│              │    ┌─────▼─────┐     │                    │
│              │    │ IndexedDB │     │                    │
│              │    │ RecallDB  │     │                    │
│              │    │ (v3)      │     │                    │
│              │    └───────────┘     │                    │
└──────────────┴──────────────────────┴────────────────────┘
```

**Communication Pattern:** All UI pages communicate with the service worker via `chrome.runtime.sendMessage()` using a typed message protocol (defined in `lib/constants.js`). The viewer and diff pages additionally access IndexedDB directly for performance when rendering large snapshots.

---

## Project Structure

```
Extension_recall/
├── manifest.json              # Chrome MV3 manifest
├── README.md                  # This file
│
├── icons/                     # Extension icons (16, 32, 48, 128px)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
│
├── lib/                       # Shared modules (imported by all contexts)
│   ├── constants.js           # DB config, message types, default settings
│   ├── db.js                  # IndexedDB wrapper (684 lines, 4 object stores)
│   ├── utils.js               # UUID, formatting, compression, thumbnails
│   ├── theme.js               # Dark/light mode toggle system
│   └── storage-manager.js     # Quota tracking & auto-cleanup logic
│
├── background/                # Service worker (background process)
│   ├── service-worker.js      # Main entry: message router, alarms, nav tracking
│   ├── capture-manager.js     # DOM capture orchestration + screenshot + export
│   ├── deep-capture.js        # CDP-based deep capture via chrome.debugger
│   └── watcher.js             # Page change monitoring with FNV-1a hashing
│
├── content/                   # Content scripts (injected into web pages)
│   ├── snapshot.js            # DOM cloning with CSS/image inlining
│   ├── spotlight.js           # Ctrl+Space overlay (Shadow DOM, full-text search)
│   └── you-were-here.js       # Revisit notification bar (Shadow DOM)
│
├── popup/                     # Extension popup (toolbar icon click)
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
├── sidepanel/                 # Chrome Side Panel
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
│
├── manager/                   # Full-page Snapshot Manager
│   ├── manager.html
│   ├── manager.css
│   └── manager.js             # Grid/list/flow/watch views, multi-select, bulk ops
│
├── viewer/                    # Snapshot Viewer
│   ├── viewer.html
│   ├── viewer.css
│   ├── viewer.js              # Sandboxed rendering, notes, annotations, flow nav
│   └── sandbox.html           # Sandboxed iframe for secure HTML rendering
│
├── diff/                      # Page Diff Comparator
│   ├── diff.html
│   ├── diff.css
│   └── diff.js                # Side-by-side + text diff with LCS algorithm
│
├── settings/                  # Settings Page
│   ├── settings.html
│   ├── settings.css
│   └── settings.js            # Capture config, storage, exclusions, data export
│
└── docs/                      # Documentation
    ├── TECHNICAL.md            # Architecture & internals deep-dive
    ├── USER_GUIDE.md           # End-user usage guide
    ├── API_REFERENCE.md        # Internal API reference
    └── CONTRIBUTING.md         # Development setup & contributing guide
```

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| Runtime | Chrome Extension Manifest V3 |
| Language | Vanilla JavaScript (ES Modules) |
| Storage | IndexedDB (via custom wrapper) |
| Compression | Native `CompressionStream` / `DecompressionStream` API (gzip) |
| UI | Plain HTML + CSS (no frameworks) |
| Deep Capture | Chrome DevTools Protocol (CDP) via `chrome.debugger` |
| Thumbnails | `OffscreenCanvas` in service worker |
| Content Isolation | Shadow DOM (for Spotlight and "You Were Here" overlays) |
| Hashing | FNV-1a (for page change detection) |
| Diff | Custom LCS (Longest Common Subsequence) algorithm |
| Build System | None required - loads directly as unpacked extension |
| External Dependencies | **Zero** |

---

## Configuration

All settings are stored in IndexedDB and can be configured from the Settings page (`chrome-extension://<id>/settings/settings.html`).

| Setting | Default | Description |
|---------|---------|-------------|
| `autoCapture` | `true` | Enable/disable automatic page capture |
| `captureDelay` | `2000` ms | Delay after page load before capturing |
| `maxStorageMB` | `2048` (2 GB) | Maximum storage quota |
| `maxSnapshotSizeMB` | `15` MB | Skip pages larger than this |
| `duplicateWindowMinutes` | `5` | Skip same URL within this time |
| `autoCleanupEnabled` | `true` | Enable automatic storage cleanup |
| `autoCleanupThreshold` | `0.9` (90%) | Trigger cleanup at this usage level |
| `autoCleanupDays` | `0` (disabled) | Delete auto-captures older than N days |
| `thumbnailQuality` | `0.6` | JPEG quality for thumbnails |
| `thumbnailMaxWidth` | `320` px | Maximum thumbnail width |
| `thumbnailMaxHeight` | `200` px | Maximum thumbnail height |
| `excludeDomains` | `['chrome.google.com', ...]` | Domains to never capture |
| `excludeProtocols` | `['chrome:', 'about:', ...]` | Protocols to never capture |

---

## Documentation

Detailed documentation is available in the `docs/` directory:

- **[Technical Architecture](docs/TECHNICAL.md)** - Deep-dive into the codebase architecture, data model, message flow, and design decisions
- **[User Guide](docs/USER_GUIDE.md)** - Complete end-user guide with step-by-step instructions for every feature
- **[API Reference](docs/API_REFERENCE.md)** - Internal module API documentation for developers
- **[Contributing Guide](docs/CONTRIBUTING.md)** - Development setup, code conventions, and contribution guidelines

---

## FAQ

**Q: Does Recall send any data to external servers?**
A: No. Recall is 100% offline. All data is stored locally in IndexedDB. There are no analytics, telemetry, or external API calls.

**Q: How much storage does Recall use?**
A: It depends on your browsing activity. With gzip compression, most pages compress to 50-200KB. The default quota is 2GB, which typically holds thousands of snapshots. You can adjust this in Settings.

**Q: What happens when storage is full?**
A: If auto-cleanup is enabled (default), Recall automatically deletes the oldest non-starred auto-captured snapshots when storage reaches 90% capacity. Starred and manually captured snapshots are never auto-deleted.

**Q: Can I capture pages behind login/authentication?**
A: Yes. Since Recall captures the DOM from your active browser session, it captures exactly what you see, including authenticated content.

**Q: What is "Deep Capture"?**
A: Deep Capture uses Chrome's DevTools Protocol to extract ALL resources (CSS, JS, images, fonts) directly from Chrome's memory, plus computed styles and an MHTML archive. This produces a much more faithful offline reproduction compared to standard DOM capture.

**Q: Why do some pages look different in the viewer?**
A: Standard DOM capture inlines CSS and images but removes JavaScript. Dynamic content that depends on JS execution (animations, lazy-loaded content) may not appear. Use Deep Capture for better fidelity.

**Q: Does Recall capture incognito/private browsing?**
A: Only if you explicitly enable "Allow in incognito" in `chrome://extensions`. By default, it does not run in incognito mode.

**Q: Can I export my snapshots?**
A: Yes. Individual snapshots can be exported as MHTML or HTML files from the viewer. You can also export all settings/data from the Settings page.

---

## Browser Compatibility

- **Google Chrome** 116+ (requires Manifest V3, Side Panel API, CompressionStream)
- **Microsoft Edge** 116+ (Chromium-based)
- **Brave Browser** 116+ (Chromium-based)

> Other Chromium-based browsers may work but are not officially tested.

---

## Permissions Explained

| Permission | Why It's Needed |
|-----------|----------------|
| `pageCapture` | Export snapshots as MHTML files |
| `activeTab` | Access the current tab for manual capture |
| `tabs` | Get tab info (URL, title) for captures |
| `webNavigation` | Detect page loads and SPA navigation for auto-capture |
| `storage` | Store extension settings |
| `unlimitedStorage` | Allow IndexedDB to exceed default quota |
| `sidePanel` | Show snapshot list in Chrome's side panel |
| `contextMenus` | Add right-click capture options |
| `offscreen` | Create offscreen documents for processing |
| `debugger` | Deep Capture via Chrome DevTools Protocol |
| `downloads` | Export snapshots as downloadable files |
| `alarms` | Periodic storage cleanup and page watch checking |
| `notifications` | Alert when watched pages change |
| `<all_urls>` | Capture DOM snapshots from any web page |

---

## Author

Created and maintained by **[longurara](https://github.com/longurara)**.

---

## License

This project is proprietary software. All rights reserved.

---

## Version

**v1.0.0** - Initial release
