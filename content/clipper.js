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
        clipperOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      z-index: 2147483647; cursor: crosshair;
      background: rgba(0,0,0,0.1);
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

            // Capture elements within the selected region
            const elementsInRegion = document.elementsFromPoint(x + w / 2, y + h / 2);
            let capturedHtml = '';
            let capturedText = '';

            // Try to find the best containing element
            for (const el of elementsInRegion) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
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
