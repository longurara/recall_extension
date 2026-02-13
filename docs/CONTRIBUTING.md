# Hướng dẫn đóng góp / Contributing Guide

> **[🇻🇳 Tiếng Việt](#tiếng-việt)** | **[🇬🇧 English](#english)**

---

# 🇻🇳 Tiếng Việt

Hướng dẫn cho các nhà phát triển muốn làm việc trên mã nguồn tiện ích Recall.

---

## Mục lục

- [Thiết lập phát triển](#thiết-lập-phát-triển)
- [Kiến trúc dự án](#kiến-trúc-dự-án-vi)
- [Quy trình phát triển](#quy-trình-phát-triển)
- [Quy ước mã nguồn](#quy-ước-mã-nguồn)
- [Thêm tính năng mới](#thêm-tính-năng-mới)
- [Thêm loại tin nhắn mới](#thêm-loại-tin-nhắn-mới)
- [Thêm database store mới](#thêm-database-store-mới)
- [Thêm trang UI mới](#thêm-trang-ui-mới)
- [Thêm bản dịch (i18n)](#thêm-bản-dịch-i18n)
- [Gỡ lỗi](#gỡ-lỗi-vi)
- [Kiểm thử](#kiểm-thử-vi)
- [Lỗi thường gặp](#lỗi-thường-gặp)
- [Tham chiếu kích thước file](#tham-chiếu-kích-thước-file)

---

## Thiết lập phát triển

### Yêu cầu

- **Google Chrome** 116 trở lên
- **Trình soạn mã** có hỗ trợ JavaScript (khuyến nghị VS Code)
- **Không cần build tools** — JS thuần với ES Modules

### Tải tiện ích

1. Mở Chrome → `chrome://extensions/`
2. Bật **Developer mode**
3. Nhấn **Load unpacked** → chọn thư mục `Extension_recall`

### Tải lại sau khi thay đổi

| Thay đổi | Hành động |
|----------|-----------|
| Service worker | Nhấn nút refresh trên thẻ extension tại `chrome://extensions/` |
| Content scripts | Tải lại extension VÀ refresh trang web |
| Trang extension | Chỉ cần refresh trang |
| Manifest | Luôn tải lại extension |

---

## Kiến trúc dự án {#kiến-trúc-dự-án-vi}

```
lib/            → Module dùng chung (import ở mọi nơi)
background/     → Service worker (xử lý tin nhắn, chụp, theo dõi, AI)
content/        → Content scripts (inject vào trang web)
popup/          → Popup thanh công cụ
sidepanel/      → Chrome Side Panel
manager/        → Quản lý snapshot toàn trang
viewer/         → Xem snapshot
diff/           → So sánh trang
dashboard/      → Dashboard phân tích
settings/       → Giao diện cài đặt
```

### Nguyên tắc chính

1. **Kiến trúc message-passing**: Trang UI giao tiếp với service worker qua `chrome.runtime.sendMessage()`.
2. **Hằng số dùng chung**: Tất cả loại tin nhắn, tên DB, cài đặt trong `lib/constants.js`.
3. **Lớp database**: Mọi truy cập IndexedDB qua `lib/db.js`.
4. **Không dependency ngoài**: Mọi thứ xây dựng từ đầu.
5. **Cách ly content script**: Content scripts dùng IIFE và Shadow DOM.
6. **i18n tập trung**: Mọi văn bản UI dùng `lib/i18n.js`.
7. **Hộp thoại tùy chỉnh**: Dùng `lib/dialog.js` thay vì `window.confirm()` / `window.alert()`.

---

## Quy trình phát triển

### Vị trí Console

| Ngữ cảnh | Cách truy cập |
|-----------|---------------|
| Service worker | `chrome://extensions/` → "Inspect views: service worker" |
| Content scripts | DevTools trang (F12) → Console (lọc theo extension) |
| Popup | Chuột phải icon extension → "Inspect popup" |
| Trang extension | Mở trang → F12 |

---

## Quy ước mã nguồn

### JavaScript

- ES Modules với `import`/`export`
- Async/await thay vì Promise thuần
- `const` mặc định, `let` khi cần, không dùng `var`
- Template literals cho nội suy
- Arrow functions cho callback
- Tiền tố `console.log('[Recall] ...')` cho logging
- Luôn dùng dấu chấm phẩy

### Đặt tên

| Loại | Quy ước | Ví dụ |
|------|---------|-------|
| Hằng số | UPPER_SNAKE_CASE | `DB_NAME`, `CAPTURE_AUTO` |
| Hàm | camelCase | `captureTab`, `getSnapshot` |
| Lớp | PascalCase | `StorageManager` |
| File | kebab-case | `capture-manager.js` |
| CSS class | kebab-case | `snapshot-card` |
| Loại tin nhắn | UPPER_SNAKE_CASE | `CAPTURE_PAGE` |
| Key i18n | kebab-case | `popup-capture`, `mgr-search` |

---

## Thêm tính năng mới

### Từng bước

#### 1. Định nghĩa loại tin nhắn
```javascript
// lib/constants.js
export const MSG = {
  MY_NEW_ACTION: 'MY_NEW_ACTION',
};
```

#### 2. Thêm thao tác database (nếu cần)
```javascript
// lib/db.js
export async function myNewDbOperation(params) {
  return withStore(STORE_NAME, 'readonly', (store) => { /* ... */ });
}
```

#### 3. Xử lý tin nhắn trong Service Worker
```javascript
// service-worker.js handleMessage()
case MSG.MY_NEW_ACTION: {
  const result = await someOperation(message.param);
  return result;
}
```

#### 4. Gửi từ UI
```javascript
const response = await chrome.runtime.sendMessage({
  type: MSG.MY_NEW_ACTION,
  param: 'value',
});
if (response.success) { const data = response.data; }
```

#### 5. Thêm bản dịch
```javascript
// lib/i18n.js
const STRINGS = {
  en: { 'my-feature-label': 'My Feature' },
  vi: { 'my-feature-label': 'Tính năng của tôi' },
};
```

#### 6. Cập nhật UI với i18n
```html
<span data-i18n="my-feature-label">My Feature</span>
```

---

## Thêm loại tin nhắn mới

1. **Định nghĩa** trong `lib/constants.js`
2. **Xử lý** trong `service-worker.js`
3. **Gửi** từ UI
4. **Ghi tài liệu** trong `docs/API_REFERENCE.md`

---

## Thêm database store mới

### 1. Tăng phiên bản
```javascript
export const DB_VERSION = 6; // Trước đó là 5
export const STORE_MY_NEW_STORE = 'myNewStore';
```

### 2. Thêm migration
```javascript
// lib/db.js onupgradeneeded
if (oldVersion < 6) {
  const store = db.createObjectStore(STORE_MY_NEW_STORE, { keyPath: 'id' });
}
```

### 3. Thêm hàm CRUD

### Quan trọng
- **Không bao giờ** sửa đổi schema store hiện có — luôn tăng version
- Xử lý migration từ bất kỳ phiên bản trước nào
- Kiểm thử cả cài mới VÀ nâng cấp từ phiên bản trước

---

## Thêm trang UI mới

### 1. Tạo thư mục
```
mynewpage/
├── mynewpage.html
├── mynewpage.css
└── mynewpage.js
```

### 2. Template JavaScript
```javascript
import { initTheme, createThemeToggle } from '../lib/theme.js';
import { initI18n, t, applyI18n } from '../lib/i18n.js';

const theme = initTheme();
createThemeToggle(document.getElementById('header-actions'));

async function init() {
  await initI18n();
  applyI18n();
}
init();
```

---

## Thêm bản dịch (i18n)

### Cho trang Extension (popup, manager, v.v.)

1. Thêm key dịch vào `lib/i18n.js`:
   ```javascript
   const STRINGS = {
     en: { 'mypage-title': 'My Page' },
     vi: { 'mypage-title': 'Trang của tôi' },
   };
   ```

2. Thêm `data-i18n` vào HTML:
   ```html
   <h1 data-i18n="mypage-title">My Page</h1>
   ```

3. Import và khởi tạo trong JS:
   ```javascript
   import { initI18n, t, applyI18n } from '../lib/i18n.js';
   await initI18n();
   applyI18n();
   ```

### Cho Content Scripts (spotlight, you-were-here)

Content scripts không thể import ES modules. Thêm bản dịch vào từ điển `STRINGS` riêng:

```javascript
const STRINGS = {
  en: { 'my-key': 'English' },
  vi: { 'my-key': 'Tiếng Việt' },
};
```

---

## Gỡ lỗi {#gỡ-lỗi-vi}

### Tình huống gỡ lỗi thường gặp

**Chụp không hoạt động:**
1. Kiểm tra console service worker
2. Xác minh content script đã tải (`window.__recallSnapshotInjected`)
3. Kiểm tra URL có bị loại trừ không

**i18n không dịch:**
1. Xác minh `initI18n()` gọi trước `applyI18n()`
2. Kiểm tra thuộc tính `data-i18n` khớp key trong `STRINGS`
3. Xác minh định dạng phản hồi: `resp.data.language` không phải `resp.language`

---

## Kiểm thử {#kiểm-thử-vi}

### Checklist kiểm thử thủ công

- [ ] Tự động chụp khi điều hướng
- [ ] Chụp thủ công, Deep Capture, Đọc sau, Clipper
- [ ] Spotlight Search + AI Chat
- [ ] Manager: 4 chế độ xem, tìm kiếm, lọc, sắp xếp
- [ ] Viewer: render, ghi chú, chú thích, AI summary
- [ ] i18n: đổi ngôn ngữ → xác minh đổi text
- [ ] Cài đặt: lưu, xuất/nhập sao lưu
- [ ] Theme: dark/light, màu tùy chỉnh

---

## Lỗi thường gặp

### 1. Tuần tự hóa Blob
**Vấn đề**: Blob không gửi được qua `sendMessage()`.
**Giải pháp**: Chuyển sang data URL string.

### 2. Vòng đời Service Worker
**Vấn đề**: Trạng thái in-memory mất khi SW terminate.
**Giải pháp**: Dùng IndexedDB cho trạng thái bền vững.

### 3. Inject Content Script trùng
**Vấn đề**: Script inject nhiều lần sau reload.
**Giải pháp**: Dùng guard (`window.__recallXxxInjected`).

### 4. Định dạng phản hồi i18n
**Vấn đề**: `initI18n()` nhận `{success, data: {language}}` không phải `{language}`.
**Giải pháp**: Truy cập `resp.data.language`.

### 5. textContent và SVG Icons
**Vấn đề**: `btn.textContent = t('key')` xóa SVG icon trong nút.
**Giải pháp**: Target phần tử `<span>` bên trong, không phải nút.

### 6. i18n Content Script
**Vấn đề**: Content scripts không import được ES modules.
**Giải pháp**: Duy trì từ điển `STRINGS` riêng.

### 7. Xung đột phiên bản IndexedDB
**Vấn đề**: Nhiều ngữ cảnh có thể mở phiên bản DB khác nhau.
**Giải pháp**: Xử lý `onversionchange` bằng đóng kết nối.

### 8. sendResponse bất đồng bộ
**Vấn đề**: Listener `onMessage` cần `return true` cho phản hồi async.
**Giải pháp**: Luôn `return true`.

---

## Tham chiếu kích thước file

| File | ~Dòng | Mục đích |
|------|-------|----------|
| `lib/constants.js` | 180 | Hằng số, 50+ MSG types |
| `lib/db.js` | 900+ | Wrapper IndexedDB, 7 stores |
| `lib/i18n.js` | 285 | Bản dịch i18n (en/vi) |
| `lib/utils.js` | 225 | Tiện ích |
| `background/service-worker.js` | 1400+ | Service worker chính |
| `content/spotlight.js` | 1300+ | Spotlight + AI chat |
| `content/progressive-capture.js` | 600+ | Chụp tiến trình |
| `manager/manager.js` | 1600+ | UI Manager |
| `viewer/viewer.js` | 1200+ | UI Viewer |
| **Tổng** | **~10,000+** | |

---
---

# 🇬🇧 English

Guide for developers who want to work on the Recall extension codebase.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Development Workflow](#development-workflow)
- [Code Conventions](#code-conventions)
- [Adding a New Feature](#adding-a-new-feature)
- [Adding a New Message Type](#adding-a-new-message-type)
- [Adding a New Database Store](#adding-a-new-database-store)
- [Adding a New UI Page](#adding-a-new-ui-page)
- [Adding Translations (i18n)](#adding-translations-i18n)
- [Debugging](#debugging)
- [Testing](#testing)
- [Common Pitfalls](#common-pitfalls)
- [File Size Reference](#file-size-reference)

---

## Development Setup

### Prerequisites

- **Google Chrome** 116 or later
- **Text editor** with JavaScript support (VS Code recommended)
- **No build tools required** — vanilla JS with ES Modules

### Loading the Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `Extension_recall`

### Reloading After Changes

| Changed | Action |
|---------|--------|
| Service worker | Refresh icon at `chrome://extensions/` |
| Content scripts | Reload extension AND refresh page |
| Extension pages | Just refresh the page |
| Manifest | Always reload extension |

---

## Project Architecture

### Key Principles

1. **Message-passing**: UI → service worker via `chrome.runtime.sendMessage()`
2. **Shared constants**: `lib/constants.js` for all MSG types, DB names, settings
3. **Database layer**: All IndexedDB through `lib/db.js`
4. **No external dependencies**
5. **Content script isolation**: IIFEs and Shadow DOM
6. **Centralized i18n**: `lib/i18n.js`
7. **Custom dialogs**: `lib/dialog.js`

---

## Development Workflow

### Console Locations

| Context | Access |
|---------|--------|
| Service worker | `chrome://extensions/` → "Inspect views: service worker" |
| Content scripts | Page DevTools → Console |
| Popup | Right-click icon → "Inspect popup" |
| Extension pages | Open page → F12 |

---

## Code Conventions

- ES Modules, async/await, `const`/`let`, template literals, arrow functions
- UPPER_SNAKE for constants, camelCase for functions, PascalCase for classes
- kebab-case for files, CSS classes, i18n keys
- Dark mode via `[data-theme="dark"]`
- All text translatable via `data-i18n` or `t()`

---

## Adding a New Feature

1. Define message types in `lib/constants.js`
2. Add DB operations in `lib/db.js` (if needed)
3. Handle in `service-worker.js`
4. Send from UI
5. Add translations in `lib/i18n.js`
6. Update UI with `data-i18n` attributes

---

## Adding a New Message Type

1. Define in `lib/constants.js`
2. Handle in `service-worker.js`
3. Send from UI
4. Document in `docs/API_REFERENCE.md`

---

## Adding a New Database Store

1. Increment `DB_VERSION` in `lib/constants.js`
2. Add migration in `lib/db.js` `onupgradeneeded`
3. Add CRUD functions
4. **Never** modify existing store schemas

---

## Adding a New UI Page

Create `mynewpage/` with `.html`, `.css`, `.js`. Use standard template with theme, i18n, and dark mode support.

---

## Adding Translations (i18n)

### Extension Pages
Add keys to `lib/i18n.js` STRINGS, use `data-i18n` attributes, call `initI18n()` + `applyI18n()`.

### Content Scripts
Maintain separate STRINGS dictionary (can't import ES modules).

---

## Debugging

- **Capture issues:** Service worker console, injection guards, URL exclusions
- **i18n issues:** `initI18n()` before `applyI18n()`, check `resp.data.language`
- **AI issues:** API key, model, internet, service worker console

---

## Testing

### Manual Checklist

- [ ] Auto-capture, manual, deep, read later, clipper
- [ ] Spotlight search + AI chat
- [ ] Manager: 4 views, search, filter, sort, multi-select
- [ ] Viewer: render, notes, annotations, AI summary
- [ ] i18n: language switch, verify text changes
- [ ] Settings: save, backup export/import
- [ ] Theme: dark/light, custom colors

---

## Common Pitfalls

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Blob serialization | Can't send via `sendMessage()` | Convert to data URL |
| SW lifecycle | In-memory state lost on terminate | Use IndexedDB |
| Script re-injection | Injected multiple times | Injection guards |
| i18n response format | `{success, data: {language}}` | Access `resp.data.language` |
| textContent + SVG | `textContent` erases SVG icons | Target inner `<span>` |
| Content script i18n | Can't import ES modules | Own STRINGS dictionary |
| DB version conflicts | Multiple contexts, different versions | Handle `onversionchange` |
| Async sendResponse | Need `return true` for async | Always `return true` |

---

## File Size Reference

| File | ~Lines | Purpose |
|------|--------|---------|
| `lib/constants.js` | 180 | Constants, 50+ MSG types |
| `lib/db.js` | 900+ | IndexedDB wrapper, 7 stores |
| `lib/i18n.js` | 285 | i18n translations (en/vi) |
| `lib/utils.js` | 225 | Utilities |
| `background/service-worker.js` | 1400+ | Main service worker |
| `content/spotlight.js` | 1300+ | Spotlight + AI chat |
| `content/progressive-capture.js` | 600+ | Progressive capture |
| `manager/manager.js` | 1600+ | Manager UI |
| `viewer/viewer.js` | 1200+ | Viewer UI |
| **Total** | **~10,000+** | |
