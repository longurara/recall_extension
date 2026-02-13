// lib/utils.js - Shared utility functions for Recall extension

/**
 * Generate a unique ID
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Extract domain from URL
 */
export function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format timestamp to relative time string
 */
export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m}m ago`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    return `${h}h ago`;
  }
  if (seconds < 2592000) {
    const d = Math.floor(seconds / 86400);
    return `${d}d ago`;
  }

  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Format timestamp to full date string
 */
export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Compress a Blob using gzip via CompressionStream
 */
export async function compressBlob(blob) {
  if (typeof CompressionStream === 'undefined') {
    return blob; // Fallback: no compression
  }
  const cs = new CompressionStream('gzip');
  const stream = blob.stream().pipeThrough(cs);
  return new Response(stream).blob();
}

/**
 * Decompress a gzip Blob using DecompressionStream
 */
export async function decompressBlob(blob) {
  if (typeof DecompressionStream === 'undefined') {
    return blob; // Fallback
  }
  const ds = new DecompressionStream('gzip');
  const stream = blob.stream().pipeThrough(ds);
  return new Response(stream).blob();
}

/**
 * Compress a string to gzip Blob
 */
export async function compressString(str) {
  const blob = new Blob([str], { type: 'text/html' });
  return compressBlob(blob);
}

/**
 * Decompress a gzip Blob to string
 */
export async function decompressToString(blob) {
  const decompressed = await decompressBlob(blob);
  return decompressed.text();
}

/**
 * Debounce function
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Throttle function
 */
export function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str, maxLen = 60) {
  if (!str || str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

/**
 * Sanitize HTML string (basic XSS prevention for metadata display)
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Check if a URL should be excluded from capture
 */
export function shouldExcludeUrl(url, settings) {
  if (!url) return true;

  try {
    const parsed = new URL(url);

    // Check protocol
    if (settings.excludeProtocols.includes(parsed.protocol)) {
      return true;
    }

    // Check domain
    if (settings.excludeDomains.some((d) => parsed.hostname.includes(d))) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Create a thumbnail from an image data URL
 */
export function createThumbnail(dataUrl, maxWidth = 320, maxHeight = 200, quality = 0.6) {
  // Service Worker context: use OffscreenCanvas + createImageBitmap
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return (async () => {
      if (typeof OffscreenCanvas === 'undefined') {
        throw new Error('createThumbnail not supported in this context');
      }
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      let { width, height } = bitmap;
      if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth; }
      if (height > maxHeight) { width = (width * maxHeight) / height; height = maxHeight; }
      const canvas = new OffscreenCanvas(Math.round(width), Math.round(height));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.convertToBlob({ type: 'image/jpeg', quality });
    })();
  }

  // Page context: use Image + canvas
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      // Scale down
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create thumbnail'));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
