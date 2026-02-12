// sidepanel/sidepanel.js - Side Panel logic

import { MSG } from '../lib/constants.js';
import { formatBytes, timeAgo, debounce, truncate } from '../lib/utils.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';

// ============================================================
// State
// ============================================================

let allSnapshots = [];
let filteredSnapshots = [];
let domains = [];

// ============================================================
// DOM Elements
// ============================================================

const searchInput = document.getElementById('search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const filterDomain = document.getElementById('filter-domain');
const filterSort = document.getElementById('filter-sort');
const snapshotList = document.getElementById('snapshot-list');
const emptyState = document.getElementById('empty-state');
const noResults = document.getElementById('no-results');
const storageFill = document.getElementById('storage-fill');
const storageText = document.getElementById('storage-text');

// ============================================================
// Communication with Service Worker
// ============================================================

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

// ============================================================
// Data Loading
// ============================================================

async function loadSnapshots() {
  try {
    allSnapshots = await sendMessage({ type: MSG.GET_SNAPSHOTS });
    buildDomainFilter();
    applyFilters();
  } catch (e) {
    console.error('[Recall SidePanel] Load error:', e);
  }
}

async function loadStorageUsage() {
  try {
    const usage = await sendMessage({ type: MSG.GET_STORAGE_USAGE });
    storageFill.style.width = `${Math.min(usage.usagePercent, 100)}%`;
    storageFill.className = 'storage-fill' +
      (usage.isCritical ? ' critical' : usage.isWarning ? ' warning' : '');
    storageText.textContent = `${usage.totalSizeFormatted} / ${usage.maxFormatted}`;
  } catch (e) {
    console.error('[Recall SidePanel] Storage usage error:', e);
  }
}

function buildDomainFilter() {
  const domainMap = new Map();
  for (const s of allSnapshots) {
    domainMap.set(s.domain, (domainMap.get(s.domain) || 0) + 1);
  }

  domains = Array.from(domainMap.entries())
    .sort((a, b) => b[1] - a[1]);

  filterDomain.innerHTML = '<option value="">All domains</option>';
  for (const [domain, count] of domains) {
    const opt = document.createElement('option');
    opt.value = domain;
    opt.textContent = `${domain} (${count})`;
    filterDomain.appendChild(opt);
  }
}

// ============================================================
// Filtering & Sorting
// ============================================================

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const domain = filterDomain.value;
  const sort = filterSort.value;

  // Filter
  filteredSnapshots = allSnapshots.filter((s) => {
    if (domain && s.domain !== domain) return false;
    if (query) {
      return (
        s.title.toLowerCase().includes(query) ||
        s.url.toLowerCase().includes(query) ||
        s.domain.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Sort
  switch (sort) {
    case 'newest':
      filteredSnapshots.sort((a, b) => b.timestamp - a.timestamp);
      break;
    case 'oldest':
      filteredSnapshots.sort((a, b) => a.timestamp - b.timestamp);
      break;
    case 'largest':
      filteredSnapshots.sort((a, b) => (b.snapshotSize || 0) - (a.snapshotSize || 0));
      break;
    case 'smallest':
      filteredSnapshots.sort((a, b) => (a.snapshotSize || 0) - (b.snapshotSize || 0));
      break;
    case 'title':
      filteredSnapshots.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
  }

  renderList();
}

// ============================================================
// Rendering
// ============================================================

function renderList() {
  // Show/hide states
  if (allSnapshots.length === 0) {
    snapshotList.classList.add('hidden');
    noResults.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  if (filteredSnapshots.length === 0) {
    snapshotList.classList.add('hidden');
    emptyState.classList.add('hidden');
    noResults.classList.remove('hidden');
    return;
  }

  snapshotList.classList.remove('hidden');
  emptyState.classList.add('hidden');
  noResults.classList.add('hidden');

  // Build HTML
  const fragment = document.createDocumentFragment();

  for (const snapshot of filteredSnapshots) {
    const item = createSnapshotItem(snapshot);
    fragment.appendChild(item);
  }

  snapshotList.innerHTML = '';
  snapshotList.appendChild(fragment);
}

function createSnapshotItem(snapshot) {
  const div = document.createElement('div');
  div.className = 'snapshot-item';
  div.dataset.id = snapshot.id;

  // Thumbnail
  let thumbHtml;
  if (snapshot.thumbnailDataUrl) {
    thumbHtml = `<img class="snapshot-thumb" src="${snapshot.thumbnailDataUrl}" alt="" loading="lazy">`;
  } else {
    const initial = (snapshot.domain || '?')[0].toUpperCase();
    thumbHtml = `<div class="snapshot-thumb-placeholder">${initial}</div>`;
  }

  const starHtml = snapshot.isStarred ? '<span class="star-indicator">&#9733;</span>' : '';

  div.innerHTML = `
    ${thumbHtml}
    <div class="snapshot-info">
      <div class="snapshot-title">${starHtml}${escapeHtml(snapshot.title || 'Untitled')}</div>
      <div class="snapshot-url">${escapeHtml(snapshot.domain)}</div>
      <div class="snapshot-meta">
        <span class="type-badge ${snapshot.captureType || 'auto'}">${snapshot.captureType || 'auto'}</span>
        <span>${timeAgo(snapshot.timestamp)}</span>
        <span>${formatBytes(snapshot.snapshotSize || 0)}</span>
      </div>
    </div>
    <div class="snapshot-actions">
      <button class="btn-action" data-action="open-original" title="Open original">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 3H3v10h10v-3M9 3h4v4M14 2L7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="btn-action danger" data-action="delete" title="Delete">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M4 4l.8 9a1 1 0 001 .9h4.4a1 1 0 001-.9L12 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;

  // Click: open in viewer
  div.addEventListener('click', (e) => {
    // Don't trigger if clicking action buttons
    if (e.target.closest('.snapshot-actions')) return;
    openSnapshot(snapshot.id);
  });

  // Action buttons
  div.querySelector('[data-action="open-original"]').addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.create({ url: snapshot.url });
  });

  div.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSnapshot(snapshot.id);
  });

  return div;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ============================================================
// Actions
// ============================================================

function openSnapshot(id) {
  sendMessage({ type: MSG.OPEN_VIEWER, id }).catch(console.error);
}

async function deleteSnapshot(id) {
  if (!confirm('Delete this snapshot?')) return;

  try {
    await sendMessage({ type: MSG.DELETE_SNAPSHOT, id });
    allSnapshots = allSnapshots.filter((s) => s.id !== id);
    buildDomainFilter();
    applyFilters();
    loadStorageUsage();
  } catch (e) {
    console.error('[Recall SidePanel] Delete error:', e);
  }
}

// ============================================================
// Event Listeners
// ============================================================

// Search
const debouncedFilter = debounce(applyFilters, 200);
searchInput.addEventListener('input', () => {
  btnClearSearch.classList.toggle('hidden', !searchInput.value);
  debouncedFilter();
});

btnClearSearch.addEventListener('click', () => {
  searchInput.value = '';
  btnClearSearch.classList.add('hidden');
  applyFilters();
});

// Filters
filterDomain.addEventListener('change', applyFilters);
filterSort.addEventListener('change', applyFilters);

// Capture button
document.getElementById('btn-capture').addEventListener('click', async () => {
  const btn = document.getElementById('btn-capture');
  btn.disabled = true;
  btn.textContent = 'Capturing...';

  try {
    await sendMessage({ type: MSG.CAPTURE_PAGE });
    // Reload list after a short delay
    setTimeout(async () => {
      await loadSnapshots();
      await loadStorageUsage();
    }, 1000);
  } catch (e) {
    console.error('[Recall SidePanel] Capture error:', e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>
      Capture
    `;
  }
});

// Manager button
document.getElementById('btn-manager').addEventListener('click', () => {
  sendMessage({ type: MSG.OPEN_MANAGER }).catch(console.error);
});

// Settings button
document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('settings/settings.html'),
  });
});

// Listen for snapshot updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.SNAPSHOT_SAVED || message.type === MSG.SNAPSHOT_DELETED) {
    loadSnapshots();
    loadStorageUsage();
  }
});

// ============================================================
// Init
// ============================================================

initTheme();
createThemeToggle(document.getElementById('theme-toggle-container'));

loadSnapshots();
loadStorageUsage();
