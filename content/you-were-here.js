// content/you-were-here.js - "You were here" notification bar
// Shows a subtle bar when the user revisits a page that has saved snapshots.

(() => {
  if (window.__recallYouWereHereInjected) return;
  window.__recallYouWereHereInjected = true;

  // Don't run on extension pages
  if (location.protocol === 'chrome-extension:' || location.protocol === 'chrome:') return;

  // Per-tab session: track dismissed URLs so we don't nag
  const DISMISSED_KEY = '__recall_ywh_dismissed';
  function isDismissed() {
    try { return sessionStorage.getItem(DISMISSED_KEY) === location.href; }
    catch { return false; }
  }
  function markDismissed() {
    try { sessionStorage.setItem(DISMISSED_KEY, location.href); }
    catch { /* private mode */ }
  }

  // Delay check to not race with page load
  setTimeout(checkForSnapshots, 2500);

  async function checkForSnapshots() {
    if (isDismissed()) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_URL_SNAPSHOTS',
        url: location.href,
      });

      if (!response || !response.success) return;
      const { snapshots, count } = response.data;
      if (count === 0) return;

      showBar(snapshots, count);
    } catch {
      // Extension context invalidated or similar
    }
  }

  function showBar(snapshots, count) {
    const host = document.createElement('div');
    host.id = 'recall-ywh-host';
    const shadow = host.attachShadow({ mode: 'closed' });

    const latest = snapshots[0];
    const timeAgo = formatTimeAgo(latest.timestamp);

    shadow.innerHTML = `
      <style>${getStyles()}</style>
      <div class="ywh-bar" id="bar">
        <div class="ywh-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M8 4v4.5l3 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="ywh-text">
          You have <strong>${count} snapshot${count > 1 ? 's' : ''}</strong> of this page. Last saved <strong>${timeAgo}</strong>.
        </span>
        <button class="ywh-btn ywh-btn-view" id="btn-view" title="View latest snapshot">
          View latest
        </button>
        ${count > 1 ? `<button class="ywh-btn ywh-btn-all" id="btn-all" title="View all snapshots">All (${count})</button>` : ''}
        <button class="ywh-close" id="btn-close" title="Dismiss">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;

    const bar = shadow.getElementById('bar');
    const btnView = shadow.getElementById('btn-view');
    const btnAll = shadow.getElementById('btn-all');
    const btnClose = shadow.getElementById('btn-close');

    btnView.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'OPEN_VIEWER',
        id: latest.id,
      });
    });

    if (btnAll) {
      btnAll.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_MANAGER' });
      });
    }

    btnClose.addEventListener('click', () => {
      bar.classList.add('hiding');
      markDismissed();
      setTimeout(() => host.remove(), 300);
    });

    // Auto-hide after 8 seconds
    setTimeout(() => {
      if (host.isConnected && !bar.classList.contains('hiding')) {
        bar.classList.add('hiding');
        setTimeout(() => host.remove(), 300);
      }
    }, 8000);

    document.body.appendChild(host);
  }

  function formatTimeAgo(ts) {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (s < 60) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    return new Date(ts).toLocaleDateString();
  }

  function getStyles() {
    return `
      .ywh-bar {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #1e293b;
        color: #e2e8f0;
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        animation: ywh-slideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        transition: opacity 0.25s, transform 0.25s;
        max-width: 580px;
      }

      .ywh-bar.hiding {
        opacity: 0;
        transform: translateY(-10px);
      }

      @keyframes ywh-slideIn {
        from { opacity: 0; transform: translateX(30px); }
        to   { opacity: 1; transform: translateX(0); }
      }

      .ywh-icon {
        flex-shrink: 0;
        color: #60a5fa;
        display: flex;
      }

      .ywh-text {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ywh-text strong {
        color: #ffffff;
        font-weight: 600;
      }

      .ywh-btn {
        flex-shrink: 0;
        border: none;
        border-radius: 6px;
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s;
      }

      .ywh-btn-view {
        background: #3b82f6;
        color: #fff;
      }
      .ywh-btn-view:hover {
        background: #2563eb;
      }

      .ywh-btn-all {
        background: #334155;
        color: #cbd5e1;
      }
      .ywh-btn-all:hover {
        background: #475569;
      }

      .ywh-close {
        flex-shrink: 0;
        background: none;
        border: none;
        color: #64748b;
        cursor: pointer;
        padding: 2px;
        display: flex;
        align-items: center;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }
      .ywh-close:hover {
        color: #e2e8f0;
        background: rgba(255,255,255,0.08);
      }

      @media (prefers-color-scheme: light) {
        .ywh-bar {
          background: #ffffff;
          color: #334155;
          box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06);
        }
        .ywh-text strong { color: #0f172a; }
        .ywh-btn-all { background: #f1f5f9; color: #475569; }
        .ywh-btn-all:hover { background: #e2e8f0; }
        .ywh-close { color: #94a3b8; }
        .ywh-close:hover { color: #334155; background: rgba(0,0,0,0.05); }
      }
    `;
  }
})();
