// popup/popup.js - Popup logic

import { MSG } from '../lib/constants.js';
import { initTheme, createThemeToggle } from '../lib/theme.js';
import { showConfirm } from '../lib/dialog.js';
import { initI18n, t, applyI18n } from '../lib/i18n.js';

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
  // Load language
  await initI18n();
  applyI18n();

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
  btn.textContent = t('popup-capturing');

  try {
    await sendMessage({ type: MSG.CAPTURE_PAGE });
    btn.textContent = t('popup-captured');
    setTimeout(() => window.close(), 1000);
  } catch (e) {
    btn.textContent = t('popup-failed');
    console.error(e);
    setTimeout(() => {
      btn.textContent = t('popup-capture');
      btn.disabled = false;
    }, 2000);
  }
});

// Deep capture
document.getElementById('btn-deep-capture').addEventListener('click', async () => {
  const btn = document.getElementById('btn-deep-capture');

  if (!await showConfirm('Chrome will show a "debugging" banner while capturing.\nThis captures ALL page resources for maximum fidelity.', { title: 'Deep Capture', confirmText: 'Continue', cancelText: 'Cancel' })) {
    return;
  }

  btn.disabled = true;
  btn.textContent = t('popup-deep-capturing');

  try {
    await sendMessage({ type: MSG.CAPTURE_DEEP, userGesture: true });
    btn.textContent = t('popup-done');
    setTimeout(() => window.close(), 1000);
  } catch (e) {
    btn.textContent = t('popup-failed');
    console.error(e);
    setTimeout(() => {
      btn.textContent = t('popup-deep-capture');
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
  btn.textContent = t('popup-adding');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) throw new Error('No active tab');

    await sendMessage({
      type: MSG.WATCH_PAGE,
      url: tab.url,
      title: tab.title,
    });
    btn.textContent = t('popup-watching');
    setTimeout(() => window.close(), 1000);
  } catch (e) {
    if (e.message && e.message.includes('already')) {
      btn.textContent = t('popup-already-watching');
    } else {
      btn.textContent = t('popup-failed');
      console.error(e);
    }
    setTimeout(() => {
      btn.textContent = t('popup-watch');
      btn.disabled = false;
    }, 2000);
  }
});

// Read Later
document.getElementById('btn-read-later').addEventListener('click', async () => {
  const btn = document.getElementById('btn-read-later');
  btn.disabled = true;
  btn.textContent = t('popup-saving');

  try {
    await sendMessage({ type: MSG.MARK_READ_LATER });
    btn.textContent = t('popup-saved');
    setTimeout(() => window.close(), 1000);
  } catch (e) {
    btn.textContent = t('popup-failed');
    console.error(e);
    setTimeout(() => {
      btn.textContent = t('popup-read-later');
      btn.disabled = false;
    }, 2000);
  }
});
// Restore Last Session
document.getElementById('btn-restore-session').addEventListener('click', async () => {
  const btn = document.getElementById('btn-restore-session');
  btn.disabled = true;
  btn.textContent = t('popup-checking');

  try {
    const sessions = await sendMessage({ type: MSG.GET_SESSIONS });
    if (!sessions || sessions.length === 0) {
      btn.textContent = t('popup-no-session');
      setTimeout(() => {
        btn.textContent = t('popup-restore-session');
        btn.disabled = false;
      }, 2000);
      return;
    }

    const latest = sessions[0];
    const tabCount = latest.tabs ? latest.tabs.length : 0;
    if (tabCount === 0) {
      btn.textContent = t('popup-empty-session');
      setTimeout(() => {
        btn.textContent = t('popup-restore-session');
        btn.disabled = false;
      }, 2000);
      return;
    }

    if (!await showConfirm(`Restore ${tabCount} tab(s) from ${new Date(latest.savedAt).toLocaleString()}?`, { title: 'Restore Session', confirmText: 'Restore', cancelText: t('dialog-cancel') })) {
      btn.textContent = t('popup-restore-session');
      btn.disabled = false;
      return;
    }

    btn.textContent = t('popup-restoring');
    await sendMessage({ type: MSG.RESTORE_SESSION, sessionId: latest.id, mode: 'online' });
    btn.textContent = `Restored ${tabCount} tabs!`;
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    btn.textContent = t('popup-failed');
    console.error(e);
    setTimeout(() => {
      btn.textContent = t('popup-restore-session');
      btn.disabled = false;
    }, 2000);
  }
});

// Save Current Session
document.getElementById('btn-save-session').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-session');
  btn.disabled = true;
  btn.textContent = t('popup-saving');

  try {
    await sendMessage({ type: MSG.SAVE_SESSION });
    btn.textContent = t('popup-session-saved');
    setTimeout(() => {
      btn.textContent = t('popup-save-session');
      btn.disabled = false;
    }, 1500);
  } catch (e) {
    btn.textContent = t('popup-failed');
    console.error(e);
    setTimeout(() => {
      btn.textContent = t('popup-save-session');
      btn.disabled = false;
    }, 2000);
  }
});

// Save All Open Tabs
document.getElementById('btn-save-all-tabs').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-all-tabs');

  if (!await showConfirm('Capture all open tabs in this window?\nThis may take a moment.', { title: 'Save All Tabs', confirmText: 'Save All', cancelText: 'Cancel' })) {
    return;
  }

  btn.disabled = true;
  btn.textContent = t('popup-saving');

  try {
    const result = await sendMessage({ type: MSG.SAVE_ALL_TABS });
    btn.textContent = `Saved ${result.captured}/${result.total} tabs!`;
    setTimeout(() => window.close(), 2000);
  } catch (e) {
    btn.textContent = t('popup-failed');
    console.error(e);
    setTimeout(() => {
      btn.textContent = t('popup-save-all-tabs');
      btn.disabled = false;
    }, 2000);
  }
});

initTheme();
createThemeToggle(document.getElementById('theme-toggle-container'));

init();
