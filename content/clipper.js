// content/clipper.js - Web Clipper content script for Recall extension

(function () {
    // Respond to selection HTML requests from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'GET_SELECTION_HTML') {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                sendResponse({ html: '', text: '' });
                return;
            }

            const range = selection.getRangeAt(0);
            const fragment = range.cloneContents();
            const container = document.createElement('div');
            container.appendChild(fragment);

            sendResponse({
                html: container.innerHTML,
                text: selection.toString(),
            });
        }

        if (message.type === 'TOGGLE_CLIPPER') {
            toggleClipperOverlay();
        }
    });

    let clipperOverlay = null;

    function toggleClipperOverlay() {
        if (clipperOverlay) {
            clipperOverlay.remove();
            clipperOverlay = null;
            return;
        }

        // Create overlay for visual region selection
        clipperOverlay = document.createElement('div');
        clipperOverlay.id = 'recall-clipper-overlay';
        clipperOverlay.setAttribute('tabindex', '-1');
        clipperOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      z-index: 2147483647; cursor: crosshair;
      background: rgba(0,0,0,0.1); outline: none;
    `;

        let startX, startY;
        let selectionBox = null;

        clipperOverlay.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            startY = e.clientY;
            selectionBox = document.createElement('div');
            selectionBox.style.cssText = `
        position: fixed; border: 2px dashed #6366f1;
        background: rgba(99,102,241,0.1); pointer-events: none;
      `;
            clipperOverlay.appendChild(selectionBox);
        });

        clipperOverlay.addEventListener('mousemove', (e) => {
            if (!selectionBox) return;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const w = Math.abs(e.clientX - startX);
            const h = Math.abs(e.clientY - startY);
            selectionBox.style.left = x + 'px';
            selectionBox.style.top = y + 'px';
            selectionBox.style.width = w + 'px';
            selectionBox.style.height = h + 'px';
        });

        clipperOverlay.addEventListener('mouseup', (e) => {
            if (!selectionBox) return;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const w = Math.abs(e.clientX - startX);
            const h = Math.abs(e.clientY - startY);

            clipperOverlay.remove();
            clipperOverlay = null;

            if (w < 10 || h < 10) return; // Too small

            // Sample multiple points across the selection to find elements
            const samplePoints = [
                [x + w * 0.25, y + h * 0.25],
                [x + w * 0.50, y + h * 0.25],
                [x + w * 0.75, y + h * 0.25],
                [x + w * 0.25, y + h * 0.50],
                [x + w * 0.50, y + h * 0.50],
                [x + w * 0.75, y + h * 0.50],
                [x + w * 0.25, y + h * 0.75],
                [x + w * 0.50, y + h * 0.75],
                [x + w * 0.75, y + h * 0.75],
            ];
            const foundElements = new Set();
            for (const [px, py] of samplePoints) {
                const els = document.elementsFromPoint(px, py);
                for (const el of els) {
                    if (el !== clipperOverlay && el.id !== 'recall-clipper-overlay') {
                        foundElements.add(el);
                    }
                }
            }

            // Find the best containing element (smallest with content)
            let capturedHtml = '';
            let capturedText = '';
            const candidates = [...foundElements].filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });

            // Sort by area (smallest first) and pick suitable container
            candidates.sort((a, b) => {
                const aRect = a.getBoundingClientRect();
                const bRect = b.getBoundingClientRect();
                return (aRect.width * aRect.height) - (bRect.width * bRect.height);
            });

            for (const el of candidates) {
                if (el.innerHTML && el.innerHTML.length > 0) {
                    capturedHtml = el.outerHTML;
                    capturedText = el.innerText || el.textContent || '';
                    break;
                }
            }

            if (capturedHtml) {
                chrome.runtime.sendMessage({
                    type: 'CAPTURE_CLIP',
                    url: window.location.href,
                    title: `Clip: ${document.title}`,
                    domain: window.location.hostname,
                    html: capturedHtml,
                    text: capturedText,
                });
            }
        });

        clipperOverlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                clipperOverlay.remove();
                clipperOverlay = null;
            }
        });

        document.body.appendChild(clipperOverlay);
        clipperOverlay.focus();
    }
})();
