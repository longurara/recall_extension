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

  // AI Chat state
  let isAiMode = false;
  let aiChatHistory = [];
  let isAiLoading = false;
  let aiSettingsCache = null;
  let aiConsentGranted = false;

  // i18n
  let currentLang = 'en';
  const STRINGS = {
    en: {
      searchPlaceholder: 'Search your saved snapshots...',
      aiPlaceholder: 'Ask AI about this page or your snapshots...',
      searchTitle: 'Search your Recall snapshots',
      searchSub: 'Type to search by title, URL, domain, or page content',
      aiHint: 'Type <kbd>/ai</kbd> to chat with AI about this page',
      noResults: 'No results found',
      noResultsSub: 'Try a different search term',
      navigate: 'navigate',
      open: 'open',
      close: 'close',
      aiTitle: 'Ask AI anything',
      aiSub: 'Ask about the current page or your saved snapshots',
      aiSummarize: '📝 Summarize',
      aiKeyPoints: '🔑 Key points',
      aiRelated: '🔗 Related snapshots',
      aiRefLabel: '📎 Referenced snapshots',
      searching: 'Searching...',
    },
    vi: {
      searchPlaceholder: 'Tìm kiếm snapshot đã lưu...',
      aiPlaceholder: 'Hỏi AI về trang này hoặc snapshot đã lưu...',
      searchTitle: 'Tìm kiếm Recall snapshots',
      searchSub: 'Nhập để tìm theo tiêu đề, URL, tên miền hoặc nội dung',
      aiHint: 'Gõ <kbd>/ai</kbd> để trò chuyện với AI về trang này',
      noResults: 'Không tìm thấy kết quả',
      noResultsSub: 'Thử từ khóa khác',
      navigate: 'di chuyển',
      open: 'mở',
      close: 'đóng',
      aiTitle: 'Hỏi AI bất kỳ điều gì',
      aiSub: 'Hỏi về trang hiện tại hoặc các snapshot đã lưu',
      aiSummarize: '📝 Tóm tắt trang',
      aiKeyPoints: '🔑 Ý chính',
      aiRelated: '🔗 Snapshot liên quan',
      aiRefLabel: '📎 Snapshot được tham chiếu',
      searching: 'Đang tìm kiếm...',
    },
  };
  function t(key) { return (STRINGS[currentLang] || STRINGS.en)[key] || STRINGS.en[key] || key; }

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
              placeholder="" autocomplete="off" spellcheck="false" />
            <kbd class="spotlight-kbd">ESC</kbd>
          </div>
          <div class="spotlight-results" id="spotlight-results">
            <div class="spotlight-empty" id="spotlight-empty"></div>
          </div>
          <div class="spotlight-footer" id="spotlight-footer">
            <span><kbd>↑↓</kbd> <span class="footer-navigate"></span></span>
            <span><kbd>Enter</kbd> <span class="footer-open"></span></span>
            <span><kbd>ESC</kbd> <span class="footer-close"></span></span>
          </div>
        </div>
      </div>
    `;

    overlay = {
      host,
      shadow,
      backdrop: shadow.getElementById('backdrop'),
      container: shadow.getElementById('container'),
      footer: shadow.getElementById('spotlight-footer'),
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

  async function open() {
    if (isOpen) return;

    if (!overlay) createOverlay();

    isOpen = true;
    overlay.host.style.display = 'block';
    overlay.backdrop.classList.add('visible');

    // Fetch language setting
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (resp && resp.success && resp.data && resp.data.language) {
        currentLang = resp.data.language;
      } else if (resp && resp.language) {
        currentLang = resp.language;
      }
    } catch { /* keep default */ }

    // Reset state
    overlay.input.value = '';
    currentQuery = '';
    results = [];
    selectedIndex = 0;
    isAiMode = false;
    aiChatHistory = [];
    isAiLoading = false;
    overlay.container.classList.remove('ai-mode');
    overlay.input.placeholder = t('searchPlaceholder');
    updateFooterText();
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
    const raw = overlay.input.value;
    const query = raw.trim();

    if (searchTimeout) clearTimeout(searchTimeout);

    // Detect @ai prefix
    const aiMatch = query.match(/^\/ai\s*(.*)/i);
    const wasAiMode = isAiMode;
    isAiMode = !!aiMatch;

    if (isAiMode !== wasAiMode) {
      overlay.container.classList.toggle('ai-mode', isAiMode);
      if (isAiMode) {
        overlay.input.placeholder = t('aiPlaceholder');
        if (!aiMatch[1]) renderAiEmpty();
      } else {
        overlay.input.placeholder = t('searchPlaceholder');
        aiChatHistory = [];
      }
    }

    if (!query || (isAiMode && !aiMatch[1])) {
      currentQuery = '';
      results = [];
      selectedIndex = 0;
      if (isAiMode) renderAiEmpty();
      else renderEmpty();
      return;
    }

    // In AI mode, don't auto-search — user must press Enter
    if (isAiMode) return;

    // Normal search: debounce 250ms
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
        <span>${t('searching')}</span>
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

  function updateFooterText() {
    if (!overlay || !overlay.footer) return;
    const nav = overlay.footer.querySelector('.footer-navigate');
    const opn = overlay.footer.querySelector('.footer-open');
    const cls = overlay.footer.querySelector('.footer-close');
    if (nav) nav.textContent = t('navigate');
    if (opn) opn.textContent = t('open');
    if (cls) cls.textContent = t('close');
  }

  function renderEmpty() {
    overlay.resultsList.innerHTML = `
      <div class="spotlight-empty">
        <p class="spotlight-empty-title">${t('searchTitle')}</p>
        <p class="spotlight-empty-sub">${t('searchSub')}</p>
        <div class="spotlight-ai-hint">
          <span class="ai-hint-icon">✨</span>
          <span>${t('aiHint')}</span>
        </div>
      </div>
    `;
  }

  function renderNoResults() {
    overlay.resultsList.innerHTML = `
      <div class="spotlight-empty">
        <p class="spotlight-empty-title">${t('noResults')}</p>
        <p class="spotlight-empty-sub">${t('noResultsSub')}</p>
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

    chrome.runtime.sendMessage({
      type: 'OPEN_VIEWER',
      id: result.id,
      query: currentQuery,
    });

    close();
  }

  // ============================================================
  // AI Chat
  // ============================================================

  function renderAiEmpty() {
    const suggestions = [
      { q: currentLang === 'vi' ? 'Tóm tắt trang này' : 'Summarize this page', label: t('aiSummarize') },
      { q: currentLang === 'vi' ? 'Ý chính của trang?' : 'What are the key points?', label: t('aiKeyPoints') },
      { q: currentLang === 'vi' ? 'Tìm trang liên quan trong snapshot' : 'Find related pages in my snapshots', label: t('aiRelated') },
    ];
    overlay.resultsList.innerHTML = `
      <div class="ai-empty">
        <div class="ai-empty-icon">✨</div>
        <p class="ai-empty-title">${t('aiTitle')}</p>
        <p class="ai-empty-sub">${t('aiSub')}</p>
        <div class="ai-suggestions">
          ${suggestions.map(s => `<button class="ai-suggestion" data-q="${s.q}">${s.label}</button>`).join('')}
        </div>
      </div>
    `;
    // Suggestion click handlers
    overlay.resultsList.querySelectorAll('.ai-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.q;
        overlay.input.value = '/ai ' + q;
        sendAiMessage(q);
      });
    });
  }

  function renderAiLoading() {
    // Append loading indicator
    const loadingEl = document.createElement('div');
    loadingEl.className = 'ai-message ai-message-assistant ai-loading-msg';
    loadingEl.innerHTML = `
      <div class="ai-avatar">✨</div>
      <div class="ai-bubble">
        <div class="ai-typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    overlay.resultsList.appendChild(loadingEl);
    loadingEl.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  function renderAiMessage(role, content) {
    const msgEl = document.createElement('div');
    msgEl.className = `ai-message ai-message-${role}`;

    if (role === 'user') {
      msgEl.innerHTML = `
        <div class="ai-bubble">${escapeHtml(content)}</div>
        <div class="ai-avatar">👤</div>
      `;
    } else {
      // Simple markdown-like formatting for AI responses
      let formatted = escapeHtml(content)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^[-•]\s(.+)/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
        .replace(/\n/g, '<br>');

      msgEl.innerHTML = `
        <div class="ai-avatar">✨</div>
        <div class="ai-bubble">${formatted}</div>
      `;
    }

    overlay.resultsList.appendChild(msgEl);
    msgEl.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  function renderAiSnapshots(snapshots) {
    if (!snapshots || snapshots.length === 0) return;
    const el = document.createElement('div');
    el.className = 'ai-related-snapshots';
    el.innerHTML = `
      <div class="ai-related-label">${t('aiRefLabel')}</div>
      ${snapshots.map(s => `
        <div class="ai-related-item" data-id="${s.id}">
          <span class="ai-related-title">${escapeHtml(s.title)}</span>
          <span class="ai-related-domain">${escapeHtml(s.domain)}</span>
        </div>
      `).join('')}
    `;
    overlay.resultsList.appendChild(el);

    el.querySelectorAll('.ai-related-item').forEach(item => {
      item.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_VIEWER', id: item.dataset.id });
        close();
      });
    });
  }

  async function getAiSettings() {
    if (aiSettingsCache) return aiSettingsCache;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (resp?.success) {
        aiSettingsCache = resp.data || {};
        return aiSettingsCache;
      }
    } catch { /* ignore */ }
    aiSettingsCache = {};
    return aiSettingsCache;
  }

  function isBlockedForAI(hostname, blocklist = []) {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    return blocklist.some((entry) => {
      if (!entry) return false;
      const e = entry.toLowerCase();
      if (e.startsWith('.')) return host.endsWith(e);
      if (e.endsWith('.')) return host.startsWith(e);
      return host.includes(e);
    });
  }

  async function ensureAiAllowedForPage(url) {
    const settings = await getAiSettings();
    const blocklist = settings.aiBlockedDomains || [];
    let hostname = '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Chỉ hỗ trợ trang http/https khi gửi tới AI.');
      }
      hostname = parsed.hostname;
    } catch (e) { hostname = ''; if (e?.message) throw e; }

    if (isBlockedForAI(hostname, blocklist)) {
      throw new Error('Tên miền này đang bị chặn gửi đến AI.');
    }

    if (settings.aiRequireConfirm !== false && !aiConsentGranted) {
      const ok = window.confirm('Gửi nội dung trang này tới dịch vụ AI bên ngoài?');
      if (!ok) throw new Error('Đã hủy theo yêu cầu người dùng.');
      aiConsentGranted = true;
    }
    return settings;
  }

  async function sendAiMessage(question) {
    if (isAiLoading || !question.trim()) return;
    isAiLoading = true;

    // If first message, clear the empty state and show chat
    if (aiChatHistory.length === 0) {
      overlay.resultsList.innerHTML = '';
    }

    // Render user message
    renderAiMessage('user', question);
    aiChatHistory.push({ role: 'user', content: question });

    // Show loading
    renderAiLoading();

    try {
      // Extract current page text
      let pageText = '';
      let pageUrl = window.location.href;
      let pageTitle = document.title;
      try {
        pageText = (document.body.innerText || '').substring(0, 8000);
      } catch { /* cross-origin or restricted */ }

      await ensureAiAllowedForPage(pageUrl);

      const response = await chrome.runtime.sendMessage({
        type: 'SPOTLIGHT_AI_CHAT',
        question,
        pageText,
        pageUrl,
        pageTitle,
        chatHistory: aiChatHistory.slice(0, -1), // exclude current question (already added)
        confirmed: true,
      });

      // Remove loading indicator
      const loadingMsg = overlay.resultsList.querySelector('.ai-loading-msg');
      if (loadingMsg) loadingMsg.remove();

      if (response && response.success && response.data) {
        const { answer, relatedSnapshots } = response.data;
        renderAiMessage('assistant', answer);
        aiChatHistory.push({ role: 'assistant', content: answer });
        renderAiSnapshots(relatedSnapshots);
      } else {
        const errMsg = response?.error || 'Failed to get AI response';
        renderAiMessage('assistant', `⚠️ Error: ${errMsg}`);
      }
    } catch (err) {
      // Remove loading indicator
      const loadingMsg = overlay.resultsList.querySelector('.ai-loading-msg');
      if (loadingMsg) loadingMsg.remove();

      renderAiMessage('assistant', `⚠️ Error: ${err.message}`);
    } finally {
      isAiLoading = false;
    }
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
        if (isAiMode) {
          const aiQ = overlay.input.value.trim().replace(/^\/ai\s*/i, '');
          if (aiQ) {
            overlay.input.value = '/ai ';
            sendAiMessage(aiQ);
          }
        } else if (results.length > 0 && results[selectedIndex]) {
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

      .spotlight-ai-hint {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        padding: 8px 14px;
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08));
        border: 1px solid rgba(124,58,237,0.15);
        font-size: 12px;
        color: #6d28d9;
        cursor: default;
        transition: all 0.2s;
      }

      .spotlight-ai-hint:hover {
        background: linear-gradient(135deg, rgba(99,102,241,0.14), rgba(168,85,247,0.14));
        border-color: rgba(124,58,237,0.3);
      }

      .ai-hint-icon {
        font-size: 14px;
      }

      .spotlight-ai-hint kbd {
        background: rgba(124,58,237,0.15);
        border: 1px solid rgba(124,58,237,0.25);
        padding: 1px 6px;
        border-radius: 4px;
        font-family: inherit;
        font-weight: 600;
        color: #7c3aed;
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

        .spotlight-ai-hint {
          background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.12));
          border-color: rgba(124,58,237,0.25);
          color: #c4b5fd;
        }

        .spotlight-ai-hint kbd {
          background: rgba(124,58,237,0.25);
          border-color: rgba(124,58,237,0.35);
          color: #a78bfa;
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

        /* AI Dark mode overrides */
        .ai-mode .spotlight-input-row {
          border-bottom-color: #4c1d95;
        }

        .ai-empty-title { color: #c4b5fd !important; }
        .ai-empty-sub { color: #7c6fad !important; }

        .ai-message-user .ai-bubble {
          background: #5b21b6 !important;
          color: #ede9fe !important;
        }

        .ai-message-assistant .ai-bubble {
          background: #293548 !important;
          color: #e2e8f0 !important;
        }

        .ai-message-assistant .ai-bubble code {
          background: rgba(255,255,255,0.1) !important;
        }

        .ai-related-snapshots {
          border-top-color: #334155 !important;
        }

        .ai-related-item {
          background: #293548 !important;
        }

        .ai-related-item:hover {
          background: #334155 !important;
        }

        .ai-related-title { color: #e2e8f0 !important; }
        .ai-related-domain { color: #64748b !important; }

        .ai-suggestion {
          background: #293548 !important;
          color: #c4b5fd !important;
          border-color: #4c1d95 !important;
        }

        .ai-suggestion:hover {
          background: #334155 !important;
        }
      }

      /* ============================================================
         AI Chat Styles
         ============================================================ */

      .ai-mode .spotlight-input-row {
        border-bottom: 2px solid #7c3aed;
      }

      .ai-mode .spotlight-icon {
        color: #7c3aed;
      }

      /* AI Empty state */
      .ai-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 24px 20px 16px;
        gap: 6px;
      }

      .ai-empty-icon {
        font-size: 28px;
        margin-bottom: 4px;
      }

      .ai-empty-title {
        font-size: 15px;
        font-weight: 600;
        color: #6d28d9;
      }

      .ai-empty-sub {
        font-size: 12px;
        color: #9ca3af;
        margin-bottom: 8px;
      }

      .ai-suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: center;
      }

      .ai-suggestion {
        font-size: 12px;
        padding: 6px 12px;
        border-radius: 20px;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        color: #6d28d9;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
      }

      .ai-suggestion:hover {
        background: #ede9fe;
        border-color: #c4b5fd;
      }

      /* Chat messages */
      .ai-message {
        display: flex;
        gap: 8px;
        padding: 8px 16px;
        align-items: flex-start;
        animation: aiFadeIn 0.2s ease;
      }

      @keyframes aiFadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .ai-message-user {
        justify-content: flex-end;
      }

      .ai-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        flex-shrink: 0;
        background: #f3f4f6;
      }

      .ai-bubble {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.6;
        word-wrap: break-word;
      }

      .ai-message-user .ai-bubble {
        background: #7c3aed;
        color: #fff;
        border-bottom-right-radius: 4px;
      }

      .ai-message-assistant .ai-bubble {
        background: #f3f4f6;
        color: #1f2937;
        border-bottom-left-radius: 4px;
      }

      .ai-message-assistant .ai-bubble strong {
        font-weight: 600;
      }

      .ai-message-assistant .ai-bubble code {
        background: rgba(0,0,0,0.06);
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 12px;
        font-family: 'SF Mono', Monaco, Consolas, monospace;
      }

      .ai-message-assistant .ai-bubble ul {
        margin: 4px 0;
        padding-left: 16px;
      }

      .ai-message-assistant .ai-bubble li {
        margin: 2px 0;
      }

      /* Typing indicator */
      .ai-typing {
        display: flex;
        gap: 4px;
        padding: 4px 0;
      }

      .ai-typing span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #9ca3af;
        animation: aiTypingDot 1.2s ease-in-out infinite;
      }

      .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
      .ai-typing span:nth-child(3) { animation-delay: 0.4s; }

      @keyframes aiTypingDot {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-6px); opacity: 1; }
      }

      /* Related snapshots */
      .ai-related-snapshots {
        margin: 4px 16px 8px;
        padding-top: 8px;
        border-top: 1px solid #e5e7eb;
      }

      .ai-related-label {
        font-size: 11px;
        color: #9ca3af;
        margin-bottom: 6px;
        font-weight: 500;
      }

      .ai-related-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.1s;
        background: #f9fafb;
        margin-bottom: 4px;
      }

      .ai-related-item:hover {
        background: #ede9fe;
      }

      .ai-related-title {
        font-size: 12px;
        color: #1f2937;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .ai-related-domain {
        font-size: 11px;
        color: #9ca3af;
        flex-shrink: 0;
        margin-left: 8px;
      }
    `;
  }
})();
