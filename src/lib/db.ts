import type {
  BookFileBlob,
  BookRecord,
  BookmarkRecord,
  CategoryRecord,
  FolderRecord,
  HighlightRecord,
} from '../types/library';

const DB_NAME = 'folio_offline_library_v1';
const DB_VERSION = 1;

const STORES = {
  books: 'books',
  files: 'files',
  folders: 'folders',
  categories: 'categories',
  bookmarks: 'bookmarks',
  highlights: 'highlights',
} as const;

export const DEFAULT_CATEGORIES: Omit<CategoryRecord, 'createdAt'>[] = [
  {id: 'cat-fiction', name: 'Fiction'},
  {id: 'cat-nonfiction', name: 'Non-Fiction'},
  {id: 'cat-technology', name: 'Technology'},
  {id: 'cat-essays', name: 'Essays & Criticism'},
  {id: 'cat-reference', name: 'Reference'},
];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.books)) {
        const bookStore = db.createObjectStore(STORES.books, {keyPath: 'id'});
        bookStore.createIndex('addedAt', 'addedAt');
        bookStore.createIndex('folderId', 'folderId');
        bookStore.createIndex('categoryId', 'categoryId');
      }
      if (!db.objectStoreNames.contains(STORES.files)) {
        db.createObjectStore(STORES.files, {keyPath: 'bookId'});
      }
      if (!db.objectStoreNames.contains(STORES.folders)) {
        db.createObjectStore(STORES.folders, {keyPath: 'id'});
      }
      if (!db.objectStoreNames.contains(STORES.categories)) {
        const catStore = db.createObjectStore(STORES.categories, {keyPath: 'id'});
        const now = Date.now();
        for (const cat of DEFAULT_CATEGORIES) {
          catStore.put({...cat, createdAt: now});
        }
      }
      if (!db.objectStoreNames.contains(STORES.bookmarks)) {
        const bmStore = db.createObjectStore(STORES.bookmarks, {keyPath: 'id'});
        bmStore.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains(STORES.highlights)) {
        const hlStore = db.createObjectStore(STORES.highlights, {keyPath: 'id'});
        hlStore.createIndex('bookId', 'bookId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export const libraryDb = {
  async getAllBooks(): Promise<BookRecord[]> {
    const db = await openDB();
    const tx = db.transaction(STORES.books, 'readonly');
    const items = await reqToPromise<BookRecord[]>(tx.objectStore(STORES.books).getAll());
    return items.sort((a, b) => b.addedAt - a.addedAt);
  },

  async saveBookWithFile(book: BookRecord, file: BookFileBlob): Promise<void> {
    const db = await openDB();
    const tx = db.transaction([STORES.books, STORES.files], 'readwrite');
    tx.objectStore(STORES.books).put(book);
    tx.objectStore(STORES.files).put(file);
    await txDone(tx);
  },

  async updateBook(book: BookRecord): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORES.books, 'readwrite');
    tx.objectStore(STORES.books).put(book);
    await txDone(tx);
  },

  async updateBooksBatch(books: BookRecord[]): Promise<void> {
    if (books.length === 0) return;
    const db = await openDB();
    const tx = db.transaction(STORES.books, 'readwrite');
    const store = tx.objectStore(STORES.books);
    for (const book of books) {
      store.put(book);
    }
    await txDone(tx);
  },

  async getBookFile(bookId: string): Promise<BookFileBlob | null> {
    const db = await openDB();
    const tx = db.transaction(STORES.files, 'readonly');
    const result = await reqToPromise<BookFileBlob | undefined>(
      tx.objectStore(STORES.files).get(bookId)
    );
    return result ?? null;
  },

  async deleteBooks(bookIds: string[]): Promise<void> {
    if (bookIds.length === 0) return;
    const idSet = new Set(bookIds);
    const db = await openDB();
    const tx = db.transaction(
      [STORES.books, STORES.files, STORES.bookmarks, STORES.highlights],
      'readwrite'
    );
    const bookStore = tx.objectStore(STORES.books);
    const fileStore = tx.objectStore(STORES.files);
    const bmStore = tx.objectStore(STORES.bookmarks);
    const hlStore = tx.objectStore(STORES.highlights);

    for (const id of bookIds) {
      bookStore.delete(id);
      fileStore.delete(id);
    }

    // Clean up orphaned bookmarks and highlights for deleted books
    const allBookmarks = await reqToPromise<BookmarkRecord[]>(bmStore.getAll());
    for (const bm of allBookmarks) {
      if (idSet.has(bm.bookId)) bmStore.delete(bm.id);
    }

    const allHighlights = await reqToPromise<HighlightRecord[]>(hlStore.getAll());
    for (const hl of allHighlights) {
      if (idSet.has(hl.bookId)) hlStore.delete(hl.id);
    }

    await txDone(tx);
  },

  // Folders
  async getAllFolders(): Promise<FolderRecord[]> {
    const db = await openDB();
    const tx = db.transaction(STORES.folders, 'readonly');
    const items = await reqToPromise<FolderRecord[]>(tx.objectStore(STORES.folders).getAll());
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveFolder(folder: FolderRecord): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORES.folders, 'readwrite');
    tx.objectStore(STORES.folders).put(folder);
    await txDone(tx);
  },

  async deleteFolder(folderId: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction([STORES.folders, STORES.books], 'readwrite');
    const folderStore = tx.objectStore(STORES.folders);
    const allFolders = await reqToPromise<FolderRecord[]>(folderStore.getAll());
    const target = allFolders.find((f) => f.id === folderId);
    const nextParentId = target?.parentId ?? null;

    folderStore.delete(folderId);
    for (const child of allFolders) {
      if (child.parentId === folderId) {
        folderStore.put({...child, parentId: nextParentId});
      }
    }

    const bookStore = tx.objectStore(STORES.books);
    const books = await reqToPromise<BookRecord[]>(bookStore.getAll());
    for (const book of books) {
      if (book.folderId === folderId) {
        bookStore.put({...book, folderId: null});
      }
    }
    await txDone(tx);
  },

  // Categories
  async getAllCategories(): Promise<CategoryRecord[]> {
    const db = await openDB();
    const tx = db.transaction(STORES.categories, 'readonly');
    const items = await reqToPromise<CategoryRecord[]>(tx.objectStore(STORES.categories).getAll());
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveCategory(category: CategoryRecord): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORES.categories, 'readwrite');
    tx.objectStore(STORES.categories).put(category);
    await txDone(tx);
  },

  async deleteCategory(categoryId: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction([STORES.categories, STORES.books], 'readwrite');
    tx.objectStore(STORES.categories).delete(categoryId);
    const bookStore = tx.objectStore(STORES.books);
    const books = await reqToPromise<BookRecord[]>(bookStore.getAll());
    for (const book of books) {
      if (book.categoryId === categoryId) {
        bookStore.put({...book, categoryId: null});
      }
    }
    await txDone(tx);
  },

  // Bookmarks
  async getAllBookmarks(): Promise<BookmarkRecord[]> {
    const db = await openDB();
    const tx = db.transaction(STORES.bookmarks, 'readonly');
    const items = await reqToPromise<BookmarkRecord[]>(tx.objectStore(STORES.bookmarks).getAll());
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getBookmarksForBook(bookId: string): Promise<BookmarkRecord[]> {
    const db = await openDB();
    const tx = db.transaction(STORES.bookmarks, 'readonly');
    const idx = tx.objectStore(STORES.bookmarks).index('bookId');
    const items = await reqToPromise<BookmarkRecord[]>(idx.getAll(bookId));
    return items.sort((a, b) => a.unitIndex - b.unitIndex || a.createdAt - b.createdAt);
  },

  async saveBookmark(bookmark: BookmarkRecord): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORES.bookmarks, 'readwrite');
    tx.objectStore(STORES.bookmarks).put(bookmark);
    await txDone(tx);
  },

  async deleteBookmark(bookmarkId: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORES.bookmarks, 'readwrite');
    tx.objectStore(STORES.bookmarks).delete(bookmarkId);
    await txDone(tx);
  },

  // Highlights
  async getAllHighlights(): Promise<HighlightRecord[]> {
    const db = await openDB();
    const tx = db.transaction(STORES.highlights, 'readonly');
    const items = await reqToPromise<HighlightRecord[]>(tx.objectStore(STORES.highlights).getAll());
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getHighlightsForBook(bookId: string): Promise<HighlightRecord[]> {
    const db = await openDB();
    const tx = db.transaction(STORES.highlights, 'readonly');
    const idx = tx.objectStore(STORES.highlights).index('bookId');
    const items = await reqToPromise<HighlightRecord[]>(idx.getAll(bookId));
    return items.sort((a, b) => a.unitIndex - b.unitIndex || a.createdAt - b.createdAt);
  },

  async saveHighlight(highlight: HighlightRecord): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORES.highlights, 'readwrite');
    tx.objectStore(STORES.highlights).put(highlight);
    await txDone(tx);
  },

  async deleteHighlight(highlightId: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORES.highlights, 'readwrite');
    tx.objectStore(STORES.highlights).delete(highlightId);
    await txDone(tx);
  },
};
