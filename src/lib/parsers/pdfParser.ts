import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {ImportMetadataResult, ParsedTocItem} from '../../types/library';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfDocumentHandle = pdfjsLib.PDFDocumentProxy;

export async function loadPdfDocument(buffer: ArrayBuffer): Promise<PdfDocumentHandle> {
  // Clone bytes because pdf.js transfers the buffer to its web worker
  const copy = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({
    data: copy,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    useSystemFonts: true,
  });
  return loadingTask.promise;
}

export async function extractPdfMetadata(
  buffer: ArrayBuffer,
  fallbackTitle: string
): Promise<ImportMetadataResult> {
  const pdf = await loadPdfDocument(buffer);
  try {
    const meta = await pdf.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;

    const rawTitle = typeof info.Title === 'string' ? info.Title.trim() : '';
    const rawAuthor = typeof info.Author === 'string' ? info.Author.trim() : '';
    const rawSubject = typeof info.Subject === 'string' ? info.Subject.trim() : '';
    const rawProducer = typeof info.Creator === 'string' ? info.Creator.trim() : '';
    const rawDate = typeof info.CreationDate === 'string' ? info.CreationDate : '';
    const yearMatch = rawDate.match(/(19[0-9]{2}|20[0-9]{2})/);

    let coverDataUrl: string | null = null;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({scale: 1});
      const targetWidth = 360;
      const scale = targetWidth / viewport.width;
      const scaledViewport = page.getViewport({scale});
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(scaledViewport.width);
      canvas.height = Math.round(scaledViewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({canvasContext: ctx, viewport: scaledViewport, canvas}).promise;
        coverDataUrl = canvas.toDataURL('image/jpeg', 0.82);
      }
      page.cleanup();
    } catch {
      coverDataUrl = null;
    }

    return {
      title: rawTitle || fallbackTitle,
      author: rawAuthor || 'Unknown Author',
      publisher: rawProducer,
      year: yearMatch ? yearMatch[1] : '',
      language: 'en',
      description: rawSubject,
      coverDataUrl,
      totalUnits: Math.max(1, pdf.numPages),
      format: 'pdf',
    };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

export async function destroyPdfDocument(pdf: PdfDocumentHandle): Promise<void> {
  const handle = pdf as unknown as {
    destroy?: () => Promise<void>;
    cleanup?: () => Promise<void>;
  };
  if (typeof handle.destroy === 'function') {
    await handle.destroy();
  } else if (typeof handle.cleanup === 'function') {
    await handle.cleanup();
  }
}

interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineNode[];
}

export async function extractPdfToc(pdf: PdfDocumentHandle): Promise<ParsedTocItem[]> {
  const outline = (await pdf.getOutline().catch(() => null)) as PdfOutlineNode[] | null;
  const toc: ParsedTocItem[] = [];

  if (outline && outline.length > 0) {
    const walk = async (nodes: PdfOutlineNode[], depth: number) => {
      for (const node of nodes) {
        let pageNumber = 1;
        try {
          let dest = node.dest;
          if (typeof dest === 'string') {
            dest = await pdf.getDestination(dest);
          }
          if (Array.isArray(dest) && dest[0]) {
            const pageIndex = await pdf.getPageIndex(dest[0] as never);
            pageNumber = pageIndex + 1;
          }
        } catch {
          pageNumber = 1;
        }
        toc.push({
          id: `pdf-toc-${toc.length}`,
          title: node.title || `Page ${pageNumber}`,
          unitIndex: pageNumber,
          depth,
        });
        if (node.items && node.items.length > 0) {
          await walk(node.items, depth + 1);
        }
      }
    };
    await walk(outline, 0);
  }

  return toc;
}
