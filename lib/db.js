// lib/db.js - IndexedDB wrapper for Recall extension

import {
  DB_NAME,
  DB_VERSION,
  STORE_SNAPSHOTS,
  STORE_SNAPSHOT_DATA,
  STORE_SETTINGS,
  STORE_WATCHED_PAGES,
  DEFAULT_SETTINGS,
} from './constants.js';

let dbInstance = null;

/**
 * Open (or get cached) IndexedDB connection
 */
export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      // ---- v0 -> v1: Initial schema ----
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('domain', 'domain', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('captureType', 'captureType', { unique: false });
        store.createIndex('isStarred', 'isStarred', { unique: false });

        db.createObjectStore(STORE_SNAPSHOT_DATA, { keyPath: 'id' });
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }

      // ---- v1 -> v2: Navigation flow tracking ----
      if (oldVersion < 2) {
        // Add sessionId index to existing snapshots store
        const tx = event.target.transaction;
        const store = tx.objectStore(STORE_SNAPSHOTS);
        if (!store.indexNames.contains('sessionId')) {
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }
      }

      // ---- v2 -> v3: Watched pages store ----
      if (oldVersion < 3) {
        const watchStore = db.createObjectStore(STORE_WATCHED_PAGES, { keyPath: 'id' });
        watchStore.createIndex('url', 'url', { unique: true });
        watchStore.createIndex('isActive', 'isActive', { unique: false });
        watchStore.createIndex('lastChecked', 'lastChecked', { unique: false });
        watchStore.createIndex('domain', 'domain', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;

      // Handle connection close (e.g., version change from another tab)
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB open error: ${event.target.error}`));
    };
  });
}

/**
 * Generic transaction helper
 */
async function withStore(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);

    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    } else {
      // callback returned something else (e.g., for cursors)
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    }
  });
}

/**
 * Multi-store transaction helper
 */
async function withStores(storeNames, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = {};
    for (const name of storeNames) {
      stores[name] = tx.objectStore(name);
    }

    try {
      const result = callback(stores, tx);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================
// SNAPSHOTS (metadata)
// ============================================================

/**
 * Save snapshot metadata
 */
export async function saveSnapshot(metadata) {
  return withStore(STORE_SNAPSHOTS, 'readwrite', (store) => store.put(metadata));
}

/**
 * Get snapshot metadata by ID
 */
export async function getSnapshot(id) {
  return withStore(STORE_SNAPSHOTS, 'readonly', (store) => store.get(id));
}

/**
 * Get all snapshots, sorted by timestamp descending
 */
export async function getAllSnapshots() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('timestamp');
    const results = [];

    const request = index.openCursor(null, 'prev'); // newest first
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get snapshots with pagination
 */
export async function getSnapshotsPaginated(offset = 0, limit = 50) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('timestamp');
    const results = [];
    let skipped = 0;

    const request = index.openCursor(null, 'prev');
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(results);
        return;
      }

      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }

      if (results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Search snapshots by title or URL
 */
export async function searchSnapshots(query) {
  const all = await getAllSnapshots();
  const q = query.toLowerCase();
  return all.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q) ||
      s.domain.toLowerCase().includes(q)
  );
}

/**
 * Get snapshots filtered by domain
 */
export async function getSnapshotsByDomain(domain) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('domain');
    const request = index.getAll(domain);
    request.onsuccess = () => {
      const results = request.result.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check for recent duplicate (same URL within X minutes)
 */
export async function hasRecentDuplicate(url, withinMinutes = 5) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('url');
    const request = index.getAll(url);
    request.onsuccess = () => {
      const cutoff = Date.now() - withinMinutes * 60 * 1000;
      const recent = request.result.some((s) => s.timestamp > cutoff);
      resolve(recent);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all snapshots for a specific URL, sorted newest first.
 */
export async function getSnapshotsByUrl(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('url');
    const request = index.getAll(url);
    request.onsuccess = () => {
      const results = request.result.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a snapshot (metadata + data)
 */
export async function deleteSnapshot(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SNAPSHOTS, STORE_SNAPSHOT_DATA], 'readwrite');
    tx.objectStore(STORE_SNAPSHOTS).delete(id);
    tx.objectStore(STORE_SNAPSHOT_DATA).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete multiple snapshots
 */
export async function deleteSnapshots(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SNAPSHOTS, STORE_SNAPSHOT_DATA], 'readwrite');
    const metaStore = tx.objectStore(STORE_SNAPSHOTS);
    const dataStore = tx.objectStore(STORE_SNAPSHOT_DATA);

    for (const id of ids) {
      metaStore.delete(id);
      dataStore.delete(id);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update snapshot metadata (partial update)
 */
export async function updateSnapshot(id, updates) {
  const existing = await getSnapshot(id);
  if (!existing) throw new Error(`Snapshot not found: ${id}`);

  const updated = { ...existing, ...updates };
  return saveSnapshot(updated);
}

/**
 * Get total count of snapshots
 */
export async function getSnapshotCount() {
  return withStore(STORE_SNAPSHOTS, 'readonly', (store) => store.count());
}

/**
 * Get all unique domains
 */
export async function getAllDomains() {
  const all = await getAllSnapshots();
  const domains = new Map();
  for (const s of all) {
    if (!domains.has(s.domain)) {
      domains.set(s.domain, 0);
    }
    domains.set(s.domain, domains.get(s.domain) + 1);
  }
  return Array.from(domains.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================
// SNAPSHOT DATA (large blobs)
// ============================================================

/**
 * Save snapshot data (compressed DOM + optional deep bundle)
 */
export async function saveSnapshotData(data) {
  return withStore(STORE_SNAPSHOT_DATA, 'readwrite', (store) => store.put(data));
}

/**
 * Get snapshot data by ID
 */
export async function getSnapshotData(id) {
  return withStore(STORE_SNAPSHOT_DATA, 'readonly', (store) => store.get(id));
}

// ============================================================
// SETTINGS
// ============================================================

/**
 * Get a setting value (with default fallback)
 */
export async function getSetting(key) {
  const result = await withStore(STORE_SETTINGS, 'readonly', (store) => store.get(key));
  if (result) return result.value;
  return DEFAULT_SETTINGS[key] !== undefined ? DEFAULT_SETTINGS[key] : null;
}

/**
 * Get all settings (merged with defaults)
 */
export async function getAllSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);
    const request = store.getAll();
    request.onsuccess = () => {
      const saved = {};
      for (const item of request.result) {
        saved[item.key] = item.value;
      }
      resolve({ ...DEFAULT_SETTINGS, ...saved });
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a setting
 */
export async function saveSetting(key, value) {
  return withStore(STORE_SETTINGS, 'readwrite', (store) => store.put({ key, value }));
}

/**
 * Save multiple settings
 */
export async function saveSettings(settingsObj) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);
    for (const [key, value] of Object.entries(settingsObj)) {
      store.put({ key, value });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// STORAGE USAGE
// ============================================================

/**
 * Calculate total storage usage
 */
export async function getStorageUsage() {
  const all = await getAllSnapshots();
  let totalSize = 0;
  let count = all.length;

  for (const s of all) {
    totalSize += s.snapshotSize || 0;
  }

  return { totalSize, count };
}

/**
 * Get snapshots sorted by size (largest first) for cleanup
 */
export async function getSnapshotsBySize() {
  const all = await getAllSnapshots();
  return all.sort((a, b) => (b.snapshotSize || 0) - (a.snapshotSize || 0));
}

/**
 * Get oldest snapshots for cleanup
 */
export async function getOldestSnapshots(limit = 10) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('timestamp');
    const results = [];

    const request = index.openCursor(null, 'next'); // oldest first
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && results.length < limit) {
        // Skip starred snapshots from auto-cleanup
        if (!cursor.value.isStarred) {
          results.push(cursor.value);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ============================================================
// NAVIGATION FLOWS
// ============================================================

/**
 * Get all snapshots that belong to a given sessionId, ordered by timestamp (oldest first).
 */
export async function getSnapshotsBySessionId(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('sessionId');
    const request = index.getAll(sessionId);
    request.onsuccess = () => {
      const results = request.result.sort((a, b) => a.timestamp - b.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all navigation flows (groups of snapshots sharing a sessionId).
 * Returns an array of flow objects: { sessionId, snapshots: [...], startTime, endTime }
 * Only includes sessions with 2+ snapshots (single-page visits are not flows).
 * Sorted by most recent flow first.
 */
export async function getNavigationFlows() {
  const all = await getAllSnapshots();
  const sessionMap = new Map();

  for (const s of all) {
    if (!s.sessionId) continue;
    if (!sessionMap.has(s.sessionId)) {
      sessionMap.set(s.sessionId, []);
    }
    sessionMap.get(s.sessionId).push(s);
  }

  const flows = [];
  for (const [sessionId, snapshots] of sessionMap) {
    // Only include sessions with 2+ captures (actual navigation chains)
    if (snapshots.length < 2) continue;

    // Sort by timestamp ascending (navigation order)
    snapshots.sort((a, b) => a.timestamp - b.timestamp);

    flows.push({
      sessionId,
      snapshots,
      startTime: snapshots[0].timestamp,
      endTime: snapshots[snapshots.length - 1].timestamp,
      pageCount: snapshots.length,
    });
  }

  // Sort flows by most recent activity first
  flows.sort((a, b) => b.endTime - a.endTime);

  return flows;
}

// ============================================================
// FULL-TEXT SEARCH
// ============================================================

/**
 * Search page content (textContent stored in snapshotData) for a query string.
 * Returns matching snapshot IDs. Uses cursor to avoid loading all data into memory at once.
 */
export async function searchContentForIds(query) {
  const db = await openDB();
  const q = query.toLowerCase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOT_DATA, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOT_DATA);
    const matchingIds = [];

    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        if (record.textContent && record.textContent.toLowerCase().includes(q)) {
          matchingIds.push(record.id);
        }
        cursor.continue();
      } else {
        resolve(matchingIds);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Full-text search: search both metadata (title/url/domain) and page content.
 * Returns metadata objects for matching snapshots.
 */
export async function searchSnapshotsFullText(query) {
  // Run metadata search and content search in parallel
  const [metaResults, contentIds] = await Promise.all([
    searchSnapshots(query),
    searchContentForIds(query),
  ]);

  // Merge results: metadata matches + content-only matches
  const metaIdSet = new Set(metaResults.map(s => s.id));
  const extraIds = contentIds.filter(id => !metaIdSet.has(id));

  if (extraIds.length === 0) return metaResults;

  // Fetch metadata for content-only matches
  const extraSnapshots = [];
  for (const id of extraIds) {
    const s = await getSnapshot(id);
    if (s) extraSnapshots.push(s);
  }

  // Combine and sort by timestamp desc
  const combined = [...metaResults, ...extraSnapshots];
  combined.sort((a, b) => b.timestamp - a.timestamp);
  return combined;
}

// ============================================================
// WATCHED PAGES
// ============================================================

/**
 * Save (create or update) a watched page entry.
 */
export async function saveWatchedPage(entry) {
  return withStore(STORE_WATCHED_PAGES, 'readwrite', (store) => store.put(entry));
}

/**
 * Get a watched page by ID.
 */
export async function getWatchedPage(id) {
  return withStore(STORE_WATCHED_PAGES, 'readonly', (store) => store.get(id));
}

/**
 * Get all watched pages, sorted by createdAt descending.
 */
export async function getAllWatchedPages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WATCHED_PAGES, 'readonly');
    const store = tx.objectStore(STORE_WATCHED_PAGES);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all active watched pages (isActive === true).
 */
export async function getActiveWatchedPages() {
  const all = await getAllWatchedPages();
  return all.filter(w => w.isActive);
}

/**
 * Get a watched page by URL (unique).
 */
export async function getWatchedPageByUrl(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WATCHED_PAGES, 'readonly');
    const store = tx.objectStore(STORE_WATCHED_PAGES);
    const index = store.index('url');
    const request = index.get(url);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a watched page (partial update).
 */
export async function updateWatchedPage(id, updates) {
  const existing = await getWatchedPage(id);
  if (!existing) throw new Error(`Watched page not found: ${id}`);
  const updated = { ...existing, ...updates };
  return saveWatchedPage(updated);
}

/**
 * Delete a watched page by ID.
 */
export async function deleteWatchedPage(id) {
  return withStore(STORE_WATCHED_PAGES, 'readwrite', (store) => store.delete(id));
}

/**
 * Get pages that are due for a check (lastChecked + intervalMinutes < now).
 */
export async function getWatchedPagesDueForCheck() {
  const active = await getActiveWatchedPages();
  const now = Date.now();
  return active.filter(w => {
    const interval = (w.intervalMinutes || 60) * 60 * 1000;
    return !w.lastChecked || (now - w.lastChecked >= interval);
  });
}
