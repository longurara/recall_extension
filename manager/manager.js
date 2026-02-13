// manager/manager.js - Manager Page logic

import { MSG } from '../lib/constants.js';
import { formatBytes, timeAgo, debounce } from '../lib/utils.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';
import { showConfirm, showAlert } from '../lib/dialog.js';
import { initI18n, applyI18n } from '../lib/i18n.js';

// ============================================================
// State
// ============================================================

let allSnapshots = [];
let filteredSnapshots = [];
let selectedIds = new Set();
let viewMode = 'grid'; // 'grid' | 'list' | 'flow' | 'watch' | 'sessions'
let cachedFlows = null; // cached navigation flows for flow view
let cachedWatchedPages = null; // cached watched pages for watch view

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
// DOM
// ============================================================

const searchInput = document.getElementById('search-input');
const searchContentCheck = document.getElementById('search-content-check');
const filterDomain = document.getElementById('filter-domain');
const filterType = document.getElementById('filter-type');
const filterTag = document.getElementById('filter-tag');
const filterSort = document.getElementById('filter-sort');
const resultCount = document.getElementById('result-count');
const container = document.getElementById('snapshot-container');
const emptyState = document.getElementById('empty-state');
const bulkBar = document.getElementById('bulk-bar');
const selectAll = document.getElementById('select-all');
const selectedCountEl = document.getElementById('selected-count');
const storageFill = document.getElementById('storage-fill');
const storageTextEl = document.getElementById('storage-text');
const totalInfo = document.getElementById('total-info');
const btnCompare = document.getElementById('btn-compare');

// ============================================================
// Data
// ============================================================

async function loadData() {
  try {
    allSnapshots = await sendMessage({ type: MSG.GET_SNAPSHOTS });
    buildDomainFilter();
    buildTagFilter();
    applyFilters();
    loadStorageUsage();
  } catch (e) {
    console.error('[Manager] Load error:', e);
  }
}

async function loadStorageUsage() {
  try {
    const usage = await sendMessage({ type: MSG.GET_STORAGE_USAGE });
    storageFill.style.width = `${Math.min(usage.usagePercent, 100)}%`;
    storageFill.className = 'storage-fill' +
      (usage.isCritical ? ' critical' : usage.isWarning ? ' warning' : '');
    storageTextEl.textContent = `${usage.totalSizeFormatted} / ${usage.maxFormatted} (${usage.usagePercent}%)`;
  } catch { storageTextEl.textContent = 'N/A'; }
}

function buildDomainFilter() {
  const map = new Map();
  for (const s of allSnapshots) map.set(s.domain, (map.get(s.domain) || 0) + 1);

  filterDomain.innerHTML = '<option value="">All domains</option>';
  Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([d, c]) => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `${d} (${c})`;
      filterDomain.appendChild(opt);
    });
}

function buildTagFilter() {
  const tagCounts = new Map();
  for (const s of allSnapshots) {
    if (s.tags && s.tags.length > 0) {
      for (const tag of s.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  filterTag.innerHTML = '<option value="">All tags</option>';
  if (tagCounts.size > 0) {
    const opt = document.createElement('option');
    opt.value = '__untagged__';
    opt.textContent = 'Untagged';
    filterTag.appendChild(opt);
  }
  Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, count]) => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = `${tag} (${count})`;
      filterTag.appendChild(opt);
    });
}

// ============================================================
// Filter & Sort
// ============================================================

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const domain = filterDomain.value;
  const type = filterType.value;
  const tag = filterTag.value;
  const sort = filterSort.value;
  const searchContent = searchContentCheck.checked;

  // If searching content, use the full-text search API
  if (query && searchContent) {
    performContentSearch(query, domain, type, tag, sort);
    return;
  }

  filteredSnapshots = allSnapshots.filter((s) => {
    if (domain && s.domain !== domain) return false;
    if (type && s.captureType !== type) return false;
    if (tag) {
      if (tag === '__untagged__') {
        if (s.tags && s.tags.length > 0) return false;
      } else {
        if (!s.tags || !s.tags.includes(tag)) return false;
      }
    }
    if (query) {
      return s.title.toLowerCase().includes(query) ||
        s.url.toLowerCase().includes(query) ||
        s.domain.toLowerCase().includes(query);
    }
    return true;
  });

  switch (sort) {
    case 'newest': filteredSnapshots.sort((a, b) => b.timestamp - a.timestamp); break;
    case 'oldest': filteredSnapshots.sort((a, b) => a.timestamp - b.timestamp); break;
    case 'largest': filteredSnapshots.sort((a, b) => (b.snapshotSize || 0) - (a.snapshotSize || 0)); break;
    case 'smallest': filteredSnapshots.sort((a, b) => (a.snapshotSize || 0) - (b.snapshotSize || 0)); break;
    case 'title': filteredSnapshots.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
  }

  // Pin: always sort pinned items to the top, preserving existing order within groups
  filteredSnapshots.sort((a, b) => {
    const ap = a.isPinned ? 1 : 0;
    const bp = b.isPinned ? 1 : 0;
    return bp - ap;
  });

  resultCount.textContent = `${filteredSnapshots.length} of ${allSnapshots.length}`;
  totalInfo.textContent = `${allSnapshots.length} snapshots`;

  render();
}

/**
 * Perform full-text content search via the service worker.
 */
async function performContentSearch(query, domain, type, tag, sort) {
  try {
    resultCount.textContent = 'Searching content...';
    let results = await sendMessage({ type: MSG.SEARCH_CONTENT, query });

    // Apply local filters (domain, type, tag) on top
    if (domain) results = results.filter(s => s.domain === domain);
    if (type) results = results.filter(s => s.captureType === type);
    if (tag) {
      if (tag === '__untagged__') {
        results = results.filter(s => !s.tags || s.tags.length === 0);
      } else {
        results = results.filter(s => s.tags && s.tags.includes(tag));
      }
    }

    switch (sort) {
      case 'newest': results.sort((a, b) => b.timestamp - a.timestamp); break;
      case 'oldest': results.sort((a, b) => a.timestamp - b.timestamp); break;
      case 'largest': results.sort((a, b) => (b.snapshotSize || 0) - (a.snapshotSize || 0)); break;
      case 'smallest': results.sort((a, b) => (a.snapshotSize || 0) - (b.snapshotSize || 0)); break;
      case 'title': results.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
    }

    filteredSnapshots = results;
    resultCount.textContent = `${filteredSnapshots.length} matches`;
    render();
  } catch (e) {
    console.error('[Manager] Content search error:', e);
    resultCount.textContent = 'Search failed';
  }
}

// ============================================================
// Rendering
// ============================================================

function render() {
  // Flow view has its own renderer
  if (viewMode === 'flow') {
    renderFlowView();
    return;
  }

  // Watch view has its own renderer
  if (viewMode === 'watch') {
    renderWatchView();
    return;
  }

  // Collections view
  if (viewMode === 'collections') {
    renderCollectionsView();
    return;
  }

  // Reading list view
  if (viewMode === 'readingList') {
    renderReadingListView();
    return;
  }

  // Sessions view
  if (viewMode === 'sessions') {
    renderSessionsView();
    return;
  }

  // Calendar view
  if (viewMode === 'calendar') {
    renderCalendarView();
    return;
  }

  // Trash view
  if (viewMode === 'trash') {
    renderTrashView();
    return;
  }

  if (allSnapshots.length === 0) {
    container.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  container.classList.remove('hidden');
  emptyState.classList.add('hidden');

  container.className = `snapshot-container ${viewMode}-view`;

  const fragment = document.createDocumentFragment();

  for (const snapshot of filteredSnapshots) {
    const el = viewMode === 'grid' ? createGridItem(snapshot) : createListItem(snapshot);
    fragment.appendChild(el);
  }

  container.innerHTML = '';
  container.appendChild(fragment);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function createGridItem(s) {
  const div = document.createElement('div');
  div.className = `grid-item${selectedIds.has(s.id) ? ' selected' : ''}`;
  div.dataset.id = s.id;

  let thumbHtml;
  if (s.thumbnailDataUrl) {
    thumbHtml = `<img class="thumb" src="${s.thumbnailDataUrl}" alt="" loading="lazy">`;
  } else {
    const ch = (s.domain || '?')[0].toUpperCase();
    thumbHtml = `<div class="thumb-placeholder">${ch}</div>`;
  }

  const starHtml = s.isStarred ? '<span class="star-badge">&#9733;</span>' : '';
  const tagsHtml = (s.tags && s.tags.length > 0)
    ? `<div class="item-tags">${s.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const notesIndicator = (s.notes && s.notes.trim()) ? '<span class="notes-indicator" title="Has notes">&#9998;</span>' : '';

  div.innerHTML = `
    <input type="checkbox" class="select-check" ${selectedIds.has(s.id) ? 'checked' : ''}>
    ${starHtml}
    <button class="btn-pin${s.isPinned ? ' pinned' : ''}" title="${s.isPinned ? 'Unpin' : 'Pin to top'}">&#128204;</button>
    ${thumbHtml}
    <div class="item-info">
      <div class="item-title">${escapeHtml(s.title || 'Untitled')}</div>
      <div class="item-meta">
        <span class="item-domain">${escapeHtml(s.domain)}</span>
        <span class="type-badge ${s.captureType || 'auto'}">${s.captureType || 'auto'}</span>
      </div>
      ${tagsHtml}
      <div class="item-bottom">
        <span>${timeAgo(s.timestamp)}</span>
        <span>${formatBytes(s.snapshotSize || 0)}</span>
        ${notesIndicator}
        <button class="btn-tag-edit" title="Edit tags">+tag</button>
      </div>
    </div>
  `;

  // Click: open viewer
  div.addEventListener('click', (e) => {
    if (e.target.classList.contains('select-check')) {
      toggleSelect(s.id, e.target.checked);
      return;
    }
    if (e.target.classList.contains('btn-tag-edit')) {
      e.stopPropagation();
      showTagEditor(s);
      return;
    }
    if (e.target.closest('.btn-pin')) {
      e.stopPropagation();
      togglePin(s);
      return;
    }
    if (selectedIds.size > 0) {
      toggleSelect(s.id);
      return;
    }
    openSnapshot(s.id);
  });

  // Right-click: select
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    toggleSelect(s.id);
  });

  return div;
}

function createListItem(s) {
  const div = document.createElement('div');
  div.className = `list-item${selectedIds.has(s.id) ? ' selected' : ''}`;
  div.dataset.id = s.id;

  let thumbHtml;
  if (s.thumbnailDataUrl) {
    thumbHtml = `<img class="list-thumb" src="${s.thumbnailDataUrl}" alt="" loading="lazy">`;
  } else {
    thumbHtml = `<div class="list-thumb" style="display:flex;align-items:center;justify-content:center;color:#ccc;font-size:16px">${(s.domain || '?')[0].toUpperCase()}</div>`;
  }

  const starStr = s.isStarred ? '&#9733; ' : '';

  div.innerHTML = `
    <input type="checkbox" class="select-check" ${selectedIds.has(s.id) ? 'checked' : ''}>
    ${thumbHtml}
    <div class="list-info">
      <div class="list-title">${starStr}${escapeHtml(s.title || 'Untitled')}</div>
      <div class="list-url">${escapeHtml(s.url)}</div>
    </div>
    <div class="list-meta">
      <span class="type-badge ${s.captureType || 'auto'}">${s.captureType || 'auto'}</span>
      <span>${timeAgo(s.timestamp)}</span>
      <span>${formatBytes(s.snapshotSize || 0)}</span>
    </div>
  `;

  div.addEventListener('click', (e) => {
    if (e.target.classList.contains('select-check')) {
      toggleSelect(s.id, e.target.checked);
      return;
    }
    if (selectedIds.size > 0) {
      toggleSelect(s.id);
      return;
    }
    openSnapshot(s.id);
  });

  return div;
}

// ============================================================
// Flow View
// ============================================================

async function loadFlows() {
  try {
    cachedFlows = await sendMessage({ type: MSG.GET_NAVIGATION_FLOWS });
  } catch (e) {
    console.error('[Manager] Load flows error:', e);
    cachedFlows = [];
  }
}

function renderFlowView() {
  container.classList.remove('hidden');
  emptyState.classList.add('hidden');
  container.className = 'snapshot-container flow-view';

  if (!cachedFlows || cachedFlows.length === 0) {
    container.innerHTML = `
      <div class="flow-empty">
        <h3>No navigation flows yet</h3>
        <p>Flows appear when you browse multiple pages in the same tab. Navigate A &rarr; B &rarr; C and they'll be grouped automatically.</p>
      </div>
    `;
    resultCount.textContent = '0 flows';
    return;
  }

  resultCount.textContent = `${cachedFlows.length} flows`;

  const fragment = document.createDocumentFragment();

  for (const flow of cachedFlows) {
    const card = createFlowCard(flow);
    fragment.appendChild(card);
  }

  container.innerHTML = '';
  container.appendChild(fragment);
}

function createFlowCard(flow) {
  const div = document.createElement('div');
  div.className = 'flow-card';

  // Flow header: page count + time range
  const startDate = new Date(flow.startTime);
  const endDate = new Date(flow.endTime);
  const timeStr = timeAgo(flow.endTime);
  const dateStr = startDate.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  div.innerHTML = `
    <div class="flow-header">
      <span class="flow-page-count">${flow.pageCount} pages</span>
      <span class="flow-time">${dateStr} &middot; ${timeStr}</span>
    </div>
    <div class="flow-chain"></div>
  `;

  const chain = div.querySelector('.flow-chain');

  flow.snapshots.forEach((s, idx) => {
    // Snapshot node
    const node = document.createElement('div');
    node.className = 'flow-node';
    node.title = s.url;

    let thumbHtml;
    if (s.thumbnailDataUrl) {
      thumbHtml = `<img class="flow-thumb" src="${s.thumbnailDataUrl}" alt="" loading="lazy">`;
    } else {
      const ch = (s.domain || '?')[0].toUpperCase();
      thumbHtml = `<div class="flow-thumb flow-thumb-placeholder">${ch}</div>`;
    }

    node.innerHTML = `
      ${thumbHtml}
      <div class="flow-node-title">${escapeHtml(s.title || 'Untitled')}</div>
      <div class="flow-node-domain">${escapeHtml(s.domain)}</div>
    `;

    node.addEventListener('click', () => openSnapshot(s.id));
    chain.appendChild(node);

    // Arrow between nodes (not after last)
    if (idx < flow.snapshots.length - 1) {
      const arrow = document.createElement('div');
      arrow.className = 'flow-arrow';
      arrow.innerHTML = `<svg width="20" height="16" viewBox="0 0 20 16" fill="none">
        <path d="M1 8h16M13 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      chain.appendChild(arrow);
    }
  });

  return div;
}

// ============================================================
// Selection
// ============================================================

function toggleSelect(id, force) {
  if (force !== undefined) {
    force ? selectedIds.add(id) : selectedIds.delete(id);
  } else {
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  }
  updateBulkBar();
  render();
}

function updateBulkBar() {
  if (selectedIds.size > 0) {
    bulkBar.classList.remove('hidden');
    selectedCountEl.textContent = `${selectedIds.size} selected`;
    selectAll.checked = selectedIds.size === filteredSnapshots.length;
    // Show Compare button only when exactly 2 are selected
    if (selectedIds.size === 2) {
      btnCompare.classList.remove('hidden');
    } else {
      btnCompare.classList.add('hidden');
    }
  } else {
    bulkBar.classList.add('hidden');
    btnCompare.classList.add('hidden');
  }
}

// ============================================================
// Actions
// ============================================================

function openSnapshot(id) {
  sendMessage({ type: MSG.OPEN_VIEWER, id }).catch(console.error);
}

async function deleteSelected() {
  if (selectedIds.size === 0) return;
  if (!await showConfirm(`Delete ${selectedIds.size} snapshot(s)?\nThis cannot be undone.`, { title: 'Delete Snapshots', type: 'danger', confirmText: 'Delete', cancelText: 'Cancel' })) return;

  try {
    await sendMessage({ type: MSG.DELETE_SNAPSHOTS, ids: Array.from(selectedIds) });
    allSnapshots = allSnapshots.filter((s) => !selectedIds.has(s.id));
    selectedIds.clear();
    updateBulkBar();
    buildDomainFilter();
    applyFilters();
    loadStorageUsage();
  } catch (e) {
    console.error('[Manager] Delete error:', e);
    showAlert('Failed to delete: ' + e.message, { type: 'error', title: 'Error' });
  }
}

function openCompare() {
  if (selectedIds.size !== 2) return;
  const [leftId, rightId] = Array.from(selectedIds);
  const diffUrl = chrome.runtime.getURL(`diff/diff.html?left=${leftId}&right=${rightId}`);
  chrome.tabs.create({ url: diffUrl });
}

const debouncedFilter = debounce(applyFilters, 250);
searchInput.addEventListener('input', debouncedFilter);
searchContentCheck.addEventListener('change', applyFilters);
filterDomain.addEventListener('change', applyFilters);
filterType.addEventListener('change', applyFilters);
filterTag.addEventListener('change', applyFilters);
filterSort.addEventListener('change', applyFilters);

// View toggle
function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('btn-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-list').classList.toggle('active', mode === 'list');
  document.getElementById('btn-flow').classList.toggle('active', mode === 'flow');
  document.getElementById('btn-watch').classList.toggle('active', mode === 'watch');
  document.getElementById('btn-collections').classList.toggle('active', mode === 'collections');
  document.getElementById('btn-reading-list').classList.toggle('active', mode === 'readingList');
  document.getElementById('btn-sessions').classList.toggle('active', mode === 'sessions');
  document.getElementById('btn-calendar').classList.toggle('active', mode === 'calendar');
  document.getElementById('btn-trash').classList.toggle('active', mode === 'trash');

  if (mode === 'flow') {
    loadFlows().then(() => render());
  } else if (mode === 'watch') {
    loadWatchedPages().then(() => render());
  } else if (mode === 'collections') {
    render();
  } else if (mode === 'readingList') {
    render();
  } else if (mode === 'sessions') {
    render();
  } else if (mode === 'calendar') {
    render();
  } else if (mode === 'trash') {
    render();
  } else {
    cachedFlows = null;
    cachedWatchedPages = null;
    render();
  }
}

document.getElementById('btn-grid').addEventListener('click', () => setViewMode('grid'));
document.getElementById('btn-list').addEventListener('click', () => setViewMode('list'));
document.getElementById('btn-flow').addEventListener('click', () => setViewMode('flow'));
document.getElementById('btn-watch').addEventListener('click', () => setViewMode('watch'));
document.getElementById('btn-collections').addEventListener('click', () => setViewMode('collections'));
document.getElementById('btn-reading-list').addEventListener('click', () => setViewMode('readingList'));
document.getElementById('btn-sessions').addEventListener('click', () => setViewMode('sessions'));
document.getElementById('btn-calendar').addEventListener('click', () => setViewMode('calendar'));
document.getElementById('btn-trash').addEventListener('click', () => setViewMode('trash'));

// Bulk actions
selectAll.addEventListener('change', (e) => {
  if (e.target.checked) {
    filteredSnapshots.forEach((s) => selectedIds.add(s.id));
  } else {
    selectedIds.clear();
  }
  updateBulkBar();
  render();
});

document.getElementById('btn-delete-selected').addEventListener('click', deleteSelected);
btnCompare.addEventListener('click', openCompare);

document.getElementById('btn-cancel-select').addEventListener('click', () => {
  selectedIds.clear();
  updateBulkBar();
  render();
});

// Settings
document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
});

// Dashboard
document.getElementById('btn-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// Listen for updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.SNAPSHOT_SAVED || msg.type === MSG.SNAPSHOT_DELETED) {
    loadData();
  }
  if (msg.type === MSG.WATCHED_PAGE_CHANGED) {
    if (viewMode === 'watch') {
      loadWatchedPages().then(() => render());
    }
  }
});

// ============================================================
// Watch View
// ============================================================

async function loadWatchedPages() {
  try {
    cachedWatchedPages = await sendMessage({ type: MSG.GET_WATCHED_PAGES });
  } catch (e) {
    console.error('[Manager] Load watched pages error:', e);
    cachedWatchedPages = [];
  }
}

function renderWatchView() {
  container.classList.remove('hidden');
  emptyState.classList.add('hidden');
  container.className = 'snapshot-container watch-view';

  // Header with add button
  let headerHtml = `
    <div class="watch-header-bar">
      <h3>Watched Pages</h3>
      <button id="btn-add-watch" class="btn btn-primary-sm">+ Watch a Page</button>
    </div>
  `;

  if (!cachedWatchedPages || cachedWatchedPages.length === 0) {
    container.innerHTML = headerHtml + `
      <div class="watch-empty">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path d="M24 10C14 10 4 24 4 24s10 14 20 14 20-14 20-14-10-14-20-14Z" stroke="#ddd" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="24" cy="24" r="6" stroke="#ddd" stroke-width="2"/>
        </svg>
        <h3>No watched pages yet</h3>
        <p>Watch a URL to get notified when its content changes. Great for tracking news, prices, job postings, and more.</p>
      </div>
    `;
    resultCount.textContent = '0 watched';

    container.querySelector('#btn-add-watch').addEventListener('click', showAddWatchDialog);
    return;
  }

  resultCount.textContent = `${cachedWatchedPages.length} watched`;

  const fragment = document.createDocumentFragment();

  // Header
  const headerDiv = document.createElement('div');
  headerDiv.innerHTML = headerHtml;
  fragment.appendChild(headerDiv);

  for (const entry of cachedWatchedPages) {
    fragment.appendChild(createWatchCard(entry));
  }

  container.innerHTML = '';
  container.appendChild(fragment);

  // Attach add-watch button listener
  const addBtn = container.querySelector('#btn-add-watch');
  if (addBtn) addBtn.addEventListener('click', showAddWatchDialog);
}

function createWatchCard(entry) {
  const div = document.createElement('div');
  div.className = `watch-card${entry.isActive ? '' : ' paused'}`;
  div.dataset.id = entry.id;

  const lastCheckedStr = entry.lastChecked ? timeAgo(entry.lastChecked) : 'Never';
  const lastChangedStr = entry.lastChangedAt ? timeAgo(entry.lastChangedAt) : 'No changes';
  const statusClass = entry.lastError ? 'error'
    : entry.lastChangedAt ? 'changed'
      : entry.lastChecked ? 'ok'
        : 'pending';

  const statusLabel = entry.lastError ? 'Error'
    : !entry.isActive ? 'Paused'
      : 'Active';

  const intervalLabel = entry.intervalMinutes < 60
    ? `${entry.intervalMinutes}m`
    : `${Math.round(entry.intervalMinutes / 60)}h`;

  div.innerHTML = `
    <div class="watch-card-header">
      <div class="watch-card-title-row">
        <span class="watch-status-dot ${statusClass}"></span>
        <span class="watch-card-title">${escapeHtml(entry.title || entry.url)}</span>
      </div>
      <div class="watch-card-actions">
        <button class="btn-ghost-sm watch-btn-check" title="Check now">Check</button>
        <button class="btn-ghost-sm watch-btn-toggle" title="${entry.isActive ? 'Pause' : 'Resume'}">${entry.isActive ? 'Pause' : 'Resume'}</button>
        <button class="btn-ghost-sm watch-btn-delete" title="Stop watching">&times;</button>
      </div>
    </div>
    <div class="watch-card-url">${escapeHtml(entry.url)}</div>
    ${entry.cssSelector ? `<div class="watch-card-selector">Selector: ${escapeHtml(entry.cssSelector)}</div>` : ''}
    <div class="watch-card-meta">
      <span class="watch-badge ${statusClass}">${statusLabel}</span>
      <span>Every ${intervalLabel}</span>
      <span>Checked: ${lastCheckedStr}</span>
      <span>Changes: ${entry.changeCount || 0}</span>
      <span>Last change: ${lastChangedStr}</span>
    </div>
    ${entry.lastError ? `<div class="watch-card-error">Error: ${escapeHtml(entry.lastError)}</div>` : ''}
    ${entry.lastChangePreview ? `<div class="watch-card-preview">${escapeHtml(entry.lastChangePreview)}</div>` : ''}
  `;

  // Event handlers
  div.querySelector('.watch-btn-check').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.target;
    btn.textContent = '...';
    btn.disabled = true;
    try {
      const result = await sendMessage({ type: MSG.CHECK_WATCHED_NOW, id: entry.id });
      if (result.changed) {
        btn.textContent = 'Changed!';
      } else if (result.error) {
        btn.textContent = 'Error';
      } else {
        btn.textContent = 'No change';
      }
    } catch (err) {
      btn.textContent = 'Failed';
    }
    setTimeout(() => {
      loadWatchedPages().then(() => render());
    }, 1000);
  });

  div.querySelector('.watch-btn-toggle').addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await sendMessage({ type: MSG.UPDATE_WATCH, id: entry.id, isActive: !entry.isActive });
      loadWatchedPages().then(() => render());
    } catch (err) {
      console.error('[Manager] Toggle watch error:', err);
    }
  });

  div.querySelector('.watch-btn-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!await showConfirm(`Stop watching "${entry.title || entry.url}"?`, { title: 'Stop Watching', type: 'danger', confirmText: 'Stop', cancelText: 'Cancel' })) return;
    try {
      await sendMessage({ type: MSG.UNWATCH_PAGE, id: entry.id });
      loadWatchedPages().then(() => render());
    } catch (err) {
      console.error('[Manager] Unwatch error:', err);
    }
  });

  // Click card to open URL
  div.addEventListener('click', () => {
    chrome.tabs.create({ url: entry.url });
  });

  return div;
}

function showAddWatchDialog() {
  // Remove existing dialog if any
  const existing = document.querySelector('.watch-dialog-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'watch-dialog-overlay';

  overlay.innerHTML = `
    <div class="watch-dialog">
      <div class="watch-dialog-header">
        <h3>Watch a Page</h3>
        <p class="watch-dialog-subtitle">Get notified when a page's content changes.</p>
      </div>
      <div class="watch-dialog-form">
        <label>
          <span>URL</span>
          <input type="url" class="watch-input" id="watch-url" placeholder="https://example.com/page" autocomplete="off">
        </label>
        <label>
          <span>Check Interval</span>
          <select class="filter-select" id="watch-interval">
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
            <option value="60" selected>Every 1 hour</option>
            <option value="180">Every 3 hours</option>
            <option value="360">Every 6 hours</option>
            <option value="720">Every 12 hours</option>
            <option value="1440">Every 24 hours</option>
          </select>
        </label>
        <label>
          <span>CSS Selector (optional)</span>
          <input type="text" class="watch-input" id="watch-selector" placeholder="#main-content or .article-body" autocomplete="off">
          <small>Only watch a specific part of the page. Leave empty for whole page.</small>
        </label>
        <label class="watch-checkbox-label">
          <input type="checkbox" id="watch-notify" checked>
          <span>Show notification on change</span>
        </label>
      </div>
      <div class="watch-dialog-actions">
        <button class="btn btn-ghost-sm watch-cancel-btn">Cancel</button>
        <button class="btn btn-primary-sm watch-save-btn">Start Watching</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const urlInput = overlay.querySelector('#watch-url');
  const intervalSelect = overlay.querySelector('#watch-interval');
  const selectorInput = overlay.querySelector('#watch-selector');
  const notifyCheck = overlay.querySelector('#watch-notify');
  const saveBtn = overlay.querySelector('.watch-save-btn');
  const cancelBtn = overlay.querySelector('.watch-cancel-btn');

  function closeDialog() {
    overlay.remove();
  }

  cancelBtn.addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  saveBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }

    try {
      new URL(url); // validate
    } catch {
      showAlert('Please enter a valid URL.', { type: 'warning', title: 'Invalid URL' });
      urlInput.focus();
      return;
    }

    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
      await sendMessage({
        type: MSG.WATCH_PAGE,
        url,
        intervalMinutes: parseInt(intervalSelect.value, 10),
        cssSelector: selectorInput.value.trim() || null,
        notifyOnChange: notifyCheck.checked,
      });
      closeDialog();
      loadWatchedPages().then(() => render());
    } catch (err) {
      showAlert('Failed to watch page: ' + err.message, { type: 'error', title: 'Error' });
      saveBtn.textContent = 'Start Watching';
      saveBtn.disabled = false;
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });

  urlInput.focus();
}

// ============================================================
// Tag Editor
// ============================================================

function showTagEditor(snapshot) {
  // Remove existing editor if any
  const existing = document.querySelector('.tag-editor-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'tag-editor-overlay';

  const currentTags = snapshot.tags || [];
  const allTags = getAllUsedTags();

  overlay.innerHTML = `
    <div class="tag-editor">
      <div class="tag-editor-header">
        <h3>Edit Tags</h3>
        <span class="tag-editor-subtitle">${escapeHtml(snapshot.title || 'Untitled')}</span>
      </div>
      <div class="tag-editor-current">
        ${currentTags.map(t =>
    `<span class="tag-chip tag-chip-removable" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <span class="tag-remove">&times;</span></span>`
  ).join('')}
      </div>
      <div class="tag-editor-input-row">
        <input type="text" class="tag-input" placeholder="Add a tag..." list="tag-suggestions" autocomplete="off">
        <button class="btn btn-primary-sm tag-add-btn">Add</button>
      </div>
      <datalist id="tag-suggestions">
        ${allTags.filter(t => !currentTags.includes(t)).map(t => `<option value="${escapeHtml(t)}">`).join('')}
      </datalist>
      <div class="tag-editor-actions">
        <button class="btn btn-ghost-sm tag-done-btn">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const tagInput = overlay.querySelector('.tag-input');
  const addBtn = overlay.querySelector('.tag-add-btn');
  const doneBtn = overlay.querySelector('.tag-done-btn');
  const currentContainer = overlay.querySelector('.tag-editor-current');

  function addTag() {
    const val = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9\-_ ]/g, '');
    if (!val) return;
    if (currentTags.includes(val)) { tagInput.value = ''; return; }

    currentTags.push(val);
    updateTags();
    tagInput.value = '';
    tagInput.focus();
  }

  function removeTag(tag) {
    const idx = currentTags.indexOf(tag);
    if (idx !== -1) currentTags.splice(idx, 1);
    updateTags();
  }

  async function updateTags() {
    // Update local state
    snapshot.tags = [...currentTags];

    // Re-render current tags
    currentContainer.innerHTML = currentTags.map(t =>
      `<span class="tag-chip tag-chip-removable" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <span class="tag-remove">&times;</span></span>`
    ).join('');

    // Save to DB via service worker
    try {
      await sendMessage({ type: MSG.UPDATE_SNAPSHOT_TAGS, id: snapshot.id, tags: currentTags });
    } catch (e) {
      console.error('[Manager] Tag update error:', e);
    }
  }

  currentContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('tag-remove')) {
      const chip = e.target.closest('.tag-chip-removable');
      if (chip) removeTag(chip.dataset.tag);
    }
  });

  addBtn.addEventListener('click', addTag);
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
  });

  function closeEditor() {
    overlay.remove();
    buildTagFilter();
    applyFilters();
  }

  doneBtn.addEventListener('click', closeEditor);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditor();
  });

  tagInput.focus();
}

function getAllUsedTags() {
  const tags = new Set();
  for (const s of allSnapshots) {
    if (s.tags) s.tags.forEach(t => tags.add(t));
  }
  return Array.from(tags).sort();
}

// ============================================================
// Collections View
// ============================================================

async function renderCollectionsView() {
  container.classList.remove('hidden');
  emptyState.classList.add('hidden');
  container.className = 'snapshot-container collections-view';

  try {
    const collections = await sendMessage({ type: MSG.GET_COLLECTIONS });

    if (!collections || collections.length === 0) {
      container.innerHTML = `
        <div class="collections-empty">
          <h3>No collections yet</h3>
          <p>Create your first collection to organize snapshots.</p>
          <button id="btn-create-collection" class="btn btn-primary-sm">+ New Collection</button>
        </div>
      `;
      resultCount.textContent = '0 collections';
      container.querySelector('#btn-create-collection').addEventListener('click', createCollection);
      return;
    }

    resultCount.textContent = `${collections.length} collections`;

    let html = `<div class="collections-header-bar">
      <button id="btn-create-collection" class="btn btn-primary-sm">+ New Collection</button>
    </div>`;

    html += collections.map(c => {
      const count = allSnapshots.filter(s => s.collectionId === c.id).length;
      return `
        <div class="collection-card" data-id="${c.id}">
          <div class="collection-card-info">
            <div class="collection-icon">${c.icon || '📁'}</div>
            <div>
              <div class="collection-name">${escapeHtml(c.name)}</div>
              <div class="collection-count">${count} snapshot${count !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div class="collection-card-actions">
            <button class="btn-ghost-sm btn-delete-collection" data-id="${c.id}" title="Delete">&times;</button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    container.querySelector('#btn-create-collection').addEventListener('click', createCollection);

    container.querySelectorAll('.collection-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-collection')) return;
        // Show snapshots in this collection
        const cId = el.dataset.id;
        filteredSnapshots = allSnapshots.filter(s => s.collectionId === cId);
        setViewMode('grid');
      });
    });

    container.querySelectorAll('.btn-delete-collection').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await showConfirm('Delete this collection?', { title: 'Delete Collection', type: 'danger', confirmText: 'Delete', cancelText: 'Cancel' })) return;
        try {
          await sendMessage({ type: MSG.DELETE_COLLECTION, id: el.dataset.id });
          renderCollectionsView();
        } catch (err) {
          showAlert('Failed to delete: ' + err.message, { type: 'error', title: 'Error' });
        }
      });
    });
  } catch (e) {
    console.error('[Manager] Collections error:', e);
    container.innerHTML = '<p>Error loading collections.</p>';
  }
}

async function createCollection() {
  const name = prompt('Collection name:');
  if (!name || !name.trim()) return;
  try {
    await sendMessage({ type: MSG.CREATE_COLLECTION, name: name.trim() });
    renderCollectionsView();
  } catch (e) {
    showAlert('Error: ' + e.message, { type: 'error', title: 'Error' });
  }
}

// ============================================================
// Reading List View
// ============================================================

async function renderReadingListView() {
  container.classList.remove('hidden');
  emptyState.classList.add('hidden');
  container.className = 'snapshot-container grid-view';

  try {
    const readLaterItems = await sendMessage({ type: MSG.GET_READ_LATER });

    if (!readLaterItems || readLaterItems.length === 0) {
      container.innerHTML = `
        <div class="reading-list-empty">
          <h3>Reading list is empty</h3>
          <p>Save pages for later using the "Read Later" button in the popup or right-click menu.</p>
        </div>
      `;
      resultCount.textContent = '0 saved';
      return;
    }

    resultCount.textContent = `${readLaterItems.length} saved for later`;

    const fragment = document.createDocumentFragment();
    for (const s of readLaterItems) {
      const el = createGridItem(s);
      // Add read/unread indicator
      if (s.isRead) el.classList.add('is-read');
      fragment.appendChild(el);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
  } catch (e) {
    console.error('[Manager] Reading list error:', e);
    container.innerHTML = '<p>Error loading reading list.</p>';
  }
}

// ============================================================
// Sessions View
// ============================================================

async function renderSessionsView() {
  container.classList.remove('hidden');
  emptyState.classList.add('hidden');
  container.className = 'snapshot-container sessions-view';

  try {
    const sessions = await sendMessage({ type: MSG.GET_SESSIONS });

    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div class="sessions-empty">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M8 16h32M8 24h24M8 32h28" stroke="#ddd" stroke-width="2" stroke-linecap="round"/>
            <path d="M36 28l4 4-4 4" stroke="#ddd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h3>No saved sessions yet</h3>
          <p>Sessions are saved automatically every 2 minutes. Reopen the browser to see your previous sessions here.</p>
        </div>
      `;
      resultCount.textContent = '0 sessions';
      return;
    }

    resultCount.textContent = `${sessions.length} sessions`;

    const fragment = document.createDocumentFragment();

    for (const session of sessions) {
      const card = document.createElement('div');
      card.className = 'session-card';
      card.dataset.id = session.id;

      const dateStr = new Date(session.savedAt).toLocaleString();
      const agoStr = timeAgo(session.savedAt);

      card.innerHTML = `
        <div class="session-header">
          <div class="session-info">
            <span class="session-date">${dateStr}</span>
            <span class="session-ago">${agoStr}</span>
            <span class="session-count">${session.tabCount} tab${session.tabCount !== 1 ? 's' : ''} · ${session.windowCount} window${session.windowCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="session-actions">
            <button class="btn btn-primary-sm btn-restore-online" title="Restore Online (open original URLs)">🌐 Online</button>
            <button class="btn btn-secondary-sm btn-restore-offline" title="Restore Offline (open saved snapshots)">💾 Offline</button>
            <button class="btn btn-ghost-sm btn-toggle-tabs" title="Show tabs">▼</button>
            <button class="btn btn-ghost-sm btn-delete-session" title="Delete">&times;</button>
          </div>
        </div>
        <div class="session-tabs hidden">
          ${session.tabs.map((t, i) => `
            <div class="session-tab-row">
              <img class="session-tab-icon" src="${t.favIconUrl || 'icons/icon16.png'}" alt="" width="16" height="16" onerror="this.src='icons/icon16.png'">
              <span class="session-tab-title" title="${escapeHtml(t.url)}">${escapeHtml(t.title || t.url)}</span>
              ${t.pinned ? '<span class="session-pin">📌</span>' : ''}
            </div>
          `).join('')}
        </div>
      `;

      // Toggle tabs list
      card.querySelector('.btn-toggle-tabs').addEventListener('click', (e) => {
        e.stopPropagation();
        const tabsDiv = card.querySelector('.session-tabs');
        const btn = card.querySelector('.btn-toggle-tabs');
        tabsDiv.classList.toggle('hidden');
        btn.textContent = tabsDiv.classList.contains('hidden') ? '▼' : '▲';
      });

      // Restore Online
      card.querySelector('.btn-restore-online').addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.target;
        if (!await showConfirm(`Restore ${session.tabCount} tab(s) online?`, { title: 'Restore Session', confirmText: 'Restore', cancelText: 'Cancel' })) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await sendMessage({ type: MSG.RESTORE_SESSION, sessionId: session.id, mode: 'online' });
          btn.textContent = '✓ Done';
        } catch (err) {
          btn.textContent = 'Failed';
          console.error(err);
        }
      });

      // Restore Offline
      card.querySelector('.btn-restore-offline').addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.target;
        if (!await showConfirm(`Restore ${session.tabCount} tab(s) offline (from snapshots)?`, { title: 'Restore Offline', confirmText: 'Restore', cancelText: 'Cancel' })) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await sendMessage({ type: MSG.RESTORE_SESSION, sessionId: session.id, mode: 'offline' });
          btn.textContent = '✓ Done';
        } catch (err) {
          btn.textContent = 'Failed';
          console.error(err);
        }
      });

      // Delete session
      card.querySelector('.btn-delete-session').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await showConfirm('Delete this session?', { title: 'Delete Session', type: 'danger', confirmText: 'Delete', cancelText: 'Cancel' })) return;
        try {
          await sendMessage({ type: MSG.DELETE_SESSION, id: session.id });
          renderSessionsView();
        } catch (err) {
          showAlert('Failed: ' + err.message, { type: 'error', title: 'Error' });
        }
      });

      fragment.appendChild(card);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
  } catch (e) {
    console.error('[Manager] Sessions error:', e);
    container.innerHTML = '<p>Error loading sessions.</p>';
  }
}

// ============================================================
// Pin Snapshot
// ============================================================

async function togglePin(snapshot) {
  const newPinned = !snapshot.isPinned;
  try {
    await sendMessage({ type: newPinned ? MSG.PIN_SNAPSHOT : MSG.UNPIN_SNAPSHOT, id: snapshot.id });
    snapshot.isPinned = newPinned;
    applyFilters();
  } catch (e) {
    console.error('[Manager] Pin error:', e);
  }
}

// ============================================================
// Calendar View
// ============================================================

let calendarDate = new Date(); // Currently viewed month

function renderCalendarView() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Count snapshots per day
  const dayCounts = {};
  for (const s of allSnapshots) {
    const d = new Date(s.timestamp);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  let html = `
    <div class="calendar-container">
      <div class="calendar-header">
        <button class="btn btn-ghost calendar-nav" id="cal-prev">&larr;</button>
        <h2 class="calendar-title">${monthNames[month]} ${year}</h2>
        <button class="btn btn-ghost calendar-nav" id="cal-next">&rarr;</button>
      </div>
      <div class="calendar-grid">
        <div class="cal-day-header">Sun</div>
        <div class="cal-day-header">Mon</div>
        <div class="cal-day-header">Tue</div>
        <div class="cal-day-header">Wed</div>
        <div class="cal-day-header">Thu</div>
        <div class="cal-day-header">Fri</div>
        <div class="cal-day-header">Sat</div>
  `;

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const count = dayCounts[d] || 0;
    const isToday = (d === today.getDate() && month === today.getMonth() && year === today.getFullYear());
    const hasSnaps = count > 0;

    html += `
      <div class="cal-day${isToday ? ' today' : ''}${hasSnaps ? ' has-snapshots' : ''}" data-day="${d}">
        <span class="cal-day-num">${d}</span>
        ${count > 0 ? `<span class="cal-count">${count}</span>` : ''}
      </div>
    `;
  }

  html += '</div></div>';

  // Day detail area
  html += '<div id="cal-day-detail" class="cal-day-detail"></div>';

  container.innerHTML = html;
  container.className = 'snapshot-container calendar-view';
  emptyState.classList.add('hidden');

  // Navigation
  container.querySelector('#cal-prev').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendarView();
  });
  container.querySelector('#cal-next').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendarView();
  });

  // Click on day cells
  container.querySelectorAll('.cal-day[data-day]').forEach(cell => {
    cell.addEventListener('click', () => {
      const day = parseInt(cell.dataset.day);
      showDaySnapshots(year, month, day);

      // Highlight selected day
      container.querySelectorAll('.cal-day').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
    });
  });
}

function showDaySnapshots(year, month, day) {
  const detail = container.querySelector('#cal-day-detail');
  const dayStart = new Date(year, month, day).getTime();
  const dayEnd = new Date(year, month, day + 1).getTime();

  const daySnapshots = allSnapshots.filter(s => s.timestamp >= dayStart && s.timestamp < dayEnd);

  if (daySnapshots.length === 0) {
    detail.innerHTML = '<p class="cal-empty">No snapshots on this day</p>';
    return;
  }

  let html = `<h3 class="cal-detail-title">${daySnapshots.length} snapshot${daySnapshots.length > 1 ? 's' : ''} on ${month + 1}/${day}/${year}</h3>`;
  html += '<div class="cal-detail-list">';
  for (const s of daySnapshots) {
    const time = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pinIcon = s.isPinned ? ' 📌' : '';
    html += `
      <div class="cal-detail-item" data-id="${s.id}">
        <span class="cal-detail-time">${time}</span>
        <span class="cal-detail-title-text">${escapeHtml(s.title || 'Untitled')}${pinIcon}</span>
        <span class="cal-detail-domain">${escapeHtml(s.domain)}</span>
        <span class="type-badge ${s.captureType || 'auto'}">${s.captureType || 'auto'}</span>
      </div>
    `;
  }
  html += '</div>';
  detail.innerHTML = html;

  detail.querySelectorAll('.cal-detail-item').forEach(item => {
    item.addEventListener('click', () => openSnapshot(item.dataset.id));
  });
}

// ============================================================
// Trash View
// ============================================================

async function renderTrashView() {
  container.className = 'snapshot-container trash-view';
  emptyState.classList.add('hidden');

  try {
    const trashItems = await sendMessage({ type: MSG.GET_TRASH });

    if (trashItems.length === 0) {
      container.innerHTML = `
        <div class="trash-empty">
          <svg width="48" height="48" viewBox="0 0 16 16" fill="none" style="opacity:0.3">
            <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M4 4l.8 9a1 1 0 001 .9h4.4a1 1 0 001-.9L12 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h3>Trash is empty</h3>
          <p>Deleted snapshots will appear here for 30 days before being permanently removed.</p>
        </div>
      `;
      return;
    }

    let html = `
      <div class="trash-header">
        <span class="trash-count">${trashItems.length} item${trashItems.length > 1 ? 's' : ''} in trash</span>
        <div class="trash-actions">
          <button class="btn btn-ghost-sm" id="btn-restore-all">Restore All</button>
          <button class="btn btn-danger-sm" id="btn-empty-trash">Empty Trash</button>
        </div>
      </div>
      <div class="trash-list">
    `;

    for (const s of trashItems) {
      const deletedAgo = s.deletedAt ? timeAgo(s.deletedAt) : 'unknown';
      const autoDeleteDate = s.deletedAt ? new Date(s.deletedAt + 30 * 24 * 60 * 60 * 1000).toLocaleDateString() : '';

      html += `
        <div class="trash-item" data-id="${s.id}">
          <div class="trash-item-info">
            <div class="trash-item-title">${escapeHtml(s.title || 'Untitled')}</div>
            <div class="trash-item-meta">
              <span>${escapeHtml(s.domain)}</span>
              <span>Deleted ${deletedAgo}</span>
              ${autoDeleteDate ? `<span class="trash-auto-delete">Auto-delete: ${autoDeleteDate}</span>` : ''}
            </div>
          </div>
          <div class="trash-item-actions">
            <button class="btn btn-ghost-sm btn-restore" data-id="${s.id}">Restore</button>
            <button class="btn btn-danger-sm btn-perm-delete" data-id="${s.id}">Delete Forever</button>
          </div>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;

    // Event listeners
    container.querySelectorAll('.btn-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await sendMessage({ type: MSG.RESTORE_SNAPSHOT, id: btn.dataset.id });
          await loadData();
          renderTrashView();
        } catch (e) {
          showAlert('Restore failed: ' + e.message, { type: 'error', title: 'Error' });
        }
      });
    });

    container.querySelectorAll('.btn-perm-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await showConfirm('Permanently delete this snapshot?\nThis cannot be undone.', { title: 'Delete Forever', type: 'danger', confirmText: 'Delete', cancelText: 'Cancel' })) return;
        try {
          await sendMessage({ type: MSG.PERMANENT_DELETE, id: btn.dataset.id });
          renderTrashView();
        } catch (e) {
          showAlert('Delete failed: ' + e.message, { type: 'error', title: 'Error' });
        }
      });
    });

    const restoreAllBtn = container.querySelector('#btn-restore-all');
    if (restoreAllBtn) {
      restoreAllBtn.addEventListener('click', async () => {
        if (!await showConfirm(`Restore all ${trashItems.length} items?`, { title: 'Restore All', confirmText: 'Restore', cancelText: 'Cancel' })) return;
        try {
          await sendMessage({ type: MSG.RESTORE_SNAPSHOT, ids: trashItems.map(s => s.id) });
          await loadData();
          renderTrashView();
        } catch (e) {
          showAlert('Restore failed: ' + e.message, { type: 'error', title: 'Error' });
        }
      });
    }

    const emptyTrashBtn = container.querySelector('#btn-empty-trash');
    if (emptyTrashBtn) {
      emptyTrashBtn.addEventListener('click', async () => {
        if (!await showConfirm(`Permanently delete all ${trashItems.length} items?\nThis cannot be undone.`, { title: 'Empty Trash', type: 'danger', confirmText: 'Empty Trash', cancelText: 'Cancel' })) return;
        try {
          await sendMessage({ type: MSG.EMPTY_TRASH });
          renderTrashView();
        } catch (e) {
          showAlert('Empty trash failed: ' + e.message, { type: 'error', title: 'Error' });
        }
      });
    }
  } catch (e) {
    console.error('[Manager] Trash view error:', e);
    container.innerHTML = '<p>Error loading trash.</p>';
  }
}

// ============================================================
// Init
// ============================================================

initTheme();
createThemeToggle(document.querySelector('.topbar-right'));
initI18n().then(() => applyI18n());
loadData();

// Auto-switch to sessions view if opened via notification
if (location.hash === '#sessions') {
  setTimeout(() => setViewMode('sessions'), 500);
}
