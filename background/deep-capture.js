// background/deep-capture.js - Deep Capture via Chrome DevTools Protocol (CDP)

import * as db from '../lib/db.js';
import { generateId, getDomain, compressString } from '../lib/utils.js';
import { CAPTURE_DEEP, BADGE_COLORS, MSG } from '../lib/constants.js';

/**
 * Send a CDP command via chrome.debugger
 */
function sendCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Attach debugger to a tab
 */
function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Detach debugger from a tab
 */
function detachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      resolve(); // Ignore errors on detach
    });
  });
}

/**
 * Deep capture a tab using Chrome DevTools Protocol
 * This gets ALL resources from Chrome's memory
 * @param {number} tabId
 * @param {object} [flowMeta] - { sessionId, parentSnapshotId } for navigation flow tracking
 */
export async function deepCaptureTab(tabId, flowMeta = null) {
  let attached = false;

  try {
    // Set badge
    chrome.action.setBadgeText({ text: 'DP', tabId }).catch(() => { });
    chrome.action.setBadgeBackgroundColor({
      color: BADGE_COLORS.CAPTURING,
      tabId,
    }).catch(() => { });

    // Get tab info
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) throw new Error('Invalid tab');

    // Attach debugger
    await attachDebugger(tabId);
    attached = true;

    // Enable required domains
    await sendCommand(tabId, 'Page.enable');
    await sendCommand(tabId, 'DOM.enable');
    await sendCommand(tabId, 'CSS.enable');

    // 1. Get resource tree (all loaded resources)
    const { frameTree } = await sendCommand(tabId, 'Page.getResourceTree');
    const resources = [];

    // Collect all resources from all frames
    async function collectResources(tree) {
      const frame = tree.frame;

      // Fetch the frame's own document HTML first.
      // Page.getResourceTree does NOT include the frame's own document
      // in tree.resources — only sub-resources (CSS, JS, images, etc.).
      // We must explicitly fetch it via Page.getResourceContent.
      if (frame.url && !frame.url.startsWith('about:')) {
        try {
          const { content, base64Encoded } = await sendCommand(
            tabId,
            'Page.getResourceContent',
            { frameId: frame.id, url: frame.url }
          );

          resources.push({
            url: frame.url,
            type: 'Document',
            mimeType: frame.mimeType || 'text/html',
            content,
            base64Encoded: base64Encoded || false,
            frameId: frame.id,
          });
        } catch (e) {
          console.warn(`[Recall] Failed to fetch frame document ${frame.url}:`, e.message);
          resources.push({
            url: frame.url,
            type: 'Document',
            mimeType: frame.mimeType || 'text/html',
            content: null,
            base64Encoded: false,
            frameId: frame.id,
            error: e.message,
          });
        }
      }

      // Get sub-resources for this frame (stylesheets, scripts, images, etc.)
      if (tree.resources) {
        for (const resource of tree.resources) {
          // Skip if this resource URL is the same as the frame document
          // (already fetched above)
          if (resource.url === frame.url) continue;

          try {
            const { content, base64Encoded } = await sendCommand(
              tabId,
              'Page.getResourceContent',
              { frameId: frame.id, url: resource.url }
            );

            resources.push({
              url: resource.url,
              type: resource.type,
              mimeType: resource.mimeType,
              content,
              base64Encoded: base64Encoded || false,
              frameId: frame.id,
            });
          } catch (e) {
            // Resource fetch failed (e.g., cross-origin)
            resources.push({
              url: resource.url,
              type: resource.type,
              mimeType: resource.mimeType,
              content: null,
              base64Encoded: false,
              frameId: frame.id,
              error: e.message,
            });
          }
        }
      }

      // Recurse into child frames
      if (tree.childFrames) {
        for (const child of tree.childFrames) {
          await collectResources(child);
        }
      }
    }

    await collectResources(frameTree);

    // 2. Get full DOM snapshot with computed styles
    const domSnapshot = await sendCommand(tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: [
        'display',
        'visibility',
        'opacity',
        'color',
        'background-color',
        'background-image',
        'font-family',
        'font-size',
        'font-weight',
        'margin',
        'padding',
        'border',
        'width',
        'height',
        'position',
        'top',
        'left',
        'right',
        'bottom',
        'z-index',
        'overflow',
        'text-decoration',
        'transform',
        'box-shadow',
      ],
    });

    // 3. Capture MHTML via CDP
    let mhtmlData = null;
    try {
      const result = await sendCommand(tabId, 'Page.captureSnapshot', {
        format: 'mhtml',
      });
      mhtmlData = result.data;
    } catch {
      console.warn('[Recall] CDP MHTML capture failed, continuing without it');
    }

    // 4. Take screenshot via CDP (higher quality)
    let screenshotData = null;
    let screenshotBlob = null;
    try {
      const result = await sendCommand(tabId, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality: 80,
        captureBeyondViewport: false,
      });
      screenshotData = result.data; // base64
      screenshotBlob = base64ToBlob(screenshotData, 'image/jpeg');
    } catch {
      console.warn('[Recall] CDP screenshot failed');
    }

    // Detach debugger
    await detachDebugger(tabId);
    attached = false;

    // 5. Build the deep capture bundle
    const bundle = {
      captureTime: Date.now(),
      url: tab.url,
      title: tab.title,
      frameTree: {
        url: frameTree.frame.url,
        id: frameTree.frame.id,
        securityOrigin: frameTree.frame.securityOrigin,
      },
      resources: resources.map((r) => ({
        url: r.url,
        type: r.type,
        mimeType: r.mimeType,
        base64Encoded: r.base64Encoded,
        contentLength: r.content ? r.content.length : 0,
        hasContent: r.content !== null,
        error: r.error || null,
      })),
      resourceContents: {}, // URL -> content mapping
      domSnapshot: domSnapshot,
      mhtml: mhtmlData,
      screenshot: screenshotData,
    };

    // Store resource contents separately (can be large)
    for (const r of resources) {
      if (r.content) {
        bundle.resourceContents[r.url] = {
          content: r.content,
          base64Encoded: r.base64Encoded,
        };
      }
    }

    // 6. Serialize and compress the bundle
    const bundleJson = JSON.stringify(bundle);
    const compressedBundle = await compressString(bundleJson);

    // 7. Also create a viewable DOM snapshot (self-contained HTML)
    // by rebuilding from resources
    const viewableHtml = buildViewableHtml(resources, tab.url, tab.title);
    const compressedHtml = await compressString(viewableHtml);

    // 8. Create thumbnail from screenshot (as data URL string for message serialization)
    let thumbnailDataUrl = null;
    if (screenshotData && screenshotBlob) {
      try {
        const bitmap = await createImageBitmap(screenshotBlob);
        const canvas = new OffscreenCanvas(320, 200);
        const ctx = canvas.getContext('2d');

        let w = bitmap.width, h = bitmap.height;
        if (w > 320) { h = (h * 320) / w; w = 320; }
        if (h > 200) { w = (w * 200) / h; h = 200; }

        ctx.drawImage(bitmap, 0, 0, Math.round(w), Math.round(h));
        const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
        // Convert blob to data URL string
        const buffer = await thumbBlob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        thumbnailDataUrl = `data:image/jpeg;base64,${btoa(binary)}`;
      } catch {
        // Thumbnail creation failed
      }
    }

    // 9. Save to IndexedDB
    const id = generateId();

    const metadata = {
      id,
      url: tab.url,
      title: tab.title || 'Untitled',
      domain: getDomain(tab.url),
      favicon: '',
      timestamp: bundle.captureTime,
      captureType: CAPTURE_DEEP,
      snapshotSize: compressedHtml.size + compressedBundle.size + (screenshotBlob?.size || 0),
      thumbnailDataUrl,
      scrollPosition: 0,
      tags: ['deep-capture'],
      isStarred: false,
      // Navigation flow tracking
      sessionId: flowMeta?.sessionId || null,
      parentSnapshotId: flowMeta?.parentSnapshotId || null,
    };

    // Extract text content for full-text search
    let textContent = '';
    const mainDocRes = resources.find(r => r.type === 'Document' && r.content);
    if (mainDocRes && mainDocRes.content) {
      try {
        // Strip HTML tags to get plain text
        const stripped = mainDocRes.content
          .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
          .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        textContent = stripped.substring(0, 50000); // Max 50KB
      } catch { /* ignore */ }
    }

    const snapshotData = {
      id,
      domSnapshot: compressedHtml,
      deepBundle: compressedBundle,
      textContent,
      screenshotBlob,
    };

    await Promise.all([
      db.saveSnapshot(metadata),
      db.saveSnapshotData(snapshotData),
    ]);

    // Success badge
    chrome.action.setBadgeText({ text: 'OK', tabId }).catch(() => { });
    chrome.action.setBadgeBackgroundColor({
      color: BADGE_COLORS.SUCCESS,
      tabId,
    }).catch(() => { });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '', tabId }).catch(() => { });
    }, 3000);

    console.log(
      `[Recall] Deep capture complete: ${tab.title} ` +
      `(${resources.length} resources, ` +
      `HTML: ${(compressedHtml.size / 1024).toFixed(1)}KB, ` +
      `Bundle: ${(compressedBundle.size / 1024).toFixed(1)}KB)`
    );

    // Notify UI
    chrome.runtime.sendMessage({
      type: MSG.SNAPSHOT_SAVED,
      snapshot: metadata,
    }).catch(() => { });

    return metadata;
  } catch (error) {
    console.error('[Recall] Deep capture failed:', error);

    // Ensure debugger is detached
    if (attached) {
      await detachDebugger(tabId);
    }

    // Error badge
    chrome.action.setBadgeText({ text: 'X', tabId }).catch(() => { });
    chrome.action.setBadgeBackgroundColor({
      color: BADGE_COLORS.ERROR,
      tabId,
    }).catch(() => { });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '', tabId }).catch(() => { });
    }, 3000);

    throw error;
  }
}

/**
 * Build a viewable self-contained HTML from CDP resources
 */
function buildViewableHtml(resources, pageUrl, title) {
  // Find the main HTML document
  const mainDoc = resources.find(
    (r) => r.type === 'Document' && r.content
  );

  if (!mainDoc || !mainDoc.content) {
    return `<!DOCTYPE html><html><head><title>${title || 'Deep Capture'}</title></head>` +
      `<body><p>Deep capture data available but could not build viewable HTML.</p></body></html>`;
  }

  let html = mainDoc.content;

  // Inline CSS resources
  for (const r of resources) {
    if (r.type === 'Stylesheet' && r.content && r.url) {
      const styleTag = `<style data-recall-deep-inlined="${r.url}">${r.content}</style>`;
      // Try to replace the <link> tag
      const linkPattern = new RegExp(
        `<link[^>]*href=["']${escapeRegExp(r.url)}["'][^>]*/?>`,
        'gi'
      );
      // Replace directly — .replace() is safe on no-match (returns original)
      // Do NOT use .test() before .replace() with /g flag — .test() advances
      // lastIndex, causing .replace() to skip the first match.
      html = html.replace(linkPattern, styleTag);
    }
  }

  // Inline image resources as base64
  for (const r of resources) {
    if (r.type === 'Image' && r.content && r.base64Encoded && r.url) {
      const mimeType = r.mimeType || 'image/png';
      const dataUri = `data:${mimeType};base64,${r.content}`;
      // Replace src references
      html = html.split(r.url).join(dataUri);
    }
  }

  // Remove scripts (use [\s\S]*? to match any content including < and newlines)
  html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  // Also remove <noscript> tags since scripts are removed
  html = html.replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '');
  // Remove inline event handlers (onclick, onerror, onload, etc.)
  html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Add base tag
  if (!html.includes('<base')) {
    html = html.replace(
      '<head>',
      `<head><base href="${pageUrl}">`
    );
  }

  // Add metadata
  html = html.replace(
    '</head>',
    `<meta name="recall-capture-type" content="deep">` +
    `<meta name="recall-capture-time" content="${new Date().toISOString()}">` +
    `<meta name="recall-original-url" content="${pageUrl}">` +
    `</head>`
  );

  return html;
}

/**
 * Convert base64 string to Blob
 */
function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  const byteChars = atob(base64);
  const byteArrays = [];

  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);

    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: mimeType });
}

/**
 * Escape string for use in RegExp
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
