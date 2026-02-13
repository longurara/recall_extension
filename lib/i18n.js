// lib/i18n.js – Centralized i18n for Recall extension
// Usage:
//   import { initI18n, t, applyI18n } from '../lib/i18n.js';
//   await initI18n();            // call once on page load
//   applyI18n();                 // translate data-i18n elements
//   t('someKey');                 // get translated string

import { MSG } from './constants.js';

let currentLang = 'en';

// --------------- dictionaries ---------------
const STRINGS = {
    en: {
        // ---- Popup ----
        'popup-capture': 'Capture This Page',
        'popup-deep-capture': 'Deep Capture (CDP)',
        'popup-read-later': 'Read Later',
        'popup-watch': 'Watch This Page',
        'popup-save-all-tabs': 'Save All Open Tabs',
        'popup-sidepanel': 'Open Side Panel',
        'popup-manager': 'Snapshot Manager',
        'popup-save-session': 'Save Current Session',
        'popup-restore-session': 'Restore Last Session',
        'popup-settings': 'Settings',
        'popup-auto-capture': 'Auto-Capture',
        'popup-loading': 'Loading...',
        'popup-capturing': 'Capturing...',
        'popup-captured': 'Captured!',
        'popup-failed': 'Failed',
        'popup-deep-capturing': 'Deep Capturing...',
        'popup-done': 'Done!',
        'popup-saving': 'Saving...',
        'popup-saved': 'Saved!',
        'popup-adding': 'Adding...',
        'popup-watching': 'Watching!',
        'popup-already-watching': 'Already watching',
        'popup-session-saved': 'Session Saved!',
        'popup-checking': 'Checking...',
        'popup-no-session': 'No session found',
        'popup-empty-session': 'Empty session',
        'popup-restoring': 'Restoring...',

        // ---- Manager ----
        'mgr-subtitle': 'Snapshot Manager',
        'mgr-settings': 'Settings',
        'mgr-search': 'Search snapshots...',
        'mgr-all-types': 'All types',
        'mgr-type-auto': 'Auto',
        'mgr-type-manual': 'Manual',
        'mgr-type-clip': 'Clip',
        'mgr-type-readlater': 'Read Later',
        'mgr-all-tags': 'All tags',
        'mgr-sort-newest': 'Newest first',
        'mgr-sort-oldest': 'Oldest first',
        'mgr-sort-largest': 'Largest first',
        'mgr-sort-smallest': 'Smallest first',
        'mgr-sort-title': 'Title A-Z',
        'mgr-select-all': 'Select All',
        'mgr-delete-selected': 'Delete Selected',
        'mgr-export-selected': 'Export Selected',
        'mgr-no-snapshots': 'No snapshots yet',
        'mgr-no-snapshots-desc': 'Browse the web and pages will be automatically captured. You can also manually capture pages using the extension popup.',
        'mgr-loading': 'Loading...',
        'mgr-snapshots': 'snapshots',

        // ---- Viewer ----
        'viewer-prev-flow': 'Previous in flow',
        'viewer-next-flow': 'Next in flow',
        'viewer-open-original': 'Open original URL',
        'viewer-export': 'Export as MHTML',
        'viewer-compare': 'Compare versions',
        'viewer-notes': 'Toggle notes panel',
        'viewer-star': 'Toggle star',
        'viewer-delete': 'Delete this snapshot',
        'viewer-collapse': 'Collapse info bar',
        'viewer-expand': 'Show info bar',
        'viewer-annotations': 'Annotations',
        'viewer-no-annotations': 'No annotations yet',
        'viewer-ai-summary': 'AI Summary',
        'viewer-gen-summary': 'Generate Summary',
        'viewer-generating': 'Generating...',
        'viewer-not-found': 'Snapshot not found',
        'viewer-open-manager': 'Open Manager',
        'viewer-loading': 'Loading snapshot...',

        // ---- Dashboard ----
        'dash-subtitle': 'Dashboard',
        'dash-back': '← Back to Manager',
        'dash-total': 'Total Snapshots',
        'dash-today': 'Today',
        'dash-week': 'This Week',
        'dash-unread': 'Unread (Read Later)',
        'dash-per-day': 'Snapshots Per Day (Last 30 Days)',
        'dash-top-domains': 'Top Domains',
        'dash-storage-domain': 'Storage by Domain',
        'dash-capture-types': 'Capture Types',

        // ---- Side Panel ----
        'sp-capture': 'Capture',
        'sp-search': 'Search snapshots...',
        'sp-all-domains': 'All domains',
        'sp-sort-newest': 'Newest first',
        'sp-sort-oldest': 'Oldest first',
        'sp-sort-largest': 'Largest first',
        'sp-sort-smallest': 'Smallest first',
        'sp-sort-title': 'Title A-Z',
        'sp-no-snapshots': 'No snapshots yet',
        'sp-no-snapshots-desc': 'Browse the web and pages will be automatically captured.',
        'sp-no-results': 'No results found',
        'sp-no-results-desc': 'Try a different search term or filter.',

        // ---- Dialog ----
        'dialog-ok': 'OK',
        'dialog-cancel': 'Cancel',
        'dialog-confirm': 'Confirm',
        'dialog-delete': 'Delete',
    },

    vi: {
        // ---- Popup ----
        'popup-capture': 'Chụp trang này',
        'popup-deep-capture': 'Chụp sâu (CDP)',
        'popup-read-later': 'Đọc sau',
        'popup-watch': 'Theo dõi trang này',
        'popup-save-all-tabs': 'Lưu tất cả tab đang mở',
        'popup-sidepanel': 'Mở bảng bên',
        'popup-manager': 'Quản lý Snapshot',
        'popup-save-session': 'Lưu phiên hiện tại',
        'popup-restore-session': 'Khôi phục phiên trước',
        'popup-settings': 'Cài đặt',
        'popup-auto-capture': 'Tự động chụp',
        'popup-loading': 'Đang tải...',
        'popup-capturing': 'Đang chụp...',
        'popup-captured': 'Đã chụp!',
        'popup-failed': 'Thất bại',
        'popup-deep-capturing': 'Đang chụp sâu...',
        'popup-done': 'Xong!',
        'popup-saving': 'Đang lưu...',
        'popup-saved': 'Đã lưu!',
        'popup-adding': 'Đang thêm...',
        'popup-watching': 'Đang theo dõi!',
        'popup-already-watching': 'Đã theo dõi rồi',
        'popup-session-saved': 'Đã lưu phiên!',
        'popup-checking': 'Đang kiểm tra...',
        'popup-no-session': 'Không tìm thấy phiên',
        'popup-empty-session': 'Phiên trống',
        'popup-restoring': 'Đang khôi phục...',

        // ---- Manager ----
        'mgr-subtitle': 'Quản lý Snapshot',
        'mgr-settings': 'Cài đặt',
        'mgr-search': 'Tìm kiếm snapshot...',
        'mgr-all-types': 'Tất cả loại',
        'mgr-type-auto': 'Tự động',
        'mgr-type-manual': 'Thủ công',
        'mgr-type-clip': 'Clip',
        'mgr-type-readlater': 'Đọc sau',
        'mgr-all-tags': 'Tất cả thẻ',
        'mgr-sort-newest': 'Mới nhất',
        'mgr-sort-oldest': 'Cũ nhất',
        'mgr-sort-largest': 'Lớn nhất',
        'mgr-sort-smallest': 'Nhỏ nhất',
        'mgr-sort-title': 'Tên A-Z',
        'mgr-select-all': 'Chọn tất cả',
        'mgr-delete-selected': 'Xóa đã chọn',
        'mgr-export-selected': 'Xuất đã chọn',
        'mgr-no-snapshots': 'Chưa có snapshot nào',
        'mgr-no-snapshots-desc': 'Duyệt web để trang được tự động chụp. Bạn cũng có thể chụp thủ công từ popup.',
        'mgr-loading': 'Đang tải...',
        'mgr-snapshots': 'snapshot',

        // ---- Viewer ----
        'viewer-prev-flow': 'Trang trước',
        'viewer-next-flow': 'Trang sau',
        'viewer-open-original': 'Mở URL gốc',
        'viewer-export': 'Xuất MHTML',
        'viewer-compare': 'So sánh phiên bản',
        'viewer-notes': 'Bật/tắt ghi chú',
        'viewer-star': 'Đánh dấu sao',
        'viewer-delete': 'Xóa snapshot này',
        'viewer-collapse': 'Thu gọn thanh thông tin',
        'viewer-expand': 'Hiện thanh thông tin',
        'viewer-annotations': 'Chú thích',
        'viewer-no-annotations': 'Chưa có chú thích',
        'viewer-ai-summary': 'Tóm tắt AI',
        'viewer-gen-summary': 'Tạo tóm tắt',
        'viewer-generating': 'Đang tạo...',
        'viewer-not-found': 'Không tìm thấy snapshot',
        'viewer-open-manager': 'Mở quản lý',
        'viewer-loading': 'Đang tải snapshot...',

        // ---- Dashboard ----
        'dash-subtitle': 'Bảng điều khiển',
        'dash-back': '← Quay lại Quản lý',
        'dash-total': 'Tổng Snapshot',
        'dash-today': 'Hôm nay',
        'dash-week': 'Tuần này',
        'dash-unread': 'Chưa đọc (Đọc sau)',
        'dash-per-day': 'Snapshot theo ngày (30 ngày qua)',
        'dash-top-domains': 'Tên miền phổ biến',
        'dash-storage-domain': 'Dung lượng theo tên miền',
        'dash-capture-types': 'Loại chụp',

        // ---- Side Panel ----
        'sp-capture': 'Chụp',
        'sp-search': 'Tìm kiếm snapshot...',
        'sp-all-domains': 'Tất cả tên miền',
        'sp-sort-newest': 'Mới nhất',
        'sp-sort-oldest': 'Cũ nhất',
        'sp-sort-largest': 'Lớn nhất',
        'sp-sort-smallest': 'Nhỏ nhất',
        'sp-sort-title': 'Tên A-Z',
        'sp-no-snapshots': 'Chưa có snapshot nào',
        'sp-no-snapshots-desc': 'Duyệt web để trang được tự động chụp.',
        'sp-no-results': 'Không tìm thấy kết quả',
        'sp-no-results-desc': 'Thử từ khóa hoặc bộ lọc khác.',

        // ---- Dialog ----
        'dialog-ok': 'OK',
        'dialog-cancel': 'Hủy',
        'dialog-confirm': 'Xác nhận',
        'dialog-delete': 'Xóa',
    },
};

// --------------- public API ---------------

/**
 * Initialise i18n — fetches the language setting from the extension storage.
 * Call once early (e.g. DOMContentLoaded).
 */
export async function initI18n() {
    try {
        const resp = await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
        if (resp && resp.data && resp.data.language) {
            currentLang = resp.data.language;
        }
    } catch { /* keep default 'en' */ }
}

/**
 * Get a translated string by key.
 * Falls back to English if the key is missing in the current language.
 */
export function t(key) {
    return (STRINGS[currentLang] || STRINGS.en)[key] || STRINGS.en[key] || key;
}

/**
 * Get the current language code ('en' | 'vi').
 */
export function getLang() {
    return currentLang;
}

/**
 * Walk the DOM and translate elements bearing [data-i18n]:
 *   <span data-i18n="popup-capture">Capture This Page</span>
 * Also handles:
 *   data-i18n-placeholder  → sets el.placeholder
 *   data-i18n-title        → sets el.title
 *
 * @param {HTMLElement|Document} [root=document]  scope to search within
 */
export function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = t(key);
        if (val && val !== key) el.textContent = val;
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const val = t(key);
        if (val && val !== key) el.placeholder = val;
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const val = t(key);
        if (val && val !== key) el.title = val;
    });
}
