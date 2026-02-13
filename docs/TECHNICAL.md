# Kiến trúc kỹ thuật / Technical Architecture

> **[🇻🇳 Tiếng Việt](#tiếng-việt)** | **[🇬🇧 English](#english)**

---

# 🇻🇳 Tiếng Việt

Chi tiết kiến trúc nội bộ, mô hình dữ liệu, quyết định thiết kế và tổ chức mã nguồn của tiện ích Recall.

---

## Mục lục

- [Tổng quan hệ thống](#tổng-quan-hệ-thống)
- [Ngữ cảnh thực thi](#ngữ-cảnh-thực-thi)
- [Mô hình dữ liệu](#mô-hình-dữ-liệu)
- [Giao thức tin nhắn](#giao-thức-tin-nhắn)
- [Pipeline chụp trang](#pipeline-chụp-trang)
- [Pipeline chụp sâu](#pipeline-chụp-sâu)
- [Chụp tiến trình](#chụp-tiến-trình)
- [Web Clipper](#web-clipper-vi)
- [Kiến trúc tìm kiếm](#kiến-trúc-tìm-kiếm)
- [Tích hợp AI](#tích-hợp-ai)
- [Theo dõi luồng điều hướng](#theo-dõi-luồng-điều-hướng)
- [Theo dõi thay đổi trang](#theo-dõi-thay-đổi-trang-vi)
- [Quản lý phiên](#quản-lý-phiên-vi)
- [Quản lý bộ nhớ](#quản-lý-bộ-nhớ-vi)
- [Đa ngôn ngữ (i18n)](#đa-ngôn-ngữ-i18n-vi)
- [Hệ thống sao lưu](#hệ-thống-sao-lưu)
- [Mô hình bảo mật](#mô-hình-bảo-mật)
- [Hệ thống theme](#hệ-thống-theme)
- [Cân nhắc hiệu năng](#cân-nhắc-hiệu-năng)
- [Quyết định thiết kế](#quyết-định-thiết-kế)

---

## Tổng quan hệ thống

Recall hoạt động trên bốn ngữ cảnh thực thi Chrome extension riêng biệt, giao tiếp chủ yếu qua Chrome message passing API:

```
┌──────────────────────────────────────────────────────────────────┐
│                     Service Worker (Nền)                          │
│                                                                   │
│  ┌────────────────┐ ┌──────────────────┐ ┌───────────────────┐   │
│  │service-worker   │ │capture-manager   │ │deep-capture       │   │
│  │.js              │ │.js               │ │.js                │   │
│  │                 │ │                  │ │                   │   │
│  │- Định tuyến msg │ │- Chụp DOM       │ │- Lệnh CDP         │   │
│  │- Theo dõi nav   │ │- Screenshot     │ │- Tải tài nguyên   │   │
│  │- AI chat/tóm tắt│ │- Thumbnail      │ │- Chụp MHTML       │   │
│  │- Quản lý phiên  │ │- Nén            │ │- Xây dựng bundle  │   │
│  │- Gắn thẻ tự động│ │- Xuất           │ │- Tái tạo HTML     │   │
│  │- Alarm          │ │                  │ │                   │   │
│  │- Menu ngữ cảnh  │ │                  │ │                   │   │
│  └────────┬────────┘ └────────┬─────────┘ └────────┬──────────┘  │
│           │                   │                     │             │
│  ┌────────┴────────┐ ┌───────┴─────────┐ ┌────────┴──────────┐  │
│  │watcher.js       │ │storage-manager  │ │backup-exporter    │  │
│  │                 │ │.js              │ │.js                │  │
│  │- Tải trang      │ │- Kiểm tra quota │ │- Tạo ZIP          │  │
│  │- Hash FNV-1a    │ │- Dọn dẹp tự động│ │- Nhập/xuất        │  │
│  │- Phát hiện thay │ │- Dọn dẹp theo   │ │- Di chuyển dữ liệu│  │
│  │  đổi            │ │  thời gian      │ │                   │  │
│  │- Thông báo      │ │- Thống kê       │ │                   │  │
│  └─────────────────┘ └─────────────────┘ └───────────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │
               chrome.runtime.sendMessage / onMessage
                             │
         ┌───────────────────┼───────────────────────┐
         │                   │                       │
         ▼                   ▼                       ▼
┌────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│Content Scripts  │  │Trang Extension   │  │IndexedDB (RecallDB) │
│                │  │                  │  │  v5 — 7 stores      │
│ snapshot.js    │  │ popup/           │  │                     │
│ spotlight.js   │  │ sidepanel/       │  │ snapshots           │
│ clipper.js     │  │ manager/         │  │ snapshotData        │
│ progressive-   │  │ viewer/          │  │ settings            │
│  capture.js    │  │ diff/            │  │ watchedPages        │
│ you-were-      │  │ dashboard/       │  │ collections         │
│  here.js       │  │ settings/        │  │ autoTagRules        │
│                │  │                  │  │ sessions            │
└────────────────┘  └──────────────────┘  └─────────────────────┘
```

---

## Ngữ cảnh thực thi

### 1. Service Worker (`background/`)

Service worker là trung tâm điều phối. Chạy dưới dạng **module service worker Manifest V3** (`"type": "module"`):

- **Định tuyến tin nhắn**: Tất cả `chrome.runtime.onMessage` chuyển đến `handleMessage()` switch
- **Tự động chụp**: Lắng nghe `webNavigation.onCompleted` và `webNavigation.onHistoryStateUpdated`
- **Tích hợp AI**: Xử lý `SPOTLIGHT_AI_CHAT` và `GENERATE_SUMMARY` qua Google Gemini API
- **Quản lý phiên**: Lưu/khôi phục phiên tab với `SAVE_SESSION` / `RESTORE_SESSION`
- **Bộ sưu tập & gắn thẻ tự động**: CRUD cho collections và auto-tag rules
- **Thùng rác**: Di chuyển snapshot vào thùng rác với tự động xóa sau 30 ngày
- **Theo dõi luồng điều hướng**: In-memory `Map<tabId, SessionInfo>`
- **Alarm**:
  - `recall-time-cleanup` (mỗi 6 giờ): xóa auto-capture cũ
  - `recall-page-watch` (mỗi 15 phút): kiểm tra trang theo dõi
  - `recall-auto-purge` (mỗi 24 giờ): xóa thùng rác quá 30 ngày

### 2. Content Scripts (`content/`)

Năm content script được inject vào mọi trang `http://` và `https://`:

| Script | Mục đích | Cách ly |
|--------|----------|---------|
| `snapshot.js` | Clone DOM và tuần tự hóa | IIFE với guard `window.__recallSnapshotInjected` |
| `spotlight.js` | Overlay tìm kiếm + AI chat | Shadow DOM (closed) |
| `clipper.js` | Web clipper chọn vùng | IIFE với injection guard |
| `progressive-capture.js` | Chụp dần bằng MutationObserver | IIFE với injection guard |
| `you-were-here.js` | Thanh thông báo truy cập lại | Shadow DOM (closed) |

### 3. Trang Extension

| Trang | Mục đích |
|-------|----------|
| `popup/` | Popup thanh công cụ với thao tác nhanh |
| `sidepanel/` | Side panel Chrome danh sách snapshot |
| `manager/` | Quản lý snapshot (grid/list/flow/watch) |
| `viewer/` | Xem snapshot với ghi chú, chú thích, tóm tắt AI |
| `diff/` | So sánh trang cạnh nhau |
| `dashboard/` | Dashboard phân tích và thống kê |
| `settings/` | Giao diện cấu hình |

### 4. Thư viện dùng chung (`lib/`)

| Module | Mục đích |
|--------|----------|
| `constants.js` | Cấu hình DB, 50+ loại tin nhắn, cài đặt mặc định |
| `db.js` | Wrapper IndexedDB cho 7 stores |
| `utils.js` | UUID, định dạng, nén, thumbnail |
| `i18n.js` | Dịch en/vi tập trung, dịch DOM |
| `theme.js` | Chế độ tối/sáng + 6 bảng màu tùy chỉnh |
| `dialog.js` + `dialog.css` | Hộp thoại modal tùy chỉnh |
| `storage-manager.js` | Theo dõi quota & dọn dẹp tự động |
| `zip.js` | Tạo ZIP (không dependency) |

---

## Mô hình dữ liệu

### Schema IndexedDB: `RecallDB` (phiên bản 5)

#### Store: `snapshots` (keyPath: `id`)

Metadata snapshot. Giữ nhẹ để truy vấn danh sách nhanh.

```typescript
interface SnapshotMetadata {
  id: string;                     // UUID v4
  url: string;                    // URL gốc
  title: string;                  // Tiêu đề trang
  domain: string;                 // Hostname
  favicon: string;                // Favicon dạng data URL
  timestamp: number;              // Thời gian chụp (Date.now())
  captureType: 'auto' | 'manual' | 'deep' | 'clip' | 'readlater';
  snapshotSize: number;           // Kích thước blob nén (bytes)
  thumbnailDataUrl: string|null;  // Thumbnail JPEG dạng data URL
  scrollPosition: number;         // window.scrollY khi chụp
  tags: string[];                 // Thẻ do người dùng đặt
  isStarred: boolean;             // Bảo vệ khỏi dọn dẹp tự động
  isPinned: boolean;              // Ghim lên đầu danh sách
  isDeleted: boolean;             // Đã xóa mềm (trong thùng rác)
  deletedAt: number|null;         // Thời gian xóa
  isReadLater: boolean;           // Trong hàng đợi Đọc sau
  isRead: boolean;                // Trạng thái đã đọc
  notes: string;                  // Ghi chú (từ viewer)
  annotations: Annotation[];     // Chú thích đánh dấu văn bản
  sessionId: string|null;         // UUID phiên điều hướng
  parentSnapshotId: string|null;  // Snapshot trước trong luồng
  collectionIds: string[];        // Thành viên bộ sưu tập
}
```

**Indexes:** `url`, `domain`, `timestamp`, `captureType`, `isStarred`, `sessionId`

#### Store: `snapshotData` (keyPath: `id`)

Dữ liệu nhị phân lớn, tách riêng khỏi metadata để tối ưu hiệu năng.

```typescript
interface SnapshotData {
  id: string;                   // Cùng ID với metadata
  domSnapshot: Blob;            // HTML nén gzip
  deepBundle: Blob|null;        // JSON nén gzip (chỉ deep capture)
  textContent: string;          // Văn bản thuần cho tìm kiếm (tối đa 50KB)
}
```

#### Store: `settings` (keyPath: `key`) — Lưu cài đặt key-value

#### Store: `watchedPages` (keyPath: `id`) — Mục theo dõi thay đổi trang

#### Store: `collections` (keyPath: `id`) — Bộ sưu tập snapshot

#### Store: `autoTagRules` (keyPath: `id`) — Quy tắc gắn thẻ tự động theo domain/URL

#### Store: `sessions` (keyPath: `id`) — Phiên tab đã lưu

### Di chuyển Schema

- **v0 → v1**: Khởi tạo (snapshots, snapshotData, settings)
- **v1 → v2**: Thêm index `sessionId` cho luồng điều hướng
- **v2 → v3**: Thêm store `watchedPages`
- **v3 → v4**: Thêm store `collections` và `autoTagRules`
- **v4 → v5**: Thêm store `sessions`

---

## Giao thức tin nhắn

Tất cả giao tiếp liên ngữ cảnh sử dụng `chrome.runtime.sendMessage()` với tin nhắn có kiểu từ `MSG` trong `lib/constants.js`.

### Phong bì phản hồi

```javascript
// Thành công
{ success: true, data: <kết_quả> }

// Lỗi
{ success: false, error: "thông báo lỗi" }
```

### Danh mục tin nhắn (50+ loại)

| Danh mục | Các loại |
|----------|----------|
| **Chụp** | `CAPTURE_PAGE`, `CAPTURE_DOM`, `CAPTURE_DEEP`, `CAPTURE_CLIP`, `CAPTURE_STATUS` |
| **CRUD** | `GET_SNAPSHOTS`, `GET_SNAPSHOT`, `DELETE_SNAPSHOT(S)`, `UPDATE_SNAPSHOT_*` |
| **Cài đặt** | `GET_SETTINGS`, `UPDATE_SETTINGS`, `TOGGLE_AUTO_CAPTURE` |
| **Tìm kiếm** | `SEARCH_CONTENT`, `SPOTLIGHT_SEARCH`, `CHECK_URL_SNAPSHOTS` |
| **Đọc sau** | `MARK_READ_LATER`, `MARK_AS_READ`, `GET_READ_LATER` |
| **Bộ sưu tập** | `CREATE/UPDATE/DELETE/GET_COLLECTIONS`, `ADD/REMOVE_FROM_COLLECTION` |
| **AI** | `GENERATE_SUMMARY`, `GET_SUMMARY`, `FETCH_AI_MODELS`, `SPOTLIGHT_AI_CHAT` |
| **Theo dõi** | `WATCH/UNWATCH_PAGE`, `GET_WATCHED_PAGES`, `UPDATE_WATCH`, `CHECK_WATCHED_NOW` |
| **Phiên** | `SAVE/GET/DELETE/RESTORE_SESSION` |
| **Tiến trình** | `GET_PROGRESSIVE_CACHE`, `CLEAR_PROGRESSIVE_CACHE`, `TAB_CLOSING_CAPTURE` |
| **Ghim/Rác** | `PIN/UNPIN_SNAPSHOT`, `GET_TRASH`, `RESTORE_SNAPSHOT`, `EMPTY_TRASH` |
| **Sao lưu** | `IMPORT/EXPORT_BACKUP` |
| **Dashboard** | `GET_DASHBOARD_STATS` |

---

## Pipeline chụp trang

### Chụp tiêu chuẩn (`capture-manager.js`)

```
1. Kiểm tra điều kiện
   ├── Tab đang được chụp? → bỏ qua
   ├── URL bị loại trừ bởi protocol/domain? → bỏ qua
   ├── Auto-capture: có bản sao gần đây? → bỏ qua
   └── Quota bộ nhớ vượt? → dọn dẹp tự động hoặc bỏ qua

2. Chụp song song
   ├── DOM Snapshot (qua tin nhắn content script)
   │   ├── Clone document.documentElement
   │   ├── Inline stylesheet → <style>
   │   ├── Inline hình ảnh dạng base64
   │   ├── Chụp <canvas> → <img>
   │   ├── Bảo toàn giá trị form
   │   ├── Loại bỏ <script>, event handler
   │   ├── Thêm <base href>
   │   ├── Trích xuất text (tối đa 50KB)
   │   └── Trả về { html, textContent, title, url, ... }
   └── Screenshot (chrome.tabs.captureVisibleTab, JPEG 60%)

3. Xử lý hậu kỳ
   ├── Kiểm tra giới hạn kích thước (mặc định 15MB)
   ├── Nén HTML → gzip Blob
   ├── Tạo thumbnail (320×200 JPEG)
   ├── Sinh UUID
   └── Áp dụng quy tắc gắn thẻ tự động

4. Lưu vào IndexedDB (metadata + data song song)

5. Thông báo: badge "OK" + broadcast SNAPSHOT_SAVED
```

---

## Pipeline chụp sâu

Sử dụng Chrome DevTools Protocol (CDP) qua `chrome.debugger`:

1. Đính kèm debugger → Bật CDP domains (Page, DOM, CSS)
2. Lấy cây tài nguyên → Thu thập đệ quy TẤT CẢ tài nguyên
3. Chụp DOM snapshot với 24 CSS computed properties
4. Chụp MHTML archive
5. Chụp screenshot chất lượng cao
6. Hủy đính kèm debugger
7. Xây dựng HTML có thể xem với tài nguyên inline
8. Nén và lưu

---

## Chụp tiến trình

`progressive-capture.js` sử dụng `MutationObserver` để chụp dần thay đổi trang:

- Theo dõi DOM mutation, scroll và `visibilitychange`
- Debounce chụp để tránh snapshot quá mức
- Chụp trạng thái "cuối cùng" khi người dùng rời trang hoặc đóng tab
- Gửi dữ liệu qua tin nhắn `TAB_CLOSING_CAPTURE`

---

## Web Clipper {#web-clipper-vi}

`clipper.js` cho phép chụp một phần trang:

- Người dùng kích hoạt chế độ clipper qua popup hoặc menu ngữ cảnh
- Overlay chọn xuất hiện để chọn vùng trang
- Chỉ chụp đoạn HTML được chọn
- Lưu với `captureType: 'clip'`

---

## Kiến trúc tìm kiếm

### Ba lớp tìm kiếm

1. **Tìm kiếm Metadata** — Lọc in-memory qua tiêu đề, URL, domain
2. **Tìm kiếm toàn văn** — Duyệt cursor IndexedDB qua `textContent`
3. **Tìm kiếm kết hợp** — Tìm song song metadata + nội dung với loại trùng lặp

### Spotlight Search

Mở rộng tìm kiếm kết hợp với:
- Giới hạn 20 kết quả với trích xuất snippet (~120 ký tự)
- Phân loại loại khớp (`'meta'`, `'content'`, `'both'`)
- Tiền tố `/ai` chuyển sang chế độ AI chat

---

## Tích hợp AI

### Spotlight AI Chat

Khi người dùng gõ `/ai <câu hỏi>` trong Spotlight:

1. Câu hỏi + ngữ cảnh snapshot gần đây gửi đến Google Gemini API
2. System prompt hướng dẫn AI trả lời theo ngôn ngữ đã cấu hình
3. Phản hồi AI hiển thị với markdown cơ bản
4. Snapshot được tham chiếu hiển thị dạng liên kết có thể nhấp

### Tóm tắt AI (Viewer)

- Trích xuất `textContent` từ dữ liệu snapshot
- Gửi đến Gemini với prompt tóm tắt
- Tóm tắt được cache trong metadata snapshot

---

## Theo dõi luồng điều hướng

In-memory `Map<tabId, SessionInfo>`:
- Điều hướng đầu tiên tạo session UUID mới
- Các điều hướng tiếp theo nối chuỗi qua `parentSnapshotId`
- Đóng tab xóa dữ liệu session
- SPA: cửa sổ dedup 3 giây

---

## Theo dõi thay đổi trang {#theo-dõi-thay-đổi-trang-vi}

- Kiểm tra dựa trên alarm mỗi 15 phút
- So sánh hash FNV-1a để phát hiện thay đổi
- Tùy chọn giới hạn phạm vi bằng CSS selector
- Chrome notification khi có thay đổi

---

## Quản lý phiên {#quản-lý-phiên-vi}

- **Lưu**: Ghi tất cả URL, tiêu đề, favicon tab đang mở vào store `sessions`
- **Khôi phục**: Mở tất cả tab từ phiên đã lưu qua `chrome.tabs.create`
- **Danh sách/Xóa**: Xem và quản lý phiên đã lưu

---

## Quản lý bộ nhớ {#quản-lý-bộ-nhớ-vi}

### Lớp StorageManager

- `checkAndCleanup()` gọi trước mỗi lần chụp
- Dựa trên quota: xóa cũ nhất không có sao khi ≥90%
- Dựa trên thời gian: xóa auto-capture cũ hơn N ngày (chạy mỗi 6 giờ)

### Tự động xóa thùng rác

- Alarm `recall-auto-purge` chạy mỗi 24 giờ
- Xóa vĩnh viễn snapshot trong thùng rác quá 30 ngày

---

## Đa ngôn ngữ (i18n) {#đa-ngôn-ngữ-i18n-vi}

### Kiến trúc (`lib/i18n.js`)

| Export | Mục đích |
|--------|----------|
| `initI18n()` | Lấy ngôn ngữ từ `GET_SETTINGS`, đặt `currentLang` |
| `t(key)` | Trả về chuỗi đã dịch, fallback sang English |
| `getLang()` | Trả về `'en'` hoặc `'vi'` |
| `applyI18n(root)` | Dịch `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` |

### Content Scripts

`spotlight.js` và `you-were-here.js` duy trì từ điển `STRINGS` riêng vì chạy trong ngữ cảnh content script và không thể import ES modules.

---

## Hệ thống sao lưu

`backup-exporter.js` + `lib/zip.js`:

- **Xuất**: Tạo ZIP chứa tất cả snapshot, metadata, cài đặt và bộ sưu tập
- **Nhập**: Đọc ZIP, xác thực cấu trúc, merge vào database hiện tại
- Triển khai ZIP không phụ thuộc trong `lib/zip.js`

---

## Mô hình bảo mật

### Cách ly Content Script

- Spotlight và You-Were-Here sử dụng **closed Shadow DOM**
- Guard injection ngăn khởi tạo trùng lặp

### Xem Snapshot (Viewer)

1. Thẻ `<script>` loại bỏ khi chụp
2. Thuộc tính `on*` bị xóa
3. Sanitize bằng DOMParser trong viewer
4. Iframe sandbox (`sandbox.html`) ngăn thực thi script

---

## Hệ thống theme

- `initTheme()`: localStorage → tùy chọn hệ thống → thuộc tính `data-theme`
- `toggleTheme()`: Đảo tối ↔ sáng, lưu vào localStorage
- Bảng màu tùy chỉnh: cài đặt `themeColor` (default, ocean, forest, sunset, midnight, rose)
- CSS sử dụng `[data-theme="dark"]` selectors

---

## Cân nhắc hiệu năng

- **Tách metadata/data**: Truy vấn danh sách chỉ đọc metadata nhẹ
- **Tìm kiếm dựa trên cursor**: Tránh tải tất cả dữ liệu vào bộ nhớ
- **Truy cập DB trực tiếp**: Viewer và diff bỏ qua service worker
- **Nén gzip**: Giảm 60-80% kích thước
- **Chụp song song**: DOM snapshot và screenshot qua `Promise.allSettled`
- **Thumbnail dạng data URL**: Loại bỏ vấn đề tuần tự hóa Blob

---

## Quyết định thiết kế

### Tại sao không có Build System?
JS thuần với ES Modules — Chrome hỗ trợ gốc. Không có sự phức tạp build.

### Tại sao IndexedDB thay vì chrome.storage?
Hỗ trợ Blob, index, cursor, transaction. `chrome.storage.local` có nhiều hạn chế.

### Tại sao dùng Data URL cho Thumbnail?
Tuần tự hóa tin nhắn Chrome không truyền được Blob. Data URL "hoạt động" ở mọi nơi.

### Tại sao dùng FNV-1a cho Theo dõi?
Nhanh, phi mật mã — chỉ cần phát hiện thay đổi, không cần bảo mật.

### Tại sao dùng Shadow DOM cho Content Scripts?
Cách ly CSS/JS hoàn toàn hai chiều giữa UI tiện ích và trang host.

---
---

# 🇬🇧 English

Deep-dive into the internal architecture, data model, design decisions, and code organization of the Recall extension.

---

## Table of Contents

- [System Overview](#system-overview)
- [Execution Contexts](#execution-contexts)
- [Data Model](#data-model)
- [Message Protocol](#message-protocol)
- [Capture Pipeline](#capture-pipeline)
- [Deep Capture Pipeline](#deep-capture-pipeline)
- [Progressive Capture](#progressive-capture)
- [Web Clipper](#web-clipper)
- [Search Architecture](#search-architecture)
- [AI Integration](#ai-integration)
- [Navigation Flow Tracking](#navigation-flow-tracking)
- [Page Change Watching](#page-change-watching)
- [Session Management](#session-management)
- [Storage Management](#storage-management)
- [Internationalization (i18n)](#internationalization-i18n)
- [Backup System](#backup-system)
- [Security Model](#security-model)
- [Theme System](#theme-system)
- [Performance Considerations](#performance-considerations)
- [Design Decisions](#design-decisions)

---

## System Overview

Recall operates across four distinct Chrome extension execution contexts, communicating primarily through Chrome's message passing API:

```
┌──────────────────────────────────────────────────────────────────┐
│                     Service Worker (Background)                   │
│                                                                   │
│  ┌────────────────┐ ┌──────────────────┐ ┌───────────────────┐   │
│  │service-worker   │ │capture-manager   │ │deep-capture       │   │
│  │.js              │ │.js               │ │.js                │   │
│  │                 │ │                  │ │                   │   │
│  │- Message router │ │- DOM capture     │ │- CDP commands     │   │
│  │- Nav tracking   │ │- Screenshot      │ │- Resource fetch   │   │
│  │- AI chat/summary│ │- Thumbnail       │ │- MHTML capture    │   │
│  │- Sessions       │ │- Compression     │ │- Bundle build     │   │
│  │- Auto-tagging   │ │- Export          │ │- HTML rebuild     │   │
│  │- Alarms         │ │                  │ │                   │   │
│  │- Context menus  │ │                  │ │                   │   │
│  └────────┬────────┘ └────────┬─────────┘ └────────┬──────────┘  │
│           │                   │                     │             │
│  ┌────────┴────────┐ ┌───────┴─────────┐ ┌────────┴──────────┐  │
│  │watcher.js       │ │storage-manager  │ │backup-exporter    │  │
│  │                 │ │.js              │ │.js                │  │
│  │- Page fetch     │ │- Quota check    │ │- ZIP creation     │  │
│  │- FNV-1a hash    │ │- Auto cleanup   │ │- Import/export    │  │
│  │- Change detect  │ │- Time cleanup   │ │- Data migration   │  │
│  │- Notifications  │ │- Usage stats    │ │                   │  │
│  └─────────────────┘ └─────────────────┘ └───────────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │
               chrome.runtime.sendMessage / onMessage
                             │
         ┌───────────────────┼───────────────────────┐
         │                   │                       │
         ▼                   ▼                       ▼
┌────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│Content Scripts  │  │Extension Pages   │  │IndexedDB (RecallDB) │
│                │  │                  │  │  v5 — 7 stores      │
│ snapshot.js    │  │ popup/           │  │                     │
│ spotlight.js   │  │ sidepanel/       │  │ snapshots           │
│ clipper.js     │  │ manager/         │  │ snapshotData        │
│ progressive-   │  │ viewer/          │  │ settings            │
│  capture.js    │  │ diff/            │  │ watchedPages        │
│ you-were-      │  │ dashboard/       │  │ collections         │
│  here.js       │  │ settings/        │  │ autoTagRules        │
│                │  │                  │  │ sessions            │
└────────────────┘  └──────────────────┘  └─────────────────────┘
```

---

## Execution Contexts

### 1. Service Worker (`background/`)

The service worker is the central hub. It runs as a **Manifest V3 module service worker** (`"type": "module"`):

- **Message routing**: All `chrome.runtime.onMessage` handlers dispatch to `handleMessage()` switch
- **Auto-capture**: Listens to `webNavigation.onCompleted` and `webNavigation.onHistoryStateUpdated`
- **AI integration**: Handles `SPOTLIGHT_AI_CHAT` and `GENERATE_SUMMARY` using Google Gemini API
- **Session management**: Save/restore tab sessions with `SAVE_SESSION` / `RESTORE_SESSION`
- **Collections & auto-tagging**: CRUD for collections and auto-tag rules
- **Trash / soft delete**: Moves snapshots to trash with 30-day auto-purge
- **Navigation flow tracking**: In-memory `Map<tabId, SessionInfo>`
- **Alarms**:
  - `recall-time-cleanup` (every 6 hours): deletes old auto-captures
  - `recall-page-watch` (every 15 min): checks watched pages
  - `recall-auto-purge` (every 24 hours): empties trash older than 30 days

### 2. Content Scripts (`content/`)

Five content scripts are injected into every `http://` and `https://` page:

| Script | Purpose | Isolation |
|--------|---------|-----------|
| `snapshot.js` | DOM cloning and serialization | IIFE with `window.__recallSnapshotInjected` guard |
| `spotlight.js` | Spotlight search overlay + AI chat | Shadow DOM (closed) |
| `clipper.js` | Web clipper for selecting regions | IIFE with injection guard |
| `progressive-capture.js` | MutationObserver-based incremental capture | IIFE with injection guard |
| `you-were-here.js` | Revisit notification bar | Shadow DOM (closed) |

### 3. Extension Pages

| Page | Purpose |
|------|---------|
| `popup/` | Toolbar popup with quick actions |
| `sidepanel/` | Chrome side panel snapshot list |
| `manager/` | Full-page snapshot management (grid/list/flow/watch) |
| `viewer/` | Snapshot rendering with notes, annotations, AI summary |
| `diff/` | Side-by-side page comparison |
| `dashboard/` | Analytics and statistics |
| `settings/` | Configuration interface |

### 4. Shared Libraries (`lib/`)

| Module | Purpose |
|--------|---------|
| `constants.js` | DB config, 50+ message types, default settings |
| `db.js` | IndexedDB wrapper for 7 stores |
| `utils.js` | UUID, formatting, compression, thumbnails |
| `i18n.js` | Centralized en/vi translations, DOM translation |
| `theme.js` | Dark/light mode + 6 custom color palettes |
| `dialog.js` + `dialog.css` | Custom modal dialogs (confirm, alert) |
| `storage-manager.js` | Quota tracking & auto-cleanup |
| `zip.js` | ZIP archive creation (no dependencies) |

---

## Data Model

### IndexedDB Schema: `RecallDB` (version 5)

#### Store: `snapshots` (keyPath: `id`)

```typescript
interface SnapshotMetadata {
  id: string;                     // UUID v4
  url: string;                    // Original page URL
  title: string;                  // Page title
  domain: string;                 // Hostname
  favicon: string;                // Favicon as data URL
  timestamp: number;              // Capture time (Date.now())
  captureType: 'auto' | 'manual' | 'deep' | 'clip' | 'readlater';
  snapshotSize: number;           // Compressed blob size in bytes
  thumbnailDataUrl: string|null;  // JPEG thumbnail as data URL
  scrollPosition: number;         // window.scrollY at capture
  tags: string[];                 // User-defined tags
  isStarred: boolean;             // Protected from auto-cleanup
  isPinned: boolean;              // Pinned to top of lists
  isDeleted: boolean;             // Soft-deleted (in trash)
  deletedAt: number|null;         // Deletion timestamp
  isReadLater: boolean;           // In Read Later queue
  isRead: boolean;                // Read Later read status
  notes: string;                  // User notes (from viewer)
  annotations: Annotation[];     // Text highlight annotations
  sessionId: string|null;         // Navigation flow session UUID
  parentSnapshotId: string|null;  // Previous snapshot in flow
  collectionIds: string[];        // Collection memberships
}
```

#### Store: `snapshotData` (keyPath: `id`)

```typescript
interface SnapshotData {
  id: string;                   // Same ID as metadata
  domSnapshot: Blob;            // Gzip-compressed HTML
  deepBundle: Blob|null;        // Gzip-compressed JSON (deep capture only)
  textContent: string;          // Plain text for search (max 50KB)
}
```

#### Other Stores

- `settings` — Key-value settings
- `watchedPages` — Page change monitoring entries
- `collections` — Named snapshot groups
- `autoTagRules` — Domain/URL-based auto-tagging rules
- `sessions` — Saved tab sessions

### Schema Migrations

- **v0 → v1**: Initial (snapshots, snapshotData, settings)
- **v1 → v2**: Added `sessionId` index
- **v2 → v3**: Added `watchedPages`
- **v3 → v4**: Added `collections` and `autoTagRules`
- **v4 → v5**: Added `sessions`

---

## Message Protocol

All inter-context communication uses `chrome.runtime.sendMessage()` with typed messages.

### Response Envelope

```javascript
{ success: true, data: <result> }    // Success
{ success: false, error: "message" } // Error
```

### Message Categories (50+ types)

| Category | Types |
|----------|-------|
| **Capture** | `CAPTURE_PAGE`, `CAPTURE_DOM`, `CAPTURE_DEEP`, `CAPTURE_CLIP`, `CAPTURE_STATUS` |
| **CRUD** | `GET_SNAPSHOTS`, `GET_SNAPSHOT`, `DELETE_SNAPSHOT(S)`, `UPDATE_SNAPSHOT_*` |
| **Settings** | `GET_SETTINGS`, `UPDATE_SETTINGS`, `TOGGLE_AUTO_CAPTURE` |
| **Search** | `SEARCH_CONTENT`, `SPOTLIGHT_SEARCH`, `CHECK_URL_SNAPSHOTS` |
| **Read Later** | `MARK_READ_LATER`, `MARK_AS_READ`, `GET_READ_LATER` |
| **Collections** | `CREATE/UPDATE/DELETE/GET_COLLECTIONS`, `ADD/REMOVE_FROM_COLLECTION` |
| **AI** | `GENERATE_SUMMARY`, `GET_SUMMARY`, `FETCH_AI_MODELS`, `SPOTLIGHT_AI_CHAT` |
| **Watch** | `WATCH/UNWATCH_PAGE`, `GET_WATCHED_PAGES`, `UPDATE_WATCH`, `CHECK_WATCHED_NOW` |
| **Sessions** | `SAVE/GET/DELETE/RESTORE_SESSION` |
| **Progressive** | `GET_PROGRESSIVE_CACHE`, `CLEAR_PROGRESSIVE_CACHE`, `TAB_CLOSING_CAPTURE` |
| **Pin / Trash** | `PIN/UNPIN_SNAPSHOT`, `GET_TRASH`, `RESTORE_SNAPSHOT`, `EMPTY_TRASH` |
| **Backup** | `IMPORT/EXPORT_BACKUP` |
| **Dashboard** | `GET_DASHBOARD_STATS` |

---

## Capture Pipeline

### Standard Capture (`capture-manager.js`)

```
1. Check guards (duplicate, excluded, quota)
2. Parallel: DOM Snapshot + Screenshot
3. Post-process: compress, thumbnail, UUID, auto-tag
4. Save to IndexedDB
5. Badge "OK" + broadcast SNAPSHOT_SAVED
```

---

## Deep Capture Pipeline

Uses CDP via `chrome.debugger`:

1. Attach debugger → Enable CDP domains
2. Get resource tree → Collect ALL resources
3. Capture DOM snapshot with computed styles
4. Capture MHTML archive + screenshot
5. Detach debugger
6. Build viewable HTML, compress, save

---

## Progressive Capture

`progressive-capture.js` — `MutationObserver` for incremental capture:
- Watches DOM mutations, scroll, `visibilitychange`
- Debounced captures
- Final capture on tab close via `TAB_CLOSING_CAPTURE`

---

## Web Clipper

`clipper.js` — Partial page capture:
- Selection overlay for choosing regions
- Captures only selected HTML fragment
- Saves with `captureType: 'clip'`

---

## Search Architecture

Three layers: metadata search, full-text content search, combined search.
Spotlight extends with 20-result limit, snippets, and `/ai` mode switch.

---

## AI Integration

- **Spotlight AI Chat**: `/ai <query>` → Gemini API with snapshot context, language-aware
- **AI Summary**: `textContent` → Gemini summarization, cached in metadata

---

## Navigation Flow Tracking

In-memory `Map<tabId, SessionInfo>`:
- First nav creates session UUID
- Subsequent navs chain via `parentSnapshotId`
- SPA: 3s dedup window

---

## Page Change Watching

- Alarm-based checking every 15 min
- FNV-1a hash comparison
- Optional CSS selector scoping
- Chrome notifications on change

---

## Session Management

- Save/restore/list/delete tab sessions

---

## Storage Management

- `checkAndCleanup()` before every capture
- Quota-based + time-based cleanup
- Trash auto-purge (30 days)

---

## Internationalization (i18n)

| Export | Purpose |
|--------|---------|
| `initI18n()` | Fetches language, sets `currentLang` |
| `t(key)` | Translated string, English fallback |
| `getLang()` | Returns `'en'` or `'vi'` |
| `applyI18n(root)` | Translates `data-i18n` attributes |

Content scripts maintain their own `STRINGS` dictionaries.

---

## Backup System

`backup-exporter.js` + `lib/zip.js`: Export/import all data as ZIP.

---

## Security Model

- Closed Shadow DOM for content scripts
- `<script>` removal + `on*` stripping during capture
- DOMParser sanitization + sandboxed iframe in viewer

---

## Theme System

- localStorage → system preference → `data-theme` attribute
- 6 color palettes

---

## Performance Considerations

- Metadata/data separation for fast listing
- Cursor-based search
- Direct DB access in viewer/diff
- Gzip compression (60-80%)
- Parallel capture
- Data URL thumbnails

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| No build system | Chrome supports ES Modules natively |
| IndexedDB | Blob support, indexes, cursors, transactions |
| Data URL thumbnails | Message serialization can't transfer Blobs |
| FNV-1a hashing | Fast, non-cryptographic — only needs change detection |
| Shadow DOM | Complete CSS/JS isolation |
| Tiered capture | auto → manual → deep → clip for coverage vs. fidelity |
