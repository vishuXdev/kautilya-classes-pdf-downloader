// ===========================
// ClassX PDF Downloader
// background.js
// ===========================

const RULE_ID = 42;
const VIEWER_TOOLS_KEY = '__classxViewerToolsV1';

function isViewerUrl(url = '') {
  return /https?:\/\/pdfweb\.classx\.co\.in\/pdfjs[^/]*\/web\/viewer\.html/i.test(url);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

function sanitizeFilename(name = '') {
  const cleaned = String(name).replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'classx_notes.pdf';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function extractFilenameFromViewerUrl(url = '', fallback = 'classx_notes.pdf') {
  try {
    const u = new URL(url);
    const title = u.searchParams.get('title');
    if (title) return sanitizeFilename(safeDecode(title).replace(/\+/g, ' '));

    const fileParam = u.searchParams.get('file');
    if (fileParam) {
      const decodedFileUrl = safeDecode(fileParam);
      const fileUrl = new URL(decodedFileUrl);
      const rawName = fileUrl.pathname.split('/').pop() || '';
      if (rawName) return sanitizeFilename(safeDecode(rawName));
    }
  } catch (e) {}

  return sanitizeFilename(fallback);
}

async function addRefererRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [{
        id: RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Referer',
            operation: 'set',
            value: 'https://pdfweb.classx.co.in/'
          }]
        },
        condition: {
          urlFilter: '*appx.co.in*',
          resourceTypes: ['other', 'xmlhttprequest']
        }
      }]
    });
    console.log('[ClassX BG] Referer rule added');
  } catch (e) {
    console.error('[ClassX BG] Failed to add rule:', e);
  }
}

async function removeRefererRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID] });
  } catch (e) {}
}

function getAllFrames(tabId) {
  return new Promise((resolve) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => resolve(frames || []));
  });
}

async function findPdfFrame(tabId) {
  const frames = await getAllFrames(tabId);
  const pdfFrame = frames.find((f) => isViewerUrl(f.url))
    || frames.find((f) =>
      f.url.includes('viewer')
      || f.url.includes('pdfjs')
      || f.url.includes('pdfweb')
      || (f.url.includes('appx.co.in') && f.frameId !== 0)
    );

  return { frames, pdfFrame };
}

async function injectViewerTools(tabId, frameId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    files: ['viewer_tools.js']
  });
}

async function callViewerTool(tabId, frameId, method, payload) {
  await injectViewerTools(tabId, frameId);

  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    args: [method, payload, VIEWER_TOOLS_KEY],
    func: async (methodName, payloadArg, key) => {
      try {
        const tools = window[key];
        if (!tools || typeof tools[methodName] !== 'function') {
          return { success: false, error: 'Viewer tools unavailable' };
        }
        return await tools[methodName](payloadArg);
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  });

  return results?.[0]?.result || { success: false, error: 'No response from viewer frame' };
}

async function tryInPageViewerDownload(tabId, frameId, preferredName) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    args: [preferredName],
    func: async (preferredNameArg) => {
      const safeDecodeInner = (value) => {
        try {
          return decodeURIComponent(value);
        } catch (e) {
          return value;
        }
      };

      const sanitizeInner = (name = '') => {
        const cleaned = String(name).replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
        if (!cleaned) return 'classx_notes.pdf';
        return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
      };

      const filenameFromLocation = () => {
        try {
          const u = new URL(window.location.href);
          const title = u.searchParams.get('title');
          if (title) return sanitizeInner(safeDecodeInner(title).replace(/\+/g, ' '));

          const fileParam = u.searchParams.get('file');
          if (fileParam) {
            const decodedFileUrl = safeDecodeInner(fileParam);
            const fileUrl = new URL(decodedFileUrl);
            const rawName = fileUrl.pathname.split('/').pop() || '';
            if (rawName) return sanitizeInner(safeDecodeInner(rawName));
          }
        } catch (e) {}
        return null;
      };

      try {
        const targetUrl = window.PDFViewerApplication?.url || null;
        if (!targetUrl) {
          return { success: false, error: 'PDFViewerApplication.url not found' };
        }

        const response = await fetch(targetUrl);
        if (!response.ok) {
          return { success: false, error: `fetch failed with status ${response.status}` };
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const filename = sanitizeInner(preferredNameArg) || filenameFromLocation() || 'classx_notes.pdf';

        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          a.remove();
        }, 30000);

        return { success: true, filename, mode: 'viewer-fetch' };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  });

  return results?.[0]?.result || { success: false, error: 'No result from viewer script' };
}

async function handleDownload(tabId, filename, sendResponse) {
  try {
    const { frames, pdfFrame } = await findPdfFrame(tabId);
    console.log('[ClassX BG] Frames:', frames.map((f) => f.url));

    if (!pdfFrame) {
      sendResponse({ success: false, error: 'PDF frame not found' });
      return;
    }

    console.log('[ClassX BG] PDF frame URL:', pdfFrame.url);

    if (isViewerUrl(pdfFrame.url)) {
      try {
        const viewerFilename = extractFilenameFromViewerUrl(pdfFrame.url, filename || 'classx_notes.pdf');
        const inPageResult = await tryInPageViewerDownload(tabId, pdfFrame.frameId, viewerFilename);
        if (inPageResult?.success) {
          sendResponse({ success: true, mode: 'viewer-fetch', filename: inPageResult.filename });
          return;
        }
      } catch (e) {
        console.warn('[ClassX BG] in-page viewer flow failed:', e?.message || e);
      }
    }

    let pdfUrl = null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [pdfFrame.frameId] },
        world: 'MAIN',
        func: () => {
          try { return PDFViewerApplication?.url || null; } catch (e) { return null; }
        }
      });
      pdfUrl = results?.[0]?.result;
    } catch (e) {
      console.warn('[ClassX BG] Could not read PDFViewerApplication.url:', e?.message || e);
    }

    if (!pdfUrl) {
      try {
        const u = new URL(pdfFrame.url);
        const fileParam = u.searchParams.get('file');
        if (fileParam) pdfUrl = decodeURIComponent(fileParam);
      } catch (e) {}
    }

    if (!pdfUrl) {
      sendResponse({ success: false, error: 'Could not extract PDF URL' });
      return;
    }

    await addRefererRule();

    chrome.downloads.download({
      url: pdfUrl,
      filename: sanitizeFilename(filename || 'classx_notes.pdf'),
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        removeRefererRule();
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ success: true, mode: 'direct-download' });

      const onChanged = (delta) => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(onChanged);
          removeRefererRule();
        }
      };

      chrome.downloads.onChanged.addListener(onChanged);
      setTimeout(removeRefererRule, 30000);
    });
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}

async function handleGetPageToggleData(tabId, fallbackFilename, sendResponse) {
  try {
    const { pdfFrame } = await findPdfFrame(tabId);
    if (!pdfFrame || !isViewerUrl(pdfFrame.url)) {
      sendResponse({ success: false, error: 'Open a ClassX PDF viewer page first' });
      return;
    }

    const filename = extractFilenameFromViewerUrl(pdfFrame.url, fallbackFilename || 'classx_notes.pdf');
    const result = await callViewerTool(tabId, pdfFrame.frameId, 'getPageProfiles', { filename });
    sendResponse(result);
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}

async function handleConvertWithToggles(tabId, payload, sendResponse) {
  try {
    const { pdfFrame } = await findPdfFrame(tabId);
    if (!pdfFrame || !isViewerUrl(pdfFrame.url)) {
      sendResponse({ success: false, error: 'Open a ClassX PDF viewer page first' });
      return;
    }

    const safePayload = {
      filename: sanitizeFilename(payload?.filename || extractFilenameFromViewerUrl(pdfFrame.url, 'classx_notes.pdf')),
      invertPages: Array.isArray(payload?.invertPages) ? payload.invertPages : [],
      pagesPerSheet: [1, 4, 6].includes(Number(payload?.pagesPerSheet)) ? Number(payload.pagesPerSheet) : 1
    };

    const result = await callViewerTool(tabId, pdfFrame.frameId, 'convertPdfWithToggles', safePayload);
    sendResponse(result);
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender?.tab?.id;
  if (!tabId) {
    sendResponse({ success: false, error: 'No active tab context' });
    return false;
  }

  if (msg.type === 'FIND_AND_DOWNLOAD') {
    handleDownload(tabId, msg.filename, sendResponse);
    return true;
  }

  if (msg.type === 'GET_PAGE_TOGGLE_DATA') {
    handleGetPageToggleData(tabId, msg.filename, sendResponse);
    return true;
  }

  if (msg.type === 'CONVERT_PDF_WITH_TOGGLES') {
    handleConvertWithToggles(tabId, msg, sendResponse);
    return true;
  }

  return false;
});
