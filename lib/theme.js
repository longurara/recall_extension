// lib/theme.js - Shared dark mode / theme toggle for all Recall UI pages

/**
 * Initialize theme system.
 * - Loads saved theme preference from localStorage.
 * - Falls back to system preference (prefers-color-scheme).
 * - Sets data-theme attribute on <html>.
 * - Returns a toggle function.
 */
export function initTheme() {
  const stored = localStorage.getItem('recall-theme');
  let theme;

  if (stored === 'dark' || stored === 'light') {
    theme = stored;
  } else {
    // Auto-detect system preference
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  applyTheme(theme);

  // Listen for system changes when no explicit preference is saved
  if (!stored) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('recall-theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  return { toggle: toggleTheme, getTheme };
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('recall-theme', next);
  return next;
}

/**
 * Create and inject a theme toggle button into a container element.
 * @param {HTMLElement} container - Element to append the toggle button to.
 * @returns {HTMLButtonElement}
 */
export function createThemeToggle(container) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-theme-toggle';
  btn.title = 'Toggle dark mode';
  btn.type = 'button';

  function updateIcon() {
    const isDark = getTheme() === 'dark';
    btn.innerHTML = isDark
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.5a5.5 5.5 0 01-7-7C3.5 3.5 1.5 6 1.5 9a5.5 5.5 0 005.5 5.5c3 0 5.5-2 6.5-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  updateIcon();

  btn.addEventListener('click', () => {
    toggleTheme();
    updateIcon();
  });

  container.appendChild(btn);
  return btn;
}
