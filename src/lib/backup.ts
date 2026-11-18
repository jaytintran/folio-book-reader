import JSZip from 'jszip';
import type {
  BookFileBlob,
  BookFormat,
  BookRecord,
  BookmarkRecord,
  CategoryRecord,
  FolderRecord,
  HighlightRecord,
  LibraryPreferences,
  ReaderPreferences,
  ViewFolderRecord,
} from '../types/library';
import {libraryDb, type BackupRestoreSnapshot} from './db';
import {normalizeBookFolders} from './formatters';

export interface FolioBackupManifest {
  version: number;
  app: 'Folio';
  exportedAt: number;
  books: BookRecord[];
  folders: FolderRecord[];
  viewFolders: ViewFolderRecord[];
  categories: CategoryRecord[];
  bookmarks: BookmarkRecord[];
  highlights: HighlightRecord[];
  fileEntries: Array<{bookId: string; path: string; mimeType: string}>;
  readerPreferences?: Partial<ReaderPreferences>;
  libraryPreferences?: Partial<LibraryPreferences>;
}

export interface ParsedBackupArchive {
  fileName: string;
  fileSize: number;
  exportedAt: number;
  snapshot: BackupRestoreSnapshot;
  readerPreferences?: Partial<ReaderPreferences>;
  libraryPreferences?: Partial<LibraryPreferences>;
}

const MIME_BY_FORMAT: Record<BookFormat, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
};

function getSafeExtension(book: BookRecord): string {
  const fromName = book.fileName.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return book.format;
}

export async function exportLibraryBackupZip(
  readerPreferences: ReaderPreferences,
  libraryPreferences: LibraryPreferences
): Promise<{
  blob: Blob;
  fileName: string;
  bookCount: number;
  fileCount: number;
}> {
  const [books, files, folders, viewFolders, categories, bookmarks, highlights] = await Promise.all(
    [
      libraryDb.getAllBooks(),
      libraryDb.getAllBookFiles(),
      libraryDb.getAllFolders(),
      libraryDb.getAllViewFolders(),
      libraryDb.getAllCategories(),
      libraryDb.getAllBookmarks(),
      libraryDb.getAllHighlights(),
    ]
  );

  const zip = new JSZip();
  const bookById = new Map(books.map((b) => [b.id, b]));
  const fileEntries: FolioBackupManifest['fileEntries'] = [];

  for (const fileBlob of files) {
    const book = bookById.get(fileBlob.bookId);
    if (!book) continue;
    const ext = getSafeExtension(book);
    const path = `files/${book.id}.${ext}`;
    fileEntries.push({
      bookId: book.id,
      path,
      mimeType: fileBlob.mimeType || MIME_BY_FORMAT[book.format],
    });
    // Store book binaries uncompressed (EPUB/PDF are already compressed) for fast export
    zip.file(path, fileBlob.data, {compression: 'STORE'});
  }

  const manifest: FolioBackupManifest = {
    version: 1,
    app: 'Folio',
    exportedAt: Date.now(),
    books,
    folders,
    viewFolders,
    categories,
    bookmarks,
    highlights,
    fileEntries,
    readerPreferences,
    libraryPreferences,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2), {
    compression: 'DEFLATE',
    compressionOptions: {level: 6},
  });

  const blob = await zip.generateAsync({type: 'blob'});
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `folio-backup-${dateStamp}.zip`;

  return {
    blob,
    fileName,
    bookCount: books.length,
    fileCount: fileEntries.length,
  };
}

export async function parseLibraryBackupZip(file: File): Promise<ParsedBackupArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('Could not read that file. Please select a valid Folio .zip backup archive.');
  }

  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    throw new Error('This ZIP archive is missing manifest.json and is not a Folio backup.');
  }

  let parsed: Partial<FolioBackupManifest>;
  try {
    const text = await manifestEntry.async('string');
    parsed = JSON.parse(text) as Partial<FolioBackupManifest>;
  } catch {
    throw new Error('Backup manifest.json is malformed or unreadable.');
  }

  if (parsed.app !== 'Folio' || !Array.isArray(parsed.books)) {
    throw new Error('This archive does not match the Folio backup format.');
  }

  const books = (parsed.books as BookRecord[]).map((b) => normalizeBookFolders(b));
  const folders = Array.isArray(parsed.folders) ? (parsed.folders as FolderRecord[]) : [];
  const viewFolders = Array.isArray(parsed.viewFolders)
    ? (parsed.viewFolders as ViewFolderRecord[])
    : [];
  const categories = Array.isArray(parsed.categories)
    ? (parsed.categories as CategoryRecord[])
    : [];
  const bookmarks = Array.isArray(parsed.bookmarks)
    ? (parsed.bookmarks as BookmarkRecord[])
    : [];
  const highlights = Array.isArray(parsed.highlights)
    ? (parsed.highlights as HighlightRecord[])
    : [];

  const files: BookFileBlob[] = [];
  const entryMap = new Map((parsed.fileEntries ?? []).map((e) => [e.bookId, e]));

  for (const book of books) {
    const declared = entryMap.get(book.id);
    const candidatePaths = declared
      ? [declared.path]
      : [`files/${book.id}.${book.format}`, `files/${book.id}.epub`, `files/${book.id}.pdf`, `files/${book.id}.mobi`];

    let zipFile: JSZip.JSZipObject | null = null;
    for (const p of candidatePaths) {
      const found = zip.file(p);
      if (found) {
        zipFile = found;
        break;
      }
    }

    if (zipFile) {
      const data = await zipFile.async('arraybuffer');
      files.push({
        bookId: book.id,
        data,
        mimeType: declared?.mimeType || MIME_BY_FORMAT[book.format],
      });
    }
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : file.lastModified,
    snapshot: {
      books,
      files,
      folders,
      viewFolders,
      categories,
      bookmarks,
      highlights,
    },
    readerPreferences: parsed.readerPreferences,
    libraryPreferences: parsed.libraryPreferences,
  };
}
