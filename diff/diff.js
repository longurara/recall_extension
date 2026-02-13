// diff/diff.js - Page Diff Viewer logic

import { MSG } from '../lib/constants.js';
import { formatDate, decompressToString } from '../lib/utils.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';

// ============================================================
// IndexedDB (same as viewer - direct access)
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
      if (e.oldVersion < 1) {
        const store = db.createObjectStore('snapshots', { keyPath: 'id' });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('domain', 'domain', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('captureType', 'captureType', { unique: false });
        store.createIndex('isStarred', 'isStarred', { unique: false });
        db.createObjectStore('snapshotData', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (e.oldVersion < 2) {
        const tx = e.target.transaction;
        const store = tx.objectStore('snapshots');
        if (!store.indexNames.contains('sessionId')) {
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }
      }
      if (e.oldVersion < 3) {
        const watchStore = db.createObjectStore('watchedPages', { keyPath: 'id' });
        watchStore.createIndex('url', 'url', { unique: true });
        watchStore.createIndex('isActive', 'isActive', { unique: false });
        watchStore.createIndex('lastChecked', 'lastChecked', { unique: false });
        watchStore.createIndex('domain', 'domain', { unique: false });
      }
      if (e.oldVersion < 4) {
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
      if (e.oldVersion < 5) {
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

// ============================================================
// DOM
// ============================================================

const btnSideBySide = document.getElementById('btn-side-by-side');
const btnTextDiff = document.getElementById('btn-text-diff');
const btnBack = document.getElementById('btn-back');
const btnErrorBack = document.getElementById('btn-error-back');
const sideBySideView = document.getElementById('side-by-side-view');
const textDiffView = document.getElementById('text-diff-view');
const leftFrame = document.getElementById('left-frame');
const rightFrame = document.getElementById('right-frame');
const diffContent = document.getElementById('diff-content');
const diffStats = document.getElementById('diff-stats');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessage = document.getElementById('error-message');

let leftText = '';
let rightText = '';
let diffComputed = false;

// ============================================================
// Init
// ============================================================

async function init() {
  const params = new URLSearchParams(window.location.search);
  const leftId = params.get('left');
  const rightId = params.get('right');

  if (!leftId || !rightId) {
    showError('Two snapshot IDs are required for comparison.');
    return;
  }

  try {
    // Load both snapshots in parallel
    const [leftMeta, rightMeta, leftData, rightData] = await Promise.all([
      dbGet('snapshots', leftId),
      dbGet('snapshots', rightId),
      dbGet('snapshotData', leftId),
      dbGet('snapshotData', rightId),
    ]);

    if (!leftMeta || !rightMeta) {
      showError('One or both snapshots not found.');
      return;
    }

    if (!leftData?.domSnapshot || !rightData?.domSnapshot) {
      showError('Snapshot data not found for one or both snapshots.');
      return;
    }

    // Populate info bar
    document.getElementById('left-title').textContent = leftMeta.title || 'Untitled';
    document.getElementById('left-date').textContent = formatDate(leftMeta.timestamp);
    document.getElementById('right-title').textContent = rightMeta.title || 'Untitled';
    document.getElementById('right-date').textContent = formatDate(rightMeta.timestamp);

    document.title = `Recall - Diff: ${leftMeta.title} vs ${rightMeta.title}`;

    // Decompress HTML
    let leftHtml, rightHtml;
    try {
      leftHtml = await decompressToString(leftData.domSnapshot);
    } catch {
      leftHtml = leftData.domSnapshot instanceof Blob ? await leftData.domSnapshot.text() : leftData.domSnapshot;
    }
    try {
      rightHtml = await decompressToString(rightData.domSnapshot);
    } catch {
      rightHtml = rightData.domSnapshot instanceof Blob ? await rightData.domSnapshot.text() : rightData.domSnapshot;
    }

    // Sanitize for iframe display
    leftHtml = sanitizeHtml(leftHtml);
    rightHtml = sanitizeHtml(rightHtml);

    // Display in iframes
    leftFrame.srcdoc = leftHtml;
    rightFrame.srcdoc = rightHtml;

    // Extract text for text diff
    leftText = leftData.textContent || extractTextFromHtml(leftHtml);
    rightText = rightData.textContent || extractTextFromHtml(rightHtml);

    // Sync scrolling between iframes
    setupSyncScroll();

    // Setup divider drag
    setupDividerDrag();

    // Hide loading
    loadingEl.classList.add('hidden');
  } catch (e) {
    console.error('[Recall Diff] Error:', e);
    showError(e.message);
  }
}

// ============================================================
// HTML Sanitization (same as viewer)
// ============================================================

function sanitizeHtml(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    for (const script of doc.querySelectorAll('script')) script.remove();
    for (const el of doc.querySelectorAll('*')) {
      const toRemove = [];
      for (const attr of el.attributes) {
        if (attr.name.toLowerCase().startsWith('on')) toRemove.push(attr.name);
      }
      for (const name of toRemove) el.removeAttribute(name);
    }
    for (const el of doc.querySelectorAll('[href^="javascript:" i], [src^="javascript:" i]')) {
      if (el.hasAttribute('href')) el.setAttribute('href', '#');
      if (el.hasAttribute('src')) el.removeAttribute('src');
    }
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  } catch {
    return html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  }
}

function extractTextFromHtml(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return (doc.body.innerText || doc.body.textContent || '').trim();
  } catch {
    return '';
  }
}

// ============================================================
// Diff Algorithm (simple line-based LCS diff)
// ============================================================

function computeDiff(textA, textB) {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');

  // Simple LCS-based diff (optimized for reasonable input sizes)
  const n = linesA.length;
  const m = linesB.length;

  // For very large files, limit to first 5000 lines
  const maxLines = 5000;
  const a = linesA.slice(0, maxLines);
  const b = linesB.slice(0, maxLines);

  // Build a map of line -> positions in B for efficiency
  const bMap = new Map();
  for (let j = 0; j < b.length; j++) {
    const line = b[j];
    if (!bMap.has(line)) bMap.set(line, []);
    bMap.get(line).push(j);
  }

  // Patience-style: find matching lines using LCS via Hunt-Szymanski
  // For simplicity, use a basic O(ND) approach with a limit
  const result = [];
  let i = 0, j = 0;

  // Simple two-pointer approach with matching
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else {
      // Look ahead to find next match
      let foundI = -1, foundJ = -1;
      const lookAhead = Math.min(50, Math.max(a.length - i, b.length - j));

      for (let d = 1; d <= lookAhead; d++) {
        // Check if a[i+d] matches b[j]
        if (i + d < a.length && j < b.length && a[i + d] === b[j]) {
          foundI = i + d;
          foundJ = j;
          break;
        }
        // Check if a[i] matches b[j+d]
        if (i < a.length && j + d < b.length && a[i] === b[j + d]) {
          foundI = i;
          foundJ = j + d;
          break;
        }
        // Check diagonal
        if (i + d < a.length && j + d < b.length && a[i + d] === b[j + d]) {
          // Emit remaining as removes/adds up to the match
          for (let k = i; k < i + d; k++) result.push({ type: 'removed', text: a[k] });
          for (let k = j; k < j + d; k++) result.push({ type: 'added', text: b[k] });
          i += d;
          j += d;
          foundI = -2; // signal we handled it
          break;
        }
      }

      if (foundI === -2) {
        continue;
      } else if (foundI >= 0) {
        // Emit removes/adds before the match
        while (i < foundI) { result.push({ type: 'removed', text: a[i] }); i++; }
        while (j < foundJ) { result.push({ type: 'added', text: b[j] }); j++; }
      } else {
        // No match found in lookahead, emit one line
        if (i < a.length) { result.push({ type: 'removed', text: a[i] }); i++; }
        if (j < b.length) { result.push({ type: 'added', text: b[j] }); j++; }
      }
    }
  }

  return result;
}

function renderTextDiff() {
  if (diffComputed) return;
  diffComputed = true;

  const diff = computeDiff(leftText, rightText);

  let addedCount = 0;
  let removedCount = 0;

  // Group consecutive context lines and collapse them
  const html = [];
  let contextBuffer = [];

  function flushContext() {
    if (contextBuffer.length === 0) return;
    if (contextBuffer.length <= 6) {
      // Show all context
      for (const line of contextBuffer) {
        html.push(`<div class="diff-line context"><span class="line-prefix"> </span>${escapeHtml(line)}</div>`);
      }
    } else {
      // Show first 3 and last 3
      for (let i = 0; i < 3; i++) {
        html.push(`<div class="diff-line context"><span class="line-prefix"> </span>${escapeHtml(contextBuffer[i])}</div>`);
      }
      html.push(`<div class="diff-separator">... ${contextBuffer.length - 6} unchanged lines ...</div>`);
      for (let i = contextBuffer.length - 3; i < contextBuffer.length; i++) {
        html.push(`<div class="diff-line context"><span class="line-prefix"> </span>${escapeHtml(contextBuffer[i])}</div>`);
      }
    }
    contextBuffer = [];
  }

  for (const entry of diff) {
    if (entry.type === 'context') {
      contextBuffer.push(entry.text);
    } else {
      flushContext();
      if (entry.type === 'added') {
        addedCount++;
        html.push(`<div class="diff-line added"><span class="line-prefix">+</span>${escapeHtml(entry.text)}</div>`);
      } else {
        removedCount++;
        html.push(`<div class="diff-line removed"><span class="line-prefix">-</span>${escapeHtml(entry.text)}</div>`);
      }
    }
  }
  flushContext();

  diffStats.innerHTML = `
    <span class="added">+${addedCount} added</span>
    <span class="removed">-${removedCount} removed</span>
    <span>${diff.filter(d => d.type === 'context').length} unchanged</span>
  `;

  diffContent.innerHTML = html.join('');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ============================================================
// Sync Scroll
// ============================================================

function setupSyncScroll() {
  let syncing = false;

  function syncScroll(source, target) {
    if (syncing) return;
    syncing = true;
    try {
      const sourceDoc = source.contentDocument || source.contentWindow.document;
      const targetDoc = target.contentDocument || target.contentWindow.document;
      const sourceMax = sourceDoc.documentElement.scrollHeight - sourceDoc.documentElement.clientHeight;
      const targetMax = targetDoc.documentElement.scrollHeight - targetDoc.documentElement.clientHeight;

      if (sourceMax > 0 && targetMax > 0) {
        const ratio = sourceDoc.documentElement.scrollTop / sourceMax;
        targetDoc.documentElement.scrollTop = ratio * targetMax;
      }
    } catch {
      // Cross-origin restriction
    }
    syncing = false;
  }

  leftFrame.addEventListener('load', () => {
    try {
      leftFrame.contentWindow.addEventListener('scroll', () => syncScroll(leftFrame, rightFrame));
    } catch { }
  });

  rightFrame.addEventListener('load', () => {
    try {
      rightFrame.contentWindow.addEventListener('scroll', () => syncScroll(rightFrame, leftFrame));
    } catch { }
  });
}

// ============================================================
// Divider Drag
// ============================================================

function setupDividerDrag() {
  const divider = document.getElementById('diff-divider');
  const leftPane = document.querySelector('.left-pane');
  const rightPane = document.querySelector('.right-pane');

  let isDragging = false;

  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    divider.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const container = sideBySideView;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = (x / rect.width) * 100;
    const clamped = Math.max(20, Math.min(80, percent));

    leftPane.style.flex = `0 0 ${clamped}%`;
    rightPane.style.flex = `0 0 ${100 - clamped}%`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      divider.classList.remove('dragging');
    }
  });
}

// ============================================================
// Mode Toggle
// ============================================================

btnSideBySide.addEventListener('click', () => {
  btnSideBySide.classList.add('active');
  btnTextDiff.classList.remove('active');
  sideBySideView.classList.remove('hidden');
  textDiffView.classList.add('hidden');
});

btnTextDiff.addEventListener('click', () => {
  btnTextDiff.classList.add('active');
  btnSideBySide.classList.remove('active');
  textDiffView.classList.remove('hidden');
  sideBySideView.classList.add('hidden');
  renderTextDiff();
});

// ============================================================
// Navigation
// ============================================================

function goBack() {
  chrome.runtime.sendMessage({ type: MSG.OPEN_MANAGER }).catch(() => { });
}

btnBack.addEventListener('click', goBack);
btnErrorBack.addEventListener('click', goBack);

function showError(message) {
  loadingEl.classList.add('hidden');
  errorEl.classList.remove('hidden');
  errorMessage.textContent = message;
}

// ============================================================
// Start
// ============================================================

initTheme();
createThemeToggle(document.getElementById('theme-toggle-container'));
init();
