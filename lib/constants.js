// lib/constants.js - Shared constants for Recall extension

export const DB_NAME = 'RecallDB';
export const DB_VERSION = 5;

// Store names
export const STORE_SNAPSHOTS = 'snapshots';
export const STORE_SNAPSHOT_DATA = 'snapshotData';
export const STORE_SETTINGS = 'settings';
export const STORE_WATCHED_PAGES = 'watchedPages';
export const STORE_COLLECTIONS = 'collections';
export const STORE_AUTO_TAG_RULES = 'autoTagRules';
export const STORE_SESSIONS = 'sessions';

// Capture types
export const CAPTURE_AUTO = 'auto';
export const CAPTURE_MANUAL = 'manual';
export const CAPTURE_DEEP = 'deep';
export const CAPTURE_CLIP = 'clip';
export const CAPTURE_READ_LATER = 'readlater';

// Default settings
export const DEFAULT_SETTINGS = {
  maxStorageMB: 2048,           // 2GB default
  autoCapture: true,
  captureDelay: 2000,           // ms to wait after page load
  language: 'vi',               // UI language preference (vi | en), currently used for labels
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
  saveOriginalScreenshots: true, // Keep full-resolution screenshots for backup/export
  infoBarCollapsed: false,       // Viewer info bar state
  // Feature: Smart Notifications
  readLaterReminderDays: 3,      // Remind after N days if unread (0 = disabled)
  weeklyDigestEnabled: false,    // Weekly summary notification
  storageWarningEnabled: true,   // Warn when storage > 80%
  // Feature: AI Summary
  aiProvider: 'none',           // 'none' | 'basic' | 'openai' | 'google' | 'custom'
  aiApiKey: '',                  // API key for external AI provider
  aiApiEndpoint: '',             // Custom API endpoint
  aiModel: '',                   // Selected AI model (e.g. 'gemini-2.0-flash')
  // Feature: Custom Themes
  themeColor: 'default',        // 'default' | 'ocean' | 'forest' | 'sunset' | 'midnight' | 'rose'
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
  IMPORT_BACKUP: 'IMPORT_BACKUP',
  EXPORT_BACKUP: 'EXPORT_BACKUP',
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

  // Feature: Read Later
  MARK_READ_LATER: 'MARK_READ_LATER',
  MARK_AS_READ: 'MARK_AS_READ',
  GET_READ_LATER: 'GET_READ_LATER',

  // Feature: Collections
  CREATE_COLLECTION: 'CREATE_COLLECTION',
  UPDATE_COLLECTION: 'UPDATE_COLLECTION',
  DELETE_COLLECTION: 'DELETE_COLLECTION',
  GET_COLLECTIONS: 'GET_COLLECTIONS',
  ADD_TO_COLLECTION: 'ADD_TO_COLLECTION',
  REMOVE_FROM_COLLECTION: 'REMOVE_FROM_COLLECTION',
  GET_COLLECTION_SNAPSHOTS: 'GET_COLLECTION_SNAPSHOTS',

  // Feature: Auto-Tagging
  GET_AUTO_TAG_RULES: 'GET_AUTO_TAG_RULES',
  SAVE_AUTO_TAG_RULES: 'SAVE_AUTO_TAG_RULES',

  // Feature: Web Clipper
  CAPTURE_CLIP: 'CAPTURE_CLIP',
  TOGGLE_CLIPPER: 'TOGGLE_CLIPPER',

  // Feature: AI Summary
  GENERATE_SUMMARY: 'GENERATE_SUMMARY',
  GET_SUMMARY: 'GET_SUMMARY',
  FETCH_AI_MODELS: 'FETCH_AI_MODELS',
  SPOTLIGHT_AI_CHAT: 'SPOTLIGHT_AI_CHAT',

  // Feature: Dashboard
  GET_DASHBOARD_STATS: 'GET_DASHBOARD_STATS',

  // Feature: Snapshot Links
  GET_LINKED_SNAPSHOTS: 'GET_LINKED_SNAPSHOTS',

  // Feature: Export standalone
  EXPORT_STANDALONE_HTML: 'EXPORT_STANDALONE_HTML',

  // Feature: Session Restore
  SAVE_SESSION: 'SAVE_SESSION',
  GET_SESSIONS: 'GET_SESSIONS',
  DELETE_SESSION: 'DELETE_SESSION',
  RESTORE_SESSION: 'RESTORE_SESSION',

  // Feature: Progressive Capture
  GET_PROGRESSIVE_CACHE: 'GET_PROGRESSIVE_CACHE',
  CLEAR_PROGRESSIVE_CACHE: 'CLEAR_PROGRESSIVE_CACHE',
  TAB_CLOSING_CAPTURE: 'TAB_CLOSING_CAPTURE',

  // Feature: Pin Snapshot
  PIN_SNAPSHOT: 'PIN_SNAPSHOT',
  UNPIN_SNAPSHOT: 'UNPIN_SNAPSHOT',

  // Feature: Trash / Soft Delete
  GET_TRASH: 'GET_TRASH',
  RESTORE_SNAPSHOT: 'RESTORE_SNAPSHOT',
  EMPTY_TRASH: 'EMPTY_TRASH',
  PERMANENT_DELETE: 'PERMANENT_DELETE',

  // Feature: Save All Tabs
  SAVE_ALL_TABS: 'SAVE_ALL_TABS',
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
