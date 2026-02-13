# Hướng dẫn sử dụng / User Guide

> **[🇻🇳 Tiếng Việt](#tiếng-việt)** | **[🇬🇧 English](#english)**

---

# 🇻🇳 Tiếng Việt

Hướng dẫn toàn diện để sử dụng mọi tính năng của tiện ích Recall.

---

## Mục lục

- [Bắt đầu](#bắt-đầu)
- [Tự động chụp](#tự-động-chụp)
- [Chụp thủ công](#chụp-thủ-công)
- [Chụp sâu (Deep Capture)](#chụp-sâu-deep-capture)
- [Đọc sau](#đọc-sau)
- [Web Clipper](#web-clipper-vi)
- [Spotlight Search](#spotlight-search-vi)
- [AI Chat](#ai-chat-vi)
- [Thông báo "Bạn đã ở đây"](#thông-báo-bạn-đã-ở-đây)
- [Trình quản lý Snapshot](#trình-quản-lý-snapshot)
- [Trình xem Snapshot](#trình-xem-snapshot)
- [So sánh Diff](#so-sánh-diff)
- [Theo dõi thay đổi trang](#theo-dõi-thay-đổi-trang)
- [Quản lý phiên](#quản-lý-phiên)
- [Dashboard](#dashboard-vi)
- [Side Panel](#side-panel-vi)
- [Popup tiện ích](#popup-tiện-ích)
- [Cài đặt](#cài-đặt-vi)
- [Quản lý bộ nhớ](#quản-lý-bộ-nhớ)
- [Chế độ tối & Theme](#chế-độ-tối--theme)
- [Ngôn ngữ / i18n](#ngôn-ngữ--i18n)
- [Sao lưu & Khôi phục](#sao-lưu--khôi-phục)
- [Mẹo & Thủ thuật](#mẹo--thủ-thuật)
- [Khắc phục sự cố](#khắc-phục-sự-cố)

---

## Bắt đầu

### Cài đặt

1. Tải hoặc clone mã nguồn tiện ích Recall
2. Mở Chrome → `chrome://extensions/`
3. Bật **Developer mode** ở góc trên bên phải
4. Nhấn **Load unpacked** và chọn thư mục tiện ích
5. Ghim icon Recall vào thanh công cụ

### Lần chạy đầu tiên

- Mọi trang bạn truy cập được tự động chụp sau 2 giây
- Icon hiển thị badge trạng thái (xanh = đã chụp)
- Nhấn `Ctrl+Space` trên bất kỳ trang nào để thử Spotlight Search
- Thay đổi ngôn ngữ trong Cài đặt → Ngôn ngữ

---

## Tự động chụp

### Cách hoạt động

1. Bạn truy cập trang web (hoặc SPA thay đổi route)
2. Recall chờ khoảng trễ (mặc định 2 giây)
3. Content script clone DOM, inline CSS và hình ảnh
4. Service worker nén và lưu snapshot
5. Badge "OK" xanh xuất hiện trên icon

### Những gì được chụp

- HTML hoàn chỉnh với style inline
- Hình ảnh cùng origin chuyển đổi sang base64
- Canvas → hình ảnh tĩnh
- Giá trị form được bảo toàn
- Favicon và text trang cho tìm kiếm
- Thumbnail screenshot

### Tắt tự động chụp

- Popup → Bật/tắt "Tự động chụp"
- Menu chuột phải → "Bật/tắt tự động chụp"
- Cài đặt → Bỏ chọn "Bật tự động chụp"

---

## Chụp thủ công

| Phương thức | Cách |
|-------------|------|
| Phím tắt | `Ctrl+Shift+S` / `Cmd+Shift+S` (Mac) |
| Popup | Nhấn "Chụp trang này" |
| Menu chuột phải | Nhấp chuột phải → "Chụp trang này" |

Chụp thủ công **bỏ qua kiểm tra trùng lặp** và **không bao giờ bị tự động xóa**.

---

## Chụp sâu (Deep Capture)

Sử dụng Chrome DevTools Protocol cho độ trung thực tối đa.

### Khi nào nên dùng

- CSS phức tạp / web font không inline tốt
- Trang bạn muốn lưu trữ với chất lượng cao nhất
- Trước khi trang có thể offline hoặc thay đổi đáng kể

### Cách kích hoạt

- Popup → "Chụp sâu (CDP)"
- Menu chuột phải → "Chụp sâu trang này"

### Điều gì xảy ra

1. Chrome hiển thị banner "debugging started" (bình thường)
2. TẤT CẢ tài nguyên được trích xuất (CSS, JS, hình, font)
3. DOM snapshot đầy đủ với computed styles
4. MHTML archive được tạo
5. Screenshot chất lượng cao
6. Mọi thứ được nén và lưu

> Deep capture mất 5-15 giây và tạo snapshot lớn hơn 2-10 lần.

---

## Đọc sau

### Cách lưu

- Popup → "Đọc sau"
- Phím tắt: `Alt+Shift+R`

### Cách truy cập

- Trình quản lý → lọc theo loại "Đọc sau"
- Mục Đọc sau có chỉ báo chưa đọc

### Nhắc đọc

Nếu `readLaterReminderDays` được đặt (mặc định 3 ngày), bạn sẽ nhận thông báo.

---

## Web Clipper {#web-clipper-vi}

1. Menu chuột phải → "Cắt trang này" hoặc bật trong popup
2. Overlay chọn xuất hiện trên trang
3. Chọn vùng bạn muốn cắt
4. Đoạn HTML được chọn lưu dạng snapshot "clip"

---

## Spotlight Search {#spotlight-search-vi}

### Mở

- Nhấn `Ctrl+Space` trên bất kỳ trang web nào

### Sử dụng

1. **Gõ truy vấn** — tìm tiêu đề, URL, domain và nội dung trang
2. **Phím mũi tên** — điều hướng kết quả
3. **Enter** — mở snapshot trong viewer
4. **Ctrl+Enter** — mở trong tab mới
5. **Escape** — đóng overlay

---

## AI Chat {#ai-chat-vi}

### Cách sử dụng

1. Mở Spotlight (`Ctrl+Space`)
2. Gõ `/ai` theo sau bởi câu hỏi
3. AI phân tích snapshot đã lưu và trả lời
4. Snapshot được tham chiếu hiển thị dạng liên kết

### Nút gợi ý

Trong chế độ AI, các nút gợi ý nhanh xuất hiện:
- "Tóm tắt lịch sử duyệt gần đây"
- "Tôi đã đọc gì?"
- "Tìm bài viết về..."

### Thiết lập

1. Cài đặt → phần Tóm tắt AI
2. Đặt nhà cung cấp AI thành "Google Gemini"
3. Nhập API Key Gemini
4. Chọn model (ví dụ: `gemini-2.0-flash`)

> Phản hồi AI khớp ngôn ngữ giao diện (Tiếng Anh / Tiếng Việt).

---

## Thông báo "Bạn đã ở đây"

Khi truy cập lại trang có snapshot, thanh thông báo hiển thị:
- Số lượng snapshot đã lưu
- Thời gian chụp gần nhất
- Liên kết nhanh để xem snapshot

---

## Trình quản lý Snapshot

### Mở

- `Ctrl+Shift+R` / `Cmd+Shift+R` (Mac)
- Popup → "Trình quản lý"
- Menu chuột phải → "Mở Recall Manager"

### Chế độ xem

| Chế độ | Mô tả |
|--------|-------|
| **Lưới** | Thẻ thumbnail với xem trước hover |
| **Danh sách** | Bảng compact |
| **Luồng** | Timeline phiên duyệt web |
| **Theo dõi** | Giám sát thay đổi trang |

### Tổ chức

- **Tìm kiếm**: Lọc theo tiêu đề, URL, domain, nội dung
- **Lọc domain**: Dropdown tất cả domain đã chụp
- **Lọc loại**: Tất cả / Tự động / Thủ công / Sâu / Cắt / Đọc sau
- **Sắp xếp**: Mới nhất, cũ nhất, lớn nhất, nhỏ nhất, tên A-Z
- **Thẻ**: Thêm thẻ tùy chỉnh
- **Bộ sưu tập**: Nhóm snapshot vào bộ sưu tập
- **Sao / Ghim**: Đánh dấu snapshot quan trọng
- **Chọn nhiều**: Ctrl+click để xóa/xuất hàng loạt

### Thùng rác

Snapshot đã xóa vào thùng rác trước. Truy cập từ footer Manager. Tự động xóa sau 30 ngày.

---

## Trình xem Snapshot

| Tính năng | Mô tả |
|-----------|-------|
| **Thanh thông tin** | Thu gọn được, hiển thị tiêu đề, URL, thời gian, kích thước, thẻ |
| **Ghi chú** | Panel bên với tự động lưu |
| **Chú thích** | Đánh dấu văn bản 5 màu |
| **Tóm tắt AI** | Tạo tóm tắt AI cho trang |
| **Điều hướng luồng** | Trước/sau trong phiên duyệt |
| **Hành động** | Sao, xuất (MHTML/HTML), xóa, mở trang gốc |

---

## So sánh Diff

1. Trong Manager, chọn đúng 2 snapshot
2. Nhấn "So sánh"
3. Xem so sánh cạnh nhau với cuộn đồng bộ
4. Chuyển sang "Text Diff" cho diff từng dòng

---

## Theo dõi thay đổi trang

### Thiết lập

1. Popup → "Theo dõi trang này"
2. Cấu hình: chu kỳ kiểm tra, CSS selector (tùy chọn)

### Cách hoạt động

- Mỗi 15 phút, kiểm tra trang đến hạn
- Tải HTML trang, trích xuất text, tính hash FNV-1a
- Nếu hash khác → phát hiện thay đổi → gửi thông báo

---

## Quản lý phiên

### Lưu phiên

- Popup → "Lưu phiên hiện tại"
- Lưu tất cả URL, tiêu đề, favicon tab đang mở

### Khôi phục phiên

- Popup → "Khôi phục phiên cuối"
- Mở lại tất cả tab từ phiên đã lưu

---

## Dashboard {#dashboard-vi}

Truy cập từ header Manager → liên kết "Dashboard".

Hiển thị: thống kê tổng số, hàng ngày, hàng tuần, số chưa đọc; biểu đồ 30 ngày; top domain; phân bổ bộ nhớ; phân bổ loại chụp.

---

## Side Panel {#side-panel-vi}

- Popup → "Mở Side Panel"
- Danh sách snapshot có thể tìm kiếm bên cạnh duyệt web
- Nút chụp nhanh, lọc domain, sắp xếp

---

## Popup tiện ích

| Hành động | Mô tả |
|-----------|-------|
| Chụp trang này | Chụp thủ công |
| Chụp sâu (CDP) | Deep capture |
| Đọc sau | Lưu vào hàng đợi đọc |
| Theo dõi trang | Bắt đầu giám sát |
| Lưu tất cả Tab | Chụp tất cả tab |
| Mở Side Panel | Mở side panel |
| Trình quản lý | Mở Manager |
| Lưu phiên | Lưu phiên tab |
| Khôi phục phiên | Khôi phục phiên |
| Cài đặt | Mở trang cài đặt |
| Bật/tắt tự động chụp | Bật/tắt |

---

## Cài đặt {#cài-đặt-vi}

| Danh mục | Cài đặt |
|----------|---------|
| **Ngôn ngữ** | Tiếng Anh / Tiếng Việt |
| **Chụp** | Tự động chụp, trễ, kích thước tối đa, cửa sổ trùng lặp |
| **Bộ nhớ** | Hạn mức, ngưỡng dọn dẹp, dọn dẹp theo thời gian |
| **Loại trừ domain** | Domain không bao giờ chụp |
| **Tóm tắt AI** | Nhà cung cấp, API key, model |
| **Theme** | Bảng màu (default, ocean, forest, sunset, midnight, rose) |
| **Thông báo** | Nhắc đọc sau, cảnh báo bộ nhớ |
| **Dữ liệu** | Xuất/nhập sao lưu, xóa tất cả |

---

## Quản lý bộ nhớ

### Kích thước ước tính

- Trang thường: 50-200KB (nén)
- Deep capture: 200KB-5MB
- Thumbnail: ~10-30KB

### Chiến lược dọn dẹp

1. **Dọn dẹp theo quota**: Xóa cũ nhất không có sao khi ≥90%
2. **Dọn dẹp theo thời gian**: Auto-capture cũ hơn N ngày bị xóa
3. **Thủ công**: Xóa hoặc xóa hàng loạt từ Manager
4. **Thùng rác**: Xóa mềm với cửa sổ khôi phục 30 ngày
5. **Bảo vệ sao**: Snapshot có sao không bao giờ bị tự động xóa

---

## Chế độ tối & Theme

- Nhấn icon mặt trời/mặt trăng trong header bất kỳ trang Recall
- Lần đầu: theo `prefers-color-scheme` hệ thống
- Sau khi bật/tắt: lưu vào localStorage
- Cài đặt → Màu Theme: 6 bảng màu

---

## Ngôn ngữ / i18n

Cài đặt → Ngôn ngữ → chọn English hoặc Tiếng Việt → Lưu.

Tất cả trang tiện ích cập nhật khi tải lại. Spotlight và AI Chat cũng theo cài đặt ngôn ngữ.

---

## Sao lưu & Khôi phục

- **Xuất**: Cài đặt → "Xuất sao lưu" → tải file ZIP
- **Nhập**: Cài đặt → "Nhập sao lưu" → chọn file ZIP. Dữ liệu được merge vào database hiện tại.

---

## Mẹo & Thủ thuật

1. **Nghiên cứu**: Tự động chụp + Xem luồng để truy vết đường nghiên cứu
2. **Giám sát giá**: Theo dõi trang với CSS selector `#price`
3. **Lưu trữ**: Deep Capture cho trang quan trọng
4. **Tìm nhanh**: `Ctrl+Space` → gõ → `Enter`
5. **Trợ lý AI**: `/ai tóm tắt lịch sử duyệt gần đây` trong Spotlight
6. **Quản lý tab**: Lưu/khôi phục phiên cho chuyển đổi ngữ cảnh

---

## Khắc phục sự cố

### Tự động chụp không hoạt động

1. Kiểm tra bật/tắt tự động chụp (popup)
2. Kiểm tra danh sách loại trừ domain
3. Kiểm tra console service worker

### Chụp sâu thất bại

1. Một số trang chặn đính kèm debugger
2. Thử tải lại trang trước
3. Kiểm tra xem DevTools có đang mở không

### Spotlight không xuất hiện

1. `Ctrl+Space` có thể xung đột với phím tắt khác
2. Tùy chỉnh tại `chrome://extensions/shortcuts`
3. Không chạy trên trang `chrome://`

### AI Chat không hoạt động

1. Xác nhận API key trong Cài đặt → Tóm tắt AI
2. Kiểm tra đã chọn model chưa
3. Kiểm tra kết nối internet
4. Kiểm tra console service worker

### Ngôn ngữ không thay đổi

1. Sau khi đổi ngôn ngữ, nhấn Lưu
2. Tải lại trang tiện ích
3. Ngôn ngữ Spotlight cập nhật lần mở tiếp theo

---
---

# 🇬🇧 English

A comprehensive guide to using every feature of the Recall extension.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Auto-Capture](#auto-capture)
- [Manual Capture](#manual-capture)
- [Deep Capture](#deep-capture)
- [Read Later](#read-later)
- [Web Clipper](#web-clipper)
- [Spotlight Search](#spotlight-search)
- [AI Chat](#ai-chat)
- [You Were Here Notifications](#you-were-here-notifications)
- [Snapshot Manager](#snapshot-manager)
- [Snapshot Viewer](#snapshot-viewer)
- [Page Diff Comparator](#page-diff-comparator)
- [Page Change Watching](#page-change-watching)
- [Session Management](#session-management)
- [Dashboard](#dashboard)
- [Side Panel](#side-panel)
- [Extension Popup](#extension-popup)
- [Settings](#settings)
- [Storage Management](#storage-management)
- [Dark Mode & Themes](#dark-mode--themes)
- [Language / i18n](#language--i18n)
- [Backup & Restore](#backup--restore)
- [Tips & Tricks](#tips--tricks)
- [Troubleshooting](#troubleshooting)

---

## Getting Started

### Installation

1. Download or clone the Recall extension source code
2. Open Chrome → `chrome://extensions/`
3. Turn on **Developer mode**
4. Click **Load unpacked** and select the extension folder
5. Pin the Recall icon to your toolbar

### First Run

- Every page you visit is automatically captured after 2 seconds
- Extension icon shows brief status indicators (green = captured)
- Press `Ctrl+Space` on any page to try Spotlight Search
- Change language in Settings → Language dropdown

---

## Auto-Capture

Silently saves a snapshot of every page you visit.

- Waits for configurable delay (default 2s)
- Clones DOM, inlines CSS and images
- Compresses and stores with gzip
- Green "OK" badge appears on icon

**Captured:** Complete HTML, same-origin images, canvas, form values, favicon, text, thumbnail.

**Disable:** Popup toggle, context menu, or Settings.

---

## Manual Capture

| Method | How |
|--------|-----|
| Keyboard | `Ctrl+Shift+S` / `Cmd+Shift+S` |
| Popup | Click "Capture This Page" |
| Context menu | Right-click → "Capture this page" |

Manual captures **skip duplicate check** and are **never auto-deleted**.

---

## Deep Capture

Uses Chrome DevTools Protocol for maximum fidelity (5-15 seconds).

**Trigger:** Popup → "Deep Capture (CDP)" or context menu.

Captures ALL resources (CSS, JS, images, fonts), computed styles, MHTML, and high-quality screenshot.

---

## Read Later

- **Save:** Popup → "Read Later" or `Alt+Shift+R`
- **Access:** Manager → filter by "Read Later"
- **Reminders:** Notification after configurable days

---

## Web Clipper

1. Context menu → "Clip this page" or popup toggle
2. Selection overlay appears
3. Select area to clip
4. Selected HTML saved as "clip" snapshot

---

## Spotlight Search

Open with `Ctrl+Space`. Type to search titles, URLs, domains, and page content. Arrow keys to navigate, Enter to open, Escape to close.

---

## AI Chat

1. Open Spotlight → type `/ai` + question
2. AI analyzes saved snapshots and responds
3. Referenced snapshots appear as links

**Setup:** Settings → AI Summary → Google Gemini → API Key → Model.

> AI responses match your UI language setting.

---

## You Were Here Notifications

Subtle bar when revisiting pages with saved snapshots. Shows count, last capture time, and quick link.

---

## Snapshot Manager

4 view modes: Grid, List, Flow, Watch. Full search, domain filter, type filter, sort, tags, collections, star/pin, multi-select, and trash.

---

## Snapshot Viewer

Renders HTML in sandboxed iframe. Info bar, notes, 5-color annotations, AI summary, flow navigation, export.

---

## Page Diff Comparator

Select 2 snapshots → Compare. Side-by-side with synced scroll and LCS text diff.

---

## Page Change Watching

Popup → "Watch This Page". Configurable interval and CSS selector. Notifications on change.

---

## Session Management

- **Save:** Popup → "Save Current Session"
- **Restore:** Popup → "Restore Last Session"

---

## Dashboard

Total/daily/weekly stats, 30-day chart, top domains, storage breakdown. Access from Manager header.

---

## Side Panel

Searchable snapshot list alongside browsing. Quick capture, domain filter, sort.

---

## Extension Popup

Quick actions: Capture, Deep Capture, Read Later, Watch, Save All Tabs, Side Panel, Manager, Sessions, Settings, Auto-Capture toggle.

---

## Settings

Language, capture, storage, domain exclusions, thumbnails, AI, theme, notifications, data backup.

---

## Storage Management

- Standard: 50-200KB, Deep: 200KB-5MB
- Quota cleanup (≥90%), time cleanup, manual, trash (30-day), star protection

---

## Dark Mode & Themes

Sun/moon icon toggle. System preference detection. 6 color palettes in Settings.

---

## Language / i18n

Settings → Language → English/Tiếng Việt → Save. All pages update on reload.

---

## Backup & Restore

- **Export:** Settings → "Export Backup" → ZIP
- **Import:** Settings → "Import Backup" → select ZIP

---

## Tips & Tricks

1. Research: Auto-capture + Flow View
2. Price monitoring: Watch page + CSS selector
3. Archival: Deep Capture for important pages
4. Quick recall: `Ctrl+Space` → search → Enter
5. AI: `/ai summarize recent browsing` in Spotlight
6. Tab management: Save/restore sessions

---

## Troubleshooting

- **Auto-capture not working:** Check toggle, domain exclusions, service worker console
- **Deep capture fails:** Page may block debugger; refresh first
- **Spotlight missing:** Shortcut conflict; customize at `chrome://extensions/shortcuts`
- **AI not working:** Check API key, model, internet, service worker console
- **Language stuck:** Save settings, reload pages
- **Storage full:** Delete from Manager, enable time cleanup, increase quota, empty trash
