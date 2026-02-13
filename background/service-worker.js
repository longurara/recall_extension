// background/service-worker.js - Main service worker for Recall extension

import * as db from '../lib/db.js';
import { MSG, CAPTURE_MANUAL, CAPTURE_CLIP, DEFAULT_SETTINGS } from '../lib/constants.js';
import { shouldExcludeUrl, generateId, getDomain, compressString } from '../lib/utils.js';
import { storageManager } from '../lib/storage-manager.js';
import { captureTab, exportSnapshot } from './capture-manager.js';
import { deepCaptureTab } from './deep-capture.js';
import { watchPage, unwatchPage, checkAllDuePages, checkWatchedPage } from './watcher.js';
import { exportBackupZip, importBackupZip } from './backup-exporter.js';

const EXTENSION_ORIGIN = chrome.runtime.getURL('');

function isTrustedSender(sender) {
  const url = sender?.url || '';
  return url.startsWith(EXTENSION_ORIGIN);
}

function ensureTrustedSender(sender, feature) {
  if (!isTrustedSender(sender)) {
    throw new Error(`${feature} chỉ được gọi từ trang giao diện của Recall.`);
  }
}

function isPrivateHost(hostname = '') {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  );
}

function isPublicHttpUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return !isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}

function isBlockedDomainForAI(domainOrUrl, blocklist = []) {
  if (!domainOrUrl) return false;
  let host = domainOrUrl;
  try {
    host = new URL(domainOrUrl).hostname || domainOrUrl;
  } catch { /* keep as-is */ }
  const lowerHost = host.toLowerCase();
  return blocklist.some((entry) => {
    if (!entry) return false;
    const e = entry.toLowerCase();
    if (e.startsWith('.')) return lowerHost.endsWith(e);
    if (e.endsWith('.')) return lowerHost.startsWith(e);
    return lowerHost.includes(e);
  });
}

function enforceAiPolicy({ domain, url, settings, confirmed }) {
  const blocklist = settings?.aiBlockedDomains || DEFAULT_SETTINGS.aiBlockedDomains;
  if (isBlockedDomainForAI(domain || url, blocklist)) {
    throw new Error('Domain này đang bị chặn, không gửi nội dung tới AI.');
  }
  if (settings?.aiRequireConfirm !== false && !confirmed) {
    throw new Error('Cần xác nhận trước khi gửi nội dung tới AI.');
  }
}

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

    // New context menus
    chrome.contextMenus.create({
      id: 'recall-separator2',
      type: 'separator',
      contexts: ['page', 'selection'],
    });

    chrome.contextMenus.create({
      id: 'recall-read-later',
      title: 'Save to Read Later (Recall)',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'recall-clip-selection',
      title: 'Clip Selection (Recall)',
      contexts: ['selection'],
    });
  });

  // Set up smart notification alarm (daily check)
  chrome.alarms.create('recall-smart-notify', { periodInMinutes: 1440 });

  // Set up session save alarm (every 2 minutes)
  chrome.alarms.create('recall-save-session', { periodInMinutes: 2 });
});

// ============================================================
// SESSION RESTORE: on browser startup
// ============================================================

chrome.runtime.onStartup.addListener(async () => {
  try {
    const sessions = await db.getAllSessions();
    if (sessions.length > 0) {
      const latest = sessions[0];
      const tabCount = latest.tabs ? latest.tabs.length : 0;
      if (tabCount > 0) {
        chrome.notifications.create('recall-session-restore', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Recall: Restore Previous Session?',
          message: `Your last session had ${tabCount} tab(s). Click to open Manager and restore.`,
          buttons: [
            { title: 'Restore Online' },
            { title: 'Dismiss' },
          ],
          requireInteraction: true,
        });
      }
    }
  } catch (e) {
    console.warn('[Recall] Session restore check failed:', e);
  }

  // Re-create alarms on startup (they don't survive browser restart)
  chrome.alarms.create('recall-time-cleanup', { periodInMinutes: 360 });
  chrome.alarms.create('recall-page-watch', { periodInMinutes: 15 });
  chrome.alarms.create('recall-smart-notify', { periodInMinutes: 1440 });
  chrome.alarms.create('recall-save-session', { periodInMinutes: 1 });

  // Save current session immediately on startup (don't wait 2 min for alarm)
  try {
    await saveCurrentSession();
    console.log('[Recall] Session saved on startup');
  } catch (e) {
    console.warn('[Recall] Startup session save failed:', e);
  }
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

  // Smart notifications
  if (alarm.name === 'recall-smart-notify') {
    try {
      const settings = await db.getAllSettings();

      // Read Later reminders
      if (settings.readLaterReminderDays > 0) {
        const unread = await db.getUnreadSnapshots();
        const cutoff = Date.now() - settings.readLaterReminderDays * 86400000;
        const overdue = unread.filter(s => s.timestamp < cutoff);
        if (overdue.length > 0) {
          chrome.notifications.create('recall-readlater-reminder', {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Recall: Unread Pages',
            message: `You have ${overdue.length} unread page(s) saved for later. Don't forget to read them!`,
          });
        }
      }

      // Storage warning
      if (settings.storageWarningEnabled) {
        const stats = await storageManager.getUsageStats();
        if (stats.isWarning) {
          chrome.notifications.create('recall-storage-warning', {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Recall: Storage Warning',
            message: `Storage is ${stats.usagePercent}% full (${stats.totalSizeFormatted} / ${stats.maxFormatted}). Consider deleting old snapshots.`,
          });
        }
      }
    } catch (e) {
      console.warn('[Recall] Smart notification error:', e);
    }
  }

  // Session save
  if (alarm.name === 'recall-save-session') {
    try {
      await saveCurrentSession();
    } catch (e) {
      console.warn('[Recall] Session save error:', e);
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

    case 'recall-read-later': {
      try {
        const result = await captureTab(tab.id, CAPTURE_MANUAL);
        if (result && result.id) {
          await db.updateSnapshot(result.id, { isReadLater: true, isRead: false });
        }
      } catch (e) {
        console.warn('[Recall] Read Later from context menu failed:', e.message);
      }
      break;
    }

    case 'recall-clip-selection': {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION_HTML' }, async (response) => {
          if (chrome.runtime.lastError) return;
          if (response && response.html) {
            const { getDomain } = await import('../lib/utils.js');
            await handleMessage({
              type: MSG.CAPTURE_CLIP,
              url: tab.url,
              title: `Clip: ${tab.title}`,
              domain: getDomain(tab.url),
              html: response.html,
              text: response.text || '',
            });
          }
        });
      } catch (e) {
        console.warn('[Recall] Clip selection failed:', e.message);
      }
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
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SPOTLIGHT' }).catch(() => { });
    }
  } else if (command === 'read-later') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      try {
        const snapshot = await captureTab(tab.id, CAPTURE_MANUAL);
        if (snapshot) {
          await db.updateSnapshot(snapshot.id, { isReadLater: true, isRead: false });
        }
      } catch (e) {
        console.error('[Recall] Read Later shortcut error:', e);
      }
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
  // Use chunk-based approach to avoid O(n²) string concatenation
  const chunkSize = 8192;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(chunks.join(''))}`;
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
  // Handle TAB_CLOSING_CAPTURE from content script (capture on tab close)
  if (message.type === MSG.TAB_CLOSING_CAPTURE) {
    handleClosingTabCapture(message.data).catch((err) =>
      console.warn('[Recall] Closing-tab capture failed:', err)
    );
    // No response needed - page is unloading
    return false;
  }

  handleMessage(message, sender)
    .then((result) => sendResponse({ success: true, data: result }))
    .catch((error) => sendResponse({ success: false, error: error.message }));

  return true; // Async response
});

/**
 * Save a snapshot from a closing tab's content script.
 * The content script sends the full DOM HTML (with inlined images from progressive cache)
 * right before the page unloads.
 */
async function handleClosingTabCapture(data) {
  if (!data || !data.html || !data.url) return;

  // Check exclusions
  const settings = await db.getAllSettings();
  if (shouldExcludeUrl(data.url, settings)) return;

  // Check for recent duplicates (use same window as auto-capture)
  const isDuplicate = await db.hasRecentDuplicate(
    data.url,
    settings.duplicateWindowMinutes
  );
  if (isDuplicate) {
    console.log('[Recall] Closing-tab duplicate skipped:', data.url);
    return;
  }

  // Check size limit
  const maxSize = (settings.maxSnapshotSizeMB ?? 10) * 1024 * 1024;
  if (data.htmlSize > maxSize) {
    console.warn('[Recall] Closing-tab page too large, skipping:', data.url);
    return;
  }

  // Compress HTML
  const compressedBlob = await compressString(data.html);

  const id = generateId();

  const metadata = {
    id,
    url: data.url,
    title: data.title || 'Untitled',
    domain: getDomain(data.url),
    favicon: data.favicon || '',
    timestamp: data.captureTime || Date.now(),
    captureType: 'auto-close',
    snapshotSize: compressedBlob.size,
    thumbnailDataUrl: null,
    scrollPosition: 0,
    tags: [],
    isStarred: false,
    sessionId: null,
    parentSnapshotId: null,
  };

  // Apply auto-tag rules
  try {
    const rules = await db.getAllAutoTagRules();
    for (const rule of rules) {
      if (rule.domain && metadata.domain && metadata.domain.includes(rule.domain)) {
        if (!metadata.tags.includes(rule.tag)) {
          metadata.tags.push(rule.tag);
        }
      }
    }
  } catch { /* skip */ }

  const snapshotData = {
    id,
    domSnapshot: compressedBlob,
    deepBundle: null,
    textContent: data.textContent || '',
    screenshotBlob: null,
  };

  await Promise.all([
    db.saveSnapshot(metadata),
    db.saveSnapshotData(snapshotData),
  ]);

  console.log(`[Recall] Closing-tab captured: ${data.title} (${(compressedBlob.size / 1024).toFixed(1)}KB)`);

  // Notify UI
  chrome.runtime.sendMessage({
    type: MSG.SNAPSHOT_SAVED,
    snapshot: metadata,
  }).catch(() => { });
}

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
      ensureTrustedSender(sender, 'Deep Capture');
      if (!sender?.hasUserGesture && !message.userGesture) {
        throw new Error('Deep Capture cần thao tác người dùng.');
      }
      const quota = await storageManager.checkAndCleanup();
      if (!quota.ok) {
        throw new Error(quota.message || 'Storage is full, không thể Deep Capture.');
      }
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
      // Filter out soft-deleted snapshots (unless explicitly requesting trash)
      if (!message.includeDeleted) {
        snapshots = snapshots.filter(s => !s.isDeleted);
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
      // Soft delete: mark as deleted instead of removing
      await db.updateSnapshot(message.id, { isDeleted: true, deletedAt: Date.now() });
      chrome.runtime.sendMessage({
        type: MSG.SNAPSHOT_DELETED,
        id: message.id,
      }).catch(() => { });
      return { deleted: message.id };
    }

    case MSG.DELETE_SNAPSHOTS: {
      // Soft delete all in a single transaction
      await db.updateSnapshots(message.ids, { isDeleted: true, deletedAt: Date.now() });
      chrome.runtime.sendMessage({
        type: MSG.SNAPSHOT_DELETED,
        ids: message.ids,
      }).catch(() => { });
      return { deleted: message.ids };
    }

    // ---------- Pin Snapshot ----------
    case MSG.PIN_SNAPSHOT: {
      await db.updateSnapshot(message.id, { isPinned: true, pinnedAt: Date.now() });
      return { pinned: true };
    }

    case MSG.UNPIN_SNAPSHOT: {
      await db.updateSnapshot(message.id, { isPinned: false, pinnedAt: null });
      return { pinned: false };
    }

    // ---------- Trash / Soft Delete ----------
    case MSG.GET_TRASH: {
      const allSnaps = await db.getAllSnapshots();
      const trashed = allSnaps.filter(s => s.isDeleted);
      return Promise.all(trashed.map(migrateThumbnail));
    }

    case MSG.RESTORE_SNAPSHOT: {
      if (message.ids) {
        await db.updateSnapshots(message.ids, { isDeleted: false, deletedAt: null });
        return { restored: message.ids };
      }
      await db.updateSnapshot(message.id, { isDeleted: false, deletedAt: null });
      return { restored: message.id };
    }

    case MSG.PERMANENT_DELETE: {
      if (message.ids) {
        await db.deleteSnapshots(message.ids);
        return { permanentlyDeleted: message.ids };
      }
      await db.deleteSnapshot(message.id);
      return { permanentlyDeleted: message.id };
    }

    case MSG.EMPTY_TRASH: {
      const allSnaps = await db.getAllSnapshots();
      const trashIds = allSnaps.filter(s => s.isDeleted).map(s => s.id);
      if (trashIds.length > 0) {
        await db.deleteSnapshots(trashIds);
      }
      return { emptied: trashIds.length };
    }

    // ---------- Save All Tabs ----------
    case MSG.SAVE_ALL_TABS: {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const settings = await db.getAllSettings();

      // Filter valid tabs
      const validTabs = tabs.filter(tab => {
        if (!tab.url) return false;
        return !shouldExcludeUrl(tab.url, settings);
      });

      if (validTabs.length === 0) throw new Error('No valid tabs to capture');

      // Tag for grouping
      const batchTag = `all-tabs-${new Date().toLocaleDateString()}`;

      // Capture each tab
      let captured = 0;
      const errors = [];
      for (const tab of validTabs) {
        try {
          const snapshot = await captureTab(tab.id, CAPTURE_MANUAL);
          if (snapshot) {
            // Add batch tag
            const existing = snapshot.tags || [];
            if (!existing.includes(batchTag)) {
              await db.updateSnapshot(snapshot.id, { tags: [...existing, batchTag] });
            }
            captured++;
          }
        } catch (e) {
          errors.push({ url: tab.url, error: e.message });
        }
      }

      return { captured, total: validTabs.length, batchTag, errors };
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

    case MSG.EXPORT_BACKUP: {
      return exportBackupZip();
    }

    case MSG.IMPORT_BACKUP: {
      // The settings page sends the ZIP as a plain Array (because ArrayBuffer
      // doesn't survive chrome.runtime.sendMessage serialization).
      // Reconstruct it here.
      const arr = message.bufferArray || message.buffer;
      if (!arr) throw new Error('No backup file provided');
      const arrayBuffer = (arr instanceof ArrayBuffer)
        ? arr
        : new Uint8Array(arr).buffer;
      return importBackupZip(arrayBuffer, { wipeExisting: message.wipe !== false });
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
      ensureTrustedSender(sender, 'Watch Page');
      if (!isPublicHttpUrl(message.url)) {
        throw new Error('Chỉ hỗ trợ URL http/https công khai khi theo dõi thay đổi.');
      }
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
      ensureTrustedSender(sender, 'Watch Page');
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

    // ---------- Read Later ----------
    case MSG.MARK_READ_LATER: {
      const tabId = message.tabId;
      let tab;
      if (tabId) {
        tab = await chrome.tabs.get(tabId);
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = activeTab;
      }
      if (!tab) throw new Error('No active tab');
      // Capture the page if snapshotId is not provided
      if (message.snapshotId) {
        await db.updateSnapshot(message.snapshotId, { isReadLater: true, isRead: false });
        return { updated: true };
      }
      const result = await captureTab(tab.id, CAPTURE_MANUAL);
      if (result && result.id) {
        await db.updateSnapshot(result.id, { isReadLater: true, isRead: false });
      }
      return result;
    }

    case MSG.MARK_AS_READ: {
      await db.updateSnapshot(message.id, { isRead: true });
      return { updated: true };
    }

    case MSG.GET_READ_LATER: {
      const snapshots = await db.getReadLaterSnapshots();
      return Promise.all(snapshots.map(migrateThumbnail));
    }

    // ---------- Collections ----------
    case MSG.CREATE_COLLECTION: {
      const collection = {
        id: generateId(),
        name: message.name,
        description: message.description || '',
        color: message.color || '#6366f1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.createCollection(collection);
      return collection;
    }

    case MSG.UPDATE_COLLECTION: {
      await db.updateCollection(message.id, {
        ...message.updates,
        updatedAt: Date.now(),
      });
      return { updated: true };
    }

    case MSG.DELETE_COLLECTION: {
      await db.deleteCollection(message.id);
      return { deleted: message.id };
    }

    case MSG.GET_COLLECTIONS: {
      return db.getAllCollections();
    }

    case MSG.ADD_TO_COLLECTION: {
      await db.addToCollection(message.snapshotId, message.collectionId);
      return { updated: true };
    }

    case MSG.REMOVE_FROM_COLLECTION: {
      await db.removeFromCollection(message.snapshotId);
      return { updated: true };
    }

    case MSG.GET_COLLECTION_SNAPSHOTS: {
      const snapshots = await db.getSnapshotsByCollection(message.collectionId);
      return Promise.all(snapshots.map(migrateThumbnail));
    }

    // ---------- Auto-Tag Rules ----------
    case MSG.GET_AUTO_TAG_RULES: {
      return db.getAllAutoTagRules();
    }

    case MSG.SAVE_AUTO_TAG_RULES: {
      // Save all rules (replace all) in a single transaction
      const rules = message.rules.map(rule => {
        if (!rule.id) rule.id = generateId();
        return rule;
      });
      await db.replaceAllAutoTagRules(rules);
      return { saved: true };
    }

    // ---------- Web Clipper ----------
    case MSG.CAPTURE_CLIP: {
      // Save clipped content as a snapshot
      const id = generateId();
      const timestamp = Date.now();
      const metadata = {
        id,
        url: message.url,
        title: message.title || 'Clipped Content',
        domain: message.domain || '',
        favicon: '',
        timestamp,
        captureType: CAPTURE_CLIP,
        snapshotSize: message.html ? message.html.length : 0,
        thumbnailDataUrl: null,
        scrollPosition: 0,
        tags: ['clip'],
        isStarred: false,
      };

      // Apply auto-tag rules
      const rules = await db.getAllAutoTagRules();
      for (const rule of rules) {
        if (metadata.domain && metadata.domain.includes(rule.domain)) {
          if (!metadata.tags.includes(rule.tag)) {
            metadata.tags.push(rule.tag);
          }
        }
      }

      const { compressString } = await import('../lib/utils.js');
      const htmlBlob = await compressString(message.html || '<p>No content</p>');
      const textContent = (message.text || '').substring(0, 50000);

      const snapshotData = {
        id,
        domSnapshot: htmlBlob,
        textContent,
      };

      await Promise.all([
        db.saveSnapshot(metadata),
        db.saveSnapshotData(snapshotData),
      ]);

      chrome.runtime.sendMessage({ type: MSG.SNAPSHOT_SAVED, snapshot: metadata }).catch(() => { });
      return metadata;
    }

    // ---------- AI Summary ----------
    case MSG.GENERATE_SUMMARY: {
      ensureTrustedSender(sender, 'AI Summary');
      const settings = await db.getAllSettings();
      if (settings.aiProvider === 'none') {
        throw new Error('No AI provider configured. Go to Settings to set up an AI provider.');
      }

      const snap = await db.getSnapshotData(message.id);
      if (!snap || !snap.textContent) throw new Error('No text content for this snapshot');

      const snapMeta = await db.getSnapshot(message.id);
      enforceAiPolicy({ domain: snapMeta?.domain, url: snapMeta?.url, settings, confirmed: message.confirmed });

      const text = snap.textContent.substring(0, 10000); // Limit to 10K chars
      let summary = '';

      if (settings.aiProvider === 'google') {
        // Google Gemini API
        const apiKey = settings.aiApiKey;
        if (!apiKey) throw new Error('Google API key not configured');
        const model = settings.aiModel || 'gemini-2.0-flash';
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Summarize the following web page content in 2-3 concise sentences:\n\n${text}`
              }]
            }],
            generationConfig: {
              maxOutputTokens: 300,
              temperature: 0.3,
            }
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error?.message || `Google API error ${resp.status}`);
        }
        const data = await resp.json();
        summary = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Failed to generate summary.';
      } else if (settings.aiProvider === 'openai' || settings.aiProvider === 'custom') {
        const endpoint = settings.aiProvider === 'custom'
          ? settings.aiApiEndpoint
          : 'https://api.openai.com/v1/chat/completions';
        const apiKey = settings.aiApiKey;
        if (!apiKey) throw new Error('API key not configured');
        const model = settings.aiModel || 'gpt-3.5-turbo';

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'Summarize the following web page content in 2-3 concise sentences.' },
              { role: 'user', content: text },
            ],
            max_tokens: 200,
          }),
        });
        const data = await resp.json();
        summary = data.choices?.[0]?.message?.content || 'Failed to generate summary.';
      } else {
        // Fallback: simple extractive summary (first 3 sentences)
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20).slice(0, 3);
        summary = sentences.join('. ').trim() + '.';
      }

      // Save summary to snapshot metadata
      await db.updateSnapshot(message.id, { aiSummary: summary });
      return { summary };
    }

    case MSG.FETCH_AI_MODELS: {
      ensureTrustedSender(sender, 'Fetch AI models');
      const { provider, apiKey } = message;
      if (!apiKey) throw new Error('API key is required');

      if (provider === 'google') {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error?.message || `Google API error ${resp.status}`);
        }
        const data = await resp.json();
        const models = (data.models || [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => ({
            id: m.name.replace('models/', ''),
            name: m.displayName || m.name.replace('models/', ''),
          }));
        return { models };
      }

      if (provider === 'openai') {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error?.message || `OpenAI API error ${resp.status}`);
        }
        const data = await resp.json();
        const models = (data.data || [])
          .filter(m => m.id.includes('gpt'))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(m => ({ id: m.id, name: m.id }));
        return { models };
      }

      throw new Error('Model fetching not supported for this provider');
    }

    case MSG.GET_SUMMARY: {
      const snap = await db.getSnapshot(message.id);
      return { summary: snap?.aiSummary || null };
    }

    // ---------- Spotlight AI Chat ----------
    case MSG.SPOTLIGHT_AI_CHAT: {
      const { question, pageText, pageUrl, pageTitle, chatHistory } = message;
      if (!question) throw new Error('No question provided');

      const settings = await db.getAllSettings();
      if (!settings.aiProvider || settings.aiProvider === 'none') {
        throw new Error('No AI provider configured. Go to Settings → AI Summary to set up.');
      }
      if (!settings.aiApiKey) {
        throw new Error('API key not configured. Go to Settings → AI Summary.');
      }

      if (!isPublicHttpUrl(pageUrl)) {
        throw new Error('Trang hiện tại không phải http/https công khai nên không gửi tới AI.');
      }

      enforceAiPolicy({ domain: getDomain(pageUrl), url: pageUrl, settings, confirmed: message.confirmed });

      // 1. Search related snapshots using keywords from the question
      const keywords = question.toLowerCase()
        .replace(/[^\w\sàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);

      let relatedSnapshots = [];
      if (keywords.length > 0) {
        const allSnaps = await db.getAllSnapshots();
        const scored = allSnaps
          .filter(s => !s.isDeleted)
          .map(s => {
            const haystack = `${s.title} ${s.url} ${s.domain}`.toLowerCase();
            const score = keywords.reduce((acc, kw) => acc + (haystack.includes(kw) ? 1 : 0), 0);
            return { snap: s, score };
          })
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        // Get text snippets for related snapshots
        for (const { snap: s } of scored) {
          try {
            const data = await db.getSnapshotData(s.id);
            const text = data?.textContent?.substring(0, 2000) || '';
            relatedSnapshots.push({
              id: s.id,
              title: s.title,
              url: s.url,
              domain: s.domain,
              textSnippet: text,
            });
          } catch { /* skip */ }
        }
      }

      // 2. Build context prompt
      let contextParts = [];

      if (pageText && pageText.trim()) {
        const truncatedPage = pageText.substring(0, 6000);
        contextParts.push(`CURRENT PAGE (${pageTitle || pageUrl || 'Unknown'}):\n${truncatedPage}`);
      }

      if (relatedSnapshots.length > 0) {
        const snapTexts = relatedSnapshots.map(s =>
          `- "${s.title}" (${s.domain}):\n${s.textSnippet.substring(0, 1500)}`
        ).join('\n\n');
        contextParts.push(`RELATED SAVED SNAPSHOTS:\n${snapTexts}`);
      }

      const langLabel = settings.language === 'vi' ? 'Vietnamese' : 'English';
      const systemPrompt = `You are a helpful AI assistant integrated into the Recall browser extension. You help users understand web pages and their saved snapshots.

${contextParts.length > 0 ? 'Here is the context:\n\n' + contextParts.join('\n\n---\n\n') : 'No page context is available.'}

Instructions:
- Answer concisely and helpfully
- If referencing saved snapshots, mention their titles
- Use markdown formatting (bold, lists, etc.) when helpful
- If the question is unrelated to the context, still try to help
- ALWAYS answer in ${langLabel}`;

      // 3. Build messages array (with chat history)
      const messages = [];
      if (chatHistory && chatHistory.length > 0) {
        for (const entry of chatHistory.slice(-6)) { // Keep last 6 messages for context
          messages.push({ role: entry.role, content: entry.content });
        }
      }
      messages.push({ role: 'user', content: question });

      // 4. Call AI API
      let answer = '';

      if (settings.aiProvider === 'google') {
        const model = settings.aiModel || 'gemini-2.0-flash';
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.aiApiKey}`;

        const geminiContents = [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Understood. I will help with questions about the current page and saved snapshots.' }] },
        ];
        for (const msg of messages) {
          geminiContents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
          });
        }

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: geminiContents,
            generationConfig: {
              maxOutputTokens: 1024,
              temperature: 0.5,
            },
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error?.message || `Google API error ${resp.status}`);
        }
        const data = await resp.json();
        answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
      } else if (settings.aiProvider === 'openai' || settings.aiProvider === 'custom') {
        const endpoint = settings.aiProvider === 'custom'
          ? settings.aiApiEndpoint
          : 'https://api.openai.com/v1/chat/completions';
        const model = settings.aiModel || 'gpt-3.5-turbo';

        const openaiMessages = [
          { role: 'system', content: systemPrompt },
          ...messages,
        ];

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.aiApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: openaiMessages,
            max_tokens: 1024,
          }),
        });
        const data = await resp.json();
        answer = data.choices?.[0]?.message?.content || 'No response generated.';
      } else {
        throw new Error('AI provider not supported for chat. Configure Google or OpenAI in Settings.');
      }

      return {
        answer,
        relatedSnapshots: relatedSnapshots.map(s => ({
          id: s.id,
          title: s.title,
          url: s.url,
          domain: s.domain,
        })),
      };
    }

    // ---------- Dashboard ----------
    case MSG.GET_DASHBOARD_STATS: {
      return db.getDashboardStats();
    }

    // ---------- Snapshot Links ----------
    case MSG.GET_LINKED_SNAPSHOTS: {
      // Parse [[snapshot-id]] references from notes
      const snap = await db.getSnapshot(message.id);
      if (!snap || !snap.notes) return [];

      const linkPattern = /\[\[([a-f0-9-]+)\]\]/g;
      const linkedIds = [];
      let match;
      while ((match = linkPattern.exec(snap.notes)) !== null) {
        linkedIds.push(match[1]);
      }

      const linkedSnapshots = [];
      for (const lid of linkedIds) {
        const linked = await db.getSnapshot(lid);
        if (linked) {
          await migrateThumbnail(linked);
          linkedSnapshots.push(linked);
        }
      }
      return linkedSnapshots;
    }

    // ---------- Export Standalone HTML ----------
    case MSG.EXPORT_STANDALONE_HTML: {
      const snapData = await db.getSnapshotData(message.id);
      const snapMeta = await db.getSnapshot(message.id);
      if (!snapData || !snapMeta) throw new Error('Snapshot not found');

      const { decompressToString } = await import('../lib/utils.js');
      let html = '';
      if (snapData.domSnapshot instanceof Blob) {
        html = await decompressToString(snapData.domSnapshot);
      } else if (typeof snapData.domSnapshot === 'string') {
        html = snapData.domSnapshot;
      }

      // Wrap as standalone
      const standalone = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${snapMeta.title || 'Recall Snapshot'}</title>
  <meta name="recall-snapshot-id" content="${snapMeta.id}">
  <meta name="recall-original-url" content="${snapMeta.url}">
  <meta name="recall-capture-time" content="${new Date(snapMeta.timestamp).toISOString()}">
  <style>
    body { margin: 0; padding: 0; }
    .recall-info-bar {
      background: #1e293b; color: #e2e8f0; padding: 8px 16px;
      font-family: system-ui, sans-serif; font-size: 13px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .recall-info-bar a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="recall-info-bar">
    <span>Recall Snapshot: <strong>${snapMeta.title || ''}</strong></span>
    <span>Captured: ${new Date(snapMeta.timestamp).toLocaleString()} | <a href="${snapMeta.url}" target="_blank">Original URL</a></span>
  </div>
  <iframe srcdoc="${html.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}" style="width:100%;height:calc(100vh - 40px);border:none;"></iframe>
</body>
</html>`;

      // Download as HTML file
      const blob = new Blob([standalone], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const filename = `recall-${snapMeta.domain}-${new Date(snapMeta.timestamp).toISOString().slice(0, 10)}.html`;
      await chrome.downloads.download({ url, filename, saveAs: true });
      return { exported: true, filename };
    }

    // ---------- Session Restore ----------
    case MSG.SAVE_SESSION: {
      await saveCurrentSession();
      return { saved: true };
    }

    case MSG.GET_SESSIONS: {
      return db.getAllSessions();
    }

    case MSG.DELETE_SESSION: {
      await db.deleteSession(message.id);
      return { deleted: true };
    }

    case MSG.RESTORE_SESSION: {
      const sessions = await db.getAllSessions();
      const session = sessions.find(s => s.id === message.sessionId);
      if (!session) throw new Error('Session not found');

      const mode = message.mode || 'online'; // 'online' or 'offline'
      const tabsToRestore = message.tabIds
        ? session.tabs.filter((_, i) => message.tabIds.includes(i))
        : session.tabs;

      if (mode === 'online') {
        // Open original URLs in new tabs
        for (const tab of tabsToRestore) {
          await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
        }
      } else {
        // Open snapshots in viewer (find matching snapshot by URL)
        for (const tab of tabsToRestore) {
          const allSnaps = await db.getAllSnapshots();
          const match = allSnaps.find(s => s.url === tab.url);
          if (match) {
            const viewerUrl = chrome.runtime.getURL(`viewer/viewer.html?id=${match.id}`);
            await chrome.tabs.create({ url: viewerUrl, active: false });
          } else {
            // No snapshot: fall back to online
            await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
          }
        }
      }

      return { restored: tabsToRestore.length, mode };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

console.log('[Recall] Service worker started');

// Handle notification button clicks (session restore)
chrome.notifications.onButtonClicked.addListener(async (notifId, btnIndex) => {
  if (notifId === 'recall-session-restore') {
    if (btnIndex === 0) {
      // "Restore Online" button
      try {
        const sessions = await db.getAllSessions();
        if (sessions.length > 0) {
          const latest = sessions[0];
          for (const tab of latest.tabs) {
            await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
          }
        }
      } catch (e) {
        console.warn('[Recall] Quick restore failed:', e);
      }
    }
    chrome.notifications.clear(notifId);
  }
});

// Handle notification click (open manager with sessions view)
chrome.notifications.onClicked.addListener(async (notifId) => {
  if (notifId === 'recall-session-restore') {
    const managerUrl = chrome.runtime.getURL('manager/manager.html#sessions');
    chrome.tabs.create({ url: managerUrl });
    chrome.notifications.clear(notifId);
  }
});

// ============================================================
// SESSION SAVE HELPER
// ============================================================

async function saveCurrentSession() {
  try {
    const tabs = await chrome.tabs.query({});
    // Filter out extension pages and chrome:// pages
    const validTabs = tabs.filter(t => {
      if (!t.url) return false;
      const url = t.url;
      return !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('devtools://') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://');
    });

    if (validTabs.length === 0) return;

    // Group by window
    const windows = {};
    for (const tab of validTabs) {
      if (!windows[tab.windowId]) windows[tab.windowId] = [];
      windows[tab.windowId].push({
        url: tab.url,
        title: tab.title || '',
        favIconUrl: tab.favIconUrl || '',
        index: tab.index,
        pinned: tab.pinned,
        active: tab.active,
      });
    }

    const session = {
      id: 'session-' + Date.now(),
      savedAt: Date.now(),
      tabCount: validTabs.length,
      windowCount: Object.keys(windows).length,
      tabs: validTabs.map(t => ({
        url: t.url,
        title: t.title || '',
        favIconUrl: t.favIconUrl || '',
        index: t.index,
        windowId: t.windowId,
        pinned: t.pinned,
        active: t.active,
      })),
    };

    await db.saveSession(session);
    await db.clearOldSessions(20); // Keep last 20 sessions
  } catch (e) {
    console.warn('[Recall] saveCurrentSession failed:', e);
  }
}

// ============================================================
// TRASH AUTO-PURGE (30-day cleanup)
// ============================================================

const TRASH_PURGE_ALARM = 'recall-trash-purge';
const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Create alarm on install/startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(TRASH_PURGE_ALARM, { periodInMinutes: 24 * 60 }); // daily
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(TRASH_PURGE_ALARM, { periodInMinutes: 24 * 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TRASH_PURGE_ALARM) return;

  try {
    const allSnaps = await db.getAllSnapshots();
    const now = Date.now();
    const expiredIds = allSnaps
      .filter(s => s.isDeleted && s.deletedAt && (now - s.deletedAt) > TRASH_MAX_AGE_MS)
      .map(s => s.id);

    if (expiredIds.length > 0) {
      await db.deleteSnapshots(expiredIds);
      console.log(`[Recall] Auto-purged ${expiredIds.length} expired trash items`);
    }
  } catch (e) {
    console.error('[Recall] Trash auto-purge error:', e);
  }
});
