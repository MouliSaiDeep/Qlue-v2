const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(workerData.bytes),
    stopAtErrors: true, isEvalSupported: false, enableXfa: false,
    disableFontFace: true, maxImageSize: 0, useSystemFonts: false });
  try {
    const doc = await loading.promise;
    if (!Number.isSafeInteger(doc.numPages) || doc.numPages < 1) throw new Error('No readable pages');
    if (doc.numPages > workerData.maxPages) {
      parentPort.postMessage({ error: 'PAGE_LIMIT', pages: doc.numPages }); return;
    }
    // Establish a real page tree, including pages inside compressed ObjStm.
    for (let page = 1; page <= doc.numPages; page++) {
      const parsed = await doc.getPage(page);
      if (!parsed.ref || parsed.view.length !== 4) throw new Error('Invalid page tree');
      parsed.cleanup();
    }
    parentPort.postMessage({ pages: doc.numPages });
  } finally { await loading.destroy(); }
})().catch(error => parentPort.postMessage({ error: error.name || 'INVALID_PDF' }));
