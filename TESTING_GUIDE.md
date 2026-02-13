# Testing Guide for Web Capture Optimizations

## Quick Testing Checklist

This guide helps you verify that the optimizations are working correctly.

### 1. Basic Functionality Test

**Test Regular Capture**
1. Open any webpage (e.g., https://news.google.com)
2. Click the extension icon → "Capture Page"
3. Open browser DevTools (F12) → Console tab
4. Look for capture completion message with timing info
5. ✅ Verify: Capture completes successfully

**Test Deep Capture**
1. Open a complex webpage
2. Right-click → "Deep Capture Page"
3. Check console for:
   - "Skipping low-value resource" messages (fonts, large JS)
   - "Skipping duplicate resource" messages
4. ✅ Verify: Capture completes with filtering messages

**Test Progressive Cache**
1. Open any webpage with images
2. Open DevTools Console
3. Type: `window.__recallProgressiveCache.getStats()`
4. ✅ Verify: Shows `imagesSkipped` count for tiny images

### 2. Performance Comparison Test

**Before/After Comparison**

To measure improvements, use these browser DevTools performance markers:

```javascript
// Add this temporarily to snapshot.js for testing
console.time('Total Capture Time');
// ... existing code ...
console.timeEnd('Total Capture Time');
```

**Expected Results:**
- Regular capture on image-heavy page: 30-40% faster
- Deep capture: 30-50% smaller file size
- CSS files: 20-30% smaller

### 3. Specific Feature Tests

#### A. Parallel Image Batching
**Test Setup:**
1. Open a page with many images (e.g., image gallery site)
2. Open DevTools → Network tab
3. Trigger manual capture
4. Watch Network tab

**Expected Behavior:**
- Multiple image requests load simultaneously (6 at a time)
- NOT one after another sequentially

#### B. CSS Minification
**Test:**
1. Capture any page with stylesheets
2. Open Recall Manager → view the snapshot
3. Open DevTools on viewer → inspect <style> tags

**Expected:**
- CSS has no comments
- Minimal whitespace
- Example: `body{margin:0;padding:0}` instead of:
  ```css
  body {
    margin: 0;
    padding: 0;
  }
  ```

#### C. Resource Filtering (Deep Capture)
**Test:**
1. Open a page with large libraries (e.g., https://github.com)
2. Deep capture the page
3. Check console logs

**Expected Messages:**
```
[Recall] Skipping low-value resource: Script (156.2KB) https://...vendor.js
[Recall] Skipping low-value resource: Font (89.4KB) https://...font.woff2
[Recall] Skipping duplicate resource: https://...jquery.min.js
```

#### D. Reduced Idle Timeout
**Test:**
1. Open a slow-loading page
2. Start capture
3. Time how long it waits before processing

**Expected:**
- Max wait: 15 seconds (was 20s)
- Idle threshold: 600ms (was 1200ms)
- Should start processing sooner

#### E. Progressive Cache Image Filtering
**Test:**
```javascript
// Before capture
window.__recallProgressiveCache.getStats()
```

**Expected Output:**
```javascript
{
  imagesObserved: 47,
  imagesCached: 31,
  imagesSkipped: 16,  // New metric! Tracking pixels and tiny icons
  mutationsCount: 234,
  cacheSize: 2847293,
  cacheCount: 31
}
```

### 4. Edge Cases & Regression Tests

#### Test 1: Pages with No Images
1. Capture a text-only page (e.g., Wikipedia article)
2. ✅ Should complete without errors

#### Test 2: Pages with Cross-Origin Images
1. Capture a page with images from different domains
2. ✅ Should fallback to fetch() and still work

#### Test 3: Very Large Pages
1. Capture a long article page (e.g., long-form journalism)
2. ✅ Should complete within reasonable time
3. ✅ Check memory usage doesn't spike

#### Test 4: Pages with Many Stylesheets
1. Capture a page with 10+ stylesheets
2. ✅ Should process 4 at a time (parallel)
3. ✅ All CSS should be inlined and minified

#### Test 5: SPA (Single Page Applications)
1. Navigate within a SPA (e.g., Gmail, Twitter)
2. Trigger auto-capture
3. ✅ Should capture dynamic content correctly

### 5. Console Log Verification

**Good Signs in Console:**

```
[Recall] Captured: Example Page (234.7KB compressed)
[Recall] Deep capture complete: Example (42 resources, HTML: 156.3KB, Bundle: 892.1KB)
[Recall] Skipping low-value resource: Font (89KB) ...
[Recall] Skipping duplicate resource: https://...
```

**Bad Signs (Report if you see):**

```
[Recall] Capture failed: ...
[Recall] DOM capture error: ...
[Recall] Screenshot capture failed: ...
```

### 6. Performance Metrics to Track

Use this spreadsheet format to track improvements:

| Test Case | Before (seconds) | After (seconds) | Improvement |
|-----------|------------------|-----------------|-------------|
| News site (50 images) | 12.3s | 7.8s | 37% faster |
| GitHub page (deep) | 18.2s | 11.4s | 37% faster |
| Wikipedia article | 4.5s | 3.2s | 29% faster |

### 7. Size Comparison Test

**Regular Capture:**
1. Capture same page before/after optimization
2. Check storage size in IndexedDB
3. Expected: Similar size (optimization focuses on speed)

**Deep Capture:**
1. Deep capture same page before/after
2. Compare bundle sizes in IndexedDB
3. Expected: 30-50% smaller (due to filtering)

### 8. Automated Test Script (Optional)

Run this in console to test multiple captures:

```javascript
// Test batch capture performance
async function testBatchCapture() {
  const urls = [
    'https://news.google.com',
    'https://github.com',
    'https://stackoverflow.com'
  ];
  
  for (const url of urls) {
    console.time(`Capture: ${url}`);
    // Trigger capture here
    console.timeEnd(`Capture: ${url}`);
    await new Promise(r => setTimeout(r, 2000)); // Wait between captures
  }
}
```

### 9. Backward Compatibility Test

**Critical: Ensure existing snapshots still work**

1. Open Recall Manager
2. View a snapshot captured BEFORE the optimization
3. ✅ Should render correctly
4. ✅ All features (notes, highlights, etc.) should work

### 10. Memory Usage Test

**Before Testing:**
1. Open Chrome Task Manager (Shift+Esc)
2. Note extension memory usage

**During Heavy Capture:**
1. Capture 10 pages in rapid succession
2. Monitor memory in Task Manager

**Expected:**
- Memory usage should stay reasonable (<500MB)
- Should not continuously grow (memory leak)
- Progressive cache should auto-evict at 30MB

## Reporting Issues

If you find any issues:

1. **Document the test case**
   - URL that caused the issue
   - Steps to reproduce
   - Expected vs actual behavior

2. **Collect logs**
   - Browser console logs
   - Extension console logs (service worker)

3. **Performance metrics**
   - Capture time
   - File sizes
   - Memory usage

## Success Criteria

All optimizations working correctly if:
- ✅ All captures complete successfully
- ✅ Capture time reduced by 30-40%
- ✅ Deep capture size reduced by 30-50%
- ✅ Console shows filtering messages
- ✅ No JavaScript errors
- ✅ Backward compatible with old snapshots
- ✅ Memory usage stays reasonable

---

**Last Updated**: 2026-02-13  
**Version**: 1.0.0 (Post-optimization)
