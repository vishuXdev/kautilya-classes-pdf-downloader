// ===========================
// ClassX Viewer Tools
// Runs in MAIN world inside pdfweb viewer frame
// ===========================

(() => {
  const KEY = '__classxViewerToolsV1';
  if (window[KEY]) return;

  const textEncoder = new TextEncoder();
  const A4_WIDTH_PT = 595.28;
  const A4_HEIGHT_PT = 841.89;

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (e) {
      return value;
    }
  }

  function sanitizeFilename(name = '', fallback = 'classx_notes.pdf') {
    const cleaned = String(name).replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
    if (!cleaned) return fallback;
    return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
  }

  function extractFilenameFromLocation(fallback = 'classx_notes.pdf') {
    try {
      const u = new URL(window.location.href);
      const title = u.searchParams.get('title');
      if (title) {
        return sanitizeFilename(safeDecode(title).replace(/\+/g, ' '), fallback);
      }

      const fileParam = u.searchParams.get('file');
      if (fileParam) {
        const decoded = safeDecode(fileParam);
        const fileUrl = new URL(decoded);
        const rawName = fileUrl.pathname.split('/').pop() || '';
        if (rawName) return sanitizeFilename(safeDecode(rawName), fallback);
      }
    } catch (e) {}

    return sanitizeFilename(fallback, 'classx_notes.pdf');
  }

  function ensurePdfDocument() {
    const app = window.PDFViewerApplication;
    if (!app || !app.pdfDocument) {
      throw new Error('PDF viewer is not ready yet. Please wait for file load.');
    }
    return app.pdfDocument;
  }

  function sleepTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function get2dContext(canvas) {
    return canvas.getContext('2d', { willReadFrequently: true, alpha: false })
      || canvas.getContext('2d');
  }

  function analyzeTone(imageData) {
    const data = imageData.data;
    let sampleCount = 0;
    let sumLuma = 0;
    let darkCount = 0;
    let brightCount = 0;

    // Sample every 4th pixel for speed.
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a === 0) continue;

      const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
      sumLuma += luma;
      sampleCount += 1;

      if (luma < 70) darkCount += 1;
      if (luma > 185) brightCount += 1;
    }

    if (!sampleCount) {
      return {
        avgLuma: 255,
        darkRatio: 0,
        brightRatio: 1,
        suggestInvert: false
      };
    }

    const avgLuma = sumLuma / sampleCount;
    const darkRatio = darkCount / sampleCount;
    const brightRatio = brightCount / sampleCount;

    // Heuristic for blackboard-style notes (dark bg + bright text).
    const suggestInvert = avgLuma < 125 && darkRatio > 0.52;

    return {
      avgLuma: Math.round(avgLuma),
      darkRatio: Number(darkRatio.toFixed(3)),
      brightRatio: Number(brightRatio.toFixed(3)),
      suggestInvert
    };
  }

  async function renderPageToCanvas(page, scale) {
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = get2dContext(canvas);
    if (!ctx) throw new Error('Unable to create canvas context');

    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, ctx, viewport };
  }

  function invertCanvasPixels(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = (dataUrl.split(',')[1] || '').trim();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function canvasToJpegBytes(canvas, quality) {
    if (typeof canvas.toBlob !== 'function') {
      return dataUrlToBytes(canvas.toDataURL('image/jpeg', quality));
    }

    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });

    if (!blob) {
      return dataUrlToBytes(canvas.toDataURL('image/jpeg', quality));
    }

    const arr = await blob.arrayBuffer();
    return new Uint8Array(arr);
  }

  function formatNum(value) {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(2));
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;

    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }

    return out;
  }

  function createPdfWriter() {
    const chunks = [];
    let offset = 0;

    const pushBytes = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };

    const pushText = (text) => {
      pushBytes(textEncoder.encode(text));
    };

    return {
      chunks,
      getOffset: () => offset,
      pushBytes,
      pushText
    };
  }

  function normalizePagesPerSheet(value) {
    const v = Number(value);
    if (v === 3 || v === 4) return v;
    return 1;
  }

  function layoutGrid(pagesPerSheet) {
    if (pagesPerSheet === 3) return { cols: 1, rows: 3 };
    if (pagesPerSheet === 4) return { cols: 1, rows: 4 };
    return { cols: 1, rows: 1 };
  }

  function slotRectBySeriesOrder(slotIndex, cols, rows, x, y, width, height) {
    const cellW = width / cols;
    const cellH = height / rows;

    // Series order as requested in sample:
    // 4-up => 1,2 in left column then 3,4 in right column.
    const col = Math.floor(slotIndex / rows);
    const rowTop = slotIndex % rows;

    return {
      x: x + (col * cellW),
      y: y + (rowTop * cellH),
      width: cellW,
      height: cellH
    };
  }

  function drawFittedWithPadding(ctx, srcCanvas, box, cellPaddingPx) {
    const x = box.x + cellPaddingPx;
    const y = box.y + cellPaddingPx;
    const w = Math.max(1, box.width - (2 * cellPaddingPx));
    const h = Math.max(1, box.height - (2 * cellPaddingPx));

    const fitScale = Math.min(w / srcCanvas.width, h / srcCanvas.height);
    const drawW = Math.max(1, srcCanvas.width * fitScale);
    const drawH = Math.max(1, srcCanvas.height * fitScale);
    const dx = x + ((w - drawW) / 2);
    const dy = y + ((h - drawH) / 2);

    ctx.drawImage(srcCanvas, dx, dy, drawW, drawH);
  }

  async function getPageProfiles(payload = {}) {
    const pdfDoc = ensurePdfDocument();
    const pageCount = pdfDoc.numPages || 0;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdfDoc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const maxSide = Math.max(baseViewport.width, baseViewport.height);

      const sampleScale = Math.max(0.12, Math.min(0.45, 280 / Math.max(1, maxSide)));
      const { canvas, ctx } = await renderPageToCanvas(page, sampleScale);

      const tone = analyzeTone(ctx.getImageData(0, 0, canvas.width, canvas.height));

      pages.push({
        page: pageNumber,
        suggestInvert: tone.suggestInvert,
        avgLuma: tone.avgLuma,
        darkRatio: tone.darkRatio,
        brightRatio: tone.brightRatio
      });

      page.cleanup();
      if (pageNumber % 4 === 0) await sleepTick();
    }

    const filename = extractFilenameFromLocation(payload?.filename || 'classx_notes.pdf');

    return {
      success: true,
      pageCount,
      filename,
      pages
    };
  }

  async function convertPdfWithToggles(payload = {}) {
    const pdfDoc = ensurePdfDocument();
    const pageCount = pdfDoc.numPages || 0;
    if (!pageCount) {
      return { success: false, error: 'No pages found in current PDF' };
    }

    const invertSet = new Set(
      (Array.isArray(payload?.invertPages) ? payload.invertPages : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= pageCount)
    );
    const pagesPerSheet = normalizePagesPerSheet(payload?.pagesPerSheet);
    const { cols, rows } = layoutGrid(pagesPerSheet);
    const outputPageCount = Math.ceil(pageCount / pagesPerSheet);

    const finalFilename = sanitizeFilename(
      payload?.filename || extractFilenameFromLocation('classx_notes.pdf'),
      'classx_notes.pdf'
    );

    const writer = createPdfWriter();
    const offsets = [];

    const objectCount = 2 + (outputPageCount * 3);

    const markObjectOffset = (objNumber) => {
      offsets[objNumber] = writer.getOffset();
    };

    const writePlainObject = (objNumber, body) => {
      markObjectOffset(objNumber);
      writer.pushText(`${objNumber} 0 obj\n${body}\nendobj\n`);
    };

    const writeStreamObject = (objNumber, dictText, streamBytes) => {
      markObjectOffset(objNumber);
      writer.pushText(`${objNumber} 0 obj\n${dictText}\nstream\n`);
      writer.pushBytes(streamBytes);
      writer.pushText('\nendstream\nendobj\n');
    };

    writer.pushText('%PDF-1.4\n');
    writer.pushBytes(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    const kidsRefs = [];
    for (let outPage = 1; outPage <= outputPageCount; outPage += 1) {
      const pageObj = 3 + ((outPage - 1) * 3);
      kidsRefs.push(`${pageObj} 0 R`);
    }

    writePlainObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
    writePlainObject(2, `<< /Type /Pages /Count ${outputPageCount} /Kids [ ${kidsRefs.join(' ')} ] >>`);

    // 450 DPI style output for sharper text in packed A4 sheets.
    const sheetPixelScale = 450 / 72;
    const sheetWidthPx = Math.max(1, Math.round(A4_WIDTH_PT * sheetPixelScale));
    const sheetHeightPx = Math.max(1, Math.round(A4_HEIGHT_PT * sheetPixelScale));
    const outerMarginPt = 18; // little page-side padding on A4
    const cellPaddingPt = 7; // little padding around each mini-page
    const outerMarginPx = outerMarginPt * sheetPixelScale;
    const cellPaddingPx = cellPaddingPt * sheetPixelScale;
    const layoutX = outerMarginPx;
    const layoutY = outerMarginPx;
    const layoutWidth = Math.max(1, sheetWidthPx - (2 * outerMarginPx));
    const layoutHeight = Math.max(1, sheetHeightPx - (2 * outerMarginPx));

    for (let outPage = 1; outPage <= outputPageCount; outPage += 1) {
      const pageObj = 3 + ((outPage - 1) * 3);
      const contentObj = pageObj + 1;
      const imageObj = pageObj + 2;
      const imageName = `Im${outPage}`;

      const sheetCanvas = document.createElement('canvas');
      sheetCanvas.width = sheetWidthPx;
      sheetCanvas.height = sheetHeightPx;
      const sheetCtx = get2dContext(sheetCanvas);
      if (!sheetCtx) throw new Error('Unable to create A4 sheet canvas');
      sheetCtx.imageSmoothingEnabled = true;
      sheetCtx.imageSmoothingQuality = 'high';

      sheetCtx.fillStyle = '#ffffff';
      sheetCtx.fillRect(0, 0, sheetWidthPx, sheetHeightPx);

      const pageStart = ((outPage - 1) * pagesPerSheet) + 1;
      const pageEnd = Math.min(pageStart + pagesPerSheet - 1, pageCount);

      for (let pageNumber = pageStart; pageNumber <= pageEnd; pageNumber += 1) {
        const slotIndex = pageNumber - pageStart;
        const slot = slotRectBySeriesOrder(slotIndex, cols, rows, layoutX, layoutY, layoutWidth, layoutHeight);

        const page = await pdfDoc.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const maxSide = Math.max(baseViewport.width, baseViewport.height);
        // Oversample before down-fit to keep handwriting details sharper.
        const slotLongSide = Math.max(slot.width, slot.height);
        const targetLongSide = Math.max(slotLongSide * 2.0, 1600);
        const renderScale = Math.max(1.2, Math.min(5.0, targetLongSide / Math.max(1, maxSide)));

        const { canvas, ctx } = await renderPageToCanvas(page, renderScale);
        if (invertSet.has(pageNumber)) {
          invertCanvasPixels(ctx, canvas.width, canvas.height);
        }

        drawFittedWithPadding(sheetCtx, canvas, slot, cellPaddingPx);

        page.cleanup();
      }

      const jpegQuality = pagesPerSheet === 1 ? 0.98 : 0.96;
      const imageBytes = await canvasToJpegBytes(sheetCanvas, jpegQuality);
      const mediaW = formatNum(A4_WIDTH_PT);
      const mediaH = formatNum(A4_HEIGHT_PT);
      const contentText = `q\n${mediaW} 0 0 ${mediaH} 0 0 cm\n/${imageName} Do\nQ\n`;
      const contentBytes = textEncoder.encode(contentText);

      const pageDict = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mediaW} ${mediaH}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /${imageName} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`;
      writePlainObject(pageObj, pageDict);

      const contentDict = `<< /Length ${contentBytes.length} >>`;
      writeStreamObject(contentObj, contentDict, contentBytes);

      const imageDict = `<< /Type /XObject /Subtype /Image /Width ${sheetCanvas.width} /Height ${sheetCanvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>`;
      writeStreamObject(imageObj, imageDict, imageBytes);

      // Hint GC between sheets.
      sheetCanvas.width = 1;
      sheetCanvas.height = 1;

      if (outPage % 2 === 0) await sleepTick();
    }

    const xrefOffset = writer.getOffset();
    writer.pushText(`xref\n0 ${objectCount + 1}\n`);
    writer.pushText('0000000000 65535 f \n');

    for (let i = 1; i <= objectCount; i += 1) {
      const off = offsets[i] || 0;
      writer.pushText(`${String(off).padStart(10, '0')} 00000 n \n`);
    }

    writer.pushText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    const pdfBytes = concatBytes(writer.chunks);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = finalFilename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      a.remove();
    }, 30000);

    return {
      success: true,
      filename: finalFilename,
      pageCount,
      outputPageCount,
      pagesPerSheet,
      invertedCount: invertSet.size
    };
  }

  window[KEY] = {
    getPageProfiles,
    convertPdfWithToggles
  };
})();
