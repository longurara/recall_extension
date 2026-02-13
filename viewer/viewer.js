// viewer/viewer.js - Snapshot Viewer logic

import { MSG } from '../lib/constants.js';
import { formatBytes, formatDate, decompressToString } from '../lib/utils.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';
import { showConfirm, showAlert } from '../lib/dialog.js';
import { initI18n, t, applyI18n } from '../lib/i18n.js';

// ============================================================
// IndexedDB direct access (viewer runs as extension page)
// ============================================================

const DB_NAME = 'RecallDB';
const DB_VERSION = 5;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion;
      if (oldVersion < 1) {
        const store = db.createObjectStore('snapshots', { keyPath: 'id' });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('domain', 'domain', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('captureType', 'captureType', { unique: false });
        store.createIndex('isStarred', 'isStarred', { unique: false });
        db.createObjectStore('snapshotData', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        const tx = e.target.transaction;
        const store = tx.objectStore('snapshots');
        if (!store.indexNames.contains('sessionId')) {
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }
      }
      if (oldVersion < 3) {
        const watchStore = db.createObjectStore('watchedPages', { keyPath: 'id' });
        watchStore.createIndex('url', 'url', { unique: true });
        watchStore.createIndex('isActive', 'isActive', { unique: false });
        watchStore.createIndex('lastChecked', 'lastChecked', { unique: false });
        watchStore.createIndex('domain', 'domain', { unique: false });
      }
      if (oldVersion < 4) {
        const collStore = db.createObjectStore('collections', { keyPath: 'id' });
        collStore.createIndex('name', 'name', { unique: false });
        collStore.createIndex('createdAt', 'createdAt', { unique: false });
        const ruleStore = db.createObjectStore('autoTagRules', { keyPath: 'id' });
        ruleStore.createIndex('domain', 'domain', { unique: false });
        const tx = e.target.transaction;
        const snapStore = tx.objectStore('snapshots');
        if (!snapStore.indexNames.contains('isReadLater')) {
          snapStore.createIndex('isReadLater', 'isReadLater', { unique: false });
        }
        if (!snapStore.indexNames.contains('collectionId')) {
          snapStore.createIndex('collectionId', 'collectionId', { unique: false });
        }
      }
      if (oldVersion < 5) {
        const sessStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessStore.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all snapshots with the given sessionId, sorted by timestamp ascending.
 */
async function dbGetBySessionId(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const store = tx.objectStore('snapshots');
    const index = store.index('sessionId');
    const req = index.getAll(sessionId);
    req.onsuccess = () => {
      const results = req.result.sort((a, b) => a.timestamp - b.timestamp);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// DOM Elements
// ============================================================

const infoBar = document.getElementById('info-bar');
const btnCollapse = document.getElementById('btn-collapse');
const btnExpand = document.getElementById('btn-expand');
const btnOriginal = document.getElementById('btn-original');
const btnExport = document.getElementById('btn-export');
const btnStar = document.getElementById('btn-star');
const btnDelete = document.getElementById('btn-delete');
const btnBack = document.getElementById('btn-back');
const snapshotFrame = document.getElementById('snapshot-frame');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessage = document.getElementById('error-message');

// Flow navigation elements
const btnFlowPrev = document.getElementById('btn-flow-prev');
const btnFlowNext = document.getElementById('btn-flow-next');
const flowPositionEl = document.getElementById('flow-position');
const flowNavSep = document.getElementById('flow-nav-sep');

// Notes elements
const btnNotes = document.getElementById('btn-notes');
const notesPanel = document.getElementById('notes-panel');
const btnCloseNotes = document.getElementById('btn-close-notes');
const notesTextarea = document.getElementById('notes-textarea');
const notesStatus = document.getElementById('notes-status');

// Annotations elements
const btnAnnotations = document.getElementById('btn-annotations');
const annotationsPanel = document.getElementById('annotations-panel');
const btnCloseAnnotations = document.getElementById('btn-close-annotations');
const annotationsList = document.getElementById('annotations-list');
const annotationsEmpty = document.getElementById('annotations-empty');
const annotationToolbar = document.getElementById('annotation-toolbar');

let currentSnapshot = null;
let flowSiblings = []; // ordered list of snapshot IDs in this flow
let flowIndex = -1;    // current position within flowSiblings
let notesSaveTimeout = null;
let highlightQuery = ''; // search query from spotlight for highlighting
let annotations = [];    // saved annotations for this snapshot
let pendingSelection = null; // selection data waiting for color pick

// ============================================================
// Init
// ============================================================

async function init() {
  const params = new URLSearchParams(window.location.search);
  const snapshotId = params.get('id');
  highlightQuery = params.get('q') || '';

  if (!snapshotId) {
    showError('No snapshot ID provided');
    return;
  }

  try {
    // Load metadata
    const metadata = await dbGet('snapshots', snapshotId);
    if (!metadata) {
      showError('Snapshot not found. It may have been deleted.');
      return;
    }

    currentSnapshot = metadata;

    // Update info bar
    renderInfoBar(metadata);

    // Set up flow navigation if snapshot belongs to a session
    await setupFlowNavigation(metadata);

    // Set up notes
    setupNotes(metadata);

    // Set up annotations
    setupAnnotations(metadata);

    // Update page title
    document.title = `Recall - ${metadata.title}`;

    // Load snapshot data
    const data = await dbGet('snapshotData', snapshotId);
    if (!data || !data.domSnapshot) {
      showError('Snapshot data not found. It may be corrupted.');
      return;
    }

    // Decompress and render
    let html;
    try {
      html = await decompressToString(data.domSnapshot);
    } catch {
      // Maybe it's not compressed (older version)
      if (data.domSnapshot instanceof Blob) {
        html = await data.domSnapshot.text();
      } else {
        html = data.domSnapshot;
      }
    }

    // Render in iframe
    renderSnapshot(html, metadata.scrollPosition);

    // Restore info bar state
    const settings = await dbGet('settings', 'infoBarCollapsed');
    if (settings && settings.value) {
      toggleInfoBar(true);
    }
  } catch (error) {
    console.error('[Recall Viewer] Error:', error);
    showError(error.message);
  }
}

// ============================================================
// Rendering
// ============================================================

function renderInfoBar(metadata) {
  // Favicon
  const faviconEl = document.getElementById('favicon');
  if (metadata.favicon) {
    faviconEl.src = metadata.favicon;
    faviconEl.style.display = '';
  } else {
    faviconEl.style.display = 'none';
  }

  // Capture type badge
  const badge = document.getElementById('capture-type-badge');
  badge.textContent = metadata.captureType || 'auto';
  badge.className = `badge ${metadata.captureType || 'auto'}`;

  // URL
  const urlEl = document.getElementById('original-url');
  urlEl.href = metadata.url;
  urlEl.textContent = metadata.url;
  urlEl.title = metadata.url;

  // Title
  document.getElementById('snapshot-title').textContent = metadata.title;

  // Date
  document.getElementById('snapshot-date').textContent = formatDate(metadata.timestamp);

  // Size
  document.getElementById('snapshot-size').textContent = formatBytes(metadata.snapshotSize);

  // Tags
  renderTags(metadata);

  // Star state
  if (metadata.isStarred) {
    btnStar.classList.add('starred');
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function renderTags(metadata) {
  const container = document.getElementById('snapshot-tags');
  const tags = metadata.tags || [];

  let html = tags.map(t =>
    `<span class="viewer-tag">${escapeHtml(t)}</span>`
  ).join('');
  html += `<button class="btn-add-tag" title="Add tag">+</button>`;

  container.innerHTML = html;

  // Add tag button handler
  container.querySelector('.btn-add-tag').addEventListener('click', (e) => {
    e.stopPropagation();
    const tag = prompt('Enter tag name:');
    if (!tag) return;
    const clean = tag.trim().toLowerCase().replace(/[^a-z0-9\-_ ]/g, '');
    if (!clean) return;
    if (tags.includes(clean)) return;

    tags.push(clean);
    metadata.tags = tags;

    // Save to DB
    const meta = { ...metadata };
    dbPut('snapshots', meta).catch(console.error);

    // Notify service worker
    chrome.runtime.sendMessage({
      type: MSG.UPDATE_SNAPSHOT_TAGS,
      id: metadata.id,
      tags: tags,
    }).catch(() => { });

    renderTags(metadata);
  });

  // Tag click to remove
  container.querySelectorAll('.viewer-tag').forEach(el => {
    el.addEventListener('click', () => {
      const tagText = el.textContent;
      const idx = tags.indexOf(tagText);
      if (idx === -1) return;
      tags.splice(idx, 1);
      metadata.tags = tags;

      dbPut('snapshots', { ...metadata }).catch(console.error);
      chrome.runtime.sendMessage({
        type: MSG.UPDATE_SNAPSHOT_TAGS,
        id: metadata.id,
        tags: tags,
      }).catch(() => { });

      renderTags(metadata);
    });
  });
}

/**
 * Strip all executable content from HTML before rendering in sandbox.
 * Uses DOMParser for reliable parsing (not regex) to handle all edge cases.
 */
function sanitizeHtml(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove all <script> tags (including inside <template>, <svg>, etc.)
    for (const script of doc.querySelectorAll('script')) {
      script.remove();
    }

    // Remove all inline event handler attributes (onclick, onerror, onload, etc.)
    for (const el of doc.querySelectorAll('*')) {
      const toRemove = [];
      for (const attr of el.attributes) {
        if (attr.name.toLowerCase().startsWith('on')) {
          toRemove.push(attr.name);
        }
      }
      for (const name of toRemove) {
        el.removeAttribute(name);
      }
    }

    // Remove javascript: URLs from href/src/action attributes
    for (const el of doc.querySelectorAll('[href^="javascript:" i], [src^="javascript:" i], [action^="javascript:" i]')) {
      if (el.hasAttribute('href')) el.setAttribute('href', '#');
      if (el.hasAttribute('src')) el.removeAttribute('src');
      if (el.hasAttribute('action')) el.removeAttribute('action');
    }

    // Reconstruct the full HTML including doctype
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  } catch (e) {
    console.warn('[Recall Viewer] HTML sanitization failed, falling back to regex:', e);
    // Fallback: regex strip (less reliable but better than nothing)
    return html
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }
}

function renderSnapshot(html, scrollPosition = 0) {
  // Sanitize HTML to remove scripts before rendering in sandboxed iframe
  const sanitizedHtml = sanitizeHtml(html);
  snapshotFrame.srcdoc = sanitizedHtml;

  snapshotFrame.onload = () => {
    // If there's a highlight query from spotlight, find and highlight it
    if (highlightQuery) {
      highlightAndScrollToQuery(snapshotFrame, highlightQuery);
    } else if (scrollPosition > 0) {
      // Restore scroll position only if no search query
      try {
        snapshotFrame.contentWindow.scrollTo(0, scrollPosition);
      } catch {
        // Cross-origin restriction
      }
    }

    // Restore saved annotations in the iframe
    restoreAnnotationsInIframe();

    // Listen for text selection in iframe to show annotation toolbar
    setupIframeSelectionListener();

    // Hide loading
    loadingEl.classList.add('fade-out');
    setTimeout(() => {
      loadingEl.classList.add('hidden');
    }, 300);
  };

  // Fallback: hide loading after timeout even if onload doesn't fire
  setTimeout(() => {
    loadingEl.classList.add('hidden');
  }, 5000);
}

/**
 * Highlight all occurrences of a query in the iframe's document and scroll
 * to the first match. Uses TreeWalker to find text nodes, then wraps matches
 * in <mark> elements.
 */
function highlightAndScrollToQuery(iframe, query) {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    if (!doc || !doc.body) return;

    const q = query.toLowerCase();
    const marks = [];

    // Inject highlight styles
    const style = doc.createElement('style');
    style.textContent = `
      .recall-highlight {
        background: #fef08a !important;
        color: #1f2937 !important;
        border-radius: 2px;
        padding: 1px 0;
        box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.4);
      }
      .recall-highlight-active {
        background: #fb923c !important;
        color: #fff !important;
        box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.5);
      }
    `;
    doc.head.appendChild(style);

    // Walk text nodes
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const node of textNodes) {
      const text = node.textContent;
      const lowerText = text.toLowerCase();
      let idx = lowerText.indexOf(q);
      if (idx === -1) continue;

      // Skip invisible nodes
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;

      const fragment = doc.createDocumentFragment();
      let lastEnd = 0;

      while (idx !== -1) {
        // Text before match
        if (idx > lastEnd) {
          fragment.appendChild(doc.createTextNode(text.slice(lastEnd, idx)));
        }

        // Highlighted match
        const mark = doc.createElement('mark');
        mark.className = 'recall-highlight';
        mark.textContent = text.slice(idx, idx + q.length);
        fragment.appendChild(mark);
        marks.push(mark);

        lastEnd = idx + q.length;
        idx = lowerText.indexOf(q, lastEnd);
      }

      // Remaining text
      if (lastEnd < text.length) {
        fragment.appendChild(doc.createTextNode(text.slice(lastEnd)));
      }

      parent.replaceChild(fragment, node);
    }

    // Scroll to first match
    if (marks.length > 0) {
      marks[0].classList.add('recall-highlight-active');
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Show match count indicator
      showHighlightCounter(marks.length);
    }
  } catch (e) {
    console.warn('[Recall Viewer] Highlight failed:', e);
  }
}

/**
 * Show a small floating indicator with the number of matches found.
 */
function showHighlightCounter(count) {
  const counter = document.createElement('div');
  counter.className = 'highlight-counter';
  counter.textContent = `${count} match${count !== 1 ? 'es' : ''} found`;
  document.body.appendChild(counter);

  // Auto-hide after 3 seconds
  setTimeout(() => {
    counter.classList.add('fade-out');
    setTimeout(() => counter.remove(), 500);
  }, 3000);
}

function showError(message) {
  loadingEl.classList.add('hidden');
  errorEl.classList.remove('hidden');
  errorMessage.textContent = message;
}

// ============================================================
// Info Bar Toggle
// ============================================================

function toggleInfoBar(forceCollapse) {
  const collapse = forceCollapse !== undefined ? forceCollapse : !infoBar.classList.contains('collapsed');

  if (collapse) {
    infoBar.classList.add('collapsed');
    btnExpand.classList.remove('hidden');
  } else {
    infoBar.classList.remove('collapsed');
    btnExpand.classList.add('hidden');
  }

  // Save preference
  dbPut('settings', { key: 'infoBarCollapsed', value: collapse }).catch(() => { });
}

// ============================================================
// Flow Navigation
// ============================================================

async function setupFlowNavigation(metadata) {
  if (!metadata.sessionId) return;

  try {
    const siblings = await dbGetBySessionId(metadata.sessionId);
    if (siblings.length < 2) return; // not a real flow

    flowSiblings = siblings.map(s => s.id);
    flowIndex = flowSiblings.indexOf(metadata.id);
    if (flowIndex === -1) return;

    // Show flow nav UI
    btnFlowPrev.classList.remove('hidden');
    btnFlowNext.classList.remove('hidden');
    flowPositionEl.classList.remove('hidden');
    flowNavSep.classList.remove('hidden');

    // Update state
    updateFlowNavState();
  } catch (e) {
    console.warn('[Recall Viewer] Flow navigation setup failed:', e);
  }
}

function updateFlowNavState() {
  btnFlowPrev.disabled = flowIndex <= 0;
  btnFlowNext.disabled = flowIndex >= flowSiblings.length - 1;
  flowPositionEl.textContent = `${flowIndex + 1}/${flowSiblings.length}`;
}

function navigateFlow(direction) {
  const newIndex = flowIndex + direction;
  if (newIndex < 0 || newIndex >= flowSiblings.length) return;

  const targetId = flowSiblings[newIndex];
  const viewerUrl = chrome.runtime.getURL(`viewer/viewer.html?id=${encodeURIComponent(targetId)}`);
  window.location.href = viewerUrl;
}

// ============================================================
// Event Listeners
// ============================================================

btnCollapse.addEventListener('click', () => toggleInfoBar(true));
btnExpand.addEventListener('click', () => toggleInfoBar(false));

// Flow navigation
btnFlowPrev.addEventListener('click', () => navigateFlow(-1));
btnFlowNext.addEventListener('click', () => navigateFlow(1));

btnOriginal.addEventListener('click', () => {
  if (currentSnapshot) {
    window.open(currentSnapshot.url, '_blank');
  }
});

btnExport.addEventListener('click', async () => {
  if (!currentSnapshot) return;

  try {
    btnExport.disabled = true;
    chrome.runtime.sendMessage({
      type: MSG.EXPORT_MHTML,
      id: currentSnapshot.id,
    });
  } catch (e) {
    console.error('[Recall Viewer] Export error:', e);
  } finally {
    setTimeout(() => { btnExport.disabled = false; }, 2000);
  }
});

btnStar.addEventListener('click', async () => {
  if (!currentSnapshot) return;

  const newStarred = !currentSnapshot.isStarred;
  currentSnapshot.isStarred = newStarred;

  // Update in DB
  const meta = await dbGet('snapshots', currentSnapshot.id);
  if (meta) {
    meta.isStarred = newStarred;
    await dbPut('snapshots', meta);
  }

  // Update UI
  if (newStarred) {
    btnStar.classList.add('starred');
  } else {
    btnStar.classList.remove('starred');
  }
});

btnDelete.addEventListener('click', async () => {
  if (!currentSnapshot) return;

  if (!await showConfirm('Delete this snapshot?\nThis cannot be undone.', { title: 'Delete Snapshot', type: 'danger', confirmText: 'Delete', cancelText: 'Cancel' })) return;

  try {
    await dbDelete('snapshots', currentSnapshot.id);
    await dbDelete('snapshotData', currentSnapshot.id);

    // Notify other parts of extension
    chrome.runtime.sendMessage({
      type: MSG.SNAPSHOT_DELETED,
      id: currentSnapshot.id,
    }).catch(() => { });

    // Close tab or navigate to manager
    window.close();
  } catch (e) {
    console.error('[Recall Viewer] Delete error:', e);
    showAlert('Failed to delete snapshot: ' + e.message, { type: 'error', title: 'Error' });
  }
});

btnBack.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MSG.OPEN_MANAGER });
});

// ============================================================
// Notes
// ============================================================

function setupNotes(metadata) {
  notesTextarea.value = metadata.notes || '';
  // Show indicator on button if notes exist
  if (metadata.notes && metadata.notes.trim()) {
    btnNotes.classList.add('has-notes');
  }
}

function toggleNotesPanel() {
  const isHidden = notesPanel.classList.contains('hidden');
  notesPanel.classList.toggle('hidden');
  if (isHidden) {
    notesTextarea.focus();
  }
}

async function saveNotes() {
  if (!currentSnapshot) return;

  const notes = notesTextarea.value;
  currentSnapshot.notes = notes;

  // Update indicator
  if (notes.trim()) {
    btnNotes.classList.add('has-notes');
  } else {
    btnNotes.classList.remove('has-notes');
  }

  // Save to DB directly
  const meta = await dbGet('snapshots', currentSnapshot.id);
  if (meta) {
    meta.notes = notes;
    await dbPut('snapshots', meta);
  }

  // Also notify service worker
  chrome.runtime.sendMessage({
    type: MSG.UPDATE_SNAPSHOT_NOTES,
    id: currentSnapshot.id,
    notes: notes,
  }).catch(() => { });

  notesStatus.textContent = 'Saved';
  setTimeout(() => { notesStatus.textContent = ''; }, 1500);
}

btnNotes.addEventListener('click', toggleNotesPanel);
btnCloseNotes.addEventListener('click', () => notesPanel.classList.add('hidden'));

// Auto-save notes with debounce
notesTextarea.addEventListener('input', () => {
  notesStatus.textContent = 'Typing...';
  if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(saveNotes, 800);
});

// ============================================================
// Annotations
// ============================================================

function setupAnnotations(metadata) {
  annotations = metadata.annotations || [];
  if (annotations.length > 0) {
    btnAnnotations.classList.add('has-annotations');
  }
  renderAnnotationsList();
}

function toggleAnnotationsPanel() {
  const isHidden = annotationsPanel.classList.contains('hidden');
  annotationsPanel.classList.toggle('hidden');
  // Close notes panel if opening annotations
  if (isHidden) {
    notesPanel.classList.add('hidden');
  }
}

function renderAnnotationsList() {
  if (annotations.length === 0) {
    annotationsList.innerHTML = '';
    annotationsEmpty.classList.remove('hidden');
    return;
  }

  annotationsEmpty.classList.add('hidden');

  annotationsList.innerHTML = annotations.map((ann, i) => {
    const timeStr = formatDate(ann.timestamp);
    const previewText = escapeHtml(ann.text.length > 100 ? ann.text.slice(0, 100) + '...' : ann.text);
    return `
      <div class="annotation-item" data-index="${i}">
        <div class="annotation-item-header">
          <span class="annotation-color-dot" style="background:${ann.color}"></span>
          <span class="annotation-item-time">${timeStr}</span>
          <button class="annotation-item-delete" data-index="${i}" title="Delete annotation">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="annotation-item-text" style="background:${ann.color}30">${previewText}</div>
      </div>
    `;
  }).join('');

  // Click to scroll to annotation in iframe
  annotationsList.querySelectorAll('.annotation-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.annotation-item-delete')) return;
      const idx = parseInt(el.dataset.index, 10);
      scrollToAnnotation(annotations[idx]);
    });
  });

  // Delete button
  annotationsList.querySelectorAll('.annotation-item-delete').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.index, 10);
      deleteAnnotation(idx);
    });
  });
}

function scrollToAnnotation(ann) {
  try {
    const doc = snapshotFrame.contentDocument || snapshotFrame.contentWindow.document;
    if (!doc) return;

    // Find the annotation mark in the iframe
    const marks = doc.querySelectorAll(`mark[data-ann-id="${ann.id}"]`);
    if (marks.length > 0) {
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Flash effect
      marks.forEach(m => {
        m.style.outline = '2px solid #3b82f6';
        setTimeout(() => { m.style.outline = ''; }, 1500);
      });
    }
  } catch { /* ignore */ }
}

async function saveAnnotations() {
  if (!currentSnapshot) return;

  currentSnapshot.annotations = annotations;

  // Update indicator
  if (annotations.length > 0) {
    btnAnnotations.classList.add('has-annotations');
  } else {
    btnAnnotations.classList.remove('has-annotations');
  }

  // Save to DB
  const meta = await dbGet('snapshots', currentSnapshot.id);
  if (meta) {
    meta.annotations = annotations;
    await dbPut('snapshots', meta);
  }

  // Notify service worker
  chrome.runtime.sendMessage({
    type: MSG.UPDATE_SNAPSHOT_ANNOTATIONS,
    id: currentSnapshot.id,
    annotations: annotations,
  }).catch(() => { });
}

function deleteAnnotation(index) {
  const ann = annotations[index];
  annotations.splice(index, 1);

  // Remove highlight from iframe
  try {
    const doc = snapshotFrame.contentDocument || snapshotFrame.contentWindow.document;
    if (doc) {
      const marks = doc.querySelectorAll(`mark[data-ann-id="${ann.id}"]`);
      marks.forEach(m => {
        const parent = m.parentNode;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
      });
    }
  } catch { /* ignore */ }

  renderAnnotationsList();
  saveAnnotations();
}

/**
 * Listen for text selection inside the snapshot iframe.
 * When user selects text, show the floating color picker toolbar.
 */
function setupIframeSelectionListener() {
  try {
    const doc = snapshotFrame.contentDocument || snapshotFrame.contentWindow.document;
    if (!doc) return;

    // Inject annotation styles into iframe
    const style = doc.createElement('style');
    style.textContent = `
      mark[data-ann-id] {
        border-radius: 2px;
        padding: 1px 0;
        cursor: pointer;
      }
      mark[data-ann-id]:hover {
        outline: 1px solid rgba(0,0,0,0.2);
      }
    `;
    doc.head.appendChild(style);

    doc.addEventListener('mouseup', () => {
      setTimeout(() => {
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          hideAnnotationToolbar();
          return;
        }

        const text = sel.toString().trim();
        if (text.length < 2) {
          hideAnnotationToolbar();
          return;
        }

        // Store selection data
        pendingSelection = {
          text: text,
          // Get surrounding context for re-finding
          context: getSelectionContext(sel),
        };

        // Position toolbar near the selection
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const iframeRect = snapshotFrame.getBoundingClientRect();

        const toolbarX = iframeRect.left + rect.left + (rect.width / 2) - 75;
        const toolbarY = iframeRect.top + rect.top - 42;

        showAnnotationToolbar(
          Math.max(10, Math.min(toolbarX, window.innerWidth - 160)),
          Math.max(10, toolbarY)
        );
      }, 10);
    });

    // Hide toolbar on click elsewhere
    doc.addEventListener('mousedown', (e) => {
      if (!e.target.closest('mark[data-ann-id]')) {
        // Small delay to allow selection to complete
        setTimeout(() => {
          const sel = doc.getSelection();
          if (!sel || sel.isCollapsed) {
            hideAnnotationToolbar();
          }
        }, 50);
      }
    });

  } catch (e) {
    console.warn('[Recall Viewer] Iframe selection listener failed:', e);
  }
}

function getSelectionContext(sel) {
  try {
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const textNode = container.nodeType === 3 ? container : container.firstChild;
    if (textNode && textNode.textContent) {
      const full = textNode.textContent;
      const selText = sel.toString();
      const idx = full.indexOf(selText);
      if (idx !== -1) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(full.length, idx + selText.length + 30);
        return full.slice(start, end);
      }
    }
  } catch { /* ignore */ }
  return '';
}

function showAnnotationToolbar(x, y) {
  annotationToolbar.style.left = x + 'px';
  annotationToolbar.style.top = y + 'px';
  annotationToolbar.classList.remove('hidden');
}

function hideAnnotationToolbar() {
  annotationToolbar.classList.add('hidden');
  pendingSelection = null;
}

// Color button click handlers
annotationToolbar.querySelectorAll('.ann-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    if (pendingSelection) {
      createAnnotation(pendingSelection.text, pendingSelection.context, color);
    }
    hideAnnotationToolbar();
  });
});

function createAnnotation(text, context, color) {
  const ann = {
    id: crypto.randomUUID(),
    text,
    context,
    color,
    timestamp: Date.now(),
  };

  annotations.push(ann);
  renderAnnotationsList();
  saveAnnotations();

  // Highlight in iframe
  applyAnnotationInIframe(ann);

  // Clear selection
  try {
    const doc = snapshotFrame.contentDocument || snapshotFrame.contentWindow.document;
    if (doc) doc.getSelection().removeAllRanges();
  } catch { /* ignore */ }
}

/**
 * Apply a single annotation highlight in the iframe.
 */
function applyAnnotationInIframe(ann) {
  try {
    const doc = snapshotFrame.contentDocument || snapshotFrame.contentWindow.document;
    if (!doc || !doc.body) return;

    highlightTextInDocument(doc, ann.text, ann.color, ann.id);
  } catch (e) {
    console.warn('[Recall Viewer] Apply annotation failed:', e);
  }
}

/**
 * Restore all saved annotations in the iframe after it loads.
 */
function restoreAnnotationsInIframe() {
  if (annotations.length === 0) return;

  try {
    const doc = snapshotFrame.contentDocument || snapshotFrame.contentWindow.document;
    if (!doc || !doc.body) return;

    for (const ann of annotations) {
      highlightTextInDocument(doc, ann.text, ann.color, ann.id);
    }
  } catch (e) {
    console.warn('[Recall Viewer] Restore annotations failed:', e);
  }
}

/**
 * Find and wrap the first occurrence of `text` in the document with a <mark>.
 */
function highlightTextInDocument(doc, text, color, annId) {
  const q = text.toLowerCase();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const content = node.textContent;
    const idx = content.toLowerCase().indexOf(q);
    if (idx === -1) continue;

    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
    // Don't re-highlight inside existing annotations
    if (parent.closest('mark[data-ann-id]')) continue;

    const range = doc.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + text.length);

    const mark = doc.createElement('mark');
    mark.setAttribute('data-ann-id', annId);
    mark.style.backgroundColor = color;
    mark.style.color = 'inherit';

    range.surroundContents(mark);
    return; // Only highlight first occurrence
  }
}

btnAnnotations.addEventListener('click', toggleAnnotationsPanel);
btnCloseAnnotations.addEventListener('click', () => annotationsPanel.classList.add('hidden'));

// Hide annotation toolbar when clicking outside
document.addEventListener('mousedown', (e) => {
  if (!annotationToolbar.contains(e.target)) {
    hideAnnotationToolbar();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Escape: toggle info bar
  if (e.key === 'Escape') {
    toggleInfoBar();
    e.preventDefault();
  }
  // Left/Right arrows: flow navigation
  if (e.key === 'ArrowLeft' && flowSiblings.length > 0) {
    navigateFlow(-1);
    e.preventDefault();
  }
  if (e.key === 'ArrowRight' && flowSiblings.length > 0) {
    navigateFlow(1);
    e.preventDefault();
  }
});

// ============================================================
// Start
// ============================================================

initTheme();
createThemeToggle(document.getElementById('theme-toggle-container'));
initI18n().then(() => applyI18n());

// ============================================================
// Share (Standalone HTML Export)
// ============================================================

const btnShare = document.getElementById('btn-share');
if (btnShare) {
  btnShare.addEventListener('click', async () => {
    if (!currentSnapshot) return;
    btnShare.disabled = true;
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: MSG.EXPORT_STANDALONE_HTML,
          id: currentSnapshot.id,
        }, (response) => {
          if (response?.success) resolve(response.data);
          else reject(new Error(response?.error || 'Export failed'));
        });
      });
    } catch (e) {
      console.error('[Recall Viewer] Share export error:', e);
      showAlert('Export failed: ' + e.message, { type: 'error', title: 'Export Failed' });
    } finally {
      setTimeout(() => { btnShare.disabled = false; }, 2000);
    }
  });
}

// ============================================================
// AI Summary
// ============================================================

const btnSummarize = document.getElementById('btn-summarize');
const summaryPanel = document.getElementById('summary-panel');
const btnCloseSummary = document.getElementById('btn-close-summary');
const summaryContent = document.getElementById('summary-content');
const btnGenerateSummary = document.getElementById('btn-generate-summary');
const summaryStatus = document.getElementById('summary-status');

if (btnSummarize) {
  btnSummarize.addEventListener('click', async () => {
    if (!summaryPanel) return;
    const isHidden = summaryPanel.classList.contains('hidden');
    summaryPanel.classList.toggle('hidden');

    // Load existing summary
    if (isHidden && currentSnapshot) {
      try {
        const resp = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: MSG.GET_SUMMARY,
            id: currentSnapshot.id,
          }, (response) => {
            if (response?.success) resolve(response.data);
            else reject(new Error(response?.error || 'Failed'));
          });
        });
        if (resp.summary) {
          summaryContent.innerHTML = `<p>${resp.summary}</p>`;
        }
      } catch { /* ignore */ }
    }
  });
}

if (btnCloseSummary) {
  btnCloseSummary.addEventListener('click', () => {
    summaryPanel.classList.add('hidden');
  });
}

if (btnGenerateSummary) {
  btnGenerateSummary.addEventListener('click', async () => {
    if (!currentSnapshot) return;
    btnGenerateSummary.disabled = true;
    summaryStatus.textContent = t('viewer-generating');
    summaryContent.innerHTML = '<p class="summary-placeholder">' + t('viewer-generating') + '</p>';

    try {
      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: MSG.GENERATE_SUMMARY,
          id: currentSnapshot.id,
        }, (response) => {
          if (response?.success) resolve(response.data);
          else reject(new Error(response?.error || 'Generation failed'));
        });
      });

      summaryContent.innerHTML = `<p>${resp.summary}</p>`;
      summaryStatus.textContent = 'Done';
      setTimeout(() => { summaryStatus.textContent = ''; }, 2000);
    } catch (e) {
      summaryContent.innerHTML = `<p class="summary-error">Error: ${e.message}</p>`;
      summaryStatus.textContent = 'Failed';
    } finally {
      btnGenerateSummary.disabled = false;
    }
  });
}

init();
