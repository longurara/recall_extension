# User Guide

A comprehensive guide to using every feature of the Recall extension.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Auto-Capture](#auto-capture)
- [Manual Capture](#manual-capture)
- [Deep Capture](#deep-capture)
- [Spotlight Search](#spotlight-search)
- [You Were Here Notifications](#you-were-here-notifications)
- [Snapshot Manager](#snapshot-manager)
- [Snapshot Viewer](#snapshot-viewer)
- [Page Diff Comparator](#page-diff-comparator)
- [Page Change Watching](#page-change-watching)
- [Side Panel](#side-panel)
- [Extension Popup](#extension-popup)
- [Settings](#settings)
- [Storage Management](#storage-management)
- [Dark Mode](#dark-mode)
- [Tips & Tricks](#tips--tricks)
- [Troubleshooting](#troubleshooting)

---

## Getting Started

### Installation

1. Download or clone the Recall extension source code
2. Open Chrome and go to `chrome://extensions/`
3. Turn on **Developer mode** in the top-right corner
4. Click **Load unpacked** and select the extension folder
5. Pin the Recall icon to your toolbar for easy access

### First Run

Once installed, Recall immediately begins working:
- Every page you visit is automatically captured after a 2-second delay
- The extension icon shows brief status indicators (green checkmark = captured)
- Press `Ctrl+Space` on any page to try Spotlight Search

---

## Auto-Capture

Auto-capture is the core feature. It silently saves a snapshot of every page you visit.

### How It Works

1. You navigate to a web page (or a Single Page App changes its route)
2. Recall waits for the configurable delay (default: 2 seconds)
3. The content script clones the entire DOM, inlines CSS and images
4. The service worker compresses and stores the snapshot in IndexedDB
5. A brief green "OK" badge appears on the extension icon

### What Gets Captured

- Complete HTML structure with inlined styles
- Images converted to base64 (same-origin images only)
- Canvas elements captured as static images
- Form input values preserved
- Favicon captured and stored
- Page text extracted for full-text search
- Screenshot thumbnail for visual browsing

### What Gets Excluded

- JavaScript is stripped for security and size
- Cross-origin images that can't be read (CORS restrictions)
- Dynamically loaded content that hasn't rendered yet
- Pages from excluded domains/protocols (Chrome internal pages, etc.)
- Duplicate URLs captured within the last 5 minutes (configurable)

### Disabling Auto-Capture

You can disable auto-capture in several ways:
- **Popup**: Click the Recall icon and toggle "Auto-Capture"
- **Context menu**: Right-click on any page → "Toggle Auto-Capture"
- **Settings**: Go to Settings page and uncheck "Enable Auto-Capture"

---

## Manual Capture

Capture a specific page on demand when auto-capture is disabled or when you want to ensure a page is saved.

### Methods

| Method | How |
|--------|-----|
| Keyboard shortcut | `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac) |
| Popup button | Click Recall icon → "Capture Page" |
| Context menu | Right-click → "Capture this page (Recall)" |

### Difference from Auto-Capture

- Manual captures **skip duplicate detection** (always captures even if recently saved)
- Manual captures are tagged as `captureType: 'manual'`
- Manual captures are **never auto-deleted** by the cleanup system

---

## Deep Capture

Deep Capture produces a much more faithful reproduction of a page by extracting ALL resources directly from Chrome's memory.

### When to Use Deep Capture

- Pages with complex CSS frameworks that don't inline well
- Pages with important web fonts
- Pages you want to archive with maximum fidelity
- Before a page might go offline or change significantly

### How to Trigger

| Method | How |
|--------|-----|
| Popup button | Click Recall icon → "Deep Capture" |
| Context menu | Right-click → "Deep Capture this page (Recall)" |

### What Happens During Deep Capture

1. Chrome shows a **"debugging started"** banner at the top of the page (this is normal and required)
2. The extension connects to Chrome's DevTools Protocol
3. ALL resources are extracted: HTML, CSS, JavaScript, images, fonts, media
4. A full DOM snapshot with computed styles is captured
5. An MHTML archive is generated
6. A high-quality screenshot is taken
7. Everything is compressed and stored
8. The debugging banner disappears

### Deep Capture Output

Deep capture produces two artifacts:
- **Viewable HTML**: A self-contained HTML file with inlined CSS and images (used in the viewer)
- **Deep Bundle**: A complete JSON archive of all resources, computed styles, and MHTML (for advanced analysis)

### Caveats

- Deep capture takes longer (5-15 seconds depending on page complexity)
- The "debugging" banner is visible to the user (Chrome requirement)
- Some cross-origin resources may still fail to load
- The resulting snapshot is typically 2-10x larger than standard capture

---

## Spotlight Search

Spotlight Search is a fast, keyboard-driven search overlay inspired by macOS Spotlight.

### Opening Spotlight

- Press `Ctrl+Space` on any web page
- Or use the keyboard command (configurable at `chrome://extensions/shortcuts`)

### Using Spotlight

1. **Type your query** - Search by page title, URL, domain, or page content
2. **Navigate results** - Use `Up/Down` arrow keys to move through results
3. **Open a snapshot** - Press `Enter` to open the selected snapshot in the viewer
4. **Open in new tab** - Press `Ctrl+Enter` to open in a new tab
5. **Close** - Press `Escape` or click outside the overlay

### Search Capabilities

- **Metadata matching**: Matches against page title, URL, and domain
- **Full-text content matching**: Searches the actual text content of captured pages
- **Context snippets**: Shows ~120 characters of surrounding text for content matches
- **Match indicators**: Each result shows whether it matched via metadata, content, or both

### Result Information

Each result shows:
- Page title and URL
- Domain and favicon
- Capture timestamp (relative time)
- Capture type indicator (auto/manual/deep)
- Star status
- Content snippet (for content matches)

---

## You Were Here Notifications

When you revisit a page that has saved snapshots, a subtle notification bar slides in from the top.

### What It Shows

- Number of saved snapshots for this URL
- When the most recent snapshot was captured
- Quick links to view snapshots

### Behavior

- Appears 2.5 seconds after page load (to not disrupt page rendering)
- Can be dismissed (won't show again for this URL in the current tab session)
- Does not appear on extension pages
- Uses closed Shadow DOM so it never interferes with the host page

---

## Snapshot Manager

The Snapshot Manager is the central hub for browsing, organizing, and managing all your snapshots.

### Opening the Manager

- Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Click Recall icon → "Open Manager"
- Right-click → "Open Recall Manager"

### View Modes

#### Grid View (Default)

Displays snapshots as thumbnail cards in a responsive grid:
- Thumbnail preview image
- Page title and domain
- Capture timestamp
- Capture type badge (auto/manual/deep)
- Star indicator
- Click to open in viewer

#### List View

Compact table layout showing:
- Favicon, title, URL
- Domain, capture type
- Size, timestamp
- Star and delete actions

#### Flow View

Shows your browsing sessions as navigable timelines:
- Groups snapshots by session (tab browsing chains)
- Displays chronological flow: Page A → Page B → Page C
- Shows session duration and page count
- Click any snapshot in the flow to view it

#### Watch View

Dedicated interface for page change monitoring:
- List of all watched pages
- Status indicators (active/paused/error)
- Change count and last changed time
- Quick actions: check now, pause, edit, delete

### Organization Features

#### Search

- Type in the search box to filter by title, URL, or domain
- Click the content search toggle for full-text search across page content

#### Domain Filter

- Dropdown showing all captured domains with counts
- Select a domain to filter the snapshot list

#### Sorting

- Sort by: Date (newest/oldest), Title (A-Z/Z-A), Domain, Size

#### Tagging

- Click on a snapshot's tag area to add tags
- Tags are comma-separated text labels
- Use tags to categorize snapshots (e.g., "research", "work", "recipe")

#### Starring

- Click the star icon on any snapshot to mark it as important
- Starred snapshots are never auto-deleted
- Filter to show only starred snapshots

#### Multi-Select

- Hold `Ctrl` and click to select multiple snapshots
- Or use the "Select All" checkbox
- Bulk actions: Delete selected, export selected

#### Compare

- Select exactly 2 snapshots
- Click "Compare" to open the Page Diff Comparator

---

## Snapshot Viewer

The viewer renders a captured snapshot in a secure, isolated environment.

### Opening a Snapshot

- Click any snapshot in the Manager, Side Panel, or Spotlight results
- Direct URL: `chrome-extension://<id>/viewer/viewer.html?id=<snapshot-id>`

### Viewer Features

#### Info Bar

A collapsible bar at the top showing:
- Page title and original URL (clickable to visit)
- Capture timestamp and type
- Snapshot size
- Domain and tags

#### Notes Panel

- Click the notes icon to open the side panel
- Write notes about the snapshot
- Notes are auto-saved after a brief delay
- Supports plain text

#### Annotations

- Select text in the rendered snapshot
- A color picker appears with 5 highlight colors
- Click a color to highlight the selected text
- Annotations are saved automatically
- View all annotations in the annotations panel

#### Flow Navigation

If the snapshot is part of a browsing session (navigation flow):
- "Previous" and "Next" buttons appear
- Navigate through the pages you visited in sequence
- Breadcrumb showing your position in the flow

#### Search Highlighting

When opening from Spotlight with a search query:
- The query parameter is passed to the viewer
- Matching text in the rendered page is automatically highlighted
- Helps you find exactly what you were searching for

#### Actions

| Action | Description |
|--------|-------------|
| Star | Toggle star status |
| Export | Download as MHTML or HTML file |
| Delete | Delete this snapshot |
| Open Original | Visit the original URL |

### Security

The snapshot HTML is rendered in a sandboxed iframe (`sandbox.html`) with:
- All scripts removed
- Event handlers stripped
- DOMParser-based HTML sanitization
- Sandbox attribute preventing script execution

---

## Page Diff Comparator

Compare two snapshots side-by-side to see what changed.

### Opening the Diff View

1. In the Manager, select exactly 2 snapshots
2. Click the "Compare" button
3. Or open directly via URL: `chrome-extension://<id>/diff/diff.html?left=<id1>&right=<id2>`

### Visual Diff

- Two iframes showing the rendered snapshots side-by-side
- **Synchronized scrolling**: Scrolling one side scrolls the other
- **Draggable divider**: Resize the split by dragging the center bar
- Snapshot metadata displayed above each panel

### Text Diff

- Click "Text Diff" to switch to text comparison mode
- Shows a line-by-line diff using the LCS (Longest Common Subsequence) algorithm
- **Green lines**: Added content
- **Red lines**: Removed content
- **Gray lines**: Unchanged content
- Line numbers for both versions

---

## Page Change Watching

Monitor any webpage for content changes and get notified when something updates.

### Setting Up a Watch

1. Open the Recall popup and click "Watch Page" (while on the page you want to monitor)
2. Or use the Manager's Watch view → "Add Watch"
3. Configure:
   - **URL**: The page to monitor
   - **Check interval**: How often to check (15 min, 30 min, 1 hour, 6 hours, 12 hours, 24 hours)
   - **CSS Selector** (optional): Monitor only a specific section (e.g., `#price-tag`, `.news-feed`)
   - **Notifications**: Whether to show Chrome notifications on change

### How It Works

1. Every 15 minutes, the extension checks which watches are due
2. For each due watch, it fetches the page HTML via network request
3. Text content is extracted (optionally filtered by CSS selector)
4. An FNV-1a hash is computed and compared to the last known hash
5. If different → change detected → notification sent (if enabled)

### Managing Watches

In the Manager's Watch view:
- **Check Now**: Force an immediate check
- **Pause/Resume**: Temporarily stop monitoring
- **Edit**: Change interval or CSS selector
- **Delete**: Remove the watch entirely
- **View History**: See change count and last change time

### Notifications

When a watched page changes:
- A Chrome notification appears with the page title
- Click the notification to open the changed page in a new tab
- The notification is automatic and works even when no Recall UI is open

---

## Side Panel

The Chrome Side Panel provides quick access to your snapshots without leaving your current tab.

### Opening

- Click the Recall icon → "Open Side Panel"
- Or use Chrome's side panel button (if pinned)

### Features

- Searchable list of all snapshots
- Domain filter dropdown
- Sort by date
- Thumbnail previews
- Click to open in viewer
- Delete individual snapshots
- Compact design for side-by-side browsing

---

## Extension Popup

Click the Recall toolbar icon to see the popup.

### Quick Actions

- **Capture Page**: Manual capture of current tab
- **Deep Capture**: Deep capture of current tab
- **Watch Page**: Start watching current page for changes
- **Open Side Panel**: Opens the side panel
- **Open Manager**: Opens the full Snapshot Manager
- **Settings**: Opens the Settings page

### Status Bar

- Auto-capture toggle (on/off)
- Storage usage bar showing current usage vs. quota

---

## Settings

Access Settings via the popup → "Settings" button.

### Capture Settings

| Setting | Description |
|---------|-------------|
| Auto-Capture | Enable/disable automatic page capture |
| Capture Delay | Time to wait after page load before capturing (ms) |
| Max Snapshot Size | Skip pages larger than this (MB) |
| Duplicate Window | Skip same URL within this time period (minutes) |

### Storage Settings

| Setting | Description |
|---------|-------------|
| Max Storage | Maximum total storage quota (MB) |
| Auto-Cleanup | Enable automatic cleanup when quota is reached |
| Cleanup Threshold | Usage percentage that triggers cleanup (e.g., 90%) |
| Time-Based Cleanup | Auto-delete auto-captures older than N days (0 = disabled) |

### Domain Exclusions

- Add domains that should never be captured
- Supports partial matching (e.g., "google.com" excludes all Google subdomains)
- Default exclusions: Chrome Web Store, extension pages

### Thumbnail Settings

- Quality: JPEG compression quality (0.1 - 1.0)
- Max dimensions: Maximum width and height in pixels

### Data Management

- **Export Data**: Download all snapshots and settings
- **Delete All**: Remove all snapshots (requires confirmation)

### Saving

- Click "Save" or press `Ctrl+S`
- Unsaved changes show a warning bar at the bottom

---

## Storage Management

### Understanding Storage Usage

- Each snapshot typically uses 50-200KB (compressed)
- Deep captures use 200KB-5MB depending on page complexity
- Thumbnails add ~10-30KB per snapshot
- Text content for search adds ~5-50KB per snapshot

### Monitoring Usage

- Popup shows a storage usage bar
- Manager shows total count and storage used
- Settings shows detailed storage statistics

### Cleanup Strategies

1. **Automatic quota cleanup**: When storage reaches 90% (configurable), oldest non-starred auto-captures are deleted until usage drops to 80%
2. **Time-based cleanup**: Optionally delete auto-captures older than N days
3. **Manual cleanup**: Delete individual snapshots or bulk-select and delete
4. **Star protection**: Starred snapshots are never auto-deleted

### Best Practices

- Star important snapshots to protect them from cleanup
- Use manual capture for pages you definitely want to keep
- Adjust the storage quota based on your available disk space
- Set a reasonable time-based cleanup (e.g., 30 or 90 days)
- Periodically review and clean up unnecessary snapshots

---

## Dark Mode

Recall supports full dark and light themes.

### Toggling

- Click the theme toggle button (sun/moon icon) in any Recall page
- Available in: Manager, Viewer, Diff, Settings, Side Panel

### Behavior

- **First visit**: Automatically follows your system preference (`prefers-color-scheme`)
- **After toggle**: Your choice is saved in localStorage and persists
- **System changes**: If you haven't manually toggled, Recall follows system changes automatically

---

## Tips & Tricks

### Power User Workflows

1. **Research sessions**: Use auto-capture + Flow View to retrace your research paths
2. **Price monitoring**: Set up Page Watch with `#price` CSS selector to track prices
3. **Content archival**: Use Deep Capture for important pages before they might change
4. **Quick recall**: `Ctrl+Space` on any page to instantly search your browsing history
5. **Comparison**: Capture a page before and after changes, then use Diff to compare

### Keyboard-First Usage

1. `Ctrl+Space` → Type query → `Arrow keys` → `Enter` — Full search and open without touching the mouse
2. `Ctrl+Shift+S` — Quick-save current page
3. `Ctrl+Shift+R` — Jump to Manager

### Customizing Shortcuts

1. Go to `chrome://extensions/shortcuts`
2. Find "Recall - Web Page Snapshots"
3. Click the pencil icon next to any command
4. Press your desired key combination
5. Click OK

---

## Troubleshooting

### Auto-Capture Not Working

1. Check if auto-capture is enabled (popup toggle or Settings)
2. Check if the domain is in the exclusion list
3. Check if the URL protocol is excluded (chrome://, about://, etc.)
4. Verify the extension has the required permissions
5. Check the console for errors: right-click Recall icon → "Inspect" → Console tab

### Deep Capture Fails

1. Some pages block debugger attachment (e.g., Chrome internal pages)
2. Try refreshing the page first
3. Check if another DevTools debugger is already attached
4. Cross-origin resources may partially fail (this is normal)

### Spotlight Not Appearing

1. The shortcut `Ctrl+Space` may conflict with another extension or system shortcut
2. Customize the shortcut at `chrome://extensions/shortcuts`
3. Content scripts cannot run on `chrome://` pages or the Chrome Web Store

### Storage Full

1. Open Settings → check storage usage
2. Delete unnecessary snapshots from Manager
3. Increase the storage quota in Settings
4. Enable time-based cleanup to auto-delete old captures
5. Reduce max snapshot size to skip very large pages

### Extension Icon Shows "X" (Red)

This means a capture failed. Common reasons:
- Tab was closed before capture completed
- Page was too large (exceeds max snapshot size)
- Content script couldn't access the page (restricted page)
- Network error during CSS/image inlining

### Snapshots Look Different From Original

- Standard capture removes JavaScript — dynamic content won't work
- Cross-origin images may show placeholders
- CSS that depends on JavaScript execution may not apply
- **Solution**: Use Deep Capture for better fidelity
