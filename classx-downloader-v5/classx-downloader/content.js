// ===========================
// ClassX PDF Downloader
// content.js
// ===========================

let downloadBtn = null;
let pageToolsBtn = null;
let creatorBadge = null;
let panelRoot = null;
let panelFilename = 'classx_notes.pdf';
let panelSuggested = new Map();

function isViewerPageUrl(url = window.location.href) {
  return /https?:\/\/pdfweb\.classx\.co\.in\/pdfjs[^/]*\/web\/viewer\.html/i.test(url);
}

function findPDFIframe() {
  const allIframes = document.querySelectorAll('iframe');
  for (const iframe of allIframes) {
    const src = iframe.src || '';
    if (
      src.includes('pdfjs')
      || src.includes('viewer.html')
      || src.includes('pdfweb')
      || src.includes('.pdf')
      || src.includes('appx.co.in')
    ) {
      return iframe;
    }
  }

  const h100 = document.querySelector('.h-100');
  if (h100) {
    const iframe = h100.querySelector('iframe');
    if (iframe) return iframe;
  }

  return null;
}

function sanitizeFilename(name = '') {
  const cleaned = String(name).replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'classx_notes.pdf';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function extractFilename(src) {
  try {
    const url = new URL(src, window.location.origin);
    const title = url.searchParams.get('title');
    if (title) return sanitizeFilename(decodeURIComponent(title).replace(/\+/g, ' '));

    const fileParam = url.searchParams.get('file');
    if (fileParam) {
      const decoded = decodeURIComponent(fileParam);
      const match = decoded.match(/\/([^/?#]+\.pdf)/i);
      if (match) return sanitizeFilename(match[1]);
    }
  } catch (e) {}

  return 'classx_notes.pdf';
}

function showToast(html, type = 'info', persist = false) {
  const existing = document.getElementById('classx-toast');
  if (existing) existing.remove();

  const colors = {
    success: '#22c55e',
    error: '#ef4444',
    info: '#6c63ff',
    loading: '#f59e0b'
  };

  const t = document.createElement('div');
  t.id = 'classx-toast';
  t.innerHTML = html;
  t.style.cssText = `
    position:fixed; bottom:80px; right:20px; z-index:2147483647;
    padding:10px 14px; border-radius:8px; font-size:12px; font-weight:600;
    color:#fff; background:${colors[type] || colors.info};
    box-shadow:0 4px 16px rgba(0,0,0,.35);
    max-width:320px; font-family:'Segoe UI',sans-serif; line-height:1.5;
    transition:opacity .4s;
  `;

  document.body.appendChild(t);
  if (!persist) {
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 400);
    }, 4500);
  }

  return t;
}

function setDownloadBtn(state) {
  if (!downloadBtn) return;

  const S = {
    idle: { text: 'Download PDF', bg: 'linear-gradient(135deg,#6c63ff,#4f46e5)', dis: false },
    loading: { text: 'Please wait...', bg: 'linear-gradient(135deg,#f59e0b,#d97706)', dis: true },
    ok: { text: 'Done', bg: 'linear-gradient(135deg,#22c55e,#16a34a)', dis: true },
    err: { text: 'Retry', bg: 'linear-gradient(135deg,#ef4444,#dc2626)', dis: false }
  };

  const s = S[state] || S.idle;
  downloadBtn.textContent = s.text;
  downloadBtn.style.background = s.bg;
  downloadBtn.disabled = s.dis;

  if (state === 'ok' || state === 'err') {
    setTimeout(() => setDownloadBtn('idle'), 3000);
  }
}

function setToolsBtn(state) {
  if (!pageToolsBtn) return;

  const S = {
    idle: { text: 'Page Toggles', bg: 'linear-gradient(135deg,#0ea5e9,#2563eb)', dis: false },
    loading: { text: 'Loading...', bg: 'linear-gradient(135deg,#f59e0b,#d97706)', dis: true },
    ok: { text: 'Converted', bg: 'linear-gradient(135deg,#22c55e,#16a34a)', dis: true },
    err: { text: 'Try Again', bg: 'linear-gradient(135deg,#ef4444,#dc2626)', dis: false }
  };

  const s = S[state] || S.idle;
  pageToolsBtn.textContent = s.text;
  pageToolsBtn.style.background = s.bg;
  pageToolsBtn.disabled = s.dis;

  if (state === 'ok' || state === 'err') {
    setTimeout(() => setToolsBtn('idle'), 3000);
  }
}

function hasAnyPdfContext() {
  return !!findPDFIframe() || isViewerPageUrl();
}

function updateButtonsAvailability() {
  const found = hasAnyPdfContext();

  if (downloadBtn) {
    downloadBtn.style.opacity = found ? '1' : '0.45';
    downloadBtn.title = found ? 'Download current PDF' : 'Open a ClassX PDF first';
  }

  if (pageToolsBtn) {
    pageToolsBtn.style.opacity = found ? '1' : '0.45';
    pageToolsBtn.title = found ? 'Open per-page toggle tool' : 'Open a ClassX PDF first';
  }

  if (creatorBadge) {
    creatorBadge.style.opacity = found ? '1' : '0.65';
    creatorBadge.title = 'Built by @vishuXdev';
  }
}

function getCurrentFilename() {
  const iframe = findPDFIframe();
  const sourceUrl = iframe?.src || window.location.href;
  return extractFilename(sourceUrl);
}

function handleDownload() {
  if (!hasAnyPdfContext()) {
    showToast('No PDF detected. Open lecture PDF first.', 'error');
    return;
  }

  const filename = getCurrentFilename();
  setDownloadBtn('loading');
  showToast(`Downloading <b>${filename}</b> ...`, 'loading', true);

  chrome.runtime.sendMessage({ type: 'FIND_AND_DOWNLOAD', filename }, (response) => {
    const t = document.getElementById('classx-toast');
    if (t) t.remove();

    if (chrome.runtime.lastError || !response?.success) {
      const err = chrome.runtime.lastError?.message || response?.error || 'Unknown error';
      console.error('[ClassX] Download error:', err);
      setDownloadBtn('err');
      showToast(`Download failed: ${err}`, 'error');
      return;
    }

    setDownloadBtn('ok');
    showToast('Download started.', 'success');
  });
}

function buildToolsPanel() {
  if (panelRoot) return panelRoot;

  const overlay = document.createElement('div');
  overlay.id = 'classx-tools-panel';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:2147483646; display:none;
    background:rgba(0,0,0,.45); backdrop-filter:blur(2px);
    align-items:center; justify-content:center;
    font-family:'Segoe UI',sans-serif;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width:min(760px,92vw); max-height:85vh; overflow:hidden;
    background:#fff; border-radius:14px; box-shadow:0 16px 40px rgba(0,0,0,.35);
    display:flex; flex-direction:column;
  `;

  card.innerHTML = `
    <div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div>
        <div style="font-size:15px;font-weight:700;color:#111827;">Per-Page Toggle Converter</div>
        <div id="classx-tools-file" style="font-size:12px;color:#6b7280;margin-top:2px;">-</div>
      </div>
      <button id="classx-tools-close" style="border:none;background:#ef4444;color:#fff;padding:7px 11px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">Close</button>
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid #f3f4f6;display:flex;gap:8px;flex-wrap:wrap;">
      <button id="classx-tools-auto" style="border:none;background:#2563eb;color:#fff;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">Auto</button>
      <button id="classx-tools-all" style="border:none;background:#0ea5e9;color:#fff;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">Select All</button>
      <button id="classx-tools-none" style="border:none;background:#64748b;color:#fff;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">Clear All</button>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#334155;font-weight:700;">
        A4 Layout
        <select id="classx-tools-layout" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;background:#fff;color:#0f172a;">
          <option value="1">1 page per A4</option>
          <option value="4">4 pages per A4</option>
          <option value="6">6 pages per A4</option>
        </select>
      </label>
      <div id="classx-tools-status" style="font-size:12px;color:#6b7280;align-self:center;">Loading...</div>
    </div>

    <div id="classx-tools-list" style="padding:10px 16px;overflow:auto;max-height:52vh;background:#f9fafb;"></div>

    <div style="padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;">
      <button id="classx-tools-convert" style="border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;padding:9px 12px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;">Convert And Download PDF</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  panelRoot = overlay;

  const closePanel = () => {
    overlay.style.display = 'none';
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePanel();
  });

  card.querySelector('#classx-tools-close').onclick = closePanel;

  card.querySelector('#classx-tools-auto').onclick = () => {
    const checks = card.querySelectorAll('input[data-page]');
    checks.forEach((c) => {
      const page = Number(c.getAttribute('data-page'));
      c.checked = !!panelSuggested.get(page);
    });
  };

  card.querySelector('#classx-tools-all').onclick = () => {
    const checks = card.querySelectorAll('input[data-page]');
    checks.forEach((c) => { c.checked = true; });
  };

  card.querySelector('#classx-tools-none').onclick = () => {
    const checks = card.querySelectorAll('input[data-page]');
    checks.forEach((c) => { c.checked = false; });
  };

  card.querySelector('#classx-tools-convert').onclick = () => {
    const convertBtn = card.querySelector('#classx-tools-convert');
    const statusEl = card.querySelector('#classx-tools-status');
    const layoutEl = card.querySelector('#classx-tools-layout');
    const pagesPerSheet = Number(layoutEl?.value || 1);
    const checks = [...card.querySelectorAll('input[data-page]')];
    const invertPages = checks
      .filter((c) => c.checked)
      .map((c) => Number(c.getAttribute('data-page')))
      .filter((n) => Number.isInteger(n));

    convertBtn.disabled = true;
    convertBtn.textContent = 'Converting...';
    setToolsBtn('loading');
      statusEl.textContent = `Converting ${invertPages.length} selected pages with ${pagesPerSheet}-up A4 (optimized size)...`;
    showToast('Converting selected pages to new PDF...', 'loading', true);

    let done = false;
    const timeoutId = setTimeout(() => {
      if (done) return;
      done = true;
      convertBtn.disabled = false;
      convertBtn.textContent = 'Convert And Download PDF';
      statusEl.textContent = 'Timed out. Please try with fewer pages or 4-up/6-up.';
      setToolsBtn('err');
      const t = document.getElementById('classx-toast');
      if (t) t.remove();
      showToast('Conversion timeout. Please retry.', 'error');
    }, 240000);

    chrome.runtime.sendMessage({
      type: 'CONVERT_PDF_WITH_TOGGLES',
      filename: panelFilename,
      invertPages,
      pagesPerSheet
    }, (response) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);

      const t = document.getElementById('classx-toast');
      if (t) t.remove();

      convertBtn.disabled = false;
      convertBtn.textContent = 'Convert And Download PDF';

      if (chrome.runtime.lastError || !response?.success) {
        const err = chrome.runtime.lastError?.message || response?.error || 'Unknown error';
        console.error('[ClassX] Convert error:', err);
        statusEl.textContent = `Failed: ${err}`;
        setToolsBtn('err');
        showToast(`Conversion failed: ${err}`, 'error');
        return;
      }

      const finalCount = Number(response.outputPageCount || response.pageCount || 0);
      statusEl.textContent = `Done. Inverted ${response.invertedCount || 0} pages. Output pages: ${finalCount}.`;
      setToolsBtn('ok');
      showToast('Converted PDF download started.', 'success');
      setTimeout(() => {
        if (panelRoot) panelRoot.style.display = 'none';
      }, 500);
    });
  };

  return panelRoot;
}

function renderPageRows(data) {
  const root = buildToolsPanel();
  const listEl = root.querySelector('#classx-tools-list');
  const statusEl = root.querySelector('#classx-tools-status');
  const fileEl = root.querySelector('#classx-tools-file');

  panelFilename = sanitizeFilename(data.filename || panelFilename);
  fileEl.textContent = panelFilename;
  panelSuggested = new Map();
  listEl.innerHTML = '';

  if (!Array.isArray(data.pages) || data.pages.length === 0) {
    statusEl.textContent = 'No pages found.';
    listEl.innerHTML = '<div style="font-size:13px;color:#ef4444;">Could not read pages from viewer.</div>';
    return;
  }

  statusEl.textContent = `${data.pageCount} pages loaded. Toggle pages you want to invert.`;

  for (const page of data.pages) {
    panelSuggested.set(page.page, !!page.suggestInvert);

    const row = document.createElement('label');
    row.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      gap:10px; padding:10px 12px; margin-bottom:8px;
      background:#fff; border:1px solid #e5e7eb; border-radius:10px;
      cursor:pointer;
    `;

    const left = document.createElement('div');
    left.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:#111827;">Page ${page.page}</div>
      <div style="font-size:11px;color:#6b7280;">avg luma ${page.avgLuma} | dark ratio ${page.darkRatio}</div>
    `;

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const tag = document.createElement('span');
    tag.textContent = page.suggestInvert ? 'Auto: invert' : 'Auto: default';
    tag.style.cssText = `
      font-size:10px; font-weight:700; padding:3px 7px; border-radius:999px;
      color:${page.suggestInvert ? '#1d4ed8' : '#475569'};
      background:${page.suggestInvert ? '#dbeafe' : '#e2e8f0'};
    `;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !!page.suggestInvert;
    check.setAttribute('data-page', String(page.page));
    check.style.cssText = 'width:18px;height:18px;cursor:pointer;';

    right.appendChild(tag);
    right.appendChild(check);

    row.appendChild(left);
    row.appendChild(right);
    listEl.appendChild(row);
  }
}

function openPageTools() {
  if (!hasAnyPdfContext()) {
    showToast('No PDF detected. Open lecture PDF first.', 'error');
    return;
  }

  const root = buildToolsPanel();
  const listEl = root.querySelector('#classx-tools-list');
  const statusEl = root.querySelector('#classx-tools-status');
  const fileEl = root.querySelector('#classx-tools-file');

  panelFilename = getCurrentFilename();
  fileEl.textContent = panelFilename;

  root.style.display = 'flex';
  statusEl.textContent = 'Reading pages from viewer...';
  listEl.innerHTML = '<div style="font-size:13px;color:#6b7280;">Please wait...</div>';

  setToolsBtn('loading');
  chrome.runtime.sendMessage({
    type: 'GET_PAGE_TOGGLE_DATA',
    filename: panelFilename
  }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      const err = chrome.runtime.lastError?.message || response?.error || 'Unknown error';
      console.error('[ClassX] Tools load error:', err);
      statusEl.textContent = `Failed: ${err}`;
      listEl.innerHTML = `<div style="font-size:13px;color:#ef4444;">${err}</div>`;
      setToolsBtn('err');
      return;
    }

    renderPageRows(response);
    setToolsBtn('idle');
  });
}

function styleActionButton(btn) {
  btn.onmouseenter = () => {
    btn.style.transform = 'scale(1.04)';
    btn.style.boxShadow = '0 7px 26px rgba(67,56,202,.45)';
  };
  btn.onmouseleave = () => {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = '0 4px 20px rgba(67,56,202,.35)';
  };
}

function createCreatorBadge() {
  const box = document.createElement('div');
  box.id = 'classx-creator-badge';
  box.style.cssText = `
    position:fixed; bottom:116px; right:20px; z-index:2147483644;
    display:flex; align-items:center; gap:8px;
    background:rgba(15,23,42,.92);
    border:1px solid rgba(148,163,184,.25);
    border-radius:11px;
    padding:7px 9px;
    backdrop-filter:blur(2px);
    box-shadow:0 6px 18px rgba(15,23,42,.35);
    transition:opacity .2s;
  `;

  const makeLink = (href, html, title) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = title;
    a.innerHTML = html;
    a.style.cssText = `
      display:inline-flex; align-items:center; gap:6px;
      color:#dbeafe; text-decoration:none;
      font-size:11px; font-weight:700;
      padding:4px 7px; border-radius:8px;
      background:rgba(30,41,59,.7);
      border:1px solid rgba(96,165,250,.25);
      line-height:1;
      transition:transform .12s, background .12s;
    `;
    a.onmouseenter = () => {
      a.style.transform = 'translateY(-1px)';
      a.style.background = 'rgba(30,58,138,.55)';
    };
    a.onmouseleave = () => {
      a.style.transform = 'translateY(0)';
      a.style.background = 'rgba(30,41,59,.7)';
    };
    return a;
  };

  const portfolio = makeLink(
    'https://vishalgupta.dev',
    '<span>vishalgupta.dev</span>',
    'Portfolio: vishalgupta.dev'
  );

  const insta = makeLink(
    'https://instagram.com/vishugupta.dev',
    `
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="classxInstaGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#feda75"></stop>
            <stop offset="28%" stop-color="#fa7e1e"></stop>
            <stop offset="52%" stop-color="#d62976"></stop>
            <stop offset="76%" stop-color="#962fbf"></stop>
            <stop offset="100%" stop-color="#4f5bd5"></stop>
          </linearGradient>
        </defs>
        <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="url(#classxInstaGrad)"></rect>
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" stroke-width="2"></circle>
        <circle cx="17.3" cy="6.9" r="1.2" fill="#fff"></circle>
      </svg>
      <span>instagram.com/@vishugupta.dev</span>
    `,
    'Instagram: instagram.com/@vishugupta.dev'
  );

  box.appendChild(portfolio);
  box.appendChild(insta);
  return box;
}

function injectButtons() {
  if (document.getElementById('classx-dl-btn')) return;

  downloadBtn = document.createElement('button');
  downloadBtn.id = 'classx-dl-btn';
  downloadBtn.textContent = 'Download PDF';
  downloadBtn.style.cssText = `
    position:fixed; bottom:20px; right:20px; z-index:2147483644;
    padding:11px 16px;
    background:linear-gradient(135deg,#6c63ff,#4f46e5);
    color:#fff; border:none; border-radius:10px; cursor:pointer;
    font-size:13px; font-weight:700;
    box-shadow:0 4px 20px rgba(67,56,202,.35);
    font-family:'Segoe UI',sans-serif; letter-spacing:.2px;
    transition:transform .15s, box-shadow .15s, opacity .2s;
    opacity:.45;
  `;
  downloadBtn.onclick = handleDownload;
  styleActionButton(downloadBtn);

  pageToolsBtn = document.createElement('button');
  pageToolsBtn.id = 'classx-page-tools-btn';
  pageToolsBtn.textContent = 'Page Toggles';
  pageToolsBtn.style.cssText = `
    position:fixed; bottom:68px; right:20px; z-index:2147483644;
    padding:11px 16px;
    background:linear-gradient(135deg,#0ea5e9,#2563eb);
    color:#fff; border:none; border-radius:10px; cursor:pointer;
    font-size:13px; font-weight:700;
    box-shadow:0 4px 20px rgba(30,64,175,.3);
    font-family:'Segoe UI',sans-serif; letter-spacing:.2px;
    transition:transform .15s, box-shadow .15s, opacity .2s;
    opacity:.45;
  `;
  pageToolsBtn.onclick = openPageTools;
  styleActionButton(pageToolsBtn);

  creatorBadge = createCreatorBadge();

  document.body.appendChild(downloadBtn);
  document.body.appendChild(pageToolsBtn);
  document.body.appendChild(creatorBadge);

  updateButtonsAvailability();
  setInterval(updateButtonsAvailability, 900);
}

injectButtons();

const observer = new MutationObserver(() => {
  injectButtons();
  updateButtonsAvailability();
});

observer.observe(document.body, { childList: true, subtree: true });
console.log('[ClassX Downloader] Ready on', window.location.href);
