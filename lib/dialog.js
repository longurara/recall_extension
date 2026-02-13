// lib/dialog.js - Custom dialog replacements for confirm() and alert()
// Import: import { showConfirm, showAlert } from '../lib/dialog.js';
import { t } from './i18n.js';

let cssInjected = false;

function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('lib/dialog.css');
  document.head.appendChild(link);
}

// SVG icons
const ICONS = {
  confirm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`,
  danger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>`,
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
  </svg>`,
};

/**
 * Show a custom confirm dialog.
 * @param {string} message - The message to display
 * @param {object} [options] - { title, confirmText, cancelText, type }
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 *
 * type: 'confirm' | 'danger' (danger makes confirm button red)
 */
export function showConfirm(message, options = {}) {
  injectCSS();

  const {
    title = '',
    confirmText = t('dialog-ok'),
    cancelText = t('dialog-cancel'),
    type = 'confirm', // 'confirm' | 'danger'
  } = options;

  return new Promise((resolve) => {
    const iconType = type === 'danger' ? 'danger' : 'confirm';

    const overlay = document.createElement('div');
    overlay.className = 'recall-dialog-overlay';
    overlay.innerHTML = `
      <div class="recall-dialog" role="alertdialog" aria-modal="true">
        <div class="recall-dialog-icon ${iconType}">
          ${ICONS[iconType]}
        </div>
        <div class="recall-dialog-body">
          ${title ? `<div class="recall-dialog-title">${title}</div>` : ''}
          <div class="recall-dialog-message">${message}</div>
        </div>
        <div class="recall-dialog-actions">
          <button class="recall-dialog-btn cancel" data-action="cancel">${cancelText}</button>
          <button class="recall-dialog-btn ${type === 'danger' ? 'danger' : 'primary'}" data-action="confirm">${confirmText}</button>
        </div>
      </div>
    `;

    function cleanup(result) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 150);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'confirm') cleanup(true);
      if (action === 'cancel') cleanup(false);
    });

    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);

    // Trigger animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('visible'));
    });

    // Focus confirm button
    overlay.querySelector('[data-action="confirm"]').focus();
  });
}

/**
 * Show a custom alert dialog.
 * @param {string} message - The message to display
 * @param {object} [options] - { title, okText, type }
 * @returns {Promise<void>}
 *
 * type: 'info' | 'success' | 'warning' | 'error'
 */
export function showAlert(message, options = {}) {
  injectCSS();

  const {
    title = '',
    okText = t('dialog-ok'),
    type = 'info', // 'info' | 'success' | 'warning' | 'error'
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'recall-dialog-overlay';
    overlay.innerHTML = `
      <div class="recall-dialog" role="alertdialog" aria-modal="true">
        <div class="recall-dialog-icon ${type}">
          ${ICONS[type] || ICONS.info}
        </div>
        <div class="recall-dialog-body">
          ${title ? `<div class="recall-dialog-title">${title}</div>` : ''}
          <div class="recall-dialog-message">${message}</div>
        </div>
        <div class="recall-dialog-actions single">
          <button class="recall-dialog-btn primary" data-action="ok">${okText}</button>
        </div>
      </div>
    `;

    function cleanup() {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 150);
      document.removeEventListener('keydown', onKeydown);
      resolve();
    }

    function onKeydown(e) {
      if (e.key === 'Escape' || e.key === 'Enter') cleanup();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup();
      if (e.target.closest('[data-action]')) cleanup();
    });

    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('visible'));
    });

    overlay.querySelector('[data-action="ok"]').focus();
  });
}
