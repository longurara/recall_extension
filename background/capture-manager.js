// background/capture-manager.js - Capture orchestration for Recall extension

import * as db from '../lib/db.js';
import { storageManager } from '../lib/storage-manager.js';
import {
  generateId,
  getDomain,
  compressString,
  shouldExcludeUrl,
} from '../lib/utils.js';
import {
  CAPTURE_AUTO,
  CAPTURE_MANUAL,
  BADGE_COLORS,
  MSG,
} from '../lib/constants.js';

// Track tabs currently being captured to avoid duplicate captures
const capturingTabs = new Set();

/**
 * Set badge on extension icon
 */
function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
}

/**
 * Clear badge after delay
 */
function clearBadge(tabId, delay = 2000) {
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }, delay);
}

/**
 * Capture a tab's DOM snapshot via content script
 */
async function captureDOMSnapshot(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('DOM capture timed out'));
    }, 30000); // 30s timeout

    chrome.tabs.sendMessage(tabId, { type: MSG.CAPTURE_DOM }, (response) => {
      clearTimeout(timeout);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error('No response from content script'));
        return;
      }

      if (response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response.error || 'Unknown capture error'));
      }
    });
  });
}

/**
 * Capture visible tab as screenshot for thumbnail
 */
async function captureScreenshot(tabId) {
  try {
    // Get the window ID for the tab
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.windowId) return null;

    // Focus the window to ensure we capture the right tab
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 60,
    });

    return dataUrl;
  } catch (error) {
    console.warn('[Recall] Screenshot capture failed:', error.message);
    return null;
  }
}

/**
 * Create thumbnail as data URL string from screenshot data URL.
 * Returns a string (not a Blob) so it survives Chrome message serialization.
 */
async function createThumbnailDataUrl(dataUrl, maxWidth = 320, maxHeight = 200) {
  if (!dataUrl) return null;

  try {
    // In service worker, we can't use Image/Canvas
    // Use OffscreenCanvas if available
    if (typeof OffscreenCanvas !== 'undefined') {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      let width = bitmap.width;
      let height = bitmap.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }

      const canvas = new OffscreenCanvas(Math.round(width), Math.round(height));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
      return blobToDataUrl(thumbBlob);
    }

    // Fallback: return the original screenshot data URL (already a string)
    return dataUrl;
  } catch (error) {
    console.warn('[Recall] Thumbnail creation failed:', error.message);
    return null;
  }
}

/**
 * Convert a Blob to a data URL string.
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
 * Main capture function - orchestrates DOM snapshot + screenshot
 * @param {number} tabId
 * @param {string} captureType - 'auto' | 'manual'
 * @param {object} [flowMeta] - { sessionId, parentSnapshotId } for navigation flow tracking
 */
export async function captureTab(tabId, captureType = CAPTURE_AUTO, flowMeta = null) {
  // Prevent duplicate captures
  if (capturingTabs.has(tabId)) {
    console.log('[Recall] Tab already being captured:', tabId);
    return null;
  }

  capturingTabs.add(tabId);
  setBadge(tabId, '...', BADGE_COLORS.CAPTURING);

  try {
    // Get tab info
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) {
      throw new Error('Invalid tab');
    }

    // Load settings
    const settings = await db.getAllSettings();

    // Check exclusions
    if (shouldExcludeUrl(tab.url, settings)) {
      console.log('[Recall] URL excluded:', tab.url);
      return null;
    }

    // Check for recent duplicates (auto-capture only)
    if (captureType === CAPTURE_AUTO) {
      const isDuplicate = await db.hasRecentDuplicate(
        tab.url,
        settings.duplicateWindowMinutes
      );
      if (isDuplicate) {
        console.log('[Recall] Duplicate skipped:', tab.url);
        return null;
      }
    }

    // Check storage quota
    const quotaCheck = await storageManager.checkAndCleanup();
    if (!quotaCheck.ok) {
      console.warn('[Recall] Storage full:', quotaCheck.message);
      setBadge(tabId, '!', BADGE_COLORS.ERROR);
      clearBadge(tabId, 5000);
      return null;
    }

    // Run captures in parallel: DOM snapshot + screenshot
    const [domResult, screenshotDataUrl] = await Promise.allSettled([
      captureDOMSnapshot(tabId),
      captureScreenshot(tabId),
    ]);

    // DOM capture is required
    if (domResult.status === 'rejected') {
      throw domResult.reason;
    }

    const domData = domResult.value;

    // Check size limit
    const maxSize = settings.maxSnapshotSizeMB * 1024 * 1024;
    if (domData.htmlSize > maxSize) {
      console.warn(
        `[Recall] Page too large (${(domData.htmlSize / 1024 / 1024).toFixed(1)}MB), skipping:`,
        tab.url
      );
      return null;
    }

    // Compress the HTML
    const compressedBlob = await compressString(domData.html);

    // Create thumbnail (stored as data URL string for message serialization)
    const screenshotUrl =
      screenshotDataUrl.status === 'fulfilled' ? screenshotDataUrl.value : null;
    const thumbnailDataUrl = await createThumbnailDataUrl(screenshotUrl);

    // Generate snapshot ID
    const id = generateId();

    // Save metadata
    const metadata = {
      id,
      url: domData.url,
      title: domData.title || tab.title || 'Untitled',
      domain: getDomain(domData.url),
      favicon: domData.favicon || '',
      timestamp: domData.captureTime,
      captureType,
      snapshotSize: compressedBlob.size,
      thumbnailDataUrl,
      scrollPosition: domData.scrollY || 0,
      tags: [],
      isStarred: false,
      // Navigation flow tracking
      sessionId: flowMeta?.sessionId || null,
      parentSnapshotId: flowMeta?.parentSnapshotId || null,
    };

    // Save data
    const snapshotData = {
      id,
      domSnapshot: compressedBlob,
      deepBundle: null,
      textContent: domData.textContent || '',
    };

    // Save both in parallel
    await Promise.all([
      db.saveSnapshot(metadata),
      db.saveSnapshotData(snapshotData),
    ]);

    // Success badge
    setBadge(tabId, 'OK', BADGE_COLORS.SUCCESS);
    clearBadge(tabId, 2000);

    console.log(
      `[Recall] Captured: ${domData.title} (${(compressedBlob.size / 1024).toFixed(1)}KB compressed)`
    );

    // Notify UI (side panel, popup, etc.)
    chrome.runtime.sendMessage({
      type: MSG.SNAPSHOT_SAVED,
      snapshot: metadata,
    }).catch(() => {}); // Ignore if no listeners

    return metadata;
  } catch (error) {
    console.error('[Recall] Capture failed:', error);
    setBadge(tabId, 'X', BADGE_COLORS.ERROR);
    clearBadge(tabId, 3000);
    return null;
  } finally {
    capturingTabs.delete(tabId);
  }
}

/**
 * Export a snapshot as MHTML (if tab is still open)
 * Falls back to downloading the DOM snapshot as HTML
 */
export async function exportSnapshot(snapshotId) {
  const metadata = await db.getSnapshot(snapshotId);
  if (!metadata) throw new Error('Snapshot not found');

  const data = await db.getSnapshotData(snapshotId);
  if (!data) throw new Error('Snapshot data not found');

  // Try MHTML capture if we can find the original tab
  let mhtmlBlob = null;
  try {
    const tabs = await chrome.tabs.query({ url: metadata.url });
    if (tabs.length > 0) {
      mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId: tabs[0].id });
    }
  } catch {
    // Tab not open or MHTML capture failed
  }

  if (mhtmlBlob) {
    // Download MHTML
    const url = URL.createObjectURL(mhtmlBlob);
    const filename = sanitizeFilename(metadata.title) + '.mhtml';
    await chrome.downloads.download({
      url,
      filename: `Recall/${filename}`,
      saveAs: true,
    });
    // Note: URL.revokeObjectURL can't be called reliably from SW
    return { format: 'mhtml', filename };
  }

  // Fallback: export as HTML from DOM snapshot
  const htmlBlob = data.domSnapshot; // Already compressed
  const url = URL.createObjectURL(htmlBlob);
  const filename = sanitizeFilename(metadata.title) + '.html.gz';
  await chrome.downloads.download({
    url,
    filename: `Recall/${filename}`,
    saveAs: true,
  });

  return { format: 'html', filename };
}

/**
 * Sanitize a string for use as filename
 */
function sanitizeFilename(str) {
  return (str || 'snapshot')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}
