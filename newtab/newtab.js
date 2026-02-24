// newtab/newtab.js - New Tab Dashboard for Recall

import { MSG } from '../lib/constants.js';

// ============================================================
// Helpers
// ============================================================

function sendMessage(msg) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (response?.success) resolve(response.data);
            else reject(new Error(response?.error || 'Unknown error'));
        });
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
}

function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

// ============================================================
// Clock & Greeting
// ============================================================

function updateClock() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}`;

    const hour = now.getHours();
    let greet = 'Good evening';
    if (hour < 12) greet = 'Good morning';
    else if (hour < 18) greet = 'Good afternoon';
    document.getElementById('greeting').textContent = greet;

    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('date-display').textContent = now.toLocaleDateString('en-US', options);
}

updateClock();
setInterval(updateClock, 30000);

// ============================================================
// Load Data
// ============================================================

async function loadDashboard() {
    try {
        const stats = await sendMessage({ type: MSG.GET_DASHBOARD_STATS });

        document.getElementById('stat-total').textContent = (stats.totalCount || 0).toLocaleString();
        document.getElementById('stat-today').textContent = (stats.todayCount || 0).toLocaleString();
        document.getElementById('stat-week').textContent = (stats.weekCount || 0).toLocaleString();

        // Calculate streak
        const perDay = stats.perDay || {};
        const today = new Date();
        let streak = 0;
        for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            if (perDay[key] && perDay[key] > 0) {
                streak++;
            } else if (i > 0) {
                break;
            }
        }
        document.getElementById('stat-streak').textContent = streak;

        // Top domains
        renderDomains(stats.topDomains || []);
    } catch (e) {
        console.warn('[Recall NewTab] Stats load failed:', e);
    }
}

async function loadRecentSnapshots() {
    try {
        const data = await sendMessage({ type: MSG.GET_SNAPSHOTS, limit: 12, offset: 0 });
        const snapshots = data.snapshots || data || [];
        renderRecentGrid(snapshots.slice(0, 12));
    } catch (e) {
        console.warn('[Recall NewTab] Snapshots load failed:', e);
        document.getElementById('recent-grid').innerHTML = '<p class="empty-msg">No snapshots yet. Start capturing!</p>';
    }
}

// ============================================================
// Render
// ============================================================

function renderRecentGrid(snapshots) {
    const grid = document.getElementById('recent-grid');

    if (!snapshots || snapshots.length === 0) {
        grid.innerHTML = '<p class="empty-msg">No snapshots yet. Start browsing and capturing!</p>';
        return;
    }

    grid.innerHTML = snapshots.map(snap => {
        const domain = getDomain(snap.url);
        const thumb = snap.thumbnailDataUrl
            ? `<img src="${snap.thumbnailDataUrl}" alt="" class="card-thumb" loading="lazy">`
            : `<div class="card-thumb-placeholder"><span>${domain.charAt(0).toUpperCase()}</span></div>`;

        return `
      <a class="snapshot-card" href="#" data-id="${snap.id}" title="${escapeHtml(snap.title)}">
        <div class="card-image">
          ${thumb}
          <div class="card-overlay">
            <span class="card-badge">${snap.captureType || 'auto'}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(snap.title || 'Untitled')}</div>
          <div class="card-meta">
            <span class="card-domain">${escapeHtml(domain)}</span>
            <span class="card-time">${timeAgo(snap.timestamp)}</span>
          </div>
        </div>
      </a>
    `;
    }).join('');

    // Click → open viewer
    grid.querySelectorAll('.snapshot-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            const id = card.dataset.id;
            const viewerUrl = chrome.runtime.getURL(`viewer/viewer.html?id=${encodeURIComponent(id)}`);
            window.location.href = viewerUrl;
        });
    });
}

function renderDomains(domains) {
    const list = document.getElementById('domains-list');
    if (!domains || domains.length === 0) {
        list.innerHTML = '<p class="empty-msg">No data yet</p>';
        return;
    }

    const max = domains[0]?.count || 1;
    list.innerHTML = domains.slice(0, 6).map(d => {
        const pct = Math.round((d.count / max) * 100);
        return `
      <div class="domain-row">
        <span class="domain-name">${escapeHtml(d.domain || 'Unknown')}</span>
        <div class="domain-bar-track">
          <div class="domain-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="domain-count">${d.count}</span>
      </div>
    `;
    }).join('');
}

// ============================================================
// Spotlight Search + /ai Chat
// ============================================================

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const aiChatPanel = document.getElementById('ai-chat-panel');
let aiChatHistory = [];
let searchDebounce = null;

// --- Spotlight Search (real-time) ---

searchInput.addEventListener('input', () => {
    const value = searchInput.value.trim();
    const hint = document.querySelector('.search-hint');

    // Update hint style
    if (hint) {
        hint.style.opacity = value.toLowerCase().startsWith('/ai') ? '1' : '0.5';
    }

    // Skip search if typing /ai command
    if (value.toLowerCase().startsWith('/ai')) {
        searchResults.innerHTML = '';
        searchResults.style.display = 'none';
        return;
    }

    // Debounced search
    clearTimeout(searchDebounce);
    if (value.length < 2) {
        searchResults.innerHTML = '';
        searchResults.style.display = 'none';
        return;
    }

    searchDebounce = setTimeout(() => spotlightSearch(value), 300);
});

async function spotlightSearch(query) {
    try {
        const data = await sendMessage({ type: MSG.SPOTLIGHT_SEARCH, query, limit: 8 });
        const results = data.snapshots || data || [];

        if (results.length === 0) {
            searchResults.innerHTML = '<div class="sr-empty">No results found</div>';
            searchResults.style.display = 'block';
            return;
        }

        searchResults.innerHTML = results.slice(0, 8).map(snap => {
            const domain = getDomain(snap.url);
            const thumb = snap.thumbnailDataUrl
                ? `<img src="${snap.thumbnailDataUrl}" class="sr-thumb">`
                : `<div class="sr-thumb sr-thumb-placeholder">${domain.charAt(0).toUpperCase()}</div>`;
            return `
        <div class="sr-item" data-id="${snap.id}">
          ${thumb}
          <div class="sr-info">
            <div class="sr-title">${escapeHtml(snap.title || 'Untitled')}</div>
            <div class="sr-meta">${escapeHtml(domain)} · ${timeAgo(snap.timestamp)}</div>
          </div>
        </div>`;
        }).join('');

        searchResults.style.display = 'block';

        // Click handlers
        searchResults.querySelectorAll('.sr-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                window.location.href = chrome.runtime.getURL(`viewer/viewer.html?id=${encodeURIComponent(id)}`);
            });
        });
    } catch (e) {
        console.warn('[Recall] Search error:', e);
        searchResults.innerHTML = '<div class="sr-empty">Search error</div>';
        searchResults.style.display = 'block';
    }
}

// --- Enter key: /ai chat OR open manager ---

searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
        searchResults.style.display = 'none';
        searchInput.blur();
        return;
    }

    if (e.key !== 'Enter' || !searchInput.value.trim()) return;

    const value = searchInput.value.trim();

    // /ai command → AI chat
    if (value.toLowerCase().startsWith('/ai ')) {
        const question = value.slice(4).trim();
        if (!question) return;

        e.preventDefault();
        searchInput.value = '';
        searchResults.style.display = 'none';

        // Show chat panel
        aiChatPanel.style.display = 'block';

        // Add user message
        addChatMessage('user', question);
        aiChatHistory.push({ role: 'user', content: question });

        // Add typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'ai-typing';
        typingEl.id = 'ai-typing-active';
        typingEl.innerHTML = '<span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span>';
        aiChatPanel.appendChild(typingEl);
        aiChatPanel.scrollTop = aiChatPanel.scrollHeight;

        try {
            const result = await sendMessage({
                type: MSG.AI_MEMORY_CHAT,
                question,
                history: aiChatHistory.slice(-10),
            });

            // Remove typing
            typingEl.remove();

            const answer = result.answer || result || 'No response';
            addChatMessage('ai', answer);
            aiChatHistory.push({ role: 'assistant', content: answer });

            if (result.relatedSnapshots && result.relatedSnapshots.length > 0) {
                addRelatedSnapshots(result.relatedSnapshots);
            }
        } catch (err) {
            typingEl.remove();
            addChatMessage('error', 'AI error: ' + err.message);
        }

        aiChatPanel.scrollTop = aiChatPanel.scrollHeight;
        return;
    }

    // Regular search: if results visible, clicking Enter navigates to first result
    const firstItem = searchResults.querySelector('.sr-item');
    if (firstItem && searchResults.style.display === 'block') {
        firstItem.click();
        return;
    }

    // Fallback: open manager
    const q = encodeURIComponent(value);
    window.location.href = chrome.runtime.getURL(`manager/manager.html?search=${q}`);
});

// Close results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
        searchResults.style.display = 'none';
    }
});

// Re-show on focus if has content
searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2 && searchResults.innerHTML) {
        searchResults.style.display = 'block';
    }
});

// --- AI Chat Helpers ---

function addChatMessage(type, text) {
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg-${type}`;

    if (type === 'user') {
        div.innerHTML = `<div class="ai-msg-avatar">👤</div><div class="ai-msg-content">${escapeHtml(text)}</div>`;
    } else if (type === 'ai') {
        div.innerHTML = `<div class="ai-msg-avatar">🧠</div><div class="ai-msg-content">${renderSimpleMarkdown(text)}</div>`;
    } else {
        div.innerHTML = `<div class="ai-msg-avatar">⚠️</div><div class="ai-msg-content ai-msg-error">${escapeHtml(text)}</div>`;
    }

    aiChatPanel.appendChild(div);
}

function addRelatedSnapshots(snapshots) {
    const div = document.createElement('div');
    div.className = 'ai-related';
    div.innerHTML = `<span class="ai-related-label">📎 Related:</span> ${snapshots.slice(0, 3).map(s =>
        `<a href="#" class="ai-related-link" data-id="${s.id}">${escapeHtml(s.title || 'Untitled')}</a>`
    ).join('')
        }`;
    aiChatPanel.appendChild(div);

    div.querySelectorAll('.ai-related-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = chrome.runtime.getURL(`viewer/viewer.html?id=${encodeURIComponent(link.dataset.id)}`);
        });
    });
}

function renderSimpleMarkdown(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/^### (.*$)/gm, '<h4>$1</h4>')
        .replace(/^## (.*$)/gm, '<h3>$1</h3>')
        .replace(/^- (.*$)/gm, '<li>$1</li>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

// ============================================================
// Buttons
// ============================================================

document.getElementById('btn-open-manager').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: MSG.OPEN_MANAGER });
});

document.getElementById('btn-capture').addEventListener('click', () => {
    // Get current tab and capture
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.runtime.sendMessage({ type: MSG.CAPTURE_TAB, tabId: tabs[0].id });
        }
    });
});

// ============================================================
// Wallpaper Picker
// ============================================================

const WALLPAPER_PRESETS = [
    { name: 'Default', value: '' },
    { name: 'Ocean', value: 'linear-gradient(135deg, #0c1445 0%, #0d2137 30%, #0a3d62 60%, #1a1a2e 100%)' },
    { name: 'Sunset', value: 'linear-gradient(135deg, #2d1b69 0%, #6b2fa0 30%, #e74c8b 70%, #fd9644 100%)' },
    { name: 'Forest', value: 'linear-gradient(135deg, #0b3d1e 0%, #1a5c34 30%, #2d8659 60%, #134e36 100%)' },
    { name: 'Aurora', value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 35%, #24243e 65%, #0f0c29 100%)' },
    { name: 'Cherry', value: 'linear-gradient(135deg, #2a0134 0%, #6b0f4a 40%, #a73e7a 70%, #2a0134 100%)' },
    { name: 'Midnight', value: 'linear-gradient(135deg, #020024 0%, #090979 50%, #0a0a23 100%)' },
    { name: 'Warm', value: 'linear-gradient(135deg, #2c1810 0%, #4a2520 30%, #7a3b30 60%, #3d1a0e 100%)' },
    { name: 'Frost', value: 'linear-gradient(135deg, #0f1b35 0%, #1a3a5c 30%, #2980b9 60%, #0f1b35 100%)' },
    { name: 'Lavender', value: 'linear-gradient(135deg, #1a0533 0%, #2d1b69 35%, #5c4d9a 65%, #1a0533 100%)' },
    { name: 'Ember', value: 'linear-gradient(135deg, #1a0000 0%, #4a0e0e 30%, #8b2500 60%, #1a0000 100%)' },
    { name: 'Teal', value: 'linear-gradient(135deg, #0a2922 0%, #0e4d40 35%, #17806d 65%, #0a2922 100%)' },
];

const wpOverlay = document.getElementById('wp-overlay');
const wpPresetsGrid = document.getElementById('wp-presets');
const wpFileInput = document.getElementById('wp-file-input');
const bgImage = document.getElementById('bg-image');
const bgGradient = document.querySelector('.bg-gradient');

// Build preset grid
WALLPAPER_PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.className = 'wp-preset-btn';
    btn.title = preset.name;
    btn.dataset.index = i;
    if (preset.value) {
        btn.style.background = preset.value;
    } else {
        btn.style.background = 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)';
        btn.innerHTML = '<span class="wp-preset-label">Default</span>';
    }
    btn.addEventListener('click', () => applyWallpaper({ type: 'gradient', index: i }));
    wpPresetsGrid.appendChild(btn);
});

document.getElementById('btn-wallpaper').addEventListener('click', () => {
    wpOverlay.style.display = 'flex';
});

document.getElementById('wp-close').addEventListener('click', () => {
    wpOverlay.style.display = 'none';
});

wpOverlay.addEventListener('click', (e) => {
    if (e.target === wpOverlay) wpOverlay.style.display = 'none';
});

document.getElementById('wp-upload-btn').addEventListener('click', () => {
    wpFileInput.click();
});

wpFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        applyWallpaper({ type: 'image', data: reader.result });
    };
    reader.readAsDataURL(file);
});

document.getElementById('wp-url-btn').addEventListener('click', () => {
    const url = prompt('Enter image URL:');
    if (url && url.trim()) {
        applyWallpaper({ type: 'url', data: url.trim() });
    }
});

document.getElementById('wp-reset-btn').addEventListener('click', () => {
    applyWallpaper({ type: 'gradient', index: 0 });
});

// Opacity slider
const wpOpacitySlider = document.getElementById('wp-opacity');
const wpOpacityVal = document.getElementById('wp-opacity-val');

wpOpacitySlider.addEventListener('input', () => {
    const val = wpOpacitySlider.value;
    wpOpacityVal.textContent = val + '%';
    const opacity = val / 100;
    bgGradient.style.opacity = opacity;
    bgImage.style.opacity = opacity;
    // Save opacity
    chrome.storage.local.get('newtabWallpaper', (result) => {
        const wp = result.newtabWallpaper || {};
        wp.opacity = val;
        chrome.storage.local.set({ newtabWallpaper: wp });
    });
});

function applyWallpaper(wp) {
    if (wp.type === 'gradient') {
        const preset = WALLPAPER_PRESETS[wp.index] || WALLPAPER_PRESETS[0];
        bgImage.style.backgroundImage = '';
        bgImage.style.display = 'none';
        if (preset.value) {
            bgGradient.style.background = preset.value;
        } else {
            bgGradient.style.background = '';
        }
    } else if (wp.type === 'image' || wp.type === 'url') {
        const src = wp.data;
        bgImage.style.backgroundImage = `url("${src}")`;
        bgImage.style.display = 'block';
        bgGradient.style.background = 'transparent';
    }

    // Preserve current opacity
    const currentOpacity = wpOpacitySlider.value;
    wp.opacity = currentOpacity;

    // Save
    const saveData = { ...wp };
    if (wp.type === 'image' && wp.data && wp.data.length > 2 * 1024 * 1024) {
        console.warn('[Recall] Large wallpaper image, may hit storage limits');
    }
    chrome.storage.local.set({ newtabWallpaper: saveData });
    wpOverlay.style.display = 'none';
}

function loadWallpaper() {
    chrome.storage.local.get('newtabWallpaper', (result) => {
        const wp = result.newtabWallpaper;
        if (!wp) return;

        // Apply opacity
        if (wp.opacity !== undefined) {
            const opacity = wp.opacity / 100;
            bgGradient.style.opacity = opacity;
            bgImage.style.opacity = opacity;
            wpOpacitySlider.value = wp.opacity;
            wpOpacityVal.textContent = wp.opacity + '%';
        }

        if (wp.type === 'gradient') {
            const preset = WALLPAPER_PRESETS[wp.index] || WALLPAPER_PRESETS[0];
            if (preset.value) {
                bgGradient.style.background = preset.value;
            }
        } else if (wp.type === 'image' || wp.type === 'url') {
            bgImage.style.backgroundImage = `url("${wp.data}")`;
            bgImage.style.display = 'block';
            bgGradient.style.background = 'transparent';
        }
    });
}

// ============================================================
// Init
// ============================================================

loadDashboard();
loadRecentSnapshots();
loadWallpaper();
