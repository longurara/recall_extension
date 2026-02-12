// background/service-worker.js - Main service worker for Recall extension

import * as db from '../lib/db.js';
import { MSG, CAPTURE_MANUAL, DEFAULT_SETTINGS } from '../lib/constants.js';
import { shouldExcludeUrl, generateId } from '../lib/utils.js';
import { storageManager } from '../lib/storage-manager.js';
import { captureTab, exportSnapshot } from './capture-manager.js';
import { deepCaptureTab } from './deep-capture.js';
import { watchPage, unwatchPage, checkAllDuePages, checkWatchedPage } from './watcher.js';

// ============================================================
// NAVIGATION FLOW TRACKING (in-memory per-tab session map)
// ============================================================

/**
 * tabSessions: Map<tabId, { sessionId, lastSnapshotId, lastUrl }>
 *
 * - sessionId: a UUID shared by all captures in this tab's browsing chain.
 * - lastSnapshotId: the snapshot ID of the most recent capture in this tab,
 *   used as parentSnapshotId for the next capture.
 * - lastUrl: the URL of the last completed navigation, used to detect
 *   whether the user actually navigated (vs. reloading the same page).
 */
const tabSessions = new Map();

// ============================================================
// INITIALIZATION
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Recall] Extension installed/updated:', details.reason);

  // Setup side panel behavior: open on action click
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (e) {
    console.warn('[Recall] Side panel setup failed:', e);
  }

  // Set up periodic time-based cleanup alarm (every 6 hours)
  chrome.alarms.create('recall-time-cleanup', { periodInMinutes: 360 });

  // Set up periodic page-watch alarm (every 15 minutes)
  chrome.alarms.create('recall-page-watch', { periodInMinutes: 15 });

  // Run time-based cleanup immediately on install/update
  storageManager.timeBasedCleanup().catch(e =>
    console.warn('[Recall] Initial time-based cleanup failed:', e)
  );

  // Create context menus
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'recall-capture',
      title: 'Capture this page (Recall)',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'recall-deep-capture',
      title: 'Deep Capture this page (Recall)',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'recall-open-manager',
      title: 'Open Recall Manager',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'recall-separator',
      type: 'separator',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'recall-toggle-auto',
      title: 'Toggle Auto-Capture',
      contexts: ['page'],
    });
  });
});

// ============================================================
// PERIODIC TIME-BASED CLEANUP
// ============================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'recall-time-cleanup') {
    try {
      const deleted = await storageManager.timeBasedCleanup();
      if (deleted > 0) {
        console.log(`[Recall] Time-based cleanup: removed ${deleted} old snapshots`);
      }
    } catch (e) {
      console.warn('[Recall] Time-based cleanup alarm error:', e);
    }
  }

  if (alarm.name === 'recall-page-watch') {
    try {
      await checkAllDuePages();
    } catch (e) {
      console.warn('[Recall] Page watch alarm error:', e);
    }
  }
});

// ============================================================
// AUTO-CAPTURE: Listen for page navigation complete
// ============================================================

chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only capture main frame
  if (details.frameId !== 0) return;

  try {
    const settings = await db.getAllSettings();

    // Check if auto-capture is enabled
    if (!settings.autoCapture) return;

    // Check if URL should be excluded
    if (shouldExcludeUrl(details.url, settings)) return;

    // --- Flow tracking: assign or create session for this tab ---
    let session = tabSessions.get(details.tabId);
    if (!session) {
      // First navigation we've seen in this tab -> start a new session
      session = { sessionId: generateId(), lastSnapshotId: null, lastUrl: null, lastCaptureTime: null };
      tabSessions.set(details.tabId, session);
    }

    // Build flow metadata for the capture
    const flowMeta = {
      sessionId: session.sessionId,
      parentSnapshotId: session.lastSnapshotId,
    };

    // Delay capture to let page fully render (especially SPAs)
    const delay = settings.captureDelay || DEFAULT_SETTINGS.captureDelay;

    setTimeout(async () => {
      try {
        // Verify tab still exists and URL hasn't changed
        const tab = await chrome.tabs.get(details.tabId);
        if (!tab || tab.url !== details.url) return;

        const result = await captureTab(details.tabId, undefined, flowMeta);

        // Update session with the new snapshot's ID so the next navigation
        // in this tab can link back to it via parentSnapshotId
        if (result && result.id) {
          const s = tabSessions.get(details.tabId);
          if (s) {
            s.lastSnapshotId = result.id;
            s.lastUrl = details.url;
            s.lastCaptureTime = Date.now();
          }
        }
      } catch (e) {
        // Tab might be closed already
        if (!e.message.includes('No tab with id')) {
          console.warn('[Recall] Auto-capture failed:', e.message);
        }
      }
    }, delay);
  } catch (e) {
    console.warn('[Recall] Auto-capture setup error:', e);
  }
});

// ============================================================
// SPA NAVIGATION TRACKING: history.pushState / replaceState
// ============================================================

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  // Only capture main frame
  if (details.frameId !== 0) return;

  try {
    const settings = await db.getAllSettings();

    if (!settings.autoCapture) return;
    if (shouldExcludeUrl(details.url, settings)) return;

    // --- Deduplication: skip if we just captured this exact URL recently ---
    const session = tabSessions.get(details.tabId);
    if (session) {
      const DEDUP_WINDOW_MS = 3000; // 3-second window to avoid double captures
      if (
        session.lastUrl === details.url &&
        session.lastCaptureTime &&
        Date.now() - session.lastCaptureTime < DEDUP_WINDOW_MS
      ) {
        return; // Same URL captured very recently, skip
      }
    }

    // --- Flow tracking: reuse or create session ---
    let sess = session;
    if (!sess) {
      sess = { sessionId: generateId(), lastSnapshotId: null, lastUrl: null, lastCaptureTime: null };
      tabSessions.set(details.tabId, sess);
    }

    const flowMeta = {
      sessionId: sess.sessionId,
      parentSnapshotId: sess.lastSnapshotId,
    };

    // Use a shorter delay for SPAs since the content is already partly loaded
    const delay = Math.max(1000, (settings.captureDelay || DEFAULT_SETTINGS.captureDelay) - 500);

    setTimeout(async () => {
      try {
        const tab = await chrome.tabs.get(details.tabId);
        if (!tab || tab.url !== details.url) return;

        // Duplicate-URL-within-time-window check (using settings value)
        const dupMinutes = settings.duplicateWindowMinutes ?? DEFAULT_SETTINGS.duplicateWindowMinutes;
        if (sess.lastUrl === details.url && dupMinutes > 0) {
          const elapsed = Date.now() - (sess.lastCaptureTime || 0);
          if (elapsed < dupMinutes * 60 * 1000) return;
        }

        const result = await captureTab(details.tabId, undefined, flowMeta);

        if (result && result.id) {
          const s = tabSessions.get(details.tabId);
          if (s) {
            s.lastSnapshotId = result.id;
            s.lastUrl = details.url;
            s.lastCaptureTime = Date.now();
          }
        }
      } catch (e) {
        if (!e.message.includes('No tab with id')) {
          console.warn('[Recall] SPA auto-capture failed:', e.message);
        }
      }
    }, delay);
  } catch (e) {
    console.warn('[Recall] SPA auto-capture setup error:', e);
  }
});

// Clean up session data when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabSessions.delete(tabId);
});

// ============================================================
// NOTIFICATION CLICK HANDLER (for page watch alerts)
// ============================================================

chrome.notifications.onClicked.addListener(async (notifId) => {
  if (notifId.startsWith('recall-watch-')) {
    const watchId = notifId.replace('recall-watch-', '');
    try {
      const entry = await db.getWatchedPage(watchId);
      if (entry && entry.url) {
        chrome.tabs.create({ url: entry.url });
      }
    } catch (e) {
      console.warn('[Recall] Notification click error:', e);
    }
    chrome.notifications.clear(notifId);
  }
});

// ============================================================
// CONTEXT MENU HANDLERS
// ============================================================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  switch (info.menuItemId) {
    case 'recall-capture':
      await captureTab(tab.id, CAPTURE_MANUAL);
      break;

    case 'recall-deep-capture':
      try {
        await deepCaptureTab(tab.id);
      } catch (e) {
        console.error('[Recall] Deep capture error:', e);
      }
      break;

    case 'recall-open-manager':
      chrome.tabs.create({
        url: chrome.runtime.getURL('manager/manager.html'),
      });
      break;

    case 'recall-toggle-auto': {
      const settings = await db.getAllSettings();
      const newValue = !settings.autoCapture;
      await db.saveSetting('autoCapture', newValue);
      storageManager.invalidateCache();

      // Update context menu title
      chrome.contextMenus.update('recall-toggle-auto', {
        title: newValue ? 'Auto-Capture: ON (click to disable)' : 'Auto-Capture: OFF (click to enable)',
      });
      break;
    }
  }
});

// ============================================================
// KEYBOARD SHORTCUT HANDLERS
// ============================================================

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-page') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await captureTab(tab.id, CAPTURE_MANUAL);
    }
  } else if (command === 'open-manager') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('manager/manager.html'),
    });
  } else if (command === 'toggle-spotlight') {
    // Send message to active tab's content script to toggle spotlight
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SPOTLIGHT' }).catch(() => {});
    }
  }
});

// ============================================================
// MESSAGE HANDLERS (from popup, side panel, manager, viewer)
// ============================================================

/**
 * Convert a Blob to a data URL string (for legacy thumbnailBlob migration).
 */
async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

/**
 * Migrate legacy thumbnailBlob (Blob) to thumbnailDataUrl (string) on a snapshot.
 * Blobs cannot survive Chrome message serialization, strings can.
 */
async function migrateThumbnail(snapshot) {
  if (snapshot && snapshot.thumbnailBlob instanceof Blob) {
    snapshot.thumbnailDataUrl = await blobToDataUrl(snapshot.thumbnailBlob);
    delete snapshot.thumbnailBlob;
  }
  return snapshot;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ success: true, data: result }))
    .catch((error) => sendResponse({ success: false, error: error.message }));

  return true; // Async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    // ---------- Capture ----------
    case MSG.CAPTURE_PAGE: {
      const tabId = message.tabId;
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No active tab');
        return captureTab(tab.id, CAPTURE_MANUAL);
      }
      return captureTab(tabId, CAPTURE_MANUAL);
    }

    case MSG.CAPTURE_DEEP: {
      const tabId = message.tabId;
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No active tab');
        return deepCaptureTab(tab.id);
      }
      return deepCaptureTab(tabId);
    }

    // ---------- Snapshots ----------
    case MSG.GET_SNAPSHOTS: {
      let snapshots;
      if (message.query) {
        snapshots = await db.searchSnapshots(message.query);
      } else if (message.domain) {
        snapshots = await db.getSnapshotsByDomain(message.domain);
      } else if (message.offset !== undefined || message.limit !== undefined) {
        snapshots = await db.getSnapshotsPaginated(message.offset || 0, message.limit || 50);
      } else {
        snapshots = await db.getAllSnapshots();
      }
      // Migrate any legacy Blob thumbnails to data URL strings
      return Promise.all(snapshots.map(migrateThumbnail));
    }

    case MSG.GET_SNAPSHOT: {
      const snapshot = await db.getSnapshot(message.id);
      if (!snapshot) throw new Error('Snapshot not found');
      await migrateThumbnail(snapshot);
      return snapshot;
    }

    case MSG.DELETE_SNAPSHOT: {
      await db.deleteSnapshot(message.id);
      chrome.runtime.sendMessage({
        type: MSG.SNAPSHOT_DELETED,
        id: message.id,
      }).catch(() => {});
      return { deleted: message.id };
    }

    case MSG.DELETE_SNAPSHOTS: {
      await db.deleteSnapshots(message.ids);
      chrome.runtime.sendMessage({
        type: MSG.SNAPSHOT_DELETED,
        ids: message.ids,
      }).catch(() => {});
      return { deleted: message.ids };
    }

    // ---------- Settings ----------
    case MSG.GET_SETTINGS: {
      return db.getAllSettings();
    }

    case MSG.UPDATE_SETTINGS: {
      await db.saveSettings(message.settings);
      storageManager.invalidateCache();
      return { updated: true };
    }

    case MSG.TOGGLE_AUTO_CAPTURE: {
      const settings = await db.getAllSettings();
      const newValue = !settings.autoCapture;
      await db.saveSetting('autoCapture', newValue);
      storageManager.invalidateCache();
      return { autoCapture: newValue };
    }

    // ---------- Storage ----------
    case MSG.GET_STORAGE_USAGE: {
      return storageManager.getUsageStats();
    }

    // ---------- Export ----------
    case MSG.EXPORT_MHTML: {
      return exportSnapshot(message.id);
    }

    // ---------- Navigation ----------
    case MSG.OPEN_VIEWER: {
      let viewerPath = `viewer/viewer.html?id=${encodeURIComponent(message.id)}`;
      if (message.query) {
        viewerPath += `&q=${encodeURIComponent(message.query)}`;
      }
      const viewerUrl = chrome.runtime.getURL(viewerPath);
      chrome.tabs.create({ url: viewerUrl });
      return { opened: true };
    }

    case MSG.OPEN_MANAGER: {
      const managerUrl = chrome.runtime.getURL('manager/manager.html');
      // Check if manager tab already exists
      const existing = await chrome.tabs.query({ url: managerUrl });
      if (existing.length > 0) {
        chrome.tabs.update(existing[0].id, { active: true });
        chrome.windows.update(existing[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: managerUrl });
      }
      return { opened: true };
    }

    // ---------- Navigation Flows ----------
    case MSG.GET_NAVIGATION_FLOWS: {
      const flows = await db.getNavigationFlows();
      // Migrate thumbnails on each snapshot in each flow
      for (const flow of flows) {
        await Promise.all(flow.snapshots.map(migrateThumbnail));
      }
      return flows;
    }

    case MSG.GET_FLOW_SNAPSHOTS: {
      const snapshots = await db.getSnapshotsBySessionId(message.sessionId);
      return Promise.all(snapshots.map(migrateThumbnail));
    }

    // ---------- Full-text Search ----------
    case MSG.SEARCH_CONTENT: {
      const results = await db.searchSnapshotsFullText(message.query);
      return Promise.all(results.map(migrateThumbnail));
    }

    // ---------- Spotlight Search (full-text with context snippets) ----------
    case MSG.SPOTLIGHT_SEARCH: {
      const query = (message.query || '').trim();
      if (!query) return [];

      const q = query.toLowerCase();
      const limit = message.limit || 20;

      // 1. Metadata search (title / url / domain)
      const allSnapshots = await db.getAllSnapshots();
      const metaMatches = allSnapshots.filter(
        s =>
          s.title.toLowerCase().includes(q) ||
          s.url.toLowerCase().includes(q) ||
          s.domain.toLowerCase().includes(q)
      );

      // 2. Content search with snippet extraction
      const contentIds = await db.searchContentForIds(query);

      // Merge IDs
      const metaIdSet = new Set(metaMatches.map(s => s.id));
      const allIds = [...metaMatches.map(s => s.id), ...contentIds.filter(id => !metaIdSet.has(id))];

      // Build results with snippet
      const results = [];
      for (const id of allIds) {
        if (results.length >= limit) break;

        let snap = metaMatches.find(s => s.id === id);
        if (!snap) snap = await db.getSnapshot(id);
        if (!snap) continue;

        await migrateThumbnail(snap);

        // Extract a text snippet around the match from textContent
        let textSnippet = '';
        if (contentIds.includes(id)) {
          try {
            const data = await db.getSnapshotData(id);
            if (data && data.textContent) {
              const text = data.textContent;
              const idx = text.toLowerCase().indexOf(q);
              if (idx !== -1) {
                const snippetStart = Math.max(0, idx - 60);
                const snippetEnd = Math.min(text.length, idx + q.length + 60);
                textSnippet = (snippetStart > 0 ? '...' : '') +
                  text.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ') +
                  (snippetEnd < text.length ? '...' : '');
              }
            }
          } catch { /* ignore */ }
        }

        results.push({
          id: snap.id,
          title: snap.title,
          url: snap.url,
          domain: snap.domain,
          favicon: snap.favicon,
          timestamp: snap.timestamp,
          captureType: snap.captureType,
          thumbnailDataUrl: snap.thumbnailDataUrl,
          isStarred: snap.isStarred,
          tags: snap.tags,
          textSnippet,
          matchType: metaIdSet.has(id)
            ? (contentIds.includes(id) ? 'both' : 'meta')
            : 'content',
        });
      }

      return results;
    }

    // ---------- Tags ----------
    case MSG.UPDATE_SNAPSHOT_TAGS: {
      await db.updateSnapshot(message.id, { tags: message.tags });
      return { updated: true };
    }

    // ---------- Notes ----------
    case MSG.UPDATE_SNAPSHOT_NOTES: {
      await db.updateSnapshot(message.id, { notes: message.notes });
      return { updated: true };
    }

    // ---------- Annotations ----------
    case MSG.UPDATE_SNAPSHOT_ANNOTATIONS: {
      await db.updateSnapshot(message.id, { annotations: message.annotations });
      return { updated: true };
    }

    // ---------- "You were here" check ----------
    case MSG.CHECK_URL_SNAPSHOTS: {
      const url = message.url;
      if (!url) return { snapshots: [], count: 0 };
      const snapshots = await db.getSnapshotsByUrl(url);
      // Return lightweight metadata only (no thumbnails needed for the bar)
      const lightweight = snapshots.map(s => ({
        id: s.id,
        title: s.title,
        timestamp: s.timestamp,
        captureType: s.captureType,
        isStarred: s.isStarred,
      }));
      return { snapshots: lightweight, count: lightweight.length };
    }

    // ---------- Page Watch ----------
    case MSG.WATCH_PAGE: {
      const entry = await watchPage({
        url: message.url,
        title: message.title,
        intervalMinutes: message.intervalMinutes,
        cssSelector: message.cssSelector,
        notifyOnChange: message.notifyOnChange,
      });
      return entry;
    }

    case MSG.UNWATCH_PAGE: {
      await unwatchPage(message.id);
      return { deleted: message.id };
    }

    case MSG.GET_WATCHED_PAGES: {
      return db.getAllWatchedPages();
    }

    case MSG.UPDATE_WATCH: {
      const updates = {};
      if (message.intervalMinutes !== undefined) updates.intervalMinutes = message.intervalMinutes;
      if (message.isActive !== undefined) updates.isActive = message.isActive;
      if (message.cssSelector !== undefined) updates.cssSelector = message.cssSelector;
      if (message.notifyOnChange !== undefined) updates.notifyOnChange = message.notifyOnChange;
      await db.updateWatchedPage(message.id, updates);
      return { updated: true };
    }

    case MSG.CHECK_WATCHED_NOW: {
      // Force check a single page immediately
      if (message.id) {
        const entry = await db.getWatchedPage(message.id);
        if (!entry) throw new Error('Watched page not found');
        const result = await checkWatchedPage(entry);
        return result;
      }
      // Or check all due pages
      return checkAllDuePages();
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

console.log('[Recall] Service worker started');
