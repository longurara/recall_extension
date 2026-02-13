// settings/settings.js - Settings Page logic

import { MSG, DEFAULT_SETTINGS } from '../lib/constants.js';
import { formatBytes } from '../lib/utils.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';
import { showConfirm, showAlert } from '../lib/dialog.js';

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
  saveOriginalScreenshots: document.getElementById('saveOriginalScreenshots'),
  language: document.getElementById('language'),
  aiRequireConfirm: document.getElementById('aiRequireConfirm'),
  aiBlockedDomains: document.getElementById('aiBlockedDomains'),
};

const saveBar = document.getElementById('save-bar');
const btnExportBackup = document.getElementById('btn-export-backup');
const btnImportBackup = document.getElementById('btn-import-backup');
const inputImportBackup = document.getElementById('input-import-backup');

// ============================================================
// i18n
// ============================================================

const translations = {
  en: {
    'language-label': 'Language',
    'capture-title': 'Capture',
    'autoCapture-label': 'Auto-Capture',
    'autoCapture-desc': 'Automatically capture pages when you visit them.',
    'captureDelay-label': 'Capture Delay',
    'captureDelay-desc': 'Wait time (ms) after page loads before capturing. Higher values help with SPAs.',
    'duplicateWindow-label': 'Duplicate Window',
    'duplicateWindow-desc': 'Skip capturing the same URL if already captured within this time (minutes).',
    'maxSnapshotSize-label': 'Max Snapshot Size (MB)',
    'maxSnapshotSize-desc': 'Skip pages larger than this size after serialization.',
    'storage-title': 'Storage',
    'maxStorage-label': 'Storage Limit (MB)',
    'maxStorage-desc': 'Maximum storage for all snapshots. Set 0 for unlimited (limited by disk space).',
    'autoCleanup-label': 'Auto-Cleanup',
    'autoCleanup-desc': 'Automatically delete oldest non-starred snapshots when storage is nearly full.',
    'cleanupThreshold-label': 'Cleanup Threshold (%)',
    'cleanupThreshold-desc': 'Start auto-cleanup when storage usage reaches this percentage.',
    'autoCleanupDays-label': 'Delete Auto-Captures After (days)',
    'autoCleanupDays-desc': 'Automatically delete auto-captured snapshots older than this many days. Set 0 to disable.',
    'exclusions-title': 'Exclusions',
    'excludeDomains-label': 'Excluded Domains',
    'excludeDomains-desc': 'Pages from these domains will not be auto-captured. One domain per line.',
    'thumbnails-title': 'Thumbnails',
    'thumbnailQuality-label': 'JPEG Quality',
    'thumbnailQuality-desc': 'Thumbnail image quality (0.1 - 1.0). Lower = smaller files.',
    'saveOriginal-label': 'Keep original screenshots',
    'saveOriginal-desc': 'Store full-res screenshots for backup exports. Uses more space.',
    'data-title': 'Data Management',
    'exportBackup-label': 'Export Backup (ZIP)',
    'exportBackup-desc': 'Bundle all snapshots + metadata + screenshots into one ZIP.',
    'exportMeta-label': 'Export Metadata',
    'exportMeta-desc': 'Export metadata only as lightweight JSON.',
    'importBackup-label': 'Import Backup (ZIP)',
    'importBackup-desc': 'Restore all data from an exported ZIP. Replaces current data.',
    'deleteAll-label': 'Delete All Snapshots',
    'deleteAll-desc': 'Permanently delete all captured snapshots. This cannot be undone.',
    'about-title': 'About',
    'about-name': 'Recall - Web Page Snapshots',
    'about-desc': 'Automatically save and recall web pages. View snapshots anytime, even offline.',
    'about-shortcuts': 'Keyboard Shortcuts:',
    'shortcut-capture': 'Capture current page',
    'shortcut-manager': 'Open Manager',
    'unsaved': 'You have unsaved changes',
    'heading-title': 'Recall Settings',
    'heading-desc': 'Configure how Recall captures and stores web page snapshots.',
    'btn-export-backup': 'Export Backup',
    'btn-export-data': 'Export Metadata',
    'btn-import-backup': 'Import Backup',
    'btn-delete-all': 'Delete All',
    'btn-save': 'Save Settings',
    'btn-discard': 'Discard',
  },
  vi: {
    'language-label': 'Ngôn ngữ',
    'capture-title': 'Ghi chụp',
    'autoCapture-label': 'Tự động lưu',
    'autoCapture-desc': 'Tự động chụp trang khi bạn truy cập.',
    'captureDelay-label': 'Độ trễ chụp',
    'captureDelay-desc': 'Thời gian chờ (ms) sau khi trang tải xong trước khi chụp. Tăng lên cho SPA.',
    'duplicateWindow-label': 'Cửa sổ trùng lặp',
    'duplicateWindow-desc': 'Bỏ qua khi URL đã được chụp trong khoảng thời gian này (phút).',
    'maxSnapshotSize-label': 'Kích thước tối đa (MB)',
    'maxSnapshotSize-desc': 'Bỏ qua trang vượt quá kích thước này sau khi serialize.',
    'storage-title': 'Lưu trữ',
    'maxStorage-label': 'Giới hạn lưu trữ (MB)',
    'maxStorage-desc': 'Giới hạn tổng dung lượng. Đặt 0 để không giới hạn (tùy ổ đĩa).',
    'autoCleanup-label': 'Tự dọn dẹp',
    'autoCleanup-desc': 'Tự động xóa bản chụp cũ không gắn sao khi gần đầy dung lượng.',
    'cleanupThreshold-label': 'Ngưỡng dọn dẹp (%)',
    'cleanupThreshold-desc': 'Bắt đầu dọn khi dùng tới tỷ lệ này.',
    'autoCleanupDays-label': 'Xóa tự động sau (ngày)',
    'autoCleanupDays-desc': 'Xóa bản chụp tự động cũ hơn số ngày này. Đặt 0 để tắt.',
    'exclusions-title': 'Loại trừ',
    'excludeDomains-label': 'Tên miền loại trừ',
    'excludeDomains-desc': 'Không tự chụp các tên miền này. Mỗi dòng một domain.',
    'thumbnails-title': 'Ảnh thu nhỏ',
    'thumbnailQuality-label': 'Chất lượng JPEG',
    'thumbnailQuality-desc': 'Chất lượng ảnh (0.1 - 1.0). Thấp hơn = dung lượng nhỏ hơn.',
    'saveOriginal-label': 'Giữ ảnh gốc',
    'saveOriginal-desc': 'Lưu ảnh chụp màn hình gốc để xuất backup. Tốn thêm dung lượng.',
    'data-title': 'Quản lý dữ liệu',
    'exportBackup-label': 'Xuất backup (ZIP)',
    'exportBackup-desc': 'Gộp toàn bộ snapshot + metadata + ảnh vào một file ZIP.',
    'exportMeta-label': 'Xuất metadata',
    'exportMeta-desc': 'Chỉ xuất metadata dạng JSON nhẹ.',
    'importBackup-label': 'Nhập backup (ZIP)',
    'importBackup-desc': 'Khôi phục toàn bộ dữ liệu từ file ZIP đã xuất. Sẽ thay thế dữ liệu hiện có.',
    'deleteAll-label': 'Xóa toàn bộ snapshot',
    'deleteAll-desc': 'Xóa vĩnh viễn tất cả bản chụp. Không thể hoàn tác.',
    'about-title': 'Giới thiệu',
    'about-name': 'Recall - Lưu trang web',
    'about-desc': 'Tự động lưu và xem lại trang web. Hoạt động ngoại tuyến.',
    'about-shortcuts': 'Phím tắt:',
    'shortcut-capture': 'Chụp trang hiện tại',
    'shortcut-manager': 'Mở trình quản lý',
    'unsaved': 'Bạn có thay đổi chưa lưu',
    'heading-title': 'Cài đặt Recall',
    'heading-desc': 'Điều chỉnh cách Recall chụp và lưu trữ trang web.',
    'btn-export-backup': 'Xuất Backup',
    'btn-export-data': 'Xuất Metadata',
    'btn-import-backup': 'Nhập Backup',
    'btn-delete-all': 'Xóa hết',
    'btn-save': 'Lưu cài đặt',
    'btn-discard': 'Huỷ',
  },
};

function applyTranslations(lang) {
  const dict = translations[lang] || translations.en;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  if (dict['heading-title']) {
    const h = document.getElementById('heading-title');
    if (h) h.textContent = dict['heading-title'];
  }
  if (dict['heading-desc']) {
    const p = document.getElementById('heading-desc');
    if (p) p.textContent = dict['heading-desc'];
  }
}

function tr(key) {
  const lang = fields.language.value || 'en';
  const dict = translations[lang] || translations.en;
  return dict[key] || translations.en[key] || key;
}

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
  fields.saveOriginalScreenshots.checked = !!s.saveOriginalScreenshots;
  fields.language.value = s.language || DEFAULT_SETTINGS.language || 'en';
  applyTranslations(fields.language.value);

  // New settings
  const aiProviderEl = document.getElementById('aiProvider');
  const aiApiKeyEl = document.getElementById('aiApiKey');
  const aiApiEndpointEl = document.getElementById('aiApiEndpoint');
  const rlrEl = document.getElementById('readLaterReminderDays');
  const swEl = document.getElementById('storageWarningEnabled');

  if (aiProviderEl) aiProviderEl.value = s.aiProvider || 'none';
  if (aiApiKeyEl) aiApiKeyEl.value = s.aiApiKey || '';
  if (aiApiEndpointEl) aiApiEndpointEl.value = s.aiApiEndpoint || '';
  if (fields.aiRequireConfirm) fields.aiRequireConfirm.checked = s.aiRequireConfirm !== false;
  if (fields.aiBlockedDomains) fields.aiBlockedDomains.value = (s.aiBlockedDomains || []).join('\n');

  const aiModelEl = document.getElementById('aiModel');
  if (aiModelEl && s.aiModel) {
    // Add saved model as an option if not already present
    const exists = [...aiModelEl.options].some(o => o.value === s.aiModel);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = s.aiModel;
      opt.textContent = s.aiModel;
      aiModelEl.appendChild(opt);
    }
    aiModelEl.value = s.aiModel;
  }
  if (rlrEl) rlrEl.value = s.readLaterReminderDays || 0;
  if (swEl) swEl.checked = s.storageWarningEnabled !== false;

  updateAiVisibility();
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
    saveOriginalScreenshots: fields.saveOriginalScreenshots.checked,
    language: fields.language.value || 'en',
    // New settings
    aiProvider: document.getElementById('aiProvider')?.value || 'none',
    aiApiKey: document.getElementById('aiApiKey')?.value || '',
    aiApiEndpoint: document.getElementById('aiApiEndpoint')?.value || '',
    aiModel: document.getElementById('aiModel')?.value || '',
    readLaterReminderDays: parseInt(document.getElementById('readLaterReminderDays')?.value, 10) || 0,
    storageWarningEnabled: document.getElementById('storageWarningEnabled')?.checked !== false,
    aiRequireConfirm: fields.aiRequireConfirm?.checked !== false,
    aiBlockedDomains: fields.aiBlockedDomains?.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean) || [],
  };
}

function checkChanges() {
  currentSettings = collectValues();
  hasChanges = JSON.stringify(currentSettings) !== JSON.stringify({
    ...originalSettings,
    autoCleanupDays: originalSettings.autoCleanupDays || 0,
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
    showAlert('Failed to save settings: ' + e.message, { type: 'error', title: 'Error' });
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

const btnClearAiKey = document.getElementById('btn-clear-ai-key');
if (btnClearAiKey) {
  btnClearAiKey.addEventListener('click', () => {
    const aiKeyEl = document.getElementById('aiApiKey');
    if (aiKeyEl) {
      aiKeyEl.value = '';
      checkChanges();
    }
  });
}

fields.language.addEventListener('change', () => {
  applyTranslations(fields.language.value);
  checkChanges();
});

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
    showAlert(`Export failed: ${e.message}`, { type: 'error', title: 'Export Failed' });
  }
});

// Export full backup (ZIP)
btnExportBackup.addEventListener('click', async () => {
  const btn = btnExportBackup;
  const originalText = btn.textContent;
  try {
    btn.disabled = true;
    btn.textContent = 'Đang xuất / Exporting...';
    const result = await sendMessage({ type: MSG.EXPORT_BACKUP });
    const sizeText = result?.zipSize ? ` (~${formatBytes(result.zipSize)})` : '';
    showAlert(`Đang tải / Downloading backup ${result?.filename || ''}${sizeText}.\nCó thể mất vài giây nếu dữ liệu lớn.`, { type: 'success', title: 'Export Started' });
  } catch (e) {
    showAlert('Export failed: ' + e.message, { type: 'error', title: 'Export Failed' });
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Import backup (ZIP)
btnImportBackup.addEventListener('click', () => inputImportBackup.click());

inputImportBackup.addEventListener('change', async () => {
  const file = inputImportBackup.files?.[0];
  if (!file) return;

  if (!await showConfirm('Import backup sẽ thay thế dữ liệu hiện có.\nThis will replace existing data. Continue?', { title: 'Import Backup', type: 'danger', confirmText: 'Import', cancelText: 'Cancel' })) return;

  try {
    const buffer = await file.arrayBuffer();
    // ArrayBuffer can't survive chrome.runtime.sendMessage (structured clone serializes
    // it into a plain object). Convert to a plain Array so the service worker can
    // reconstruct the ArrayBuffer from it.
    const bufferArray = Array.from(new Uint8Array(buffer));
    const result = await sendMessage({ type: MSG.IMPORT_BACKUP, bufferArray, wipe: true });
    showAlert(`Đã nhập ${result?.imported || 0} snapshot, watched pages: ${result?.watchedImported || 0}.`, { type: 'success', title: 'Import Complete' });
    await loadSettings();
    await loadStorageUsage();
  } catch (e) {
    showAlert('Import failed: ' + e.message, { type: 'error', title: 'Import Failed' });
  } finally {
    inputImportBackup.value = '';
  }
});

// Delete all
document.getElementById('btn-delete-all').addEventListener('click', async () => {
  if (!await showConfirm('Delete ALL snapshots?\nXóa toàn bộ bản chụp?\nThis cannot be undone.', { title: 'Delete All', type: 'danger', confirmText: 'Delete All', cancelText: 'Cancel' })) return;
  if (!await showConfirm('This will permanently delete all data.\nSẽ xóa vĩnh viễn dữ liệu.', { title: 'Are you sure?', type: 'danger', confirmText: 'Yes, delete everything', cancelText: 'Cancel' })) return;

  try {
    const snapshots = await sendMessage({ type: MSG.GET_SNAPSHOTS });
    const ids = snapshots.map((s) => s.id);
    if (ids.length > 0) {
      await sendMessage({ type: MSG.DELETE_SNAPSHOTS, ids });
    }
    loadStorageUsage();
    showAlert('All snapshots deleted.', { type: 'success', title: 'Done' });
  } catch (e) {
    showAlert('Delete failed: ' + e.message, { type: 'error', title: 'Error' });
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
// Auto-Tag Rules
// ============================================================

let autoTagRules = [];

async function loadAutoTagRules() {
  try {
    const rules = await sendMessage({ type: MSG.GET_AUTO_TAG_RULES });
    autoTagRules = rules || [];
    renderAutoTagRules();
  } catch (e) {
    console.warn('[Settings] Load auto-tag rules failed:', e);
  }
}

function renderAutoTagRules() {
  const container = document.getElementById('auto-tag-rules');
  if (!container) return;

  if (autoTagRules.length === 0) {
    container.innerHTML = '<p class="empty-rules">No auto-tag rules configured.</p>';
    return;
  }

  container.innerHTML = autoTagRules.map((rule, i) => `
    <div class="rule-row">
      <span class="rule-domain">${rule.domain}</span>
      <span class="rule-arrow">→</span>
      <span class="rule-tag">#${rule.tag}</span>
      <button class="btn btn-icon-sm btn-remove-rule" data-index="${i}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-remove-rule').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index, 10);
      autoTagRules.splice(index, 1);
      await sendMessage({ type: MSG.SAVE_AUTO_TAG_RULES, rules: autoTagRules });
      renderAutoTagRules();
    });
  });
}

const btnAddRule = document.getElementById('btn-add-rule');
if (btnAddRule) {
  btnAddRule.addEventListener('click', async () => {
    const domainInput = document.getElementById('new-rule-domain');
    const tagInput = document.getElementById('new-rule-tag');
    const domain = domainInput.value.trim();
    const tag = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9\-_ ]/g, '');

    if (!domain || !tag) {
      showAlert('Please enter both a domain and a tag.', { type: 'warning', title: 'Missing Fields' });
      return;
    }

    autoTagRules.push({ domain, tag });
    await sendMessage({ type: MSG.SAVE_AUTO_TAG_RULES, rules: autoTagRules });
    domainInput.value = '';
    tagInput.value = '';
    renderAutoTagRules();
  });
}

// ============================================================
// AI Provider Config
// ============================================================

function updateAiVisibility() {
  const provider = document.getElementById('aiProvider')?.value || 'none';
  const apiSettings = document.getElementById('ai-api-settings');
  const endpointRow = document.getElementById('ai-endpoint-row');
  const modelRow = document.getElementById('ai-model-row');
  const apiKeyInput = document.getElementById('aiApiKey');

  const needsApiKey = provider === 'openai' || provider === 'custom' || provider === 'google';

  if (apiSettings) {
    apiSettings.classList.toggle('hidden', !needsApiKey);
  }
  if (endpointRow) {
    endpointRow.classList.toggle('hidden', provider !== 'custom');
  }
  if (modelRow) {
    modelRow.classList.toggle('hidden', provider !== 'google' && provider !== 'openai');
  }
  // Dynamic placeholder
  if (apiKeyInput) {
    if (provider === 'google') {
      apiKeyInput.placeholder = 'AIza...';
    } else if (provider === 'openai') {
      apiKeyInput.placeholder = 'sk-...';
    } else {
      apiKeyInput.placeholder = 'API key';
    }
  }
}

const aiProviderEl = document.getElementById('aiProvider');
if (aiProviderEl) {
  aiProviderEl.addEventListener('change', () => {
    updateAiVisibility();
    checkChanges();
  });
}

// Fetch AI Models
async function fetchModels() {
  const provider = document.getElementById('aiProvider')?.value;
  const apiKey = document.getElementById('aiApiKey')?.value;
  const modelSelect = document.getElementById('aiModel');
  const fetchBtn = document.getElementById('btn-fetch-models');

  if (!apiKey) {
    alert('Please enter an API key first.');
    return;
  }
  if (!modelSelect || !fetchBtn) return;

  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Loading...';

  try {
    const result = await sendMessage({ type: MSG.FETCH_AI_MODELS, provider, apiKey });
    const models = result.models || [];

    // Clear existing options
    modelSelect.innerHTML = '<option value="">— Select model —</option>';

    if (models.length === 0) {
      alert('No models found for this API key.');
    } else {
      for (const model of models) {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = model.name || model.id;
        modelSelect.appendChild(opt);
      }
      // Auto-select first model with 'flash' in name, or first model
      const flash = models.find(m => m.id.includes('flash'));
      if (flash) modelSelect.value = flash.id;
      else modelSelect.value = models[0].id;
      checkChanges();
    }
  } catch (e) {
    alert('Failed to fetch models: ' + e.message);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch';
  }
}

const fetchModelsBtn = document.getElementById('btn-fetch-models');
if (fetchModelsBtn) {
  fetchModelsBtn.addEventListener('click', fetchModels);
}

// Auto-fetch models when API key is entered and focus leaves
const aiApiKeyEl2 = document.getElementById('aiApiKey');
if (aiApiKeyEl2) {
  aiApiKeyEl2.addEventListener('blur', () => {
    const provider = document.getElementById('aiProvider')?.value;
    const key = aiApiKeyEl2.value.trim();
    if (key && (provider === 'google' || provider === 'openai')) {
      fetchModels();
    }
  });
}

// Track changes on new settings inputs
['aiApiKey', 'aiApiEndpoint', 'aiModel', 'readLaterReminderDays', 'storageWarningEnabled'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', checkChanges);
    el.addEventListener('change', checkChanges);
  }
});

// ============================================================
// Init
// ============================================================

initTheme();
createThemeToggle(document.getElementById('theme-toggle-container'));

loadSettings();
loadAutoTagRules();
