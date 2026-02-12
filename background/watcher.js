// background/watcher.js - Page Change Monitoring module
//
// Fetches watched pages periodically, extracts text content,
// compares with the previous check via a simple hash, and
// sends Chrome notifications when changes are detected.

import * as db from '../lib/db.js';
import { generateId, getDomain } from '../lib/utils.js';
import { MSG } from '../lib/constants.js';

// ============================================================
// TEXT HASHING (simple FNV-1a for fast comparison)
// ============================================================

/**
 * FNV-1a 32-bit hash of a string. Fast, non-cryptographic.
 */
function hashText(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

// ============================================================
// TEXT EXTRACTION from HTML
// ============================================================

/**
 * Strip HTML tags and extract meaningful text content.
 * Removes scripts, styles, and normalises whitespace.
 */
function extractTextFromHtml(html) {
  // Remove <script>, <style>, <noscript> blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, '')
    .replace(/&\w+;/g, '');

  // Normalise whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Extract text for a specific CSS selector from the HTML.
 * Falls back to full-page text if selector doesn't match.
 */
function extractTextForSelector(html, selector) {
  if (!selector) return extractTextFromHtml(html);

  // Use a very simple regex-based approach since we don't have DOM in service worker.
  // For id selectors (#foo) we can find the element.
  // For simple class selectors (.foo) we do our best.
  // This is a best-effort approach; complex selectors won't work.
  // In practice most users will use #id selectors.
  const idMatch = selector.match(/^#([\w-]+)$/);
  if (idMatch) {
    const id = idMatch[1];
    const regex = new RegExp(`<[^>]+id\\s*=\\s*["']${id}["'][^>]*>[\\s\\S]*`, 'i');
    const match = html.match(regex);
    if (match) {
      // Try to find the closing tag by counting open/close pairs
      // Simple approach: just take a reasonable chunk
      const chunk = match[0].substring(0, 50000);
      return extractTextFromHtml(chunk);
    }
  }

  // Fallback to full text
  return extractTextFromHtml(html);
}

// ============================================================
// PAGE FETCHING
// ============================================================

/**
 * Fetch a page's HTML content via the network.
 * Returns { html, title, ok } or { ok: false, error }.
 */
async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecallBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000), // 30s timeout
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // Extract <title>
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

    return { ok: true, html, title };
  } catch (err) {
    return { ok: false, error: err.message || 'Fetch failed' };
  }
}

// ============================================================
// SINGLE PAGE CHECK
// ============================================================

/**
 * Check a single watched page for changes.
 * Returns { changed: boolean, entry: updatedEntry } or { error }.
 */
export async function checkWatchedPage(entry) {
  const result = await fetchPage(entry.url);

  if (!result.ok) {
    // Update lastChecked even on error so we don't spam retries
    await db.updateWatchedPage(entry.id, {
      lastChecked: Date.now(),
      lastError: result.error,
    });
    return { changed: false, error: result.error };
  }

  const text = extractTextForSelector(result.html, entry.cssSelector);
  const newHash = hashText(text);
  const now = Date.now();

  const updates = {
    lastChecked: now,
    title: result.title || entry.title,
    lastError: null,
  };

  let changed = false;

  if (entry.lastContentHash && entry.lastContentHash !== newHash) {
    // Content has changed!
    changed = true;
    updates.changeCount = (entry.changeCount || 0) + 1;
    updates.lastChangedAt = now;
    updates.previousContentHash = entry.lastContentHash;
    // Store a diff-preview snippet: first 200 chars of new content
    updates.lastChangePreview = text.substring(0, 200);
  }

  updates.lastContentHash = newHash;
  // Store last text for future diff display (truncated to 30KB)
  updates.lastTextContent = text.substring(0, 30000);

  await db.updateWatchedPage(entry.id, updates);

  const updatedEntry = { ...entry, ...updates };
  return { changed, entry: updatedEntry };
}

// ============================================================
// BATCH CHECK (called by alarm)
// ============================================================

/**
 * Check all pages that are due for checking.
 * Sends Chrome notifications for pages that changed.
 */
export async function checkAllDuePages() {
  const duePages = await db.getWatchedPagesDueForCheck();

  if (duePages.length === 0) {
    console.log('[Watcher] No pages due for check.');
    return { checked: 0, changed: 0 };
  }

  console.log(`[Watcher] Checking ${duePages.length} watched page(s)...`);

  let changedCount = 0;

  for (const entry of duePages) {
    try {
      const result = await checkWatchedPage(entry);

      if (result.changed) {
        changedCount++;

        // Send Chrome notification
        if (entry.notifyOnChange !== false) {
          try {
            chrome.notifications.create(`recall-watch-${entry.id}`, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: 'Page Changed!',
              message: `${result.entry.title || result.entry.url}\nhas been updated.`,
              priority: 1,
            });
          } catch (e) {
            console.warn('[Watcher] Notification error:', e);
          }
        }

        // Broadcast to open UI pages
        chrome.runtime.sendMessage({
          type: MSG.WATCHED_PAGE_CHANGED,
          entry: result.entry,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn(`[Watcher] Check failed for ${entry.url}:`, err.message);
    }
  }

  console.log(`[Watcher] Done. Checked: ${duePages.length}, Changed: ${changedCount}`);
  return { checked: duePages.length, changed: changedCount };
}

// ============================================================
// WATCH / UNWATCH
// ============================================================

/**
 * Start watching a URL.
 * @param {object} opts - { url, title?, intervalMinutes?, cssSelector?, notifyOnChange? }
 * @returns the created watch entry
 */
export async function watchPage(opts) {
  const { url, title, intervalMinutes, cssSelector, notifyOnChange } = opts;

  if (!url) throw new Error('URL is required');

  // Check if already watching this URL
  const existing = await db.getWatchedPageByUrl(url);
  if (existing) {
    // Re-activate if paused
    if (!existing.isActive) {
      await db.updateWatchedPage(existing.id, { isActive: true });
      return { ...existing, isActive: true };
    }
    return existing;
  }

  let domain;
  try {
    domain = getDomain(url);
  } catch {
    domain = url;
  }

  const entry = {
    id: generateId(),
    url,
    title: title || url,
    domain,
    intervalMinutes: intervalMinutes || 60,
    isActive: true,
    lastChecked: null,
    lastContentHash: null,
    lastTextContent: null,
    changeCount: 0,
    lastChangedAt: null,
    createdAt: Date.now(),
    cssSelector: cssSelector || null,
    notifyOnChange: notifyOnChange !== false,
    lastError: null,
    lastChangePreview: null,
  };

  await db.saveWatchedPage(entry);

  // Do an initial check immediately to establish baseline
  try {
    const result = await checkWatchedPage(entry);
    return result.entry || entry;
  } catch {
    return entry;
  }
}

/**
 * Stop watching a URL (delete the entry).
 */
export async function unwatchPage(id) {
  await db.deleteWatchedPage(id);
  return { deleted: id };
}
