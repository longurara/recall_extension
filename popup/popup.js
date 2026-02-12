// popup/popup.js - Popup logic

import { MSG } from '../lib/constants.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.success) resolve(response.data);
      else reject(new Error(response?.error || 'Unknown error'));
    });
  });
}

// ============================================================
// Init
// ============================================================

async function init() {
  // Load snapshot count
  try {
    const snapshots = await sendMessage({ type: MSG.GET_SNAPSHOTS });
    document.getElementById('snapshot-count').textContent = snapshots.length;
  } catch { }

  // Load settings
  try {
    const settings = await sendMessage({ type: MSG.GET_SETTINGS });
    document.getElementById('toggle-auto').checked = settings.autoCapture;
  } catch { }

  // Load storage usage
  try {
    const usage = await sendMessage({ type: MSG.GET_STORAGE_USAGE });
    const fill = document.getElementById('storage-fill');
    fill.style.width = `${Math.min(usage.usagePercent, 100)}%`;
    fill.className = 'storage-fill' +
      (usage.isCritical ? ' critical' : usage.isWarning ? ' warning' : '');
    document.getElementById('storage-text').textContent =
      `${usage.totalSizeFormatted} / ${usage.maxFormatted}`;
  } catch {
    document.getElementById('storage-text').textContent = 'N/A';
  }
}

// ============================================================
// Event Listeners
// ============================================================

// Capture current page
document.getElementById('btn-capture').addEventListener('click', async () => {
  const btn = document.getElementById('btn-capture');
  btn.disabled = true;
  btn.textContent = 'Capturing...';

  try {
    await sendMessage({ type: MSG.CAPTURE_PAGE });
    btn.textContent = 'Captured!';
    setTimeout(() => window.close(), 1000);
  } catch (e) {
    btn.textContent = 'Failed';
    console.error(e);
    setTimeout(() => {
      btn.textContent = 'Capture This Page';
      btn.disabled = false;
    }, 2000);
  }
});

// Deep capture
document.getElementById('btn-deep-capture').addEventListener('click', async () => {
  const btn = document.getElementById('btn-deep-capture');

  if (!confirm('Deep Capture uses Chrome DevTools Protocol.\n\nChrome will show a "debugging" banner while capturing.\nThis captures ALL page resources for maximum fidelity.\n\nContinue?')) {
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Deep Capturing...';

  try {
    await sendMessage({ type: MSG.CAPTURE_DEEP });
    btn.textContent = 'Done!';
    setTimeout(() => window.close(), 1000);
  } catch (e) {
    btn.textContent = 'Failed';
    console.error(e);
    setTimeout(() => {
      btn.textContent = 'Deep Capture (CDP)';
      btn.disabled = false;
    }, 2000);
  }
});

// Open side panel
document.getElementById('btn-sidepanel').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    window.close();
  } catch (e) {
    console.error('Side panel error:', e);
  }
});

// Open manager
document.getElementById('btn-manager').addEventListener('click', () => {
  sendMessage({ type: MSG.OPEN_MANAGER });
  window.close();
});

// Open settings
document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  window.close();
});

// Toggle auto-capture
document.getElementById('toggle-auto').addEventListener('change', async (e) => {
  try {
    await sendMessage({ type: MSG.TOGGLE_AUTO_CAPTURE });
  } catch (err) {
    e.target.checked = !e.target.checked;
    console.error(err);
  }
});

// Watch this page
document.getElementById('btn-watch-page').addEventListener('click', async () => {
  const btn = document.getElementById('btn-watch-page');
  btn.disabled = true;
  btn.textContent = 'Adding...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) throw new Error('No active tab');

    await sendMessage({
      type: MSG.WATCH_PAGE,
      url: tab.url,
      title: tab.title,
    });
    btn.textContent = 'Watching!';
    setTimeout(() => window.close(), 1000);
  } catch (e) {
    if (e.message && e.message.includes('already')) {
      btn.textContent = 'Already watching';
    } else {
      btn.textContent = 'Failed';
      console.error(e);
    }
    setTimeout(() => {
      btn.textContent = 'Watch This Page';
      btn.disabled = false;
    }, 2000);
  }
});

initTheme();
createThemeToggle(document.getElementById('theme-toggle-container'));

init();
