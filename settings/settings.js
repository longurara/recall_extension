// settings/settings.js - Settings Page logic

import { MSG, DEFAULT_SETTINGS } from '../lib/constants.js';
import { formatBytes } from '../lib/utils.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';

// ============================================================
// Communication
// ============================================================

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res && res.success) resolve(res.data);
      else reject(new Error(res?.error || 'Unknown error'));
    });
  });
}

// ============================================================
// State
// ============================================================

let originalSettings = {};
let currentSettings = {};
let hasChanges = false;

// ============================================================
// DOM
// ============================================================

const fields = {
  autoCapture: document.getElementById('autoCapture'),
  captureDelay: document.getElementById('captureDelay'),
  duplicateWindowMinutes: document.getElementById('duplicateWindowMinutes'),
  maxSnapshotSizeMB: document.getElementById('maxSnapshotSizeMB'),
  maxStorageMB: document.getElementById('maxStorageMB'),
  autoCleanupEnabled: document.getElementById('autoCleanupEnabled'),
  autoCleanupThreshold: document.getElementById('autoCleanupThreshold'),
  autoCleanupDays: document.getElementById('autoCleanupDays'),
  excludeDomains: document.getElementById('excludeDomains'),
  thumbnailQuality: document.getElementById('thumbnailQuality'),
};

const saveBar = document.getElementById('save-bar');

// ============================================================
// Load
// ============================================================

async function loadSettings() {
  try {
    const settings = await sendMessage({ type: MSG.GET_SETTINGS });
    originalSettings = { ...settings };
    currentSettings = { ...settings };
    populateFields(settings);
  } catch (e) {
    console.error('[Settings] Load error:', e);
    populateFields(DEFAULT_SETTINGS);
  }

  loadStorageUsage();
}

function populateFields(s) {
  fields.autoCapture.checked = s.autoCapture;
  fields.captureDelay.value = s.captureDelay;
  fields.duplicateWindowMinutes.value = s.duplicateWindowMinutes;
  fields.maxSnapshotSizeMB.value = s.maxSnapshotSizeMB;
  fields.maxStorageMB.value = s.maxStorageMB;
  fields.autoCleanupEnabled.checked = s.autoCleanupEnabled;
  fields.autoCleanupThreshold.value = Math.round(s.autoCleanupThreshold * 100);
  fields.autoCleanupDays.value = s.autoCleanupDays || 0;
  fields.excludeDomains.value = (s.excludeDomains || []).join('\n');
  fields.thumbnailQuality.value = s.thumbnailQuality;
}

async function loadStorageUsage() {
  try {
    const usage = await sendMessage({ type: MSG.GET_STORAGE_USAGE });
    const fill = document.getElementById('storage-fill');
    fill.style.width = `${Math.min(usage.usagePercent, 100)}%`;
    fill.className = 'storage-fill' +
      (usage.isCritical ? ' critical' : usage.isWarning ? ' warning' : '');
    document.getElementById('storage-used').textContent = usage.totalSizeFormatted;
    document.getElementById('storage-max').textContent = `/ ${usage.maxFormatted}`;
    document.getElementById('storage-count').textContent = `(${usage.count} snapshots)`;
  } catch { }
}

// ============================================================
// Save
// ============================================================

function collectValues() {
  return {
    autoCapture: fields.autoCapture.checked,
    captureDelay: parseInt(fields.captureDelay.value, 10) || DEFAULT_SETTINGS.captureDelay,
    duplicateWindowMinutes: parseInt(fields.duplicateWindowMinutes.value, 10) || DEFAULT_SETTINGS.duplicateWindowMinutes,
    maxSnapshotSizeMB: parseInt(fields.maxSnapshotSizeMB.value, 10) || DEFAULT_SETTINGS.maxSnapshotSizeMB,
    maxStorageMB: parseInt(fields.maxStorageMB.value, 10),
    autoCleanupEnabled: fields.autoCleanupEnabled.checked,
    autoCleanupThreshold: (parseInt(fields.autoCleanupThreshold.value, 10) || 90) / 100,
    autoCleanupDays: parseInt(fields.autoCleanupDays.value, 10) || 0,
    excludeDomains: fields.excludeDomains.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    thumbnailQuality: parseFloat(fields.thumbnailQuality.value) || DEFAULT_SETTINGS.thumbnailQuality,
  };
}

function checkChanges() {
  currentSettings = collectValues();
  hasChanges = JSON.stringify(currentSettings) !== JSON.stringify({
    autoCapture: originalSettings.autoCapture,
    captureDelay: originalSettings.captureDelay,
    duplicateWindowMinutes: originalSettings.duplicateWindowMinutes,
    maxSnapshotSizeMB: originalSettings.maxSnapshotSizeMB,
    maxStorageMB: originalSettings.maxStorageMB,
    autoCleanupEnabled: originalSettings.autoCleanupEnabled,
    autoCleanupThreshold: originalSettings.autoCleanupThreshold,
    autoCleanupDays: originalSettings.autoCleanupDays || 0,
    excludeDomains: originalSettings.excludeDomains,
    thumbnailQuality: originalSettings.thumbnailQuality,
  });

  saveBar.classList.toggle('hidden', !hasChanges);
}

async function saveSettings() {
  try {
    const values = collectValues();
    await sendMessage({ type: MSG.UPDATE_SETTINGS, settings: values });
    originalSettings = { ...originalSettings, ...values };
    hasChanges = false;
    saveBar.classList.add('hidden');
    loadStorageUsage(); // Refresh with new max
  } catch (e) {
    console.error('[Settings] Save error:', e);
    alert('Failed to save settings: ' + e.message);
  }
}

function discardChanges() {
  populateFields(originalSettings);
  hasChanges = false;
  saveBar.classList.add('hidden');
}

// ============================================================
// Events
// ============================================================

// Track changes on all inputs
for (const field of Object.values(fields)) {
  field.addEventListener('input', checkChanges);
  field.addEventListener('change', checkChanges);
}

// Save / Discard
document.getElementById('btn-save').addEventListener('click', saveSettings);
document.getElementById('btn-discard').addEventListener('click', discardChanges);

// Export metadata
document.getElementById('btn-export-data').addEventListener('click', async () => {
  try {
    const snapshots = await sendMessage({ type: MSG.GET_SNAPSHOTS });

    // Remove large data URL thumbnails for JSON export
    const exportData = snapshots.map((s) => ({
      ...s,
      thumbnailDataUrl: undefined,
      thumbnailBlob: undefined,
    }));

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `recall-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
});

// Delete all
document.getElementById('btn-delete-all').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete ALL snapshots?\nThis cannot be undone!')) return;
  if (!confirm('This will permanently delete all snapshot data.\n\nType "DELETE" below to confirm.')) return;

  try {
    const snapshots = await sendMessage({ type: MSG.GET_SNAPSHOTS });
    const ids = snapshots.map((s) => s.id);
    if (ids.length > 0) {
      await sendMessage({ type: MSG.DELETE_SNAPSHOTS, ids });
    }
    loadStorageUsage();
    alert('All snapshots deleted.');
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
});

// Keyboard: Ctrl+S to save
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (hasChanges) saveSettings();
  }
});

// ============================================================
// Init
// ============================================================

initTheme();
createThemeToggle(document.getElementById('theme-toggle-container'));

loadSettings();
