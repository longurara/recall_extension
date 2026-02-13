// dashboard/dashboard.js - Dashboard analytics for Recall extension

import { MSG } from '../lib/constants.js';
import { formatBytes } from '../lib/utils.js';
import { initTheme } from '../lib/theme.js';
import { initI18n, applyI18n } from '../lib/i18n.js';

initTheme();
initI18n().then(() => applyI18n());

async function sendMessage(msg) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (response?.success) resolve(response.data);
            else reject(new Error(response?.error || 'Unknown error'));
        });
    });
}

async function loadDashboard() {
    try {
        const stats = await sendMessage({ type: MSG.GET_DASHBOARD_STATS });

        // Update stat cards
        document.getElementById('stat-total').textContent = stats.totalCount.toLocaleString();
        document.getElementById('stat-today').textContent = stats.todayCount.toLocaleString();
        document.getElementById('stat-week').textContent = stats.weekCount.toLocaleString();
        document.getElementById('stat-unread').textContent = stats.unreadCount.toLocaleString();

        // Draw snapshots per day chart
        drawPerDayChart(stats.perDay);

        // Top domains
        renderBarList('chart-domains', stats.topDomains.map(d => ({
            label: d.domain || 'Unknown',
            value: d.count,
            suffix: ' snapshots',
        })));

        // Storage by domain
        renderBarList('chart-storage', stats.storageByDomain.map(d => ({
            label: d.domain || 'Unknown',
            value: formatBytes(d.size),
            rawValue: d.size,
        })));

        // Capture types
        const typeColors = { auto: '#6366f1', manual: '#10b981', deep: '#f59e0b', clip: '#ef4444', readlater: '#8b5cf6' };
        const typeGrid = document.getElementById('chart-types');
        typeGrid.innerHTML = '';
        for (const [type, count] of Object.entries(stats.captureTypes)) {
            const item = document.createElement('div');
            item.className = 'type-item';
            item.innerHTML = `
        <span class="type-dot" style="background:${typeColors[type] || '#94a3b8'}"></span>
        <span class="type-name">${type}</span>
        <span class="type-count">${count}</span>
      `;
            typeGrid.appendChild(item);
        }
    } catch (e) {
        console.error('[Dashboard] Failed to load:', e);
    }
}

function drawPerDayChart(perDay) {
    const canvas = document.getElementById('chart-per-day');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const padding = { top: 20, right: 20, bottom: 30, left: 40 };

    const dates = Object.keys(perDay).sort();
    const values = dates.map(d => perDay[d]);
    const maxVal = Math.max(...values, 1);

    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const barW = Math.max(2, chartW / dates.length - 2);

    // Background
    ctx.fillStyle = 'transparent';
    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--border') || '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartH * i / 4);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary') || '#888';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * (1 - i / 4)), padding.left - 5, y + 4);
    }

    // Bars
    const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
    gradient.addColorStop(0, '#6366f1');
    gradient.addColorStop(1, '#4f46e5');

    dates.forEach((date, i) => {
        const x = padding.left + (i * (chartW / dates.length)) + 1;
        const barH = (values[i] / maxVal) * chartH;
        const y = padding.top + chartH - barH;

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [2, 2, 0, 0]);
        ctx.fill();
    });

    // X-axis labels (every 7 days)
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary') || '#888';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    dates.forEach((date, i) => {
        if (i % 7 === 0 || i === dates.length - 1) {
            const x = padding.left + (i * (chartW / dates.length)) + barW / 2;
            ctx.fillText(date.slice(5), x, h - 5);
        }
    });
}

function renderBarList(containerId, items) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const maxRaw = Math.max(...items.map(i => i.rawValue || i.value || 1), 1);

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'bar-row';
        const pct = ((item.rawValue || item.value) / maxRaw * 100).toFixed(0);
        row.innerHTML = `
      <div class="bar-label">${item.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="bar-value">${typeof item.value === 'number' ? item.value.toLocaleString() : item.value}${item.suffix || ''}</div>
    `;
        container.appendChild(row);
    });
}

// Events
document.getElementById('btn-manager').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: MSG.OPEN_MANAGER });
});

// Init
loadDashboard();
