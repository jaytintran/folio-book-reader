import type {BookFileBlob, BookFormat, BookRecord} from '../../types/library';
import {extractEpubMetadata} from './epubParser';
import {extractMobiMetadata} from './mobiParser';
import {extractPdfMetadata} from './pdfParser';

export function detectBookFormat(fileName: string): BookFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'mobi' || ext === 'prc' || ext === 'azw') return 'mobi';
  return null;
}

function cleanFileNameTitle(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashStringToPalette(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 6;
}

export async function importBookFile(
  file: File,
  defaults?: {folderId?: string | null; categoryId?: string | null}
): Promise<{book: BookRecord; blob: BookFileBlob}> {
  const format = detectBookFormat(file.name);
  if (!format) {
    throw new Error(`Unsupported file format: "${file.name}". Please import PDF, EPUB, or MOBI files.`);
  }

  const buffer = await file.arrayBuffer();
  const fallbackTitle = cleanFileNameTitle(file.name) || 'Untitled Book';

  let meta;
  if (format === 'epub') {
    meta = await extractEpubMetadata(buffer, fallbackTitle);
  } else if (format === 'pdf') {
    meta = await extractPdfMetadata(buffer, fallbackTitle);
  } else {
    meta = await extractMobiMetadata(buffer, fallbackTitle);
  }

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `book-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const now = Date.now();
  const book: BookRecord = {
    id,
    title: meta.title || fallbackTitle,
    subtitle: '',
    author: meta.author || 'Unknown Author',
    format,
    fileName: file.name,
    fileSize: file.size,
    addedAt: now,
    lastReadAt: null,
    categoryId: defaults?.categoryId ?? null,
    folderId: defaults?.folderId ?? null,
    folderIds: defaults?.folderId ? [defaults.folderId] : [],
    tags: [],
    series: '',
    publisher: meta.publisher || '',
    year: meta.year || '',
    language: meta.language || 'en',
    description: meta.description || '',
    isFavorite: false,
    coverDataUrl: meta.coverDataUrl,
    coverPaletteIndex: hashStringToPalette(meta.title || fallbackTitle),
    progress: 0,
    status: 'unread',
    totalUnits: meta.totalUnits,
    currentLocation: {
      unitIndex: format === 'pdf' ? 1 : 0,
      scrollRatio: 0,
    },
  };

  const mimeMap: Record<BookFormat, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    mobi: 'application/x-mobipocket-ebook',
  };

  const blob: BookFileBlob = {
    bookId: id,
    data: buffer,
    mimeType: file.type || mimeMap[format],
  };

  return {book, blob};
}
