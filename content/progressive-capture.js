// content/progressive-capture.js - Progressive DOM & Resource Collector
// Runs on every page, uses MutationObserver to accumulate content as user browses

(function () {
    'use strict';

    // Prevent multiple injections
    if (window.__recallProgressiveInjected) return;
    window.__recallProgressiveInjected = true;

    // ============================================================
    // Image Cache - stores src → base64 dataURL
    // ============================================================

    const imageCache = new Map();    // src → base64
    const pendingImages = new Set(); // src being processed
    let totalCacheBytes = 0;
    const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50MB limit
    const MAX_IMAGE_DIMENSION = 4096;          // skip huge images (e.g. maps)
    let stats = { imagesObserved: 0, imagesCached: 0, mutationsCount: 0 };

    /**
     * Convert an image element to base64 via canvas
     */
    function imageToBase64(img) {
        try {
            if (!img.naturalWidth || !img.naturalHeight) return null;
            if (img.naturalWidth > MAX_IMAGE_DIMENSION || img.naturalHeight > MAX_IMAGE_DIMENSION) return null;

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // WebP preferred (smaller), fallback PNG
            try {
                return canvas.toDataURL('image/webp', 0.82);
            } catch {
                return canvas.toDataURL('image/png');
            }
        } catch {
            return null; // Tainted canvas (cross-origin)
        }
    }

    /**
     * Evict oldest cache entries when over limit
     */
    function evictIfNeeded() {
        if (totalCacheBytes <= MAX_CACHE_BYTES) return;

        const entries = [...imageCache.entries()];
        // Remove earliest entries until under limit
        while (totalCacheBytes > MAX_CACHE_BYTES * 0.8 && entries.length > 0) {
            const [key, val] = entries.shift();
            totalCacheBytes -= val.length;
            imageCache.delete(key);
        }
    }

    /**
     * Try to cache an image's base64 representation
     */
    function cacheImage(img) {
        const src = img.src || img.currentSrc;
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
        if (imageCache.has(src) || pendingImages.has(src)) return;

        stats.imagesObserved++;

        // If image is already loaded, convert immediately
        if (img.complete && img.naturalWidth > 0) {
            const base64 = imageToBase64(img);
            if (base64) {
                imageCache.set(src, base64);
                totalCacheBytes += base64.length;
                stats.imagesCached++;
                evictIfNeeded();
            }
            return;
        }

        // Wait for image to load
        pendingImages.add(src);
        const onDone = () => {
            pendingImages.delete(src);
            if (img.naturalWidth > 0 && !imageCache.has(src)) {
                const base64 = imageToBase64(img);
                if (base64) {
                    imageCache.set(src, base64);
                    totalCacheBytes += base64.length;
                    stats.imagesCached++;
                    evictIfNeeded();
                }
            }
            img.removeEventListener('load', onDone);
            img.removeEventListener('error', onErr);
        };
        const onErr = () => {
            pendingImages.delete(src);
            img.removeEventListener('load', onDone);
            img.removeEventListener('error', onErr);
        };
        img.addEventListener('load', onDone, { once: true });
        img.addEventListener('error', onErr, { once: true });
    }

    /**
     * Process CSS background images on an element
     */
    function cacheBackgroundImage(el) {
        try {
            const style = window.getComputedStyle(el);
            const bgImage = style.backgroundImage;
            if (!bgImage || bgImage === 'none') return;

            // Extract url() values
            const urlMatch = bgImage.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
            if (!urlMatch) return;

            const url = urlMatch[1];
            if (imageCache.has(url)) return;

            // Fetch and cache as base64
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const base64 = imageToBase64(img);
                if (base64) {
                    imageCache.set(url, base64);
                    totalCacheBytes += base64.length;
                    stats.imagesCached++;
                    evictIfNeeded();
                }
            };
            img.src = url;
        } catch {
            // Skip on error
        }
    }

    /**
     * Scan a node and its descendants for images to cache
     */
    function scanNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        // Direct images
        if (node.tagName === 'IMG') {
            cacheImage(node);
        }

        // Images within the node
        const imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
        for (const img of imgs) {
            cacheImage(img);
        }

        // Background images on visible elements
        if (node.querySelectorAll) {
            // Only process elements with background-image likely set (limit to common containers)
            cacheBackgroundImage(node);
        }
    }

    // ============================================================
    // MutationObserver - watches for new content
    // ============================================================

    let observer = null;

    function startObserving() {
        if (observer) return;

        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                stats.mutationsCount++;

                // New nodes added
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        scanNode(node);
                    }
                }

                // Attribute changes (lazy-loaded images changing src)
                if (mutation.type === 'attributes') {
                    const target = mutation.target;
                    if (target.tagName === 'IMG' &&
                        (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')) {
                        cacheImage(target);
                    }
                }
            }
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'srcset', 'data-src', 'loading'],
        });
    }

    // ============================================================
    // IntersectionObserver - cache images that become visible
    // ============================================================

    let visibilityObserver = null;

    function startVisibilityObserver() {
        if (visibilityObserver) return;

        visibilityObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting && entry.target.tagName === 'IMG') {
                    // Image came into view - try caching after a brief delay to let it load
                    setTimeout(() => cacheImage(entry.target), 500);
                }
            }
        }, { rootMargin: '200px' }); // Start caching 200px before viewport

        // Observe existing images
        const existingImages = document.querySelectorAll('img');
        for (const img of existingImages) {
            visibilityObserver.observe(img);
        }
    }

    // ============================================================
    // Initialization
    // ============================================================

    function init() {
        if (!document.body) {
            // Retry when body is available
            const bodyObserver = new MutationObserver(() => {
                if (document.body) {
                    bodyObserver.disconnect();
                    init();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
            return;
        }

        // Initial scan of existing images
        const existingImages = document.querySelectorAll('img');
        for (const img of existingImages) {
            cacheImage(img);
        }

        // Start observers
        startObserving();
        startVisibilityObserver();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    // ============================================================
    // Expose cache to snapshot.js (shared page context)
    // ============================================================

    window.__recallProgressiveCache = {
        getImageCache: () => Object.fromEntries(imageCache),
        getCacheSize: () => totalCacheBytes,
        getCacheCount: () => imageCache.size,
        getStats: () => ({ ...stats, cacheSize: totalCacheBytes, cacheCount: imageCache.size }),
        clearCache: () => {
            imageCache.clear();
            totalCacheBytes = 0;
            stats = { imagesObserved: 0, imagesCached: 0, mutationsCount: 0 };
        },
        lookupImage: (src) => imageCache.get(src) || null,
    };

    // Also handle chrome.runtime messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'GET_PROGRESSIVE_CACHE') {
            sendResponse({
                stats: window.__recallProgressiveCache.getStats(),
                cacheCount: imageCache.size,
                cacheSize: totalCacheBytes,
            });
            return false;
        }
        if (message.type === 'CLEAR_PROGRESSIVE_CACHE') {
            window.__recallProgressiveCache.clearCache();
            sendResponse({ success: true });
            return false;
        }
    });

    // ============================================================
    // Capture on Tab Close - fast capture before page unloads
    // ============================================================

    let closingCaptureSent = false;

    let fastCaptureOnClose = function () {
        if (closingCaptureSent) return;
        closingCaptureSent = true;

        try {
            // Skip internal pages
            const url = document.location.href;
            if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
                url.startsWith('about:') || url.startsWith('devtools://') ||
                url.startsWith('edge://') || url.startsWith('brave://')) {
                return;
            }

            // Fast DOM clone
            const docClone = document.documentElement.cloneNode(true);

            // Remove scripts (security + size)
            for (const s of docClone.querySelectorAll('script')) s.remove();
            for (const ns of docClone.querySelectorAll('noscript')) ns.remove();

            // Remove event handler attributes
            for (const el of docClone.querySelectorAll('*')) {
                const toRemove = [];
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('on')) toRemove.push(attr.name);
                }
                for (const a of toRemove) el.removeAttribute(a);
            }

            // Fast image inlining from progressive cache (Map lookups only, no canvas)
            if (imageCache.size > 0) {
                for (const img of docClone.querySelectorAll('img')) {
                    const src = img.getAttribute('src');
                    if (!src || src.startsWith('data:')) continue;

                    let absUrl;
                    try { absUrl = new URL(src, document.baseURI).href; } catch { continue; }

                    const cached = imageCache.get(absUrl) || imageCache.get(src);
                    if (cached) {
                        img.setAttribute('src', cached);
                        img.removeAttribute('srcset');
                    }
                }

                // Also handle data-src lazy images
                for (const img of docClone.querySelectorAll('img[data-src]')) {
                    const dataSrc = img.getAttribute('data-src');
                    if (!dataSrc || dataSrc.startsWith('data:')) continue;
                    if (img.getAttribute('src') && img.getAttribute('src').startsWith('data:')) continue;

                    let absUrl;
                    try { absUrl = new URL(dataSrc, document.baseURI).href; } catch { continue; }

                    const cached = imageCache.get(absUrl) || imageCache.get(dataSrc);
                    if (cached) {
                        img.setAttribute('src', cached);
                        img.removeAttribute('data-src');
                        img.removeAttribute('srcset');
                    }
                }
            }

            // Add base tag for relative URLs
            let head = docClone.querySelector('head');
            if (!head) {
                head = document.createElement('head');
                docClone.prepend(head);
            }
            for (const b of head.querySelectorAll('base')) b.remove();
            const base = document.createElement('base');
            base.href = url;
            head.prepend(base);

            // Add recall metadata
            const meta = document.createElement('meta');
            meta.name = 'recall-capture-time';
            meta.content = new Date().toISOString();
            head.appendChild(meta);

            const html = '<!DOCTYPE html>\n' + docClone.outerHTML;

            // Extract plain text (fast)
            let textContent = '';
            try {
                textContent = (document.body.innerText || '').replace(/\s+/g, ' ').substring(0, 50000);
            } catch { /* skip */ }

            // Get favicon
            const iconLink = document.querySelector('link[rel="shortcut icon"]') ||
                document.querySelector('link[rel="icon"]') ||
                document.querySelector('link[rel="apple-touch-icon"]');
            const favicon = iconLink ? iconLink.href : new URL('/favicon.ico', document.location.origin).href;

            // Send to service worker
            chrome.runtime.sendMessage({
                type: 'TAB_CLOSING_CAPTURE',
                data: {
                    html,
                    textContent,
                    title: document.title || '',
                    url,
                    favicon,
                    htmlSize: html.length,
                    captureTime: Date.now(),
                }
            }).catch(() => { }); // Ignore if service worker not ready

        } catch (e) {
            // Silent fail - don't block page unload
        } finally {
            // Cleanup
            if (observer) { observer.disconnect(); observer = null; }
            if (visibilityObserver) { visibilityObserver.disconnect(); visibilityObserver = null; }
            imageCache.clear();
            totalCacheBytes = 0;
        }
    };
    // ============================================================
    // Link Click Interception - capture BEFORE navigation starts
    // ============================================================

    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;

        // Skip modifier keys (opens in new tab, not navigation away)
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;

        // Skip same-page anchors and javascript: links
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        // Skip target="_blank" (opens in new tab)
        if (link.target === '_blank') return;

        // This click will navigate away - capture NOW (before navigation starts)
        fastCaptureOnClose();
    }, true); // Capture phase to fire before other handlers that might prevent default

    // ============================================================
    // Periodic Micro-Snapshots - always have a fresh DOM copy ready
    // ============================================================

    let lastMicroSnapshot = null;
    const MICRO_SNAPSHOT_INTERVAL = 30000; // 30 seconds

    function takeMicroSnapshot() {
        try {
            const url = document.location.href;
            if (!url || url.startsWith('chrome') || url.startsWith('about:')) return;

            const docClone = document.documentElement.cloneNode(true);

            // Quick strip scripts
            for (const s of docClone.querySelectorAll('script, noscript')) s.remove();

            // Inline images from cache (fast Map lookups)
            if (imageCache.size > 0) {
                for (const img of docClone.querySelectorAll('img')) {
                    const src = img.getAttribute('src');
                    if (!src || src.startsWith('data:')) continue;
                    let absUrl;
                    try { absUrl = new URL(src, document.baseURI).href; } catch { continue; }
                    const cached = imageCache.get(absUrl) || imageCache.get(src);
                    if (cached) {
                        img.setAttribute('src', cached);
                        img.removeAttribute('srcset');
                    }
                }
            }

            // Add base tag
            let head = docClone.querySelector('head');
            if (!head) { head = document.createElement('head'); docClone.prepend(head); }
            for (const b of head.querySelectorAll('base')) b.remove();
            const base = document.createElement('base');
            base.href = url;
            head.prepend(base);

            lastMicroSnapshot = {
                html: '<!DOCTYPE html>\n' + docClone.outerHTML,
                title: document.title || '',
                url,
                captureTime: Date.now(),
            };
        } catch { /* silent fail */ }
    }

    // Take periodic snapshots
    const microSnapshotTimer = setInterval(takeMicroSnapshot, MICRO_SNAPSHOT_INTERVAL);
    // Take first snapshot after 5 seconds (let page settle)
    setTimeout(takeMicroSnapshot, 5000);

    // ============================================================
    // Event Listeners - use micro-snapshot if available for speed
    // ============================================================

    // Override fastCaptureOnClose to prefer micro-snapshot for speed
    const originalFastCapture = fastCaptureOnClose;
    fastCaptureOnClose = function () {
        if (closingCaptureSent) return;

        // If we have a recent micro-snapshot (< 60s old), use it for instant send
        if (lastMicroSnapshot && (Date.now() - lastMicroSnapshot.captureTime) < 60000) {
            closingCaptureSent = true;
            try {
                let textContent = '';
                try {
                    textContent = (document.body.innerText || '').replace(/\s+/g, ' ').substring(0, 50000);
                } catch { /* skip */ }

                const iconLink = document.querySelector('link[rel="shortcut icon"]') ||
                    document.querySelector('link[rel="icon"]') ||
                    document.querySelector('link[rel="apple-touch-icon"]');
                const favicon = iconLink ? iconLink.href : new URL('/favicon.ico', document.location.origin).href;

                chrome.runtime.sendMessage({
                    type: 'TAB_CLOSING_CAPTURE',
                    data: {
                        ...lastMicroSnapshot,
                        textContent,
                        favicon,
                        htmlSize: lastMicroSnapshot.html.length,
                    }
                }).catch(() => { });
            } catch { /* silent */ }
            finally {
                clearInterval(microSnapshotTimer);
                if (observer) { observer.disconnect(); observer = null; }
                if (visibilityObserver) { visibilityObserver.disconnect(); visibilityObserver = null; }
                imageCache.clear();
                totalCacheBytes = 0;
            }
            return;
        }

        // No micro-snapshot available - do full capture
        originalFastCapture();
    };

    // Listen for page close/navigation
    window.addEventListener('pagehide', fastCaptureOnClose);
    window.addEventListener('beforeunload', fastCaptureOnClose);

})();
