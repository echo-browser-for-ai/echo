import * as pdfjsLib from './pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';

const container = document.getElementById('pagesContainer');
const loading = document.getElementById('loading');
const errorEl = document.getElementById('error');
const pageInput = document.getElementById('pageInput');
const pageCount = document.getElementById('pageCount');
const prevBtn = document.getElementById('prevPage');
const nextBtn = document.getElementById('nextPage');
const filenameEl = document.getElementById('filename');
const textContentEl = document.getElementById('textContent');

let pdfDoc = null;
let currentPage = 1;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
  loading.style.display = 'none';
}

async function renderPage(pageNum) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.5 });

  const pageDiv = document.createElement('div');
  pageDiv.className = 'pdf-page';
  pageDiv.style.width = viewport.width + 'px';

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  pageDiv.appendChild(canvas);

  await page.render({ canvasContext: ctx, viewport }).promise;

  container.innerHTML = '';
  container.appendChild(pageDiv);
  pageInput.value = pageNum;
  currentPage = pageNum;
}

async function loadPDF(pdfData) {
  try {
    loading.style.display = 'block';
    errorEl.style.display = 'none';

    pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    pageCount.textContent = pdfDoc.numPages;
    pageInput.max = pdfDoc.numPages;

    document.body.classList.add('pdf-loaded');

    await renderPage(1);

    // Extract text from all pages for AI access
    let fullText = '';
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const tc = await page.getTextContent();
      fullText += tc.items.map(item => item.str).join(' ') + '\n';
    }
    textContentEl.textContent = fullText;

    loading.style.display = 'none';
  } catch (err) {
    showError('Failed to load PDF: ' + err.message);
  }
}

// ── Controls ──────────────────────────────────
prevBtn.addEventListener('click', () => {
  if (currentPage > 1) renderPage(currentPage - 1);
});
nextBtn.addEventListener('click', () => {
  if (pdfDoc && currentPage < pdfDoc.numPages) renderPage(currentPage + 1);
});
pageInput.addEventListener('change', () => {
  const n = parseInt(pageInput.value);
  if (pdfDoc && n >= 1 && n <= pdfDoc.numPages) renderPage(n);
});

// ── Keyboard navigation ───────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextBtn.click();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevBtn.click();
});

// ── Receive PDF data from Electron ────────────
// The Electron main process sets window.__ECHO_PDF_DATA__
// via executeJavaScript after the page loads.
// Data is a Uint8Array of the PDF file bytes.
if (window.__ECHO_PDF_DATA__) {
  loadPDF(window.__ECHO_PDF_DATA__);
} else {
  showError('No PDF data received.');
}
