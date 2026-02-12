// content/spotlight.js - Spotlight search overlay (Ctrl+Space)
// Injected into every page as a content script.

(() => {
  // Prevent double-injection
  if (window.__recallSpotlightInjected) return;
  window.__recallSpotlightInjected = true;

  // ============================================================
  // State
  // ============================================================

  let overlay = null;
  let isOpen = false;
  let results = [];
  let selectedIndex = 0;
  let searchTimeout = null;
  let currentQuery = '';

  // ============================================================
  // Build DOM (injected into page via Shadow DOM for style isolation)
  // ============================================================

  function createOverlay() {
    const host = document.createElement('div');
    host.id = 'recall-spotlight-host';
    const shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>${getStyles()}</style>
      <div class="spotlight-backdrop" id="backdrop">
        <div class="spotlight-container" id="container">
          <div class="spotlight-input-row">
            <svg class="spotlight-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.8"/>
              <path d="M13 13l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <input type="text" id="spotlight-input"
              placeholder="Search your saved snapshots..."
              autocomplete="off" spellcheck="false" />
            <kbd class="spotlight-kbd">ESC</kbd>
          </div>
          <div class="spotlight-results" id="spotlight-results">
            <div class="spotlight-empty" id="spotlight-empty">
              <p class="spotlight-empty-title">Search your Recall snapshots</p>
              <p class="spotlight-empty-sub">Type to search by title, URL, domain, or page content</p>
            </div>
          </div>
          <div class="spotlight-footer">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>ESC</kbd> close</span>
          </div>
        </div>
      </div>
    `;

    overlay = {
      host,
      shadow,
      backdrop: shadow.getElementById('backdrop'),
      container: shadow.getElementById('container'),
      input: shadow.getElementById('spotlight-input'),
      resultsList: shadow.getElementById('spotlight-results'),
      emptyState: shadow.getElementById('spotlight-empty'),
    };

    // Events
    overlay.backdrop.addEventListener('click', (e) => {
      if (e.target === overlay.backdrop) close();
    });

    overlay.input.addEventListener('input', onInput);
    overlay.input.addEventListener('keydown', onKeydown);

    // Prevent page shortcuts while spotlight is active
    overlay.container.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    document.body.appendChild(host);
  }

  // ============================================================
  // Open / Close
  // ============================================================

  function open() {
    if (isOpen) return;

    if (!overlay) createOverlay();

    isOpen = true;
    overlay.host.style.display = 'block';
    overlay.backdrop.classList.add('visible');

    // Reset state
    overlay.input.value = '';
    currentQuery = '';
    results = [];
    selectedIndex = 0;
    renderEmpty();

    requestAnimationFrame(() => {
      overlay.input.focus();
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;

    overlay.backdrop.classList.remove('visible');
    setTimeout(() => {
      if (overlay && overlay.host) {
        overlay.host.style.display = 'none';
      }
    }, 200);
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // ============================================================
  // Search
  // ============================================================

  function onInput() {
    const query = overlay.input.value.trim();

    if (searchTimeout) clearTimeout(searchTimeout);

    if (!query) {
      currentQuery = '';
      results = [];
      selectedIndex = 0;
      renderEmpty();
      return;
    }

    // Debounce: 250ms
    searchTimeout = setTimeout(() => {
      performSearch(query);
    }, 250);
  }

  async function performSearch(query) {
    currentQuery = query;

    // Show loading
    overlay.resultsList.innerHTML = `
      <div class="spotlight-loading">
        <div class="spotlight-spinner"></div>
        <span>Searching...</span>
      </div>
    `;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SPOTLIGHT_SEARCH',
        query,
        limit: 20,
      });

      // Check if query is still current (user might have typed more)
      if (query !== currentQuery) return;

      if (response && response.success && response.data) {
        results = response.data;
        selectedIndex = 0;
        renderResults();
      } else {
        results = [];
        renderNoResults();
      }
    } catch (err) {
      console.warn('[Recall Spotlight] Search error:', err);
      results = [];
      renderNoResults();
    }
  }

  // ============================================================
  // Render
  // ============================================================

  function renderEmpty() {
    overlay.resultsList.innerHTML = `
      <div class="spotlight-empty">
        <p class="spotlight-empty-title">Search your Recall snapshots</p>
        <p class="spotlight-empty-sub">Type to search by title, URL, domain, or page content</p>
      </div>
    `;
  }

  function renderNoResults() {
    overlay.resultsList.innerHTML = `
      <div class="spotlight-empty">
        <p class="spotlight-empty-title">No results found</p>
        <p class="spotlight-empty-sub">Try a different search term</p>
      </div>
    `;
  }

  function renderResults() {
    if (!results.length) {
      renderNoResults();
      return;
    }

    const q = currentQuery.toLowerCase();
    overlay.resultsList.innerHTML = results
      .map((r, i) => {
        const isSelected = i === selectedIndex;
        const timeAgo = formatTimeAgo(r.timestamp);
        const highlightedTitle = highlightMatch(escapeHtml(r.title), q);
        const highlightedUrl = highlightMatch(escapeHtml(truncateUrl(r.url)), q);

        let snippetHtml = '';
        if (r.textSnippet) {
          snippetHtml = `<div class="result-snippet">${highlightMatch(escapeHtml(r.textSnippet), q)}</div>`;
        }

        const faviconHtml = r.favicon
          ? `<img class="result-favicon" src="${escapeHtml(r.favicon)}" width="16" height="16" alt="" />`
          : `<div class="result-favicon-placeholder">${escapeHtml(r.domain ? r.domain[0].toUpperCase() : '?')}</div>`;

        const matchBadge = r.matchType === 'content'
          ? '<span class="result-match-badge content">Content match</span>'
          : r.matchType === 'both'
          ? '<span class="result-match-badge both">Title + Content</span>'
          : '';

        const starHtml = r.isStarred ? '<span class="result-star">&#9733;</span>' : '';

        const typeBadge = `<span class="result-type-badge ${r.captureType || 'auto'}">${r.captureType || 'auto'}</span>`;

        return `
          <div class="spotlight-result ${isSelected ? 'selected' : ''}"
               data-index="${i}" data-id="${r.id}">
            <div class="result-icon">
              ${faviconHtml}
            </div>
            <div class="result-body">
              <div class="result-title-row">
                ${starHtml}
                <span class="result-title">${highlightedTitle}</span>
                ${typeBadge}
                ${matchBadge}
              </div>
              <div class="result-url">${highlightedUrl}</div>
              ${snippetHtml}
            </div>
            <div class="result-meta">
              <span class="result-time">${timeAgo}</span>
            </div>
          </div>
        `;
      })
      .join('');

    // Click handlers
    overlay.resultsList.querySelectorAll('.spotlight-result').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        selectedIndex = idx;
        openResult(results[idx]);
      });

      el.addEventListener('mouseenter', () => {
        selectedIndex = parseInt(el.dataset.index, 10);
        updateSelection();
      });
    });

    scrollToSelected();
  }

  function updateSelection() {
    const items = overlay.resultsList.querySelectorAll('.spotlight-result');
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIndex);
    });
  }

  function scrollToSelected() {
    const selected = overlay.resultsList.querySelector('.spotlight-result.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ============================================================
  // Open result
  // ============================================================

  function openResult(result) {
    if (!result) return;

    // Use message to service worker to open the viewer tab.
    // Content scripts cannot open chrome-extension:// URLs via window.open()
    // (Chrome blocks it with ERR_BLOCKED_BY_CLIENT).
    chrome.runtime.sendMessage({
      type: 'OPEN_VIEWER',
      id: result.id,
      query: currentQuery,
    });

    close();
  }

  // ============================================================
  // Keyboard navigation
  // ============================================================

  function onKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (results.length > 0) {
          selectedIndex = (selectedIndex + 1) % results.length;
          updateSelection();
          scrollToSelected();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (results.length > 0) {
          selectedIndex = (selectedIndex - 1 + results.length) % results.length;
          updateSelection();
          scrollToSelected();
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (results.length > 0 && results[selectedIndex]) {
          openResult(results[selectedIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  }

  // ============================================================
  // Global keyboard listener
  // ============================================================

  document.addEventListener('keydown', (e) => {
    // Ctrl+Space (or Cmd+Space on Mac) to toggle spotlight
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }

    // Escape to close
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }, true); // Use capture phase to intercept before page handlers

  // Listen for toggle message from service worker (via chrome.commands)
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'TOGGLE_SPOTLIGHT') {
      toggle();
    }
  });

  // ============================================================
  // Utilities
  // ============================================================

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightMatch(html, query) {
    if (!query) return html;
    // Escape regex special chars in query
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return html.replace(regex, '<mark class="spotlight-mark">$1</mark>');
  }

  function truncateUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      const path = u.pathname + u.search;
      if (path.length > 60) {
        return u.hostname + path.slice(0, 57) + '...';
      }
      return u.hostname + path;
    } catch {
      return url.length > 80 ? url.slice(0, 77) + '...' : url;
    }
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  // ============================================================
  // Styles (injected into Shadow DOM)
  // ============================================================

  function getStyles() {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      .spotlight-backdrop {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 2147483647;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 15vh;
        opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: none;
      }

      .spotlight-backdrop.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .spotlight-container {
        width: 620px;
        max-width: 90vw;
        max-height: 70vh;
        background: #ffffff;
        border-radius: 14px;
        box-shadow:
          0 25px 60px rgba(0, 0, 0, 0.3),
          0 0 0 1px rgba(0, 0, 0, 0.08),
          0 0 80px rgba(37, 99, 235, 0.08);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: scale(0.96) translateY(-10px);
        transition: transform 0.15s ease, opacity 0.15s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      }

      .spotlight-backdrop.visible .spotlight-container {
        transform: scale(1) translateY(0);
      }

      /* Input row */
      .spotlight-input-row {
        display: flex;
        align-items: center;
        padding: 14px 18px;
        border-bottom: 1px solid #e5e7eb;
        gap: 12px;
      }

      .spotlight-icon {
        color: #9ca3af;
        flex-shrink: 0;
      }

      #spotlight-input {
        flex: 1;
        border: none;
        outline: none;
        font-size: 17px;
        font-family: inherit;
        color: #1f2937;
        background: transparent;
        line-height: 1.4;
      }

      #spotlight-input::placeholder {
        color: #9ca3af;
      }

      .spotlight-kbd {
        font-size: 11px;
        font-family: inherit;
        color: #9ca3af;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        padding: 2px 6px;
        flex-shrink: 0;
      }

      /* Results area */
      .spotlight-results {
        flex: 1;
        overflow-y: auto;
        overscroll-behavior: contain;
        min-height: 80px;
        max-height: calc(70vh - 120px);
      }

      .spotlight-results::-webkit-scrollbar {
        width: 6px;
      }
      .spotlight-results::-webkit-scrollbar-track {
        background: transparent;
      }
      .spotlight-results::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 3px;
      }

      /* Empty state */
      .spotlight-empty {
        padding: 32px 20px;
        text-align: center;
      }

      .spotlight-empty-title {
        font-size: 14px;
        font-weight: 500;
        color: #6b7280;
        margin-bottom: 4px;
      }

      .spotlight-empty-sub {
        font-size: 12px;
        color: #9ca3af;
      }

      /* Loading */
      .spotlight-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 24px;
        color: #6b7280;
        font-size: 13px;
      }

      .spotlight-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid #e5e7eb;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spotlight-spin 0.6s linear infinite;
      }

      @keyframes spotlight-spin {
        to { transform: rotate(360deg); }
      }

      /* Result item */
      .spotlight-result {
        display: flex;
        align-items: flex-start;
        padding: 10px 18px;
        cursor: pointer;
        gap: 12px;
        border-bottom: 1px solid #f3f4f6;
        transition: background 0.08s;
      }

      .spotlight-result:last-child {
        border-bottom: none;
      }

      .spotlight-result:hover,
      .spotlight-result.selected {
        background: #f0f5ff;
      }

      .spotlight-result.selected {
        background: #eff6ff;
      }

      /* Favicon */
      .result-icon {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 2px;
      }

      .result-favicon {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        object-fit: contain;
      }

      .result-favicon-placeholder {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: #e5e7eb;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Body */
      .result-body {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .result-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .result-star {
        color: #f59e0b;
        font-size: 13px;
        flex-shrink: 0;
      }

      .result-title {
        font-size: 14px;
        font-weight: 500;
        color: #111827;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 360px;
      }

      .result-type-badge {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        padding: 1px 5px;
        border-radius: 3px;
        flex-shrink: 0;
        letter-spacing: 0.03em;
      }

      .result-type-badge.auto {
        background: #dbeafe;
        color: #1d4ed8;
      }

      .result-type-badge.manual {
        background: #dcfce7;
        color: #16a34a;
      }

      .result-type-badge.deep {
        background: #ffedd5;
        color: #c2410c;
      }

      .result-match-badge {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .result-match-badge.content {
        background: #fef3c7;
        color: #92400e;
      }

      .result-match-badge.both {
        background: #ede9fe;
        color: #6d28d9;
      }

      .result-url {
        font-size: 12px;
        color: #6b7280;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 2px;
      }

      .result-snippet {
        font-size: 12px;
        color: #4b5563;
        margin-top: 4px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* Meta (time) */
      .result-meta {
        flex-shrink: 0;
        display: flex;
        align-items: flex-start;
        padding-top: 2px;
      }

      .result-time {
        font-size: 11px;
        color: #9ca3af;
        white-space: nowrap;
      }

      /* Highlight mark */
      .spotlight-mark {
        background: #fef08a;
        color: inherit;
        border-radius: 2px;
        padding: 0 1px;
      }

      /* Footer */
      .spotlight-footer {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 18px;
        border-top: 1px solid #e5e7eb;
        font-size: 11px;
        color: #9ca3af;
      }

      .spotlight-footer kbd {
        font-size: 10px;
        font-family: inherit;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 3px;
        padding: 1px 4px;
        margin-right: 3px;
      }

      /* Dark mode detection */
      @media (prefers-color-scheme: dark) {
        .spotlight-container {
          background: #1e293b;
          box-shadow:
            0 25px 60px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(255, 255, 255, 0.08),
            0 0 80px rgba(59, 130, 246, 0.1);
        }

        .spotlight-input-row {
          border-bottom-color: #334155;
        }

        #spotlight-input {
          color: #e2e8f0;
        }

        #spotlight-input::placeholder {
          color: #64748b;
        }

        .spotlight-icon {
          color: #64748b;
        }

        .spotlight-kbd, .spotlight-footer kbd {
          background: #334155;
          border-color: #475569;
          color: #94a3b8;
        }

        .spotlight-empty-title {
          color: #94a3b8;
        }

        .spotlight-empty-sub {
          color: #64748b;
        }

        .spotlight-loading {
          color: #94a3b8;
        }

        .spotlight-spinner {
          border-color: #334155;
          border-top-color: #3b82f6;
        }

        .spotlight-result {
          border-bottom-color: #293548;
        }

        .spotlight-result:hover,
        .spotlight-result.selected {
          background: #293548;
        }

        .result-title {
          color: #e2e8f0;
        }

        .result-url {
          color: #94a3b8;
        }

        .result-snippet {
          color: #cbd5e1;
        }

        .result-time {
          color: #64748b;
        }

        .result-favicon-placeholder {
          background: #334155;
          color: #94a3b8;
        }

        .spotlight-mark {
          background: #854d0e;
          color: #fef08a;
        }

        .spotlight-footer {
          border-top-color: #334155;
          color: #64748b;
        }
      }
    `;
  }
})();
