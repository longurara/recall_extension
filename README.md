# Recall - Web Page Snapshots

> **[🇻🇳 Tiếng Việt](#tiếng-việt)** | **[🇬🇧 English](#english)**

---

# 🇻🇳 Tiếng Việt

**Tự động lưu & tìm lại trang web. Xem lại bất kỳ lúc nào, kể cả khi offline.**

Recall là tiện ích Chrome tự động chụp ảnh DOM của mọi trang web bạn truy cập và lưu trữ cục bộ trong IndexedDB với nén gzip. Không đám mây. Không tài khoản. Không theo dõi. Mọi thứ nằm trên máy bạn.

**Tác giả:** [longurara](https://github.com/longurara)

---

## Mục lục

- [Tính năng](#tính-năng)
- [Cài đặt](#cài-đặt)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Phím tắt](#phím-tắt)
- [Tổng quan kiến trúc](#tổng-quan-kiến-trúc)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Cấu hình](#cấu-hình)
- [Đa ngôn ngữ (i18n)](#đa-ngôn-ngữ-i18n)
- [Tài liệu](#tài-liệu)
- [Câu hỏi thường gặp](#câu-hỏi-thường-gặp)

---

## Tính năng

### Chụp trang cơ bản

- **Tự động chụp** — Tự động lưu ảnh chụp mọi trang bạn truy cập sau khoảng trễ có thể cấu hình (mặc định 2 giây). Hỗ trợ cả SPA qua phát hiện `history.pushState`.
- **Chụp thủ công** — Chụp bằng một cú nhấp từ popup, menu chuột phải, hoặc phím tắt (`Ctrl+Shift+S`).
- **Chụp sâu (Deep Capture)** — Sử dụng Chrome DevTools Protocol (CDP) qua `chrome.debugger` để chụp TẤT CẢ tài nguyên trang (CSS, JS, hình ảnh, font), tạo ảnh chụp hoàn toàn độc lập.
- **Chụp tiến trình (Progressive Capture)** — Chụp dần các thay đổi DOM bằng `MutationObserver`, lưu trạng thái "cuối cùng" của trang.
- **Web Clipper** — Chọn và cắt một phần trang (văn bản, hình ảnh hoặc vùng) thay vì toàn trang.
- **Đọc sau (Read Later)** — Lưu trang vào hàng đợi "Đọc sau" để đọc offline.
- **Lưu tất cả Tab** — Chụp tất cả tab đang mở cùng lúc.
- **Chống trùng lặp** — Bỏ qua chụp cùng URL trong khoảng thời gian cấu hình (mặc định 5 phút).
- **Nén Gzip** — Tất cả HTML được nén bằng `CompressionStream` API, thường giảm 60-80% kích thước.

### Tính năng AI

- **Trò chuyện AI Spotlight** (`/ai` trong Spotlight) — Hỏi AI về lịch sử duyệt web. AI trả lời theo ngôn ngữ bạn cấu hình.
- **Tóm tắt AI** — Tạo tóm tắt bằng AI cho trang đã chụp sử dụng Google Gemini.
- **Cấu hình AI** — Hỗ trợ Google Gemini với API key và model tùy chỉnh.

### Tìm kiếm & Khám phá

- **Spotlight Search** (`Ctrl+Space`) — Overlay tìm kiếm trên bất kỳ trang nào. Tìm kiếm toàn văn bản qua tiêu đề, URL, domain và **nội dung trang**.
- **Tìm kiếm toàn văn** — Tìm kiếm trong nội dung text của mọi trang đã chụp.
- **Thông báo "Bạn đã ở đây"** — Khi truy cập lại trang có ảnh chụp, thanh thông báo hiển thị số lượng và thời gian chụp gần nhất.

### Quản lý & Tổ chức

- **Trình quản lý Snapshot** — Giao diện quản lý toàn trang với 4 chế độ xem: Lưới, Danh sách, Luồng, Theo dõi.
- **Bộ sưu tập (Collections)** — Nhóm ảnh chụp vào các bộ sưu tập được đặt tên.
- **Gắn thẻ tự động** — Tự động gán thẻ dựa trên quy tắc domain/URL.
- **Hệ thống thẻ** — Thêm thẻ tùy chỉnh cho bất kỳ ảnh chụp nào.
- **Đánh dấu / Ghim** — Đánh dấu sao và ghim ảnh chụp quan trọng.
- **Thùng rác** — Ảnh chụp đã xóa vào thùng rác trước, cho phép khôi phục.
- **Chọn nhiều & Thao tác hàng loạt** — Xóa, xuất hoặc gán bộ sưu tập hàng loạt.

### Xem & Chú thích

- **Trình xem Snapshot** — Hiển thị HTML trong iframe sandbox với thanh thông tin, ghi chú, chú thích văn bản 5 màu, điều hướng luồng, tóm tắt AI.
- **So sánh Diff** — So sánh cạnh nhau với cuộn đồng bộ và diff text bằng thuật toán LCS.

### Theo dõi thay đổi trang

- **Theo dõi trang** — Giám sát URL cho thay đổi theo chu kỳ cấu hình (15 phút đến 24 giờ).
- **CSS Selector** — Chỉ theo dõi phần cụ thể bằng CSS selector.
- **Thông báo thay đổi** — Chrome notification khi trang thay đổi.

### Quản lý phiên (Session)

- **Lưu phiên** — Lưu tất cả tab đang mở như một phiên có tên.
- **Khôi phục phiên** — Mở lại tất cả tab từ phiên đã lưu.

### Dashboard & Phân tích

- **Dashboard** — Trang phân tích hiển thị: tổng số, hàng ngày, hàng tuần, biểu đồ 30 ngày, top domain, phân bổ bộ nhớ.

### Lưu trữ & Cài đặt

- **Quản lý bộ nhớ** — Thanh sử dụng, hạn mức cấu hình (mặc định 2GB), dọn dẹp tự động.
- **Nhập / Xuất** — Sao lưu và khôi phục đầy đủ bằng ZIP.
- **Chế độ tối** — Theme tối/sáng với phát hiện tùy chọn hệ thống.
- **Màu theme tùy chỉnh** — 6 bảng màu (default, ocean, forest, sunset, midnight, rose).

### Tích hợp Chrome

- **Side Panel** — Danh sách snapshot nhanh trong side panel Chrome.
- **Menu chuột phải** — Chụp, chụp sâu, cắt, mở quản lý.
- **Badge** — Icon hiển thị trạng thái chụp.

### Đa ngôn ngữ (i18n)

- **Giao diện song ngữ** — Tiếng Anh và Tiếng Việt đầy đủ cho tất cả trang.
- **Module dịch tập trung** — `lib/i18n.js` với dịch DOM qua thuộc tính `data-i18n`.
- **AI nhận biết ngôn ngữ** — AI trả lời theo ngôn ngữ giao diện.

---

## Cài đặt

### Từ mã nguồn (Developer Mode)

1. Clone hoặc tải repository:
   ```bash
   git clone https://github.com/longurara/Extension_recall.git
   ```

2. Mở Chrome và truy cập `chrome://extensions/`

3. Bật **Developer mode** (công tắc góc trên bên phải)

4. Nhấn **Load unpacked** và chọn thư mục `Extension_recall`

5. Icon Recall sẽ xuất hiện trên thanh công cụ Chrome

> **Lưu ý:** Không cần bước build. Tiện ích sử dụng JavaScript thuần với ES Modules và không có dependency ngoài.

---

## Bắt đầu nhanh

1. **Cài đặt tiện ích** theo hướng dẫn trên
2. **Duyệt web bình thường** — Recall tự động chụp trang ở nền
3. **Nhấn `Ctrl+Space`** trên bất kỳ trang nào để tìm kiếm
4. **Gõ `/ai` trong Spotlight** để hỏi AI về lịch sử duyệt web
5. **Nhấn `Ctrl+Shift+R`** để mở Trình quản lý Snapshot
6. **Nhấp chuột phải** trên bất kỳ trang nào để xem tùy chọn chụp
7. **Nhấp icon Recall** trên thanh công cụ để xem thao tác nhanh

---

## Phím tắt

| Phím tắt | Hành động |
|----------|-----------|
| `Ctrl+Shift+S` (`Cmd+Shift+S` trên Mac) | Chụp trang hiện tại |
| `Ctrl+Shift+R` (`Cmd+Shift+R` trên Mac) | Mở Trình quản lý |
| `Ctrl+Space` | Bật/tắt Spotlight Search |
| `Alt+Shift+R` | Lưu Đọc sau |
| `Esc` | Đóng Spotlight / hộp thoại |

> Phím tắt có thể tùy chỉnh tại `chrome://extensions/shortcuts`

---

## Tổng quan kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                     Trình duyệt Chrome                        │
├────────────────┬────────────────────────┬─────────────────────┤
│                │                        │                     │
│  Content       │  Service Worker        │  Extension Pages    │
│  Scripts       │  (Background)          │  (Giao diện)        │
│                │                        │                     │
│ ┌────────────┐ │ ┌────────────────────┐ │ ┌────────────────┐  │
│ │snapshot.js │ │ │ service-worker.js  │ │ │popup           │  │
│ │spotlight.js│◄├─┤  Bộ định tuyến     │◄├─┤sidepanel       │  │
│ │clipper.js  │ │ │  Theo dõi Nav      │ │ │manager         │  │
│ │progressive │ │ │  Menu ngữ cảnh     │ │ │viewer          │  │
│ │-capture.js │ │ │  Tích hợp AI       │ │ │diff            │  │
│ │you-were-   │ │ │  Quản lý phiên     │ │ │dashboard       │  │
│ │here.js     │ │ └──────────┬─────────┘ │ │settings        │  │
│ └────────────┘ │            │           │ └────────────────┘  │
│                │ ┌──────────┴─────────┐ │                     │
│                │ │capture-manager.js  │ │                     │
│                │ │deep-capture.js     │ │                     │
│                │ │watcher.js          │ │                     │
│                │ │backup-exporter.js  │ │                     │
│                │ └──────────┬─────────┘ │                     │
│                │      ┌─────▼──────┐    │                     │
│                │      │ IndexedDB  │    │                     │
│                │      │ RecallDB   │    │                     │
│                │      │ (v5)       │    │                     │
│                │      │ 7 stores   │    │                     │
│                │      └────────────┘    │                     │
└────────────────┴────────────────────────┴─────────────────────┘
```

**Mô hình giao tiếp:** Tất cả trang UI giao tiếp với service worker qua `chrome.runtime.sendMessage()` sử dụng giao thức tin nhắn có kiểu được định nghĩa trong `lib/constants.js`.

---

## Cấu trúc dự án

```
Extension_recall/
├── manifest.json              # Manifest Chrome MV3
├── README.md                  # File này
│
├── icons/                     # Icon tiện ích (16, 32, 48, 128px)
│
├── lib/                       # Module dùng chung
│   ├── constants.js           # Cấu hình DB, loại tin nhắn, cài đặt mặc định
│   ├── db.js                  # Wrapper IndexedDB (7 object stores)
│   ├── utils.js               # UUID, định dạng, nén, thumbnail
│   ├── i18n.js                # Module đa ngôn ngữ (en/vi) tập trung
│   ├── theme.js               # Chế độ tối/sáng + màu theme tùy chỉnh
│   ├── dialog.js              # Hộp thoại modal tùy chỉnh (xác nhận, cảnh báo)
│   ├── dialog.css             # CSS hộp thoại
│   ├── storage-manager.js     # Theo dõi hạn mức & dọn dẹp tự động
│   └── zip.js                 # Tạo file ZIP cho sao lưu xuất
│
├── background/                # Service worker (tiến trình nền)
│   ├── service-worker.js      # Chính: bộ định tuyến, alarm, AI, phiên
│   ├── capture-manager.js     # Điều phối chụp DOM + screenshot + xuất
│   ├── deep-capture.js        # Chụp sâu CDP qua chrome.debugger
│   ├── watcher.js             # Giám sát thay đổi trang bằng hash FNV-1a
│   └── backup-exporter.js     # Xuất/nhập dữ liệu đầy đủ (định dạng ZIP)
│
├── content/                   # Content scripts (inject vào trang web)
│   ├── snapshot.js            # Clone DOM với CSS/image inline
│   ├── spotlight.js           # Overlay Ctrl+Space (Shadow DOM, tìm kiếm + AI chat)
│   ├── clipper.js             # Web clipper để chọn phần trang
│   ├── progressive-capture.js # Chụp dần bằng MutationObserver
│   └── you-were-here.js       # Thanh thông báo truy cập lại (Shadow DOM)
│
├── popup/                     # Popup tiện ích (nhấn icon)
├── sidepanel/                 # Chrome Side Panel
├── manager/                   # Trình quản lý Snapshot
├── viewer/                    # Trình xem Snapshot
├── diff/                      # So sánh Diff trang
├── dashboard/                 # Dashboard phân tích
├── settings/                  # Trang cài đặt
│
└── docs/                      # Tài liệu
    ├── TECHNICAL.md            # Kiến trúc & chi tiết kỹ thuật
    ├── USER_GUIDE.md           # Hướng dẫn sử dụng
    ├── API_REFERENCE.md        # Tài liệu API nội bộ
    └── CONTRIBUTING.md         # Hướng dẫn phát triển & đóng góp
```

---

## Công nghệ sử dụng

| Danh mục | Công nghệ |
|----------|-----------|
| Runtime | Chrome Extension Manifest V3 |
| Ngôn ngữ | JavaScript thuần (ES Modules) |
| Lưu trữ | IndexedDB (7 object stores, schema v5) |
| Nén | `CompressionStream` / `DecompressionStream` gốc (gzip) |
| Giao diện | HTML + CSS thuần (không framework) |
| Chụp sâu | Chrome DevTools Protocol (CDP) qua `chrome.debugger` |
| Thumbnail | `OffscreenCanvas` trong service worker |
| Cách ly nội dung | Shadow DOM (Spotlight, "You Were Here", Clipper) |
| Hash | FNV-1a (phát hiện thay đổi trang) |
| Diff | Thuật toán LCS (Longest Common Subsequence) tùy chỉnh |
| AI | Google Gemini API (có thể cấu hình) |
| i18n | Module tùy chỉnh với dịch DOM qua thuộc tính |
| Sao lưu | ZIP builder tùy chỉnh (không dependency) |
| Build | Không cần — tải trực tiếp dạng unpacked |
| Dependency ngoài | **Không có** |

---

## Cấu hình

| Cài đặt | Mặc định | Mô tả |
|---------|----------|-------|
| `language` | `'vi'` | Ngôn ngữ giao diện (`'vi'` hoặc `'en'`) |
| `autoCapture` | `true` | Bật/tắt chụp tự động |
| `captureDelay` | `2000` ms | Trễ sau khi tải trang trước khi chụp |
| `maxStorageMB` | `2048` (2 GB) | Hạn mức lưu trữ tối đa |
| `maxSnapshotSizeMB` | `15` MB | Bỏ qua trang lớn hơn |
| `duplicateWindowMinutes` | `5` | Bỏ qua cùng URL trong khoảng này |
| `autoCleanupEnabled` | `true` | Bật dọn dẹp tự động |
| `autoCleanupThreshold` | `0.9` (90%) | Kích hoạt dọn dẹp tại mức này |
| `autoCleanupDays` | `0` (tắt) | Xóa tự động chụp cũ hơn N ngày |
| `aiProvider` | `'none'` | Nhà cung cấp AI |
| `themeColor` | `'default'` | Bảng màu theme |

---

## Đa ngôn ngữ (i18n)

Recall hỗ trợ **Tiếng Anh** và **Tiếng Việt**. Ngôn ngữ giao diện được điều khiển bởi cài đặt `language`.

### Cách hoạt động

1. `lib/i18n.js` chứa 100+ key dịch được tổ chức theo thành phần
2. Phần tử HTML sử dụng thuộc tính `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`
3. Khi tải trang: `await initI18n()` lấy cài đặt ngôn ngữ, sau đó `applyI18n()` dịch DOM
4. Văn bản động sử dụng `t('key')` để dịch runtime
5. Phản hồi AI tự động khớp ngôn ngữ đã cấu hình

---

## Tài liệu

- **[Kiến trúc kỹ thuật](docs/TECHNICAL.md)** — Chi tiết kiến trúc, mô hình dữ liệu, luồng tin nhắn
- **[Hướng dẫn sử dụng](docs/USER_GUIDE.md)** — Hướng dẫn đầy đủ từng bước
- **[Tài liệu API](docs/API_REFERENCE.md)** — Tài liệu API module nội bộ
- **[Hướng dẫn đóng góp](docs/CONTRIBUTING.md)** — Thiết lập phát triển và quy ước

---

## Câu hỏi thường gặp

**H: Recall có gửi dữ liệu ra server bên ngoài không?**
Đ: Chỉ khi bạn bật tính năng AI (cần API key Google Gemini). Tất cả snapshot được lưu cục bộ. Không có analytics hay telemetry.

**H: Recall sử dụng bao nhiêu bộ nhớ?**
Đ: Với nén gzip, hầu hết trang nén còn 50-200KB. Hạn mức mặc định 2GB, thường chứa hàng nghìn snapshot.

**H: Điều gì xảy ra khi đầy bộ nhớ?**
Đ: Dọn dẹp tự động xóa các snapshot tự động chụp cũ nhất khi sử dụng đạt 90%. Snapshot có sao và chụp thủ công không bao giờ bị tự động xóa.

**H: Tính năng "Chụp sâu" là gì?**
Đ: Chụp sâu sử dụng Chrome DevTools Protocol để trích xuất TẤT CẢ tài nguyên trực tiếp từ bộ nhớ Chrome, tạo bản sao offline trung thực hơn nhiều.

**H: Tính năng AI Chat là gì?**
Đ: Gõ `/ai` trong Spotlight Search để hỏi về lịch sử duyệt web. AI sử dụng snapshot đã lưu làm ngữ cảnh và trả lời theo ngôn ngữ bạn cấu hình.

**H: Tôi có thể xuất snapshot không?**
Đ: Có. Xuất riêng lẻ MHTML/HTML từ viewer. Sao lưu đầy đủ dạng ZIP từ Cài đặt.

---

## Tương thích trình duyệt

- **Google Chrome** 116+ (yêu cầu Manifest V3, Side Panel API, CompressionStream)
- **Microsoft Edge** 116+ (Chromium-based)
- **Brave Browser** 116+ (Chromium-based)

---

## Giải thích quyền

| Quyền | Lý do cần |
|-------|-----------|
| `pageCapture` | Xuất snapshot dạng MHTML |
| `activeTab` | Truy cập tab hiện tại để chụp thủ công |
| `tabs` | Lấy thông tin tab (URL, tiêu đề) |
| `webNavigation` | Phát hiện tải trang và điều hướng SPA |
| `storage` | Lưu cài đặt tiện ích |
| `unlimitedStorage` | Cho phép IndexedDB vượt hạn mức mặc định |
| `sidePanel` | Hiển thị danh sách snapshot trong side panel Chrome |
| `contextMenus` | Thêm tùy chọn chụp khi nhấp chuột phải |
| `offscreen` | Tạo tài liệu offscreen để xử lý |
| `debugger` | Chụp sâu qua Chrome DevTools Protocol |
| `downloads` | Xuất snapshot dạng file tải về |
| `alarms` | Dọn dẹp định kỳ, theo dõi trang, tự động xóa |
| `notifications` | Cảnh báo khi trang theo dõi thay đổi |
| `<all_urls>` | Chụp DOM snapshot từ bất kỳ trang web nào |

---
---

# 🇬🇧 English

**Auto-save & recall web pages. View snapshots anytime, even offline.**

Recall is a Chrome extension that automatically captures DOM snapshots of every web page you visit and stores them locally in IndexedDB with gzip compression. No cloud. No accounts. No telemetry. Everything stays on your machine.

**Author:** [longurara](https://github.com/longurara)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Configuration](#configuration)
- [Internationalization (i18n)](#internationalization-i18n)
- [Documentation](#documentation)
- [FAQ](#faq)

---

## Features

### Core Capture

- **Auto-Capture** — Automatically snapshots every page you visit after a configurable delay (default 2s). Handles both traditional navigation and SPA route changes via `history.pushState` detection.
- **Manual Capture** — One-click capture from popup, context menu, or keyboard shortcut (`Ctrl+Shift+S`).
- **Deep Capture** — Uses Chrome DevTools Protocol (CDP) via `chrome.debugger` to capture ALL page resources (CSS, JS, images, fonts), computed styles, MHTML archive, and high-quality screenshots.
- **Progressive Capture** — Incrementally captures page mutations over time using `MutationObserver`, capturing the "final" state of a page.
- **Web Clipper** — Select and clip specific portions of a page instead of the full page.
- **Read Later** — Save pages to a "Read Later" queue for offline reading.
- **Save All Tabs** — Capture all open tabs at once with a single click.
- **Smart Deduplication** — Skips capturing the same URL within a configurable time window (default 5 min).
- **Gzip Compression** — All HTML snapshots are compressed using the native `CompressionStream` API, typically achieving 60-80% size reduction.

### AI-Powered Features

- **Spotlight AI Chat** (`/ai` in Spotlight) — Ask questions about your saved snapshots using AI. The AI answers in your configured language.
- **AI Summary** — Generate AI-powered summaries of captured pages using Google Gemini.
- **Configurable AI Provider** — Support for Google Gemini with customizable API key and model selection.

### Search & Discovery

- **Spotlight Search** (`Ctrl+Space`) — macOS Spotlight-inspired overlay on any page. Full-text search across titles, URLs, domains, and **page content** with context snippets.
- **Full-Text Content Search** — Searches extracted plain text of every captured page.
- **"You Were Here" Notifications** — When you revisit a page with saved snapshots, a subtle notification bar shows snapshot count and last capture time.

### Organization & Management

- **Snapshot Manager** — Full-page management interface with 4 view modes: Grid, List, Flow, Watch.
- **Collections** — Group snapshots into named collections.
- **Auto-Tagging** — Automatic tag assignment based on configurable domain/URL rules.
- **Tagging System** — Add custom tags to any snapshot.
- **Star / Pin** — Star important snapshots; pin to top of lists.
- **Trash / Soft Delete** — Deleted snapshots go to trash first, allowing recovery.
- **Multi-Select & Bulk Operations** — Select multiple for delete, export, or collection assignment.

### Viewing & Annotation

- **Snapshot Viewer** — Renders captured HTML in sandboxed iframe with info bar, notes, 5-color annotations, flow navigation, AI summary.
- **Page Diff Comparator** — Side-by-side comparison with synchronized scroll and text diff using LCS algorithm.

### Page Change Watching

- **Watch Pages** — Monitor any URL for content changes at configurable intervals (15 min to 24 hours).
- **CSS Selector Targeting** — Watch only specific page sections.
- **Change Notifications** — Chrome notifications when watched pages change.

### Session Management

- **Save Sessions** — Save all open tabs as a named session.
- **Restore Sessions** — Re-open all tabs from a saved session.

### Dashboard & Analytics

- **Dashboard** — Visual analytics: total/daily/weekly counts, 30-day chart, top domains, storage breakdown.

### Storage & Settings

- **Storage Management** — Visual usage bar, configurable quota (default 2GB), auto-cleanup.
- **Import / Export** — Full backup with ZIP support.
- **Dark Mode** — Dark/light theme with system preference detection.
- **Custom Theme Colors** — 6 palettes (default, ocean, forest, sunset, midnight, rose).

### Chrome Integration

- **Side Panel** — Quick-access snapshot list in Chrome's side panel.
- **Context Menus** — Right-click to capture, deep capture, clip, open manager.
- **Badge Indicators** — Extension icon shows capture status.

### Internationalization (i18n)

- **Bilingual UI** — Full English and Vietnamese translations.
- **Centralized Translation Module** — Single `lib/i18n.js` with `data-i18n` attribute-based DOM translation.
- **AI Language Awareness** — AI responses match the configured UI language.

---

## Installation

### From Source (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/longurara/Extension_recall.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the `Extension_recall` directory

5. The Recall icon will appear in your Chrome toolbar

> **Note:** No build step is required. The extension uses vanilla JavaScript with ES Modules and has zero external dependencies.

---

## Quick Start

1. **Install the extension** following the steps above
2. **Browse normally** — Recall automatically captures pages in the background
3. **Press `Ctrl+Space`** on any page to search your snapshots
4. **Type `/ai` in Spotlight** to ask AI questions about your browsing history
5. **Press `Ctrl+Shift+R`** to open the Snapshot Manager
6. **Right-click** on any page for capture options
7. **Click the Recall icon** in the toolbar to see quick actions

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` (`Cmd+Shift+S` on Mac) | Capture current page |
| `Ctrl+Shift+R` (`Cmd+Shift+R` on Mac) | Open Snapshot Manager |
| `Ctrl+Space` | Toggle Spotlight Search |
| `Alt+Shift+R` | Save to Read Later |
| `Esc` | Close Spotlight / dismiss dialogs |

> Shortcuts can be customized at `chrome://extensions/shortcuts`

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     Chrome Browser                            │
├────────────────┬────────────────────────┬─────────────────────┤
│                │                        │                     │
│  Content       │  Service Worker        │  Extension Pages    │
│  Scripts       │  (Background)          │  (UI)               │
│                │                        │                     │
│ ┌────────────┐ │ ┌────────────────────┐ │ ┌────────────────┐  │
│ │snapshot.js │ │ │ service-worker.js  │ │ │popup           │  │
│ │spotlight.js│◄├─┤  Message Router    │◄├─┤sidepanel       │  │
│ │clipper.js  │ │ │  Nav Tracking      │ │ │manager         │  │
│ │progressive │ │ │  Context Menus     │ │ │viewer          │  │
│ │-capture.js │ │ │  AI Integration    │ │ │diff            │  │
│ │you-were-   │ │ │  Session Mgmt      │ │ │dashboard       │  │
│ │here.js     │ │ └──────────┬─────────┘ │ │settings        │  │
│ └────────────┘ │            │           │ └────────────────┘  │
│                │ ┌──────────┴─────────┐ │                     │
│                │ │capture-manager.js  │ │                     │
│                │ │deep-capture.js     │ │                     │
│                │ │watcher.js          │ │                     │
│                │ │backup-exporter.js  │ │                     │
│                │ └──────────┬─────────┘ │                     │
│                │      ┌─────▼──────┐    │                     │
│                │      │ IndexedDB  │    │                     │
│                │      │ RecallDB   │    │                     │
│                │      │ (v5)       │    │                     │
│                │      │ 7 stores   │    │                     │
│                │      └────────────┘    │                     │
└────────────────┴────────────────────────┴─────────────────────┘
```

**Communication Pattern:** All UI pages communicate with the service worker via `chrome.runtime.sendMessage()` using a typed message protocol defined in `lib/constants.js`.

---

## Project Structure

```
Extension_recall/
├── manifest.json              # Chrome MV3 manifest
├── README.md                  # This file
│
├── icons/                     # Extension icons (16, 32, 48, 128px)
│
├── lib/                       # Shared modules (imported by all contexts)
│   ├── constants.js           # DB config, message types, default settings
│   ├── db.js                  # IndexedDB wrapper (7 object stores)
│   ├── utils.js               # UUID, formatting, compression, thumbnails
│   ├── i18n.js                # Centralized i18n (en/vi) translation module
│   ├── theme.js               # Dark/light mode + custom color themes
│   ├── dialog.js              # Custom modal dialogs (confirm, alert)
│   ├── dialog.css             # Dialog styling
│   ├── storage-manager.js     # Quota tracking & auto-cleanup logic
│   └── zip.js                 # ZIP archive creation for backup export
│
├── background/                # Service worker (background process)
│   ├── service-worker.js      # Main entry: message router, alarms, AI, sessions
│   ├── capture-manager.js     # DOM capture orchestration + screenshot + export
│   ├── deep-capture.js        # CDP-based deep capture via chrome.debugger
│   ├── watcher.js             # Page change monitoring with FNV-1a hashing
│   └── backup-exporter.js     # Full data export/import (ZIP format)
│
├── content/                   # Content scripts (injected into web pages)
│   ├── snapshot.js            # DOM cloning with CSS/image inlining
│   ├── spotlight.js           # Ctrl+Space overlay (Shadow DOM, search + AI chat)
│   ├── clipper.js             # Web clipper for selecting page portions
│   ├── progressive-capture.js # MutationObserver-based incremental capture
│   └── you-were-here.js       # Revisit notification bar (Shadow DOM)
│
├── popup/                     # Extension popup (toolbar icon click)
├── sidepanel/                 # Chrome Side Panel
├── manager/                   # Full-page Snapshot Manager
├── viewer/                    # Snapshot Viewer
├── diff/                      # Page Diff Comparator
├── dashboard/                 # Analytics Dashboard
├── settings/                  # Settings Page
│
└── docs/                      # Documentation
    ├── TECHNICAL.md            # Architecture & internals deep-dive
    ├── USER_GUIDE.md           # End-user usage guide
    ├── API_REFERENCE.md        # Internal API reference
    └── CONTRIBUTING.md         # Development setup & contributing guide
```

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| Runtime | Chrome Extension Manifest V3 |
| Language | Vanilla JavaScript (ES Modules) |
| Storage | IndexedDB (7 object stores, schema v5) |
| Compression | Native `CompressionStream` / `DecompressionStream` (gzip) |
| UI | Plain HTML + CSS (no frameworks) |
| Deep Capture | Chrome DevTools Protocol (CDP) via `chrome.debugger` |
| Thumbnails | `OffscreenCanvas` in service worker |
| Content Isolation | Shadow DOM (Spotlight, "You Were Here", Clipper) |
| Hashing | FNV-1a (page change detection) |
| Diff | Custom LCS (Longest Common Subsequence) algorithm |
| AI | Google Gemini API (configurable) |
| i18n | Custom module with attribute-based DOM translation |
| Backup | Custom ZIP builder (no dependencies) |
| Build System | None required — loads directly as unpacked extension |
| External Dependencies | **Zero** |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `language` | `'vi'` | UI language (`'vi'` or `'en'`) |
| `autoCapture` | `true` | Enable/disable automatic page capture |
| `captureDelay` | `2000` ms | Delay after page load before capturing |
| `maxStorageMB` | `2048` (2 GB) | Maximum storage quota |
| `maxSnapshotSizeMB` | `15` MB | Skip pages larger than this |
| `duplicateWindowMinutes` | `5` | Skip same URL within this time |
| `autoCleanupEnabled` | `true` | Enable automatic storage cleanup |
| `autoCleanupThreshold` | `0.9` (90%) | Trigger cleanup at this usage level |
| `autoCleanupDays` | `0` (disabled) | Delete auto-captures older than N days |
| `aiProvider` | `'none'` | AI provider (`'none'`, `'google'`, etc.) |
| `themeColor` | `'default'` | Color theme palette |

---

## Internationalization (i18n)

Recall supports **English** and **Vietnamese**. The UI language is controlled by the `language` setting.

### How It Works

1. `lib/i18n.js` contains ~100+ translation keys organized by component
2. HTML elements use `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` attributes
3. On page load: `await initI18n()` fetches the language setting, then `applyI18n()` translates the DOM
4. Dynamic text uses `t('key')` for runtime translation
5. AI responses automatically match the configured language

---

## Documentation

- **[Technical Architecture](docs/TECHNICAL.md)** — Deep-dive into architecture, data model, message flow
- **[User Guide](docs/USER_GUIDE.md)** — Complete end-user guide with step-by-step instructions
- **[API Reference](docs/API_REFERENCE.md)** — Internal module API documentation
- **[Contributing Guide](docs/CONTRIBUTING.md)** — Development setup, code conventions, contribution guidelines

---

## FAQ

**Q: Does Recall send any data to external servers?**
A: Only if you enable the AI features (which require a Google Gemini API key). All snapshots are stored locally. There are no analytics or telemetry.

**Q: How much storage does Recall use?**
A: With gzip compression, most pages compress to 50-200KB. The default quota is 2GB, typically holding thousands of snapshots.

**Q: What happens when storage is full?**
A: Auto-cleanup deletes the oldest non-starred auto-captured snapshots when usage reaches 90%.

**Q: What is "Deep Capture"?**
A: Deep Capture uses Chrome's DevTools Protocol to extract ALL resources directly from Chrome's memory, producing a much more faithful offline reproduction.

**Q: What is the AI Chat feature?**
A: Type `/ai` in Spotlight Search to ask questions about your browsing history. The AI uses your saved snapshots as context and responds in your configured language.

**Q: Can I export my snapshots?**
A: Yes. Individual export as MHTML/HTML from the viewer. Full backup export as ZIP from Settings.

---

## Browser Compatibility

- **Google Chrome** 116+ (requires Manifest V3, Side Panel API, CompressionStream)
- **Microsoft Edge** 116+ (Chromium-based)
- **Brave Browser** 116+ (Chromium-based)

---

## Permissions Explained

| Permission | Why It's Needed |
|-----------|----------------|
| `pageCapture` | Export snapshots as MHTML files |
| `activeTab` | Access the current tab for manual capture |
| `tabs` | Get tab info (URL, title) for captures |
| `webNavigation` | Detect page loads and SPA navigation |
| `storage` | Store extension settings |
| `unlimitedStorage` | Allow IndexedDB to exceed default quota |
| `sidePanel` | Show snapshot list in Chrome's side panel |
| `contextMenus` | Add right-click capture options |
| `offscreen` | Create offscreen documents for processing |
| `debugger` | Deep Capture via Chrome DevTools Protocol |
| `downloads` | Export snapshots as downloadable files |
| `alarms` | Periodic cleanup, page watch, auto-purge |
| `notifications` | Alert when watched pages change |
| `<all_urls>` | Capture DOM snapshots from any web page |

---

## Author / Tác giả

Created and maintained by **[longurara](https://github.com/longurara)**.

---

## License / Giấy phép

This project is proprietary software. All rights reserved.
Dự án này là phần mềm độc quyền. Mọi quyền được bảo lưu.

---

**v1.0.0** — Initial release / Phiên bản đầu tiên
