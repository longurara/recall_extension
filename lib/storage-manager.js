// lib/storage-manager.js - Storage quota management for Recall extension

import * as db from './db.js';
import { formatBytes } from './utils.js';
import { DEFAULT_SETTINGS } from './constants.js';

/**
 * StorageManager handles quota tracking, auto-cleanup, and storage stats
 */
export class StorageManager {
  constructor() {
    this._settings = null;
  }

  /**
   * Load settings (cached)
   */
  async getSettings() {
    if (!this._settings) {
      this._settings = await db.getAllSettings();
    }
    return this._settings;
  }

  /**
   * Invalidate settings cache
   */
  invalidateCache() {
    this._settings = null;
  }

  /**
   * Get current storage usage stats
   */
  async getUsageStats() {
    const settings = await this.getSettings();
    const { totalSize, count } = await db.getStorageUsage();
    const maxBytes = settings.maxStorageMB * 1024 * 1024;
    const usagePercent = maxBytes > 0 ? (totalSize / maxBytes) * 100 : 0;

    return {
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      count,
      maxBytes,
      maxFormatted: formatBytes(maxBytes),
      usagePercent: Math.round(usagePercent * 10) / 10,
      isWarning: usagePercent >= 80,
      isCritical: usagePercent >= 90,
      isFull: usagePercent >= 100,
    };
  }

  /**
   * Check if there's room for a new snapshot of given size
   */
  async hasRoom(estimatedSize = 0) {
    const settings = await this.getSettings();
    const { totalSize } = await db.getStorageUsage();
    const maxBytes = settings.maxStorageMB * 1024 * 1024;
    return (totalSize + estimatedSize) <= maxBytes;
  }

  /**
   * Auto-cleanup: delete oldest non-starred snapshots to free space
   * Returns number of deleted snapshots
   */
  async autoCleanup(targetFreeBytes = 0) {
    const settings = await this.getSettings();
    if (!settings.autoCleanupEnabled) return 0;

    const { totalSize } = await db.getStorageUsage();
    const maxBytes = settings.maxStorageMB * 1024 * 1024;
    const threshold = maxBytes * settings.autoCleanupThreshold;

    if (totalSize < threshold && targetFreeBytes === 0) {
      return 0; // Not at threshold yet
    }

    // Calculate how much to free
    const targetSize = maxBytes * 0.8; // Clean down to 80%
    let bytesToFree = Math.max(totalSize - targetSize, targetFreeBytes);

    if (bytesToFree <= 0) return 0;

    // Get oldest non-starred snapshots
    const candidates = await db.getOldestSnapshots(50);
    const idsToDelete = [];
    let freedBytes = 0;

    for (const snapshot of candidates) {
      if (freedBytes >= bytesToFree) break;
      idsToDelete.push(snapshot.id);
      freedBytes += snapshot.snapshotSize || 0;
    }

    if (idsToDelete.length > 0) {
      await db.deleteSnapshots(idsToDelete);
    }

    return idsToDelete.length;
  }

  /**
   * Time-based cleanup: delete auto-captured, non-starred snapshots older than N days.
   * Manual and starred snapshots are always kept.
   * Returns number of deleted snapshots.
   */
  async timeBasedCleanup() {
    const settings = await this.getSettings();
    const days = settings.autoCleanupDays;
    if (!days || days <= 0) return 0;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const all = await db.getAllSnapshots();

    const idsToDelete = [];
    for (const s of all) {
      // Only delete auto-captures that are not starred
      if (
        s.captureType === 'auto' &&
        !s.isStarred &&
        s.timestamp < cutoff
      ) {
        idsToDelete.push(s.id);
      }
    }

    if (idsToDelete.length > 0) {
      await db.deleteSnapshots(idsToDelete);
      console.log(`[Recall] Time-based cleanup: deleted ${idsToDelete.length} snapshots older than ${days} days`);
    }

    return idsToDelete.length;
  }

  /**
   * Check quota and run cleanup if needed
   * Returns { ok, message, cleaned }
   */
  async checkAndCleanup() {
    const stats = await this.getUsageStats();

    if (!stats.isCritical) {
      return { ok: true, message: null, cleaned: 0 };
    }

    const cleaned = await this.autoCleanup();
    const newStats = await this.getUsageStats();

    if (newStats.isFull) {
      return {
        ok: false,
        message: `Storage full (${newStats.totalSizeFormatted} / ${newStats.maxFormatted}). Please delete some snapshots or increase the limit.`,
        cleaned,
      };
    }

    return {
      ok: true,
      message: cleaned > 0
        ? `Auto-cleaned ${cleaned} old snapshots. Usage: ${newStats.totalSizeFormatted} / ${newStats.maxFormatted}`
        : null,
      cleaned,
    };
  }
}

// Singleton instance
export const storageManager = new StorageManager();
