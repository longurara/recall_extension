// lib/db.js - IndexedDB wrapper for Recall extension

import {
  DB_NAME,
  DB_VERSION,
  STORE_SNAPSHOTS,
  STORE_SNAPSHOT_DATA,
  STORE_SETTINGS,
  STORE_WATCHED_PAGES,
  STORE_COLLECTIONS,
  STORE_AUTO_TAG_RULES,
  STORE_SESSIONS,
  DEFAULT_SETTINGS,
} from './constants.js';

let dbInstance = null;
let dbOpenPromise = null;

/**
 * Open (or get cached) IndexedDB connection
 */
export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  // Prevent concurrent open attempts: reuse the pending promise
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise((resolve, reject) => {
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

      // ---- v3 -> v4: Collections, Auto-Tag Rules, Read Later indexes ----
      if (oldVersion < 4) {
        // Collections store
        const collStore = db.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id' });
        collStore.createIndex('name', 'name', { unique: false });
        collStore.createIndex('createdAt', 'createdAt', { unique: false });

        // Auto-Tag Rules store
        const ruleStore = db.createObjectStore(STORE_AUTO_TAG_RULES, { keyPath: 'id' });
        ruleStore.createIndex('domain', 'domain', { unique: false });

        // Add new indexes to existing snapshots store
        const tx = event.target.transaction;
        const snapStore = tx.objectStore(STORE_SNAPSHOTS);
        if (!snapStore.indexNames.contains('isReadLater')) {
          snapStore.createIndex('isReadLater', 'isReadLater', { unique: false });
        }
        if (!snapStore.indexNames.contains('collectionId')) {
          snapStore.createIndex('collectionId', 'collectionId', { unique: false });
        }
      }

      // ---- v4 -> v5: Sessions store ----
      if (oldVersion < 5) {
        const sessStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        sessStore.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbOpenPromise = null;

      // Handle connection close (e.g., version change from another tab)
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      dbInstance.onerror = () => {
        dbInstance = null;
      };
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      dbOpenPromise = null;
      reject(new Error(`IndexedDB open error: ${event.target.error}`));
    };
  });

  return dbOpenPromise;
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
export async function getAllSnapshots({ includeDeleted = false } = {}) {
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
        if (!includeDeleted && cursor.value.isDeleted) {
          cursor.continue();
          return;
        }
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

      // Skip soft-deleted snapshots
      if (cursor.value.isDeleted) {
        cursor.continue();
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
      (s.title || '').toLowerCase().includes(q) ||
      (s.url || '').toLowerCase().includes(q) ||
      (s.domain || '').toLowerCase().includes(q)
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
      const results = request.result
        .filter(s => !s.isDeleted)
        .sort((a, b) => b.timestamp - a.timestamp);
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
      const results = request.result
        .filter(s => !s.isDeleted)
        .sort((a, b) => b.timestamp - a.timestamp);
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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Snapshot not found: ${id}`));
        return;
      }
      const updated = { ...existing, ...updates };
      store.put(updated);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update multiple snapshots with the same partial updates in a single transaction.
 * Non-existent IDs are silently skipped (consistent with batch deleteSnapshots).
 */
export async function updateSnapshots(ids, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing) {
          store.put({ ...existing, ...updates });
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
 * Calculate total storage usage.
 * Uses a cursor to avoid loading all snapshot objects into memory at once.
 */
export async function getStorageUsage() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    let totalSize = 0;
    let count = 0;

    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const s = cursor.value;
        // Exclude soft-deleted snapshots from storage calculation
        if (!s.isDeleted) {
          totalSize += s.snapshotSize || 0;
          count++;
        }
        cursor.continue();
      } else {
        resolve({ totalSize, count });
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ============================================================
// MAINTENANCE / BULK OPERATIONS
// ============================================================

/**
 * Clear all snapshots metadata and data.
 */
export async function clearSnapshotsAndData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SNAPSHOTS, STORE_SNAPSHOT_DATA], 'readwrite');
    tx.objectStore(STORE_SNAPSHOTS).clear();
    tx.objectStore(STORE_SNAPSHOT_DATA).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clear all watched pages.
 */
export async function clearWatchedPages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_WATCHED_PAGES], 'readwrite');
    tx.objectStore(STORE_WATCHED_PAGES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clear settings store.
 */
export async function clearSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SETTINGS], 'readwrite');
    tx.objectStore(STORE_SETTINGS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
        // Skip starred or already-deleted snapshots from auto-cleanup
        if (!cursor.value.isStarred && !cursor.value.isDeleted) {
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
      const results = request.result
        .filter(s => !s.isDeleted)
        .sort((a, b) => a.timestamp - b.timestamp);
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
    if (s && !s.isDeleted) extraSnapshots.push(s);
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
 * Uses a single transaction to avoid race conditions between read and write.
 */
export async function updateWatchedPage(id, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WATCHED_PAGES, 'readwrite');
    const store = tx.objectStore(STORE_WATCHED_PAGES);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Watched page not found: ${id}`));
        return;
      }
      const updated = { ...existing, ...updates };
      store.put(updated);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

// ============================================================
// COLLECTIONS
// ============================================================

/**
 * Create a new collection
 */
export async function createCollection(collection) {
  return withStore(STORE_COLLECTIONS, 'readwrite', (store) => store.put(collection));
}

/**
 * Get all collections
 */
export async function getAllCollections() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COLLECTIONS, 'readonly');
    const store = tx.objectStore(STORE_COLLECTIONS);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a collection by ID
 */
export async function getCollection(id) {
  return withStore(STORE_COLLECTIONS, 'readonly', (store) => store.get(id));
}

/**
 * Update a collection.
 * Uses a single transaction to avoid race conditions between read and write.
 */
export async function updateCollection(id, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COLLECTIONS, 'readwrite');
    const store = tx.objectStore(STORE_COLLECTIONS);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Collection not found: ${id}`));
        return;
      }
      store.put({ ...existing, ...updates });
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete a collection (also removes collectionId from snapshots).
 * Uses a single transaction to batch-update snapshots and delete the collection.
 */
export async function deleteCollection(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SNAPSHOTS, STORE_COLLECTIONS], 'readwrite');
    const snapStore = tx.objectStore(STORE_SNAPSHOTS);
    const collStore = tx.objectStore(STORE_COLLECTIONS);

    // Use collectionId index to find matching snapshots
    const index = snapStore.index('collectionId');
    const request = index.openCursor(IDBKeyRange.only(id));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const updated = { ...cursor.value, collectionId: null };
        cursor.update(updated);
        cursor.continue();
      } else {
        // All snapshots updated, now delete the collection
        collStore.delete(id);
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get snapshots belonging to a collection
 */
export async function getSnapshotsByCollection(collectionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const index = store.index('collectionId');
    const request = index.getAll(collectionId);
    request.onsuccess = () => {
      const results = request.result
        .filter(s => !s.isDeleted)
        .sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add a snapshot to a collection
 */
export async function addToCollection(snapshotId, collectionId) {
  return updateSnapshot(snapshotId, { collectionId });
}

/**
 * Remove a snapshot from its collection
 */
export async function removeFromCollection(snapshotId) {
  return updateSnapshot(snapshotId, { collectionId: null });
}

// ============================================================
// AUTO-TAG RULES
// ============================================================

/**
 * Save an auto-tag rule
 */
export async function saveAutoTagRule(rule) {
  return withStore(STORE_AUTO_TAG_RULES, 'readwrite', (store) => store.put(rule));
}

/**
 * Get all auto-tag rules
 */
export async function getAllAutoTagRules() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUTO_TAG_RULES, 'readonly');
    const store = tx.objectStore(STORE_AUTO_TAG_RULES);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete an auto-tag rule
 */
export async function deleteAutoTagRule(id) {
  return withStore(STORE_AUTO_TAG_RULES, 'readwrite', (store) => store.delete(id));
}

/**
 * Replace all auto-tag rules in a single transaction (clear + put all).
 */
export async function replaceAllAutoTagRules(rules) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUTO_TAG_RULES, 'readwrite');
    const store = tx.objectStore(STORE_AUTO_TAG_RULES);
    store.clear();
    for (const rule of rules) {
      store.put(rule);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// READ LATER
// ============================================================

/**
 * Get all read-later snapshots (sorted by timestamp desc)
 */
export async function getReadLaterSnapshots() {
  const all = await getAllSnapshots();
  return all
    .filter(s => s.isReadLater)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get unread read-later snapshots
 */
export async function getUnreadSnapshots() {
  const readLater = await getReadLaterSnapshots();
  return readLater.filter(s => !s.isRead);
}

// ============================================================
// DASHBOARD / ANALYTICS
// ============================================================

/**
 * Get snapshot counts grouped by date (YYYY-MM-DD)
 */
export async function getSnapshotCountsByDate() {
  const all = await getAllSnapshots();
  const counts = {};
  for (const s of all) {
    const date = new Date(s.timestamp).toISOString().split('T')[0];
    counts[date] = (counts[date] || 0) + 1;
  }
  return counts;
}

/**
 * Get dashboard statistics
 */
export async function getDashboardStats() {
  const all = await getAllSnapshots();
  const now = Date.now();
  const oneDay = 86400000;
  const oneWeek = 7 * oneDay;

  // Total counts
  const totalCount = all.length;
  const todayCount = all.filter(s => now - s.timestamp < oneDay).length;
  const weekCount = all.filter(s => now - s.timestamp < oneWeek).length;

  // Top domains
  const domainMap = new Map();
  for (const s of all) {
    domainMap.set(s.domain, (domainMap.get(s.domain) || 0) + 1);
  }
  const topDomains = Array.from(domainMap.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Storage by domain
  const storageDomainMap = new Map();
  for (const s of all) {
    storageDomainMap.set(s.domain, (storageDomainMap.get(s.domain) || 0) + (s.snapshotSize || 0));
  }
  const storageByDomain = Array.from(storageDomainMap.entries())
    .map(([domain, size]) => ({ domain, size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  // Capture types
  const typeMap = new Map();
  for (const s of all) {
    const t = s.captureType || 'auto';
    typeMap.set(t, (typeMap.get(t) || 0) + 1);
  }
  const captureTypes = Object.fromEntries(typeMap);

  // Snapshots per day (last 30 days)
  const perDay = {};
  for (let i = 0; i < 30; i++) {
    const date = new Date(now - i * oneDay).toISOString().split('T')[0];
    perDay[date] = 0;
  }
  for (const s of all) {
    const date = new Date(s.timestamp).toISOString().split('T')[0];
    if (perDay[date] !== undefined) perDay[date]++;
  }

  // Read later stats
  const readLaterCount = all.filter(s => s.isReadLater).length;
  const unreadCount = all.filter(s => s.isReadLater && !s.isRead).length;

  return {
    totalCount,
    todayCount,
    weekCount,
    topDomains,
    storageByDomain,
    captureTypes,
    perDay,
    readLaterCount,
    unreadCount,
  };
}

// ============================================================
// Sessions
// ============================================================

export async function saveSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const req = tx.objectStore(STORE_SESSIONS).getAll();
    req.onsuccess = () => {
      const sessions = req.result || [];
      sessions.sort((a, b) => b.savedAt - a.savedAt);
      resolve(sessions);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearOldSessions(keepCount = 20) {
  const sessions = await getAllSessions();
  if (sessions.length <= keepCount) return;
  const toDelete = sessions.slice(keepCount);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);
    for (const s of toDelete) store.delete(s.id);
    tx.oncomplete = () => resolve(toDelete.length);
    tx.onerror = () => reject(tx.error);
  });
}
