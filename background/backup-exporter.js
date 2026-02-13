// background/backup-exporter.js - Export all snapshots to a ZIP backup

import * as db from '../lib/db.js';
import { DB_VERSION } from '../lib/constants.js';
import { zipEntries, strToUint8 } from '../lib/zip.js';

async function blobToUint8(blob) {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

async function blobToDataUrl(blob) {
  const bytes = await blobToUint8(blob);
  // Use chunk-based approach to avoid O(n²) string concatenation
  const chunkSize = 8192;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(chunks.join(''))}`;
}

function createObjectUrlSafe(blob) {
  const URL_ = (typeof self !== 'undefined' && self.URL) ? self.URL : (typeof URL !== 'undefined' ? URL : null);
  if (URL_ && typeof URL_.createObjectURL === 'function') {
    return URL_.createObjectURL(blob);
  }
  return null;
}

function findEndOfCentralDir(bytes) {
  const sig = 0x06054b50;
  // EOCD is at least 22 bytes, search last 64KB
  const start = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      const view = new DataView(bytes.buffer, i, 22);
      if (view.getUint32(0, true) === sig) return i;
    }
  }
  throw new Error('Invalid ZIP: EOCD not found');
}

function parseZipStore(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();

  const eocd = findEndOfCentralDir(bytes);
  const cdCount = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  const entries = [];
  let offset = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid central directory');
    const method = view.getUint16(offset + 10, true);
    if (method !== 0) throw new Error('Only store (no compression) is supported');
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    // Read local header to find data start
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error('Invalid local header');
    const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    entries.push({ name, data });
  }

  return entries;
}

export async function exportBackupZip() {
  const snapshots = await db.getAllSnapshots();
  const settings = await db.getAllSettings();
  const watched = await db.getAllWatchedPages();
  const manifest = chrome.runtime.getManifest();

  const entries = [];

  const totals = {
    snapshots: snapshots.length,
    domBytes: 0,
    deepBytes: 0,
    screenshotBytes: 0,
    textBytes: 0,
  };

  entries.push({
    name: 'manifest.json',
    data: strToUint8(JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appVersion: manifest.version,
      dbVersion: DB_VERSION,
      counts: { snapshots: snapshots.length },
      settings: {
        maxStorageMB: settings.maxStorageMB,
        saveOriginalScreenshots: settings.saveOriginalScreenshots !== false,
      },
    }, null, 2)),
  });

  entries.push({ name: 'settings.json', data: strToUint8(JSON.stringify(settings, null, 2)) });
  entries.push({ name: 'watched-pages.json', data: strToUint8(JSON.stringify(watched, null, 2)) });

  for (const snap of snapshots) {
    const data = await db.getSnapshotData(snap.id);
    const base = `snapshots/${snap.id}/`;

    // Meta (keep thumbnail; leave blobs separate)
    entries.push({
      name: `${base}meta.json`,
      data: strToUint8(JSON.stringify(snap, null, 2)),
    });

    if (data?.domSnapshot) {
      const bytes = await blobToUint8(data.domSnapshot);
      totals.domBytes += bytes.length;
      entries.push({ name: `${base}domSnapshot.gz`, data: bytes });
    }

    if (data?.deepBundle) {
      const bytes = await blobToUint8(data.deepBundle);
      totals.deepBytes += bytes.length;
      entries.push({ name: `${base}deepBundle.gz`, data: bytes });
    }

    if (data?.textContent) {
      const bytes = strToUint8(data.textContent);
      totals.textBytes += bytes.length;
      entries.push({ name: `${base}textContent.txt`, data: bytes });
    }

    if (data?.screenshotBlob instanceof Blob) {
      const bytes = await blobToUint8(data.screenshotBlob);
      totals.screenshotBytes += bytes.length;
      entries.push({ name: `${base}screenshot.jpg`, data: bytes });
    }
  }

  const zipBytes = zipEntries(entries);
  const blob = new Blob([zipBytes], { type: 'application/zip' });

  let url = createObjectUrlSafe(blob);
  if (!url) {
    url = await blobToDataUrl(blob);
  }

  const dateTag = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const filename = `Recall/backup-${dateTag}.zip`;

  await chrome.downloads.download({ url, filename, saveAs: true });

  return {
    filename: filename.split('/').pop(),
    zipSize: zipBytes.length,
    totals,
  };
}

export async function importBackupZip(arrayBuffer, { wipeExisting = true } = {}) {
  const entries = parseZipStore(arrayBuffer);
  const decoder = new TextDecoder();
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw new Error('Backup missing manifest.json');
  const manifest = JSON.parse(decoder.decode(manifestEntry.data));

  // Validate schema version compatibility
  if (manifest.schemaVersion && manifest.schemaVersion > 1) {
    throw new Error(`Unsupported backup schema version: ${manifest.schemaVersion}. This extension supports version 1.`);
  }

  const settingsEntry = entries.find((e) => e.name === 'settings.json');
  const watchedEntry = entries.find((e) => e.name === 'watched-pages.json');

  const settings = settingsEntry ? JSON.parse(decoder.decode(settingsEntry.data)) : null;
  const watchedPages = watchedEntry ? JSON.parse(decoder.decode(watchedEntry.data)) : [];

  if (wipeExisting) {
    await db.clearSnapshotsAndData();
    await db.clearWatchedPages();
    await db.clearSettings();
  }

  if (settings) {
    await db.saveSettings(settings);
  }

  if (Array.isArray(watchedPages) && watchedPages.length > 0) {
    for (const w of watchedPages) {
      await db.saveWatchedPage(w);
    }
  }

  // Snapshots
  let imported = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.name.endsWith('/meta.json') || !entry.name.startsWith('snapshots/')) continue;
    const base = entry.name.replace(/meta\.json$/, '');

    let snap;
    try {
      snap = JSON.parse(decoder.decode(entry.data));
    } catch (e) {
      console.warn(`[Recall] Skipping corrupted snapshot entry: ${entry.name}`, e);
      skipped++;
      continue;
    }

    // Validate required fields
    if (!snap.id || !snap.url) {
      console.warn(`[Recall] Skipping snapshot with missing required fields (id/url): ${entry.name}`);
      skipped++;
      continue;
    }

    // Check for duplicate IDs when not wiping
    if (!wipeExisting) {
      try {
        const existing = await db.getSnapshot(snap.id);
        if (existing) {
          console.warn(`[Recall] Skipping duplicate snapshot ID: ${snap.id}`);
          skipped++;
          continue;
        }
      } catch { /* proceed */ }
    }

    const dom = entries.find((e) => e.name === `${base}domSnapshot.gz`);
    const deep = entries.find((e) => e.name === `${base}deepBundle.gz`);
    const text = entries.find((e) => e.name === `${base}textContent.txt`);
    const screenshot = entries.find((e) => e.name === `${base}screenshot.jpg`);

    const snapshotData = {
      id: snap.id,
      domSnapshot: dom ? new Blob([dom.data], { type: 'application/gzip' }) : null,
      deepBundle: deep ? new Blob([deep.data], { type: 'application/gzip' }) : null,
      textContent: text ? decoder.decode(text.data) : '',
      screenshotBlob: screenshot ? new Blob([screenshot.data], { type: 'image/jpeg' }) : undefined,
    };

    const sizeTotal =
      (snapshotData.domSnapshot?.size || 0) +
      (snapshotData.deepBundle?.size || 0) +
      (snapshotData.screenshotBlob?.size || 0);
    snap.snapshotSize = sizeTotal || snap.snapshotSize || 0;

    try {
      await db.saveSnapshot(snap);
      await db.saveSnapshotData(snapshotData);
      imported += 1;
    } catch (e) {
      console.warn(`[Recall] Failed to import snapshot ${snap.id}:`, e);
      skipped++;
    }
  }

  return {
    manifest,
    imported,
    skipped,
    watchedImported: watchedPages.length,
  };
}
