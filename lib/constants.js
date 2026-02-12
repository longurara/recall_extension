// lib/constants.js - Shared constants for Recall extension

export const DB_NAME = 'RecallDB';
export const DB_VERSION = 3;

// Store names
export const STORE_SNAPSHOTS = 'snapshots';
export const STORE_SNAPSHOT_DATA = 'snapshotData';
export const STORE_SETTINGS = 'settings';
export const STORE_WATCHED_PAGES = 'watchedPages';

// Capture types
export const CAPTURE_AUTO = 'auto';
export const CAPTURE_MANUAL = 'manual';
export const CAPTURE_DEEP = 'deep';

// Default settings
export const DEFAULT_SETTINGS = {
  maxStorageMB: 2048,           // 2GB default
  autoCapture: true,
  captureDelay: 2000,           // ms to wait after page load
  excludeDomains: [
    'chrome.google.com',
    'chromewebstore.google.com',
    'extensions',
  ],
  excludeProtocols: [
    'chrome:',
    'chrome-extension:',
    'about:',
    'devtools:',
    'edge:',
    'brave:',
    'file:',
    'data:',
    'blob:',
  ],
  thumbnailQuality: 0.6,
  thumbnailMaxWidth: 320,
  thumbnailMaxHeight: 200,
  maxSnapshotSizeMB: 15,        // Skip pages larger than this
  duplicateWindowMinutes: 5,     // Skip same URL within this time
  autoCleanupEnabled: true,
  autoCleanupThreshold: 0.9,     // Clean up when 90% full
  autoCleanupDays: 0,            // Delete auto-captures older than N days (0 = disabled)
  infoBarCollapsed: false,       // Viewer info bar state
};

// Messages
export const MSG = {
  CAPTURE_PAGE: 'CAPTURE_PAGE',
  CAPTURE_DOM: 'CAPTURE_DOM',
  CAPTURE_DOM_RESULT: 'CAPTURE_DOM_RESULT',
  CAPTURE_DEEP: 'CAPTURE_DEEP',
  CAPTURE_STATUS: 'CAPTURE_STATUS',
  GET_SNAPSHOTS: 'GET_SNAPSHOTS',
  GET_SNAPSHOT: 'GET_SNAPSHOT',
  DELETE_SNAPSHOT: 'DELETE_SNAPSHOT',
  DELETE_SNAPSHOTS: 'DELETE_SNAPSHOTS',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_STORAGE_USAGE: 'GET_STORAGE_USAGE',
  EXPORT_MHTML: 'EXPORT_MHTML',
  OPEN_VIEWER: 'OPEN_VIEWER',
  OPEN_MANAGER: 'OPEN_MANAGER',
  SNAPSHOT_SAVED: 'SNAPSHOT_SAVED',
  SNAPSHOT_DELETED: 'SNAPSHOT_DELETED',
  TOGGLE_AUTO_CAPTURE: 'TOGGLE_AUTO_CAPTURE',
  GET_NAVIGATION_FLOWS: 'GET_NAVIGATION_FLOWS',
  GET_FLOW_SNAPSHOTS: 'GET_FLOW_SNAPSHOTS',
  SEARCH_CONTENT: 'SEARCH_CONTENT',
  SPOTLIGHT_SEARCH: 'SPOTLIGHT_SEARCH',
  CHECK_URL_SNAPSHOTS: 'CHECK_URL_SNAPSHOTS',
  UPDATE_SNAPSHOT_TAGS: 'UPDATE_SNAPSHOT_TAGS',
  UPDATE_SNAPSHOT_NOTES: 'UPDATE_SNAPSHOT_NOTES',
  UPDATE_SNAPSHOT_ANNOTATIONS: 'UPDATE_SNAPSHOT_ANNOTATIONS',
  WATCH_PAGE: 'WATCH_PAGE',
  UNWATCH_PAGE: 'UNWATCH_PAGE',
  GET_WATCHED_PAGES: 'GET_WATCHED_PAGES',
  UPDATE_WATCH: 'UPDATE_WATCH',
  CHECK_WATCHED_NOW: 'CHECK_WATCHED_NOW',
  WATCHED_PAGE_CHANGED: 'WATCHED_PAGE_CHANGED',
};

// Badge colors
export const BADGE_COLORS = {
  CAPTURING: '#FF9800',   // Orange
  SUCCESS: '#4CAF50',     // Green
  ERROR: '#F44336',       // Red
  DISABLED: '#9E9E9E',    // Grey
};

// Image placeholder for failed inline
export const PLACEHOLDER_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
  '<rect fill="#f0f0f0" width="100" height="100"/>' +
  '<text fill="#999" font-family="sans-serif" font-size="12" x="50" y="50" text-anchor="middle" dy=".3em">Image</text>' +
  '</svg>'
);
