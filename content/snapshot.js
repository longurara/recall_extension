// content/snapshot.js - Content script for DOM snapshot capture
// Runs in the context of every web page

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__recallSnapshotInjected) return;
  window.__recallSnapshotInjected = true;

  /**
   * Convert an image element to base64 data URI
   */
  function imageToBase64(img) {
    try {
      if (!img.naturalWidth || !img.naturalHeight) return null;
      if (img.naturalWidth === 0) return null;

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Try WebP first (smaller), fallback to PNG
      try {
        return canvas.toDataURL('image/webp', 0.85);
      } catch {
        return canvas.toDataURL('image/png');
      }
    } catch (e) {
      // Tainted canvas (cross-origin image without CORS)
      return null;
    }
  }

  /**
   * Fetch and inline a CSS stylesheet
   */
  async function fetchCSS(href) {
    try {
      const response = await fetch(href, { mode: 'cors', credentials: 'same-origin' });
      if (!response.ok) return null;
      let css = await response.text();

      // Resolve relative URLs in CSS (url() references)
      const baseUrl = new URL(href);
      css = css.replace(/url\(\s*['"]?(?!data:)(?!#)([^'")]+)['"]?\s*\)/gi, (match, url) => {
        try {
          const absolute = new URL(url, baseUrl).href;
          return `url('${absolute}')`;
        } catch {
          return match;
        }
      });

      return css;
    } catch {
      return null;
    }
  }

  /**
   * Get computed styles that differ from defaults for an element
   */
  function getComputedStyleText(el) {
    try {
      return window.getComputedStyle(el).cssText;
    } catch {
      return '';
    }
  }

  /**
   * Capture the current state of a canvas element
   */
  function captureCanvas(canvas) {
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  /**
   * Clone and process Shadow DOM
   */
  function processShadowDOM(element, clone) {
    if (element.shadowRoot) {
      try {
        const shadowContent = element.shadowRoot.innerHTML;
        const shadowDiv = document.createElement('div');
        shadowDiv.setAttribute('data-recall-shadow', 'true');
        shadowDiv.innerHTML = shadowContent;
        clone.appendChild(shadowDiv);
      } catch {
        // Skip inaccessible shadow roots
      }
    }
  }

  /**
   * Main DOM capture function
   */
  async function captureDOM() {
    const startTime = performance.now();

    // Clone the entire document
    const docClone = document.documentElement.cloneNode(true);

    // 1. Inline all <link rel="stylesheet"> as <style> tags
    const links = docClone.querySelectorAll('link[rel="stylesheet"]');
    const cssPromises = [];

    for (const link of links) {
      const href = link.href || link.getAttribute('href');
      if (!href) continue;

      const absoluteHref = new URL(href, document.baseURI).href;
      cssPromises.push(
        fetchCSS(absoluteHref).then((css) => {
          if (css) {
            const style = document.createElement('style');
            style.setAttribute('data-recall-inlined', absoluteHref);
            style.textContent = css;
            link.parentNode.replaceChild(style, link);
          }
        })
      );
    }

    // Wait for all CSS to be fetched
    await Promise.allSettled(cssPromises);

    // 2. Inline <style> computed styles from CSSOM
    // (for stylesheets that inject rules via JS)
    try {
      for (const sheet of document.styleSheets) {
        try {
          if (sheet.href && !sheet.ownerNode) {
            // External sheet without a node in clone - skip
            continue;
          }
          // Check if we can access rules
          const rules = sheet.cssRules;
          if (!rules) continue;
        } catch {
          // CORS blocked stylesheet - already handled above
        }
      }
    } catch {
      // StyleSheet access error
    }

    // 3. Inline images as base64
    const images = docClone.querySelectorAll('img');
    for (const clonedImg of images) {
      const src = clonedImg.getAttribute('src');
      if (!src || src.startsWith('data:')) continue;

      // Find the original image in the live DOM to read pixels
      const absoluteSrc = new URL(src, document.baseURI).href;
      const originalImg = document.querySelector(`img[src="${CSS.escape(src)}"]`) ||
        Array.from(document.querySelectorAll('img')).find(
          (i) => i.src === absoluteSrc
        );

      if (originalImg && originalImg.complete && originalImg.naturalWidth > 0) {
        const dataUrl = imageToBase64(originalImg);
        if (dataUrl) {
          clonedImg.setAttribute('src', dataUrl);
          // Remove srcset to prevent browser loading other sources
          clonedImg.removeAttribute('srcset');
        }
      }
    }

    // 4. Inline <picture> source elements
    const sources = docClone.querySelectorAll('picture source');
    for (const source of sources) {
      // Remove srcset from picture sources since we inlined the img
      source.removeAttribute('srcset');
    }

    // 5. Capture <canvas> elements
    const canvases = document.querySelectorAll('canvas');
    const clonedCanvases = docClone.querySelectorAll('canvas');
    for (let i = 0; i < canvases.length && i < clonedCanvases.length; i++) {
      const dataUrl = captureCanvas(canvases[i]);
      if (dataUrl) {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.width = canvases[i].style.width || canvases[i].width + 'px';
        img.style.height = canvases[i].style.height || canvases[i].height + 'px';
        img.setAttribute('data-recall-canvas', 'true');
        clonedCanvases[i].parentNode.replaceChild(img, clonedCanvases[i]);
      }
    }

    // 6. Preserve form input values
    const inputs = document.querySelectorAll('input, textarea, select');
    const clonedInputs = docClone.querySelectorAll('input, textarea, select');
    for (let i = 0; i < inputs.length && i < clonedInputs.length; i++) {
      const el = inputs[i];
      const cloned = clonedInputs[i];

      if (el.tagName === 'SELECT') {
        for (let j = 0; j < el.options.length; j++) {
          if (cloned.options[j]) {
            cloned.options[j].selected = el.options[j].selected;
          }
        }
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        cloned.checked = el.checked;
        if (el.checked) cloned.setAttribute('checked', '');
        else cloned.removeAttribute('checked');
      } else if (el.tagName === 'TEXTAREA') {
        cloned.textContent = el.value;
      } else if (el.type !== 'password' && el.type !== 'hidden') {
        cloned.setAttribute('value', el.value);
      }
    }

    // 7. Inline background images in style attributes
    const styledElements = docClone.querySelectorAll('[style]');
    for (const el of styledElements) {
      const style = el.getAttribute('style');
      if (style && style.includes('url(') && !style.includes('data:')) {
        // Keep as-is for now - complex to inline inline styles
        // The base tag will handle relative URLs
      }
    }

    // 8. Remove all <script> tags (security + size reduction)
    const scripts = docClone.querySelectorAll('script');
    for (const script of scripts) {
      script.remove();
    }

    // 9. Remove event handler attributes
    const allElements = docClone.querySelectorAll('*');
    for (const el of allElements) {
      const attrs = el.attributes;
      const toRemove = [];
      for (let i = 0; i < attrs.length; i++) {
        if (attrs[i].name.startsWith('on')) {
          toRemove.push(attrs[i].name);
        }
      }
      for (const attr of toRemove) {
        el.removeAttribute(attr);
      }
    }

    // 10. Remove noscript content (since scripts are removed)
    const noscripts = docClone.querySelectorAll('noscript');
    for (const ns of noscripts) {
      ns.remove();
    }

    // 11. Add <base> tag to resolve relative URLs
    let head = docClone.querySelector('head');
    if (!head) {
      head = document.createElement('head');
      docClone.prepend(head);
    }

    // Remove existing base tags
    const existingBases = head.querySelectorAll('base');
    for (const b of existingBases) b.remove();

    const base = document.createElement('base');
    base.href = document.location.href;
    head.prepend(base);

    // 12. Add recall metadata comment
    const meta = document.createElement('meta');
    meta.name = 'recall-capture-time';
    meta.content = new Date().toISOString();
    head.appendChild(meta);

    const metaUrl = document.createElement('meta');
    metaUrl.name = 'recall-original-url';
    metaUrl.content = document.location.href;
    head.appendChild(metaUrl);

    // 13. Extract plain text content for full-text search
    let textContent = '';
    try {
      // Use the live document (not the clone which has modified elements)
      textContent = (document.body.innerText || '').trim();
      // Collapse whitespace and limit size (50KB max for search index)
      textContent = textContent.replace(/\s+/g, ' ').substring(0, 50000);
    } catch {
      // Skip text extraction on error
    }

    // 14. Build the final HTML
    const html = '<!DOCTYPE html>\n' + docClone.outerHTML;

    const elapsed = Math.round(performance.now() - startTime);

    return {
      html,
      textContent,
      title: document.title || '',
      url: document.location.href,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      captureTime: Date.now(),
      captureElapsed: elapsed,
      htmlSize: html.length,
    };
  }

  /**
   * Get the page's favicon
   */
  function getFavicon() {
    // Try link[rel="icon"] first
    const iconLink =
      document.querySelector('link[rel="shortcut icon"]') ||
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="apple-touch-icon"]');

    if (iconLink && iconLink.href) {
      return iconLink.href;
    }

    // Fallback: default /favicon.ico
    return new URL('/favicon.ico', document.location.origin).href;
  }

  /**
   * Try to convert favicon to base64
   */
  async function faviconToBase64(faviconUrl) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      return new Promise((resolve) => {
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 32, 32);
            resolve(canvas.toDataURL('image/png'));
          } catch {
            resolve(faviconUrl);
          }
        };
        img.onerror = () => resolve(faviconUrl);

        // Timeout
        setTimeout(() => resolve(faviconUrl), 3000);

        img.src = faviconUrl;
      });
    } catch {
      return faviconUrl;
    }
  }

  /**
   * Listen for capture requests from the service worker
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CAPTURE_DOM') {
      // Run async capture
      (async () => {
        try {
          const result = await captureDOM();
          const faviconUrl = getFavicon();
          const favicon = await faviconToBase64(faviconUrl);

          sendResponse({
            success: true,
            data: {
              ...result,
              favicon,
            },
          });
        } catch (error) {
          console.error('[Recall] DOM capture error:', error);
          sendResponse({
            success: false,
            error: error.message,
          });
        }
      })();

      // Return true to indicate async sendResponse
      return true;
    }
  });
})();
