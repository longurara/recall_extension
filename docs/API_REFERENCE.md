# Tài liệu API / API Reference

> **[🇻🇳 Tiếng Việt](#tiếng-việt)** | **[🇬🇧 English](#english)**

---

# 🇻🇳 Tiếng Việt

Tài liệu API module nội bộ cho các nhà phát triển làm việc trên tiện ích Recall.

---

## Mục lục

- [lib/constants.js](#libconstantsjs-vi)
- [lib/db.js](#libdbjs-vi)
- [lib/i18n.js](#libi18njs-vi)
- [lib/utils.js](#libutilsjs-vi)
- [lib/theme.js](#libthemejs-vi)
- [lib/dialog.js](#libdialogjs-vi)
- [lib/storage-manager.js](#libstorage-managerjs-vi)
- [lib/zip.js](#libzipjs-vi)
- [background/capture-manager.js](#backgroundcapture-managerjs-vi)
- [background/deep-capture.js](#backgrounddeep-capturejs-vi)
- [background/watcher.js](#backgroundwatcherjs-vi)
- [background/backup-exporter.js](#backgroundbackup-exporterjs-vi)
- [Tham chiếu loại tin nhắn](#tham-chiếu-loại-tin-nhắn)

---

## lib/constants.js {#libconstantsjs-vi}

Hằng số dùng chung được import bởi tất cả module.

### Hằng số Database

| Export | Giá trị | Mô tả |
|--------|---------|-------|
| `DB_NAME` | `'RecallDB'` | Tên database IndexedDB |
| `DB_VERSION` | `5` | Phiên bản schema hiện tại |
| `STORE_SNAPSHOTS` | `'snapshots'` | Store metadata |
| `STORE_SNAPSHOT_DATA` | `'snapshotData'` | Store dữ liệu nhị phân |
| `STORE_SETTINGS` | `'settings'` | Store cài đặt |
| `STORE_WATCHED_PAGES` | `'watchedPages'` | Store theo dõi trang |
| `STORE_COLLECTIONS` | `'collections'` | Store bộ sưu tập |
| `STORE_AUTO_TAG_RULES` | `'autoTagRules'` | Store quy tắc gắn thẻ tự động |
| `STORE_SESSIONS` | `'sessions'` | Store phiên đã lưu |

### Loại chụp

| Export | Giá trị |
|--------|---------|
| `CAPTURE_AUTO` | `'auto'` |
| `CAPTURE_MANUAL` | `'manual'` |
| `CAPTURE_DEEP` | `'deep'` |
| `CAPTURE_CLIP` | `'clip'` |
| `CAPTURE_READ_LATER` | `'readlater'` |

### `DEFAULT_SETTINGS`

Đối tượng cài đặt mặc định đầy đủ bao gồm: chụp, ngôn ngữ, bộ nhớ, AI, theme, thông báo, loại trừ domain/protocol, thumbnail.

### `MSG` — Loại tin nhắn

50+ hằng số loại tin nhắn. Xem [Tham chiếu loại tin nhắn](#tham-chiếu-loại-tin-nhắn).

### `BADGE_COLORS`

| Key | Màu | Sử dụng |
|-----|-----|---------|
| `CAPTURING` | `#FF9800` (cam) | Đang chụp |
| `SUCCESS` | `#4CAF50` (xanh) | Chụp xong |
| `ERROR` | `#F44336` (đỏ) | Chụp thất bại |
| `DISABLED` | `#9E9E9E` (xám) | Tắt tự động chụp |

---

## lib/db.js {#libdbjs-vi}

Wrapper IndexedDB cung cấp tất cả thao tác database. Tất cả hàm đều async.

### Thao tác Snapshot

| Hàm | Mô tả |
|-----|-------|
| `saveSnapshot(metadata)` | Lưu/cập nhật metadata |
| `getSnapshot(id)` | Lấy theo ID |
| `getAllSnapshots()` | Lấy tất cả, sắp xếp theo timestamp desc |
| `getSnapshotsPaginated(offset, limit)` | Truy vấn phân trang |
| `searchSnapshots(query)` | Tìm theo tiêu đề/URL/domain |
| `getSnapshotsByDomain(domain)` | Lọc theo domain |
| `hasRecentDuplicate(url, minutes)` | Kiểm tra cửa sổ dedup |
| `deleteSnapshot(id)` | Xóa metadata + data |
| `deleteSnapshots(ids)` | Xóa hàng loạt |
| `updateSnapshot(id, updates)` | Cập nhật từng phần |
| `getSnapshotCount()` | Đếm tổng |
| `getAllDomains()` | Domain duy nhất với số lượng |

### Thao tác dữ liệu Snapshot

| Hàm | Mô tả |
|-----|-------|
| `saveSnapshotData(data)` | Lưu HTML nén + text |
| `getSnapshotData(id)` | Lấy dữ liệu theo ID |

### Thao tác cài đặt

| Hàm | Mô tả |
|-----|-------|
| `getSetting(key)` | Lấy cài đặt đơn (có fallback) |
| `getAllSettings()` | Merge đã lưu + mặc định |
| `saveSetting(key, value)` | Lưu cài đặt đơn |
| `saveSettings(obj)` | Lưu nhiều cài đặt |

### Tìm kiếm toàn văn

| Hàm | Mô tả |
|-----|-------|
| `searchContentForIds(query)` | Tìm nội dung → IDs |
| `searchSnapshotsFullText(query)` | Kết hợp metadata + nội dung |

### Bộ sưu tập, Quy tắc, Phiên, Theo dõi, Bộ nhớ

Mỗi loại đều có bộ CRUD đầy đủ: `save`, `get`, `getAll`, `delete`, `update`.

---

## lib/i18n.js {#libi18njs-vi}

Module đa ngôn ngữ tập trung (Tiếng Anh / Tiếng Việt).

### Exports

#### `initI18n() → Promise<void>`
Lấy cài đặt ngôn ngữ từ `GET_SETTINGS`. Đặt `currentLang`. Gọi một lần khi tải trang.

#### `t(key) → string`
Lấy chuỗi đã dịch. Fallback: `vi[key]` → `en[key]` → `key`.

#### `getLang() → string`
Trả về mã ngôn ngữ hiện tại (`'en'` hoặc `'vi'`).

#### `applyI18n(root?) → void`
Duyệt DOM và dịch:
- `[data-i18n]` → đặt `textContent`
- `[data-i18n-placeholder]` → đặt `placeholder`
- `[data-i18n-title]` → đặt `title`

### Translation Keys (~100+)

Tổ chức theo thành phần: `popup-*`, `mgr-*`, `viewer-*`, `dash-*`, `sp-*`, `dialog-*`.

---

## lib/theme.js {#libthemejs-vi}

#### `initTheme() → {toggle, getTheme}`
Khởi tạo: localStorage → tùy chọn hệ thống → thuộc tính `data-theme`.

#### `createThemeToggle(container) → HTMLButtonElement`
Tạo và inject nút bật/tắt theme.

---

## lib/dialog.js {#libdialogjs-vi}

#### `showConfirm(options) → Promise<boolean>`
Hiển thị hộp thoại xác nhận. `title`, `message`, `confirmText?`, `cancelText?`, `isDanger?`.

#### `showAlert(options) → Promise<void>`
Hiển thị hộp thoại cảnh báo. `title`, `message`, `okText?`.

---

## lib/storage-manager.js {#libstorage-managerjs-vi}

### Lớp: `StorageManager` (singleton: `storageManager`)

| Phương thức | Trả về | Mô tả |
|-------------|--------|-------|
| `getSettings()` | `Promise<Object>` | Cài đặt đã cache |
| `invalidateCache()` | `void` | Xóa cache cài đặt |
| `getUsageStats()` | `Promise<UsageStats>` | Thống kê bộ nhớ |
| `hasRoom(estimatedSize?)` | `Promise<boolean>` | Kiểm tra dung lượng |
| `autoCleanup(targetFreeBytes?)` | `Promise<number>` | Xóa cũ nhất, trả về số lượng |
| `timeBasedCleanup()` | `Promise<number>` | Xóa auto-capture cũ |
| `checkAndCleanup()` | `Promise<{ok, message, cleaned}>` | Kiểm tra trước chụp |

---

## lib/zip.js {#libzipjs-vi}

#### `createZip(files) → Blob`
Tạo ZIP từ mảng `{name, data}`. `data` có thể là string hoặc Blob.

---

## background/capture-manager.js {#backgroundcapture-managerjs-vi}

#### `captureTab(tabId, captureType?, flowMeta?) → Promise<Object|null>`
Điều phối chụp chính. Trả về metadata hoặc `null` nếu bỏ qua/thất bại.

---

## background/deep-capture.js {#backgrounddeep-capturejs-vi}

#### `deepCaptureTab(tabId, flowMeta?) → Promise<Object>`
Chụp sâu dựa trên CDP. Trả về metadata. Ném lỗi khi thất bại.

---

## background/watcher.js {#backgroundwatcherjs-vi}

#### `watchPage(opts) → Promise<Object>` — Bắt đầu theo dõi URL
#### `unwatchPage(id) → Promise<{deleted}>` — Dừng theo dõi
#### `checkAllDuePages() → Promise<{checked, changed}>` — Kiểm tra tất cả trang đến hạn
#### `checkWatchedPage(entry) → Promise<{changed, entry?, error?}>` — Kiểm tra một trang

---

## background/backup-exporter.js {#backgroundbackup-exporterjs-vi}

#### `exportBackup() → Promise<Blob>` — Xuất tất cả dữ liệu dạng ZIP
#### `importBackup(file) → Promise<{imported, skipped}>` — Nhập dữ liệu từ ZIP

---

## Tham chiếu loại tin nhắn

### Tin nhắn chụp

| Loại | Hướng | Tham số | Phản hồi |
|------|-------|---------|----------|
| `CAPTURE_PAGE` | UI → SW | `{tabId?}` | Metadata |
| `CAPTURE_DOM` | SW → Content | — | `{html, textContent, ...}` |
| `CAPTURE_DEEP` | UI → SW | `{tabId?}` | Metadata |
| `CAPTURE_CLIP` | UI → SW | `{tabId?, html, textContent}` | Metadata |

### Tin nhắn CRUD

| Loại | Hướng | Tham số | Phản hồi |
|------|-------|---------|----------|
| `GET_SNAPSHOTS` | UI → SW | `{query?, domain?}` | `Metadata[]` |
| `GET_SNAPSHOT` | UI → SW | `{id}` | `Metadata` |
| `DELETE_SNAPSHOT` | UI → SW | `{id}` | `{deleted: id}` |
| `DELETE_SNAPSHOTS` | UI → SW | `{ids}` | `{deleted: ids}` |

### Cài đặt

| Loại | Hướng | Phản hồi |
|------|-------|----------|
| `GET_SETTINGS` | UI → SW | Đối tượng cài đặt |
| `UPDATE_SETTINGS` | UI → SW | `{updated}` |
| `TOGGLE_AUTO_CAPTURE` | UI → SW | `{autoCapture: bool}` |

### Đọc sau, Bộ sưu tập, AI, Theo dõi, Phiên, Ghim/Rác

Tất cả tuân theo mẫu CRUD chuẩn. Xem phần English bên dưới để có bảng tham chiếu đầy đủ.

**Chú giải:** SW = Service Worker, UI = Trang extension, Content = Content scripts

---
---

# 🇬🇧 English

Internal module API documentation for developers working on the Recall extension.

---

## Table of Contents

- [lib/constants.js](#libconstantsjs)
- [lib/db.js](#libdbjs)
- [lib/i18n.js](#libi18njs)
- [lib/utils.js](#libutilsjs)
- [lib/theme.js](#libthemejs)
- [lib/dialog.js](#libdialogjs)
- [lib/storage-manager.js](#libstorage-managerjs)
- [lib/zip.js](#libzipjs)
- [background/capture-manager.js](#backgroundcapture-managerjs)
- [background/deep-capture.js](#backgrounddeep-capturejs)
- [background/watcher.js](#backgroundwatcherjs)
- [background/backup-exporter.js](#backgroundbackup-exporterjs)
- [content/snapshot.js](#contentsnapshotjs)
- [content/spotlight.js](#contentspotlightjs)
- [Message Types Reference](#message-types-reference)

---

## lib/constants.js

### Database Constants

| Export | Value | Description |
|--------|-------|-------------|
| `DB_NAME` | `'RecallDB'` | IndexedDB database name |
| `DB_VERSION` | `5` | Current schema version |
| `STORE_SNAPSHOTS` | `'snapshots'` | Metadata store |
| `STORE_SNAPSHOT_DATA` | `'snapshotData'` | Binary data store |
| `STORE_SETTINGS` | `'settings'` | Settings store |
| `STORE_WATCHED_PAGES` | `'watchedPages'` | Watch entries store |
| `STORE_COLLECTIONS` | `'collections'` | Collections store |
| `STORE_AUTO_TAG_RULES` | `'autoTagRules'` | Auto-tag rules store |
| `STORE_SESSIONS` | `'sessions'` | Saved sessions store |

### Capture Types

`CAPTURE_AUTO`, `CAPTURE_MANUAL`, `CAPTURE_DEEP`, `CAPTURE_CLIP`, `CAPTURE_READ_LATER`

### `DEFAULT_SETTINGS`

Complete default settings object. See source for all fields.

### `BADGE_COLORS`

`CAPTURING` (#FF9800), `SUCCESS` (#4CAF50), `ERROR` (#F44336), `DISABLED` (#9E9E9E)

---

## lib/db.js

IndexedDB wrapper. All functions are async.

### Snapshot Operations

`saveSnapshot`, `getSnapshot`, `getAllSnapshots`, `getSnapshotsPaginated`, `searchSnapshots`, `getSnapshotsByDomain`, `hasRecentDuplicate`, `deleteSnapshot`, `deleteSnapshots`, `updateSnapshot`, `getSnapshotCount`, `getAllDomains`

### Snapshot Data

`saveSnapshotData`, `getSnapshotData`

### Settings

`getSetting`, `getAllSettings`, `saveSetting`, `saveSettings`

### Navigation Flows

`getSnapshotsBySessionId`, `getNavigationFlows`

### Full-Text Search

`searchContentForIds`, `searchSnapshotsFullText`

### Watched Pages

`saveWatchedPage`, `getWatchedPage`, `getAllWatchedPages`, `getActiveWatchedPages`, `getWatchedPageByUrl`, `updateWatchedPage`, `deleteWatchedPage`, `getWatchedPagesDueForCheck`

### Collections

`saveCollection`, `getCollection`, `getAllCollections`, `deleteCollection`

### Auto-Tag Rules

`getAutoTagRules`, `saveAutoTagRules`

### Sessions

`saveSession`, `getSession`, `getAllSessions`, `deleteSession`

### Storage

`getStorageUsage`, `getSnapshotsBySize`, `getOldestSnapshots`

---

## lib/i18n.js

#### `initI18n() → Promise<void>` — Fetch language setting, set `currentLang`
#### `t(key) → string` — Get translated string (English fallback)
#### `getLang() → string` — Returns `'en'` or `'vi'`
#### `applyI18n(root?) → void` — Translate `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`

---

## lib/utils.js

UUID generation, date formatting, file size formatting, gzip compress/decompress, thumbnail creation.

---

## lib/theme.js

#### `initTheme()` → `{toggle, getTheme}`
#### `createThemeToggle(container)` → `HTMLButtonElement`

---

## lib/dialog.js

#### `showConfirm(options) → Promise<boolean>`
#### `showAlert(options) → Promise<void>`

---

## lib/storage-manager.js

### Class: `StorageManager` (singleton: `storageManager`)

`getSettings()`, `invalidateCache()`, `getUsageStats()`, `hasRoom()`, `autoCleanup()`, `timeBasedCleanup()`, `checkAndCleanup()`

---

## lib/zip.js

#### `createZip(files) → Blob` — Create ZIP from `{name, data}` array

---

## background/capture-manager.js

#### `captureTab(tabId, captureType?, flowMeta?) → Promise<Object|null>`

---

## background/deep-capture.js

#### `deepCaptureTab(tabId, flowMeta?) → Promise<Object>`

---

## background/watcher.js

`watchPage`, `unwatchPage`, `checkAllDuePages`, `checkWatchedPage`

---

## background/backup-exporter.js

#### `exportBackup() → Promise<Blob>`
#### `importBackup(file) → Promise<{imported, skipped}>`

---

## content/snapshot.js

#### `captureDOM() → Promise<Object>`
Returns `{ html, textContent, title, url, scrollY, scrollX, captureTime, captureElapsed, htmlSize }`

---

## content/spotlight.js

Key functions: `open()`, `close()`, `onInput()`, `performSearch()`, `renderResults()`, `sendAiChat()`, `renderAiMessage()`

---

## Message Types Reference

### Capture

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `CAPTURE_PAGE` | UI → SW | `{tabId?}` | Metadata |
| `CAPTURE_DOM` | SW → Content | — | `{html, textContent, ...}` |
| `CAPTURE_DEEP` | UI → SW | `{tabId?}` | Metadata |
| `CAPTURE_CLIP` | UI → SW | `{tabId?, html, textContent}` | Metadata |

### CRUD

| Type | Direction | Parameters | Response |
|------|-----------|------------|----------|
| `GET_SNAPSHOTS` | UI → SW | `{query?, domain?}` | `Metadata[]` |
| `GET_SNAPSHOT` | UI → SW | `{id}` | `Metadata` |
| `DELETE_SNAPSHOT` | UI → SW | `{id}` | `{deleted: id}` |
| `DELETE_SNAPSHOTS` | UI → SW | `{ids}` | `{deleted: ids}` |
| `UPDATE_SNAPSHOT_TAGS` | UI → SW | `{id, tags}` | `{updated}` |
| `UPDATE_SNAPSHOT_NOTES` | UI → SW | `{id, notes}` | `{updated}` |
| `UPDATE_SNAPSHOT_ANNOTATIONS` | UI → SW | `{id, annotations}` | `{updated}` |

### Settings

| Type | Direction | Response |
|------|-----------|----------|
| `GET_SETTINGS` | UI → SW | Settings object |
| `UPDATE_SETTINGS` | UI → SW | `{updated}` |
| `TOGGLE_AUTO_CAPTURE` | UI → SW | `{autoCapture: bool}` |

### Search

| Type | Direction | Response |
|------|-----------|----------|
| `SEARCH_CONTENT` | UI → SW | `Metadata[]` |
| `SPOTLIGHT_SEARCH` | UI → SW | Results with snippets |
| `CHECK_URL_SNAPSHOTS` | Content → SW | `{snapshots, count}` |

### Read Later

| Type | Direction | Response |
|------|-----------|----------|
| `MARK_READ_LATER` | UI → SW | Metadata |
| `MARK_AS_READ` | UI → SW | `{updated}` |
| `GET_READ_LATER` | UI → SW | `Metadata[]` |

### Collections

| Type | Direction | Response |
|------|-----------|----------|
| `CREATE_COLLECTION` | UI → SW | Collection |
| `UPDATE_COLLECTION` | UI → SW | `{updated}` |
| `DELETE_COLLECTION` | UI → SW | `{deleted}` |
| `GET_COLLECTIONS` | UI → SW | `Collection[]` |
| `ADD_TO_COLLECTION` | UI → SW | `{updated}` |
| `REMOVE_FROM_COLLECTION` | UI → SW | `{updated}` |

### AI

| Type | Direction | Response |
|------|-----------|----------|
| `GENERATE_SUMMARY` | UI → SW | Summary text |
| `GET_SUMMARY` | UI → SW | Cached summary |
| `FETCH_AI_MODELS` | UI → SW | Model list |
| `SPOTLIGHT_AI_CHAT` | Content → SW | AI response |

### Watch

| Type | Direction | Response |
|------|-----------|----------|
| `WATCH_PAGE` | UI → SW | Watch entry |
| `UNWATCH_PAGE` | UI → SW | `{deleted}` |
| `GET_WATCHED_PAGES` | UI → SW | `WatchEntry[]` |
| `CHECK_WATCHED_NOW` | UI → SW | Check result |

### Sessions

| Type | Direction | Response |
|------|-----------|----------|
| `SAVE_SESSION` | UI → SW | Session entry |
| `GET_SESSIONS` | UI → SW | `Session[]` |
| `DELETE_SESSION` | UI → SW | `{deleted}` |
| `RESTORE_SESSION` | UI → SW | `{restored, tabCount}` |

### Pin / Trash

| Type | Direction | Response |
|------|-----------|----------|
| `PIN_SNAPSHOT` | UI → SW | `{updated}` |
| `UNPIN_SNAPSHOT` | UI → SW | `{updated}` |
| `GET_TRASH` | UI → SW | `Metadata[]` |
| `RESTORE_SNAPSHOT` | UI → SW | `{restored}` |
| `EMPTY_TRASH` | UI → SW | `{deleted: count}` |

### Export / Backup

| Type | Direction | Response |
|------|-----------|----------|
| `EXPORT_MHTML` | UI → SW | `{format, filename}` |
| `EXPORT_STANDALONE_HTML` | UI → SW | HTML string |
| `IMPORT_BACKUP` | UI → SW | `{imported, skipped}` |
| `EXPORT_BACKUP` | UI → SW | ZIP Blob |
| `SAVE_ALL_TABS` | UI → SW | `{saved: count}` |

### Dashboard

| Type | Direction | Response |
|------|-----------|----------|
| `GET_DASHBOARD_STATS` | UI → SW | Stats object |

### Broadcast Events (SW → All)

| Type | Data |
|------|------|
| `SNAPSHOT_SAVED` | `{snapshot: metadata}` |
| `SNAPSHOT_DELETED` | `{id}` or `{ids}` |
| `WATCHED_PAGE_CHANGED` | `{entry}` |

**Legend:** SW = Service Worker, UI = Extension pages, Content = Content scripts
