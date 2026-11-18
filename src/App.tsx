/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BookUp,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  List,
  Menu,
  Moon,
  PanelRight,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BookGrid} from './components/library/BookGrid';
import {BookInspector} from './components/library/BookInspector';
import {BookTable} from './components/library/BookTable';
import {BulkActionBar} from './components/library/BulkActionBar';
import {BulkEditModal, type BulkEditPatch} from './components/library/BulkEditModal';
import {CommandPalette} from './components/library/CommandPalette';
import {ConfirmDeleteModal} from './components/library/ConfirmDeleteModal';
import {ContinueReadingShelf} from './components/library/ContinueReadingShelf';
import {DisplayOptionsPopover} from './components/library/DisplayOptionsPopover';
import {
  DuplicateImportModal,
  type DuplicateResolutionAction,
  type PendingDuplicateItem,
} from './components/library/DuplicateImportModal';
import {EmptyLibraryDropzone} from './components/library/EmptyLibraryDropzone';
import {HighlightsHubView} from './components/library/HighlightsHubView';
import {
  LibrarySidebar,
  type ActiveLibraryFilter,
} from './components/library/LibrarySidebar';
import {MetadataDrawer} from './components/library/MetadataDrawer';
import {OfflineIndicator} from './components/pwa/OfflineIndicator';
import {ReaderTabStrip} from './components/reader/ReaderTabStrip';
import {ReaderView} from './components/reader/ReaderView';
import {ToastContainer} from './components/ui/ToastContainer';
import {usePreferences} from './hooks/usePreferences';
import {libraryDb} from './lib/db';
import {flattenFoldersHierarchy, getFolderDescendantIds} from './lib/formatters';
import {importBookFile} from './lib/parsers';
import type {
  BookFileBlob,
  BookFormat,
  BookRecord,
  BookmarkRecord,
  CategoryRecord,
  FolderColor,
  FolderRecord,
  GroupByField,
  HighlightRecord,
  LibraryViewMode,
  SortDirection,
  SortField,
  ToastMessage,
} from './types/library';

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMatchText(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

export default function App() {
  const {
    prefs,
    libraryPrefs,
    updatePreferences,
    updateLibraryPrefs,
    updateCardDetails,
    toggleSidebarSection,
    toggleTheme,
    resetTypography,
  } = usePreferences();

  const [isHydrating, setIsHydrating] = useState(true);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [allHighlights, setAllHighlights] = useState<HighlightRecord[]>([]);
  const [allBookmarks, setAllBookmarks] = useState<BookmarkRecord[]>([]);

  // Multi-book open tabs & active reader book
  const [openBookIds, setOpenBookIds] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem('folio_open_tabs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter((id) => typeof id === 'string');
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [readingBookId, setReadingBookId] = useState<string | null>(null);

  // Library workspace UI state
  const [activeFilter, setActiveFilter] = useState<ActiveLibraryFilter>({
    kind: 'smart',
    id: 'all',
  });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [formatFilter, setFormatFilter] = useState<'all' | BookFormat>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const [sortField, setSortField] = useState<SortField>('addedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Book Inspector & Command Palette
  const [inspectedBookId, setInspectedBookId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Selection & Overlays
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);

  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Import state, duplicate resolution queue & global drop overlay
  const [isImporting, setIsImporting] = useState(false);
  const [pendingDuplicates, setPendingDuplicates] = useState<PendingDuplicateItem[]>([]);
  const [isGlobalDragOver, setIsGlobalDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback(
    (title: string, tone: 'info' | 'success' | 'error' = 'info', detail?: string) => {
      const id = makeId('toast');
      setToasts((prev) => [...prev.slice(-3), {id, title, detail, tone}]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshAnnotations = useCallback(async () => {
    try {
      const [loadedHighlights, loadedBookmarks] = await Promise.all([
        libraryDb.getAllHighlights(),
        libraryDb.getAllBookmarks(),
      ]);
      setAllHighlights(loadedHighlights);
      setAllBookmarks(loadedBookmarks);
    } catch {
      // ignore transient errors
    }
  }, []);

  // Hydrate offline library from IndexedDB on mount
  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const [
          loadedBooks,
          loadedFolders,
          loadedCategories,
          loadedHighlights,
          loadedBookmarks,
        ] = await Promise.all([
          libraryDb.getAllBooks(),
          libraryDb.getAllFolders(),
          libraryDb.getAllCategories(),
          libraryDb.getAllHighlights(),
          libraryDb.getAllBookmarks(),
        ]);
        if (!active) return;
        setBooks(loadedBooks);
        setFolders(loadedFolders);
        setCategories(loadedCategories);
        setAllHighlights(loadedHighlights);
        setAllBookmarks(loadedBookmarks);
        const validIds = new Set(loadedBooks.map((b) => b.id));
        setOpenBookIds((prev) => prev.filter((id) => validIds.has(id)));
      } catch {
        if (active) {
          notify('Could not open local IndexedDB storage', 'error');
        }
      } finally {
        if (active) setIsHydrating(false);
      }
    };
    hydrate();
    return () => {
      active = false;
    };
  }, [notify]);

  // Global Cmd/Ctrl+K Command Palette shortcut (in Library view)
  useEffect(() => {
    if (readingBookId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readingBookId]);

  // Derived tag catalog
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of books) {
      for (const tag of book.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({name, count}))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [books]);

  const existingTagNames = useMemo(() => allTags.map((t) => t.name), [allTags]);

  const isHighlightsHubActive =
    activeFilter.kind === 'smart' && activeFilter.id === 'highlights';

  // Derived filtered + sorted book list
  const visibleBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const activeFolderDescendants =
      activeFilter.kind === 'folder' ? getFolderDescendantIds(folders, activeFilter.id) : null;

    const filtered = books.filter((book) => {
      // Primary sidebar filter
      if (activeFilter.kind === 'smart') {
        if (activeFilter.id === 'reading' && book.status !== 'reading') return false;
        if (activeFilter.id === 'unread' && book.status !== 'unread') return false;
        if (activeFilter.id === 'finished' && book.status !== 'finished') return false;
        if (activeFilter.id === 'favorites' && !book.isFavorite) return false;
      } else if (activeFilter.kind === 'folder' && activeFolderDescendants) {
        if (!book.folderId || !activeFolderDescendants.has(book.folderId)) return false;
      } else if (activeFilter.kind === 'category') {
        if (book.categoryId !== activeFilter.id) return false;
      }

      // Format filter
      if (formatFilter !== 'all' && book.format !== formatFilter) return false;

      // Multi-tag filter (book must include all selected tags)
      if (selectedTags.length > 0) {
        const lowerBookTags = new Set(book.tags.map((t) => t.toLowerCase()));
        for (const tag of selectedTags) {
          if (!lowerBookTags.has(tag.toLowerCase())) return false;
        }
      }

      // Search query
      if (q) {
        const haystack = [
          book.title,
          book.author,
          book.series,
          book.publisher,
          book.description,
          ...book.tags,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case 'recent':
          return ((a.lastReadAt ?? 0) - (b.lastReadAt ?? 0)) * dir || b.addedAt - a.addedAt;
        case 'addedAt':
          return (a.addedAt - b.addedAt) * dir;
        case 'title':
          return a.title.localeCompare(b.title) * dir;
        case 'author':
          return a.author.localeCompare(b.author) * dir;
        case 'progress':
          return (a.progress - b.progress) * dir;
        case 'format':
          return a.format.localeCompare(b.format) * dir;
        default:
          return 0;
      }
    });
  }, [books, folders, activeFilter, formatFilter, selectedTags, searchQuery, sortField, sortDirection]);

  // Catalog Grouping Pipeline
  const groupedBooks = useMemo<Array<{key: string; label: string; books: BookRecord[]}>>(() => {
    const groupBy = libraryPrefs.groupBy;
    if (groupBy === 'none') {
      return [{key: '__all__', label: '', books: visibleBooks}];
    }

    const map = new Map<string, {label: string; books: BookRecord[]; order?: number}>();
    const statusOrder: Record<BookRecord['status'], {label: string; order: number}> = {
      reading: {label: 'Currently Reading', order: 0},
      unread: {label: 'Unread', order: 1},
      finished: {label: 'Finished', order: 2},
    };

    for (const book of visibleBooks) {
      let key = '';
      let label = '';
      let order: number | undefined;

      if (groupBy === 'author') {
        label = book.author.trim() || 'Unknown Author';
        key = `author:${label.toLowerCase()}`;
      } else if (groupBy === 'series') {
        label = book.series.trim() || 'Standalone Books';
        key = `series:${label.toLowerCase()}`;
        order = book.series.trim() ? 0 : 1;
      } else if (groupBy === 'status') {
        const meta = statusOrder[book.status];
        label = meta.label;
        key = `status:${book.status}`;
        order = meta.order;
      } else if (groupBy === 'format') {
        label = `${book.format.toUpperCase()} Books`;
        key = `format:${book.format}`;
      }

      const existing = map.get(key);
      if (existing) {
        existing.books.push(book);
      } else {
        map.set(key, {label, books: [book], order});
      }
    }

    return Array.from(map.entries())
      .map(([key, val]) => ({key, ...val}))
      .sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
          return a.order - b.order;
        }
        return a.label.localeCompare(b.label);
      });
  }, [visibleBooks, libraryPrefs.groupBy]);

  // Active breadcrumb header label
  const activeViewHeading = useMemo(() => {
    if (activeFilter.kind === 'smart') {
      const map: Record<string, string> = {
        all: 'All Books',
        reading: 'Currently Reading',
        unread: 'Unread',
        finished: 'Finished',
        favorites: 'Favorites',
        highlights: 'Highlights & Notes',
      };
      return {section: 'Library', title: map[activeFilter.id] ?? 'All Books'};
    }
    if (activeFilter.kind === 'folder') {
      const flat = flattenFoldersHierarchy(folders);
      const match = flat.find((item) => item.folder.id === activeFilter.id);
      return {section: 'Folders', title: match?.pathLabel ?? 'Folder'};
    }
    const c = categories.find((item) => item.id === activeFilter.id);
    return {section: 'Categories', title: c?.name ?? 'Category'};
  }, [activeFilter, folders, categories]);

  // File Import Pipeline with Duplicate Detection
  const handleImportFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setIsImporting(true);
      const imported: BookRecord[] = [];
      const duplicates: PendingDuplicateItem[] = [];
      const errors: string[] = [];

      const defaultFolderId = activeFilter.kind === 'folder' ? activeFilter.id : null;
      const defaultCategoryId = activeFilter.kind === 'category' ? activeFilter.id : null;

      // Include already-loaded books plus newly imported books within this batch
      const knownBooks = [...books];

      for (const file of files) {
        try {
          const {book, blob} = await importBookFile(file, {
            folderId: defaultFolderId,
            categoryId: defaultCategoryId,
          });

          const fileMatch = knownBooks.find(
            (existing) =>
              existing.fileName.toLowerCase() === file.name.toLowerCase() &&
              existing.fileSize === file.size
          );
          const titleAuthorMatch =
            !fileMatch &&
            knownBooks.find(
              (existing) =>
                normalizeMatchText(existing.title) === normalizeMatchText(book.title) &&
                normalizeMatchText(existing.author) === normalizeMatchText(book.author)
            );

          const matchedExisting = fileMatch || titleAuthorMatch || null;

          if (matchedExisting) {
            duplicates.push({
              id: makeId('dup'),
              file,
              arrayBuffer: blob.data,
              metadata: {
                title: book.title,
                author: book.author,
                publisher: book.publisher,
                year: book.year,
                language: book.language,
                description: book.description,
                coverDataUrl: book.coverDataUrl,
                totalUnits: book.totalUnits,
                format: book.format,
              },
              existingBook: matchedExisting,
              matchReason: fileMatch ? 'Same file name & size' : 'Same title & author',
            });
          } else {
            await libraryDb.saveBookWithFile(book, blob);
            imported.push(book);
            knownBooks.unshift(book);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : `Failed to import ${file.name}`;
          errors.push(msg);
        }
      }

      if (imported.length > 0) {
        setBooks((prev) => [...imported.reverse(), ...prev]);
        notify(
          imported.length === 1
            ? `Imported "${imported[0].title}"`
            : `Imported ${imported.length} books to offline library`,
          'success'
        );
      }

      if (duplicates.length > 0) {
        setPendingDuplicates((prev) => [...prev, ...duplicates]);
      }

      if (errors.length > 0) {
        notify(
          errors.length === 1 ? 'Import skipped' : `${errors.length} files could not be imported`,
          'error',
          errors[0]
        );
      }

      setIsImporting(false);
    },
    [activeFilter, books, notify]
  );

  // Resolve pending duplicates
  const handleResolveDuplicates = useCallback(
    async (decisions: Record<string, DuplicateResolutionAction>) => {
      const items = pendingDuplicates;
      setPendingDuplicates([]);

      const addedBooks: BookRecord[] = [];
      const replacedBooks: BookRecord[] = [];
      const defaultFolderId = activeFilter.kind === 'folder' ? activeFilter.id : null;
      const defaultCategoryId = activeFilter.kind === 'category' ? activeFilter.id : null;

      const mimeMap: Record<BookFormat, string> = {
        pdf: 'application/pdf',
        epub: 'application/epub+zip',
        mobi: 'application/x-mobipocket-ebook',
      };

      for (const item of items) {
        const action = decisions[item.id] ?? 'skip';
        if (action === 'skip') continue;

        if (action === 'replace') {
          const updated: BookRecord = {
            ...item.existingBook,
            format: item.metadata.format,
            fileName: item.file.name,
            fileSize: item.file.size,
            totalUnits: item.metadata.totalUnits,
            coverDataUrl: item.existingBook.coverDataUrl ?? item.metadata.coverDataUrl,
            publisher: item.existingBook.publisher || item.metadata.publisher,
            year: item.existingBook.year || item.metadata.year,
            description: item.existingBook.description || item.metadata.description,
          };
          const blob: BookFileBlob = {
            bookId: updated.id,
            data: item.arrayBuffer,
            mimeType: item.file.type || mimeMap[updated.format],
          };
          await libraryDb.saveBookWithFile(updated, blob);
          replacedBooks.push(updated);
        } else if (action === 'keep-both') {
          const id = makeId('book');
          const newBook: BookRecord = {
            id,
            title: item.metadata.title,
            author: item.metadata.author,
            format: item.metadata.format,
            fileName: item.file.name,
            fileSize: item.file.size,
            addedAt: Date.now(),
            lastReadAt: null,
            categoryId: defaultCategoryId,
            folderId: defaultFolderId,
            tags: [],
            series: '',
            publisher: item.metadata.publisher,
            year: item.metadata.year,
            language: item.metadata.language || 'en',
            description: item.metadata.description,
            isFavorite: false,
            coverDataUrl: item.metadata.coverDataUrl,
            coverPaletteIndex: item.existingBook.coverPaletteIndex,
            progress: 0,
            status: 'unread',
            totalUnits: item.metadata.totalUnits,
            currentLocation: {
              unitIndex: item.metadata.format === 'pdf' ? 1 : 0,
              scrollRatio: 0,
            },
          };
          const blob: BookFileBlob = {
            bookId: id,
            data: item.arrayBuffer,
            mimeType: item.file.type || mimeMap[newBook.format],
          };
          await libraryDb.saveBookWithFile(newBook, blob);
          addedBooks.push(newBook);
        }
      }

      if (replacedBooks.length > 0 || addedBooks.length > 0) {
        const replacedMap = new Map(replacedBooks.map((b) => [b.id, b]));
        setBooks((prev) => [
          ...addedBooks.reverse(),
          ...prev.map((b) => replacedMap.get(b.id) ?? b),
        ]);

        const parts: string[] = [];
        if (replacedBooks.length > 0) parts.push(`replaced ${replacedBooks.length}`);
        if (addedBooks.length > 0) parts.push(`added ${addedBooks.length}`);
        notify(`Import updated (${parts.join(', ')})`, 'success');
      }
    },
    [pendingDuplicates, activeFilter, notify]
  );

  // Global window file drop listeners (only while in Library view)
  useEffect(() => {
    if (readingBookId) return;

    const isExternalFileDrag = (e: DragEvent) =>
      Boolean(
        e.dataTransfer &&
          e.dataTransfer.types.includes('Files') &&
          !e.dataTransfer.types.includes('application/x-folio-book-id') &&
          !e.dataTransfer.types.includes('application/x-folio-book-ids')
      );

    const onDragEnter = (e: DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsGlobalDragOver(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsGlobalDragOver(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsGlobalDragOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        void handleImportFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [readingBookId, handleImportFiles]);

  // Folder CRUD (Nested + Colored)
  const handleCreateFolder = useCallback(
    async (
      name: string,
      parentId: string | null = null,
      color: FolderColor = 'neutral'
    ): Promise<FolderRecord> => {
      const folder: FolderRecord = {
        id: makeId('folder'),
        name,
        parentId,
        color,
        createdAt: Date.now(),
      };
      await libraryDb.saveFolder(folder);
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      notify(parentId ? `Sub-folder "${name}" created` : `Folder "${name}" created`, 'success');
      return folder;
    },
    [notify]
  );

  const handleUpdateFolder = useCallback(
    async (id: string, patch: {name?: string; color?: FolderColor}) => {
      setFolders((prev) => {
        const target = prev.find((f) => f.id === id);
        if (!target) return prev;
        const updated: FolderRecord = {
          ...target,
          ...(patch.name !== undefined ? {name: patch.name} : {}),
          ...(patch.color !== undefined ? {color: patch.color} : {}),
        };
        void libraryDb.saveFolder(updated);
        return prev
          .map((f) => (f.id === id ? updated : f))
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    []
  );

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      const target = folders.find((f) => f.id === id);
      const nextParentId = target?.parentId ?? null;
      await libraryDb.deleteFolder(id);
      setFolders((prev) =>
        prev
          .filter((f) => f.id !== id)
          .map((f) => (f.parentId === id ? {...f, parentId: nextParentId} : f))
      );
      setBooks((prev) => prev.map((b) => (b.folderId === id ? {...b, folderId: null} : b)));
      if (activeFilter.kind === 'folder' && activeFilter.id === id) {
        setActiveFilter({kind: 'smart', id: 'all'});
      }
      notify('Folder deleted (books & sub-folders kept)', 'info');
    },
    [folders, activeFilter, notify]
  );

  // Category CRUD
  const handleCreateCategory = useCallback(
    async (name: string): Promise<CategoryRecord> => {
      const cat: CategoryRecord = {
        id: makeId('cat'),
        name,
        createdAt: Date.now(),
      };
      await libraryDb.saveCategory(cat);
      setCategories((prev) => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)));
      notify(`Category "${name}" added`, 'success');
      return cat;
    },
    [notify]
  );

  const handleDeleteCategory = useCallback(
    async (id: string) => {
      await libraryDb.deleteCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setBooks((prev) => prev.map((b) => (b.categoryId === id ? {...b, categoryId: null} : b)));
      if (activeFilter.kind === 'category' && activeFilter.id === id) {
        setActiveFilter({kind: 'smart', id: 'all'});
      }
      notify('Category removed', 'info');
    },
    [activeFilter, notify]
  );

  // Book updates
  const handleUpdateBook = useCallback(async (updated: BookRecord) => {
    await libraryDb.updateBook(updated);
    setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  }, []);

  const handleSaveMetadata = useCallback(
    async (updated: BookRecord) => {
      await handleUpdateBook(updated);
      setEditingBookId(null);
      notify(`Saved changes to "${updated.title}"`, 'success');
    },
    [handleUpdateBook, notify]
  );

  const handleToggleFavorite = useCallback(
    async (book: BookRecord) => {
      const updated = {...book, isFavorite: !book.isFavorite};
      await handleUpdateBook(updated);
    },
    [handleUpdateBook]
  );

  // Extended Drag-and-Drop Handlers (single or multi-selected books)
  const handleDropBooksToFolder = useCallback(
    async (bookIds: string[], folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => idSet.has(b.id) && b.folderId !== folderId);
      if (targets.length === 0) return;

      const updated = targets.map((b) => ({...b, folderId}));
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      notify(
        updated.length === 1
          ? `Moved "${updated[0].title}" to ${folder.name}`
          : `Moved ${updated.length} books to ${folder.name}`,
        'success'
      );
    },
    [books, folders, notify]
  );

  const handleDropBooksToCategory = useCallback(
    async (bookIds: string[], categoryId: string) => {
      const cat = categories.find((c) => c.id === categoryId);
      if (!cat) return;
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => idSet.has(b.id) && b.categoryId !== categoryId);
      if (targets.length === 0) return;

      const updated = targets.map((b) => ({...b, categoryId}));
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      notify(
        updated.length === 1
          ? `Categorized "${updated[0].title}" under ${cat.name}`
          : `Set ${updated.length} books to ${cat.name}`,
        'success'
      );
    },
    [books, categories, notify]
  );

  const handleDropBooksToTag = useCallback(
    async (bookIds: string[], tagName: string) => {
      const idSet = new Set(bookIds);
      const targets = books.filter(
        (b) =>
          idSet.has(b.id) &&
          !b.tags.some((t) => t.toLowerCase() === tagName.toLowerCase())
      );
      if (targets.length === 0) return;

      const updated = targets.map((b) => ({...b, tags: [...b.tags, tagName]}));
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      notify(
        updated.length === 1
          ? `Tagged "${updated[0].title}" with "${tagName}"`
          : `Added "${tagName}" to ${updated.length} books`,
        'success'
      );
    },
    [books, notify]
  );

  const handleDropBooksToFavorites = useCallback(
    async (bookIds: string[]) => {
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => idSet.has(b.id) && !b.isFavorite);
      if (targets.length === 0) return;

      const updated = targets.map((b) => ({...b, isFavorite: true}));
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      notify(
        updated.length === 1
          ? `Added "${updated[0].title}" to Favorites`
          : `Added ${updated.length} books to Favorites`,
        'success'
      );
    },
    [books, notify]
  );

  // Highlight hub mutations
  const handleUpdateHighlight = useCallback(
    async (updated: HighlightRecord) => {
      await libraryDb.saveHighlight(updated);
      setAllHighlights((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
      notify('Highlight note saved', 'success');
    },
    [notify]
  );

  const handleDeleteHighlight = useCallback(
    async (id: string) => {
      await libraryDb.deleteHighlight(id);
      setAllHighlights((prev) => prev.filter((h) => h.id !== id));
      notify('Highlight deleted', 'info');
    },
    [notify]
  );

  const handleDeleteSingleBook = useCallback(
    async (bookId: string) => {
      await libraryDb.deleteBooks([bookId]);
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
      setAllHighlights((prev) => prev.filter((h) => h.bookId !== bookId));
      setAllBookmarks((prev) => prev.filter((bm) => bm.bookId !== bookId));
      setOpenBookIds((prev) => prev.filter((id) => id !== bookId));
      setReadingBookId((curr) => (curr === bookId ? null : curr));
      setInspectedBookId((curr) => (curr === bookId ? null : curr));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(bookId);
        return next;
      });
      setEditingBookId(null);
      notify('Book permanently deleted', 'info');
    },
    [notify]
  );

  // Multi-selection handlers (with Shift+Click range support)
  const handleToggleSelect = useCallback(
    (bookId: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastSelectedIdRef.current) {
          const ids = visibleBooks.map((b) => b.id);
          const a = ids.indexOf(lastSelectedIdRef.current);
          const b = ids.indexOf(bookId);
          if (a !== -1 && b !== -1) {
            const [start, end] = a < b ? [a, b] : [b, a];
            for (let i = start; i <= end; i++) {
              next.add(ids[i]);
            }
            return next;
          }
        }
        if (next.has(bookId)) {
          next.delete(bookId);
        } else {
          next.add(bookId);
        }
        return next;
      });
      lastSelectedIdRef.current = bookId;
    },
    [visibleBooks]
  );

  const handleToggleSelectAllVisible = useCallback(() => {
    const visibleIds = visibleBooks.map((b) => b.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }, [visibleBooks, selectedIds]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    lastSelectedIdRef.current = null;
  }, []);

  // Bulk Edit apply
  const handleApplyBulkEdit = useCallback(
    async (patch: BulkEditPatch) => {
      const targetBooks = books.filter((b) => selectedIds.has(b.id));
      if (targetBooks.length === 0) return;

      const removeSet = new Set(patch.removeTags.map((t) => t.toLowerCase()));

      const updatedBooks = targetBooks.map((book) => {
        let nextFolderId = book.folderId;
        if (patch.folderAction === 'set') nextFolderId = patch.folderId;
        if (patch.folderAction === 'clear') nextFolderId = null;

        let nextCategoryId = book.categoryId;
        if (patch.categoryAction === 'set') nextCategoryId = patch.categoryId;
        if (patch.categoryAction === 'clear') nextCategoryId = null;

        let nextStatus = book.status;
        let nextProgress = book.progress;
        if (patch.statusAction !== 'keep') {
          nextStatus = patch.statusAction;
          if (nextStatus === 'finished') nextProgress = 100;
          if (nextStatus === 'unread') nextProgress = 0;
          if (nextStatus === 'reading' && nextProgress === 0) nextProgress = 1;
        }

        let nextTags = book.tags.filter((t) => !removeSet.has(t.toLowerCase()));
        for (const t of patch.addTags) {
          if (!nextTags.some((e) => e.toLowerCase() === t.toLowerCase())) {
            nextTags.push(t);
          }
        }

        return {
          ...book,
          folderId: nextFolderId,
          categoryId: nextCategoryId,
          status: nextStatus,
          progress: nextProgress,
          tags: nextTags,
        };
      });

      await libraryDb.updateBooksBatch(updatedBooks);
      const updatedMap = new Map(updatedBooks.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      setBulkEditOpen(false);
      notify(`Updated ${updatedBooks.length} books`, 'success');
    },
    [books, selectedIds, notify]
  );

  // Bulk Favorite toggle
  const handleBulkFavorite = useCallback(async () => {
    const targetBooks = books.filter((b) => selectedIds.has(b.id));
    if (targetBooks.length === 0) return;
    const allFavorited = targetBooks.every((b) => b.isFavorite);
    const updatedBooks = targetBooks.map((b) => ({...b, isFavorite: !allFavorited}));
    await libraryDb.updateBooksBatch(updatedBooks);
    const updatedMap = new Map(updatedBooks.map((b) => [b.id, b]));
    setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
    notify(
      allFavorited
        ? `Removed ${updatedBooks.length} books from Favorites`
        : `Added ${updatedBooks.length} books to Favorites`,
      'success'
    );
  }, [books, selectedIds, notify]);

  // Bulk Delete confirm
  const handleConfirmBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await libraryDb.deleteBooks(ids);
    const idSet = new Set(ids);
    setBooks((prev) => prev.filter((b) => !idSet.has(b.id)));
    setAllHighlights((prev) => prev.filter((h) => !idSet.has(h.bookId)));
    setAllBookmarks((prev) => prev.filter((bm) => !idSet.has(bm.bookId)));
    setOpenBookIds((prev) => prev.filter((id) => !idSet.has(id)));
    setReadingBookId((curr) => (curr && idSet.has(curr) ? null : curr));
    setInspectedBookId((curr) => (curr && idSet.has(curr) ? null : curr));
    setBulkDeleteOpen(false);
    handleClearSelection();
    notify(
      ids.length === 1
        ? 'Deleted 1 book from local storage'
        : `Deleted ${ids.length} books from local storage`,
      'info'
    );
  }, [selectedIds, handleClearSelection, notify]);

  // Sort handler
  const handleSortFieldClick = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'title' || field === 'author' ? 'asc' : 'desc');
    }
  };

  useEffect(() => {
    try {
      sessionStorage.setItem('folio_open_tabs_v1', JSON.stringify(openBookIds));
    } catch {
      // ignore
    }
  }, [openBookIds]);

  const openBookInTab = useCallback(
    async (bookId: string, jumpToUnitIndex?: number) => {
      if (jumpToUnitIndex !== undefined) {
        const target = books.find((b) => b.id === bookId);
        if (target) {
          const updated: BookRecord = {
            ...target,
            currentLocation: {
              ...target.currentLocation,
              unitIndex: jumpToUnitIndex,
              scrollRatio: 0,
            },
          };
          await handleUpdateBook(updated);
        }
      }
      setOpenBookIds((prev) => (prev.includes(bookId) ? prev : [...prev, bookId]));
      setReadingBookId(bookId);
    },
    [books, handleUpdateBook]
  );

  const handleInspectBook = useCallback(
    (book: BookRecord) => {
      setInspectedBookId(book.id);
      if (!libraryPrefs.inspectorOpen) {
        updateLibraryPrefs({inspectorOpen: true});
      }
    },
    [libraryPrefs.inspectorOpen, updateLibraryPrefs]
  );

  const closeBookTab = useCallback((bookId: string) => {
    setOpenBookIds((prev) => {
      const idx = prev.indexOf(bookId);
      const next = prev.filter((id) => id !== bookId);
      setReadingBookId((curr) => {
        if (curr !== bookId) return curr;
        if (next.length === 0) return null;
        return next[Math.max(0, idx - 1)] ?? next[0];
      });
      return next;
    });
  }, []);

  const openBookRecords = useMemo(() => {
    const byId = new Map(books.map((b) => [b.id, b]));
    return openBookIds
      .map((id) => byId.get(id))
      .filter((b): b is BookRecord => Boolean(b));
  }, [books, openBookIds]);

  const readingBook = useMemo(
    () => (readingBookId ? books.find((b) => b.id === readingBookId) ?? null : null),
    [books, readingBookId]
  );

  const editingBook = useMemo(
    () => (editingBookId ? books.find((b) => b.id === editingBookId) ?? null : null),
    [books, editingBookId]
  );

  const inspectedBook = useMemo(() => {
    if (inspectedBookId) {
      const found = books.find((b) => b.id === inspectedBookId);
      if (found) return found;
    }
    return visibleBooks[0] ?? books[0] ?? null;
  }, [books, visibleBooks, inspectedBookId]);

  const inspectedHighlights = useMemo(
    () => (inspectedBook ? allHighlights.filter((h) => h.bookId === inspectedBook.id) : []),
    [allHighlights, inspectedBook]
  );

  const inspectedBookmarks = useMemo(
    () => (inspectedBook ? allBookmarks.filter((bm) => bm.bookId === inspectedBook.id) : []),
    [allBookmarks, inspectedBook]
  );

  const selectedBookRecords = useMemo(
    () => books.filter((b) => selectedIds.has(b.id)),
    [books, selectedIds]
  );

  const allVisibleSelected =
    visibleBooks.length > 0 && visibleBooks.every((b) => selectedIds.has(b.id));

  const hasActiveSubFilters =
    searchQuery.trim().length > 0 ||
    formatFilter !== 'all' ||
    selectedTags.length > 0 ||
    activeFilter.kind !== 'smart' ||
    activeFilter.id !== 'all';

  const showContinueReadingShelf =
    activeFilter.kind === 'smart' &&
    activeFilter.id === 'all' &&
    searchQuery.trim().length === 0 &&
    formatFilter === 'all' &&
    selectedTags.length === 0 &&
    books.length > 0;

  const resetAllFilters = () => {
    setActiveFilter({kind: 'smart', id: 'all'});
    setSelectedTags([]);
    setFormatFilter('all');
    setSearchQuery('');
  };

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Render full-viewport E-Book Reader when a book tab is active
  if (readingBook) {
    return (
      <>
        <ReaderView
          book={readingBook}
          openBooks={openBookRecords}
          prefs={prefs}
          onUpdatePrefs={updatePreferences}
          onResetPrefs={resetTypography}
          onToggleTheme={toggleTheme}
          onBookProgressUpdate={handleUpdateBook}
          onSelectLibrary={() => {
            setReadingBookId(null);
            void refreshAnnotations();
          }}
          onSelectBookTab={(id) => setReadingBookId(id)}
          onCloseBookTab={closeBookTab}
          onNotify={(title, tone) => notify(title, tone)}
        />
        <OfflineIndicator />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)] overflow-hidden">
      {/* Multi-Book Tab Strip shown in Library whenever books are open */}
      <ReaderTabStrip
        openBooks={openBookRecords}
        activeBookId={null}
        onSelectLibrary={() => setReadingBookId(null)}
        onSelectBook={(id) => setReadingBookId(id)}
        onCloseBookTab={closeBookTab}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Hidden Global File Picker */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.epub,.mobi,.prc,.azw"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void handleImportFiles(e.target.files);
            }
            e.target.value = '';
          }}
          className="hidden"
        />

        {/* Left Sidebar Navigation */}
        <LibrarySidebar
          books={books}
          folders={folders}
          categories={categories}
          allTags={allTags}
          totalHighlightsCount={allHighlights.length}
          activeFilter={activeFilter}
          selectedTags={selectedTags}
          collapsedSections={libraryPrefs.collapsedSidebarSections}
          onToggleSection={toggleSidebarSection}
          onSelectFilter={(filter) => {
            setActiveFilter(filter);
            setSelectedIds(new Set());
          }}
          onToggleTag={(tag) => {
            if (isHighlightsHubActive) {
              setActiveFilter({kind: 'smart', id: 'all'});
            }
            setSelectedTags((prev) =>
              prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
            );
          }}
          onClearTags={() => setSelectedTags([])}
          onCreateFolder={(name, parentId, color) =>
            void handleCreateFolder(name, parentId ?? null, color ?? 'neutral')
          }
          onUpdateFolder={(id, patch) => void handleUpdateFolder(id, patch)}
          onDeleteFolder={(id) => void handleDeleteFolder(id)}
          onCreateCategory={(name) => void handleCreateCategory(name)}
          onDeleteCategory={(id) => void handleDeleteCategory(id)}
          onDropBooksToFolder={(bookIds, folderId) =>
            void handleDropBooksToFolder(bookIds, folderId)
          }
          onDropBooksToCategory={(bookIds, categoryId) =>
            void handleDropBooksToCategory(bookIds, categoryId)
          }
          onDropBooksToTag={(bookIds, tagName) => void handleDropBooksToTag(bookIds, tagName)}
          onDropBooksToFavorites={(bookIds) => void handleDropBooksToFavorites(bookIds)}
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* Main Library Workspace */}
        <div className="flex-1 min-w-0 flex flex-col h-full">
          {/* Top Workspace Header */}
          <header className="h-14 px-5 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-6 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open navigation sidebar"
                className="lg:hidden p-1.5 -ml-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer shrink-0"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="flex items-baseline gap-2 min-w-0 truncate">
                <span className="text-xs text-[var(--text-muted)] hidden sm:inline shrink-0">
                  {activeViewHeading.section}
                </span>
                <span className="text-xs text-[var(--text-muted)] hidden sm:inline shrink-0">/</span>
                <h1 className="font-serif-editorial text-lg font-semibold text-[var(--text-primary)] truncate">
                  {activeViewHeading.title}
                </h1>
                <span className="font-mono-tabular text-xs text-[var(--text-muted)] shrink-0 ml-1">
                  {isHighlightsHubActive ? allHighlights.length : visibleBooks.length}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {books.length > 0 && !isHighlightsHubActive && (
                <button
                  type="button"
                  onClick={() =>
                    updateLibraryPrefs({inspectorOpen: !libraryPrefs.inspectorOpen})
                  }
                  title={libraryPrefs.inspectorOpen ? 'Hide Book Inspector' : 'Show Book Inspector'}
                  aria-label="Toggle Book Inspector"
                  aria-pressed={libraryPrefs.inspectorOpen}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    libraryPrefs.inspectorOpen
                      ? 'border-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                >
                  <PanelRight className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Inspector</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleTheme}
                title={`Switch to ${prefs.theme === 'sepia' ? 'Dark' : 'Sepia'} theme`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {prefs.theme === 'sepia' ? (
                  <>
                    <Moon className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="hidden sm:inline">Dark</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="hidden sm:inline">Sepia</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{isImporting ? 'Importing...' : 'Import Books'}</span>
              </button>
            </div>
          </header>

          {/* Secondary Filter / Search / Group / Display Toolbar (Catalog views) */}
          {books.length > 0 && !isHighlightsHubActive && (
            <div className="px-5 lg:px-8 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex flex-wrap items-center justify-between gap-3 shrink-0">
              {/* Search + Cmd+K Trigger & Format Filter */}
              <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
                <div className="relative flex-1 max-w-sm min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search title, author, tags..."
                    aria-label="Search library"
                    className="w-full pl-9 pr-14 py-1.5 text-xs rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCommandPaletteOpen(true)}
                      title="Open Command Palette (Ctrl/Cmd+K)"
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono-tabular text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] rounded bg-[var(--bg-surface)] cursor-pointer"
                    >
                      ⌘K
                    </button>
                  )}
                </div>

                {/* Format Segmented Filter */}
                <div
                  role="group"
                  aria-label="Filter by book format"
                  className="inline-flex items-center p-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sidebar)]"
                >
                  {(['all', 'epub', 'pdf', 'mobi'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setFormatFilter(fmt)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                        formatFilter === fmt
                          ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {fmt === 'all' ? 'All' : fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Right Controls: Group By, Sort, Display Popover, Select Mode, Grid/Table Toggle */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <select
                  value={libraryPrefs.groupBy}
                  onChange={(e) => {
                    updateLibraryPrefs({groupBy: e.target.value as GroupByField});
                    setCollapsedGroups(new Set());
                  }}
                  aria-label="Group books by"
                  className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] cursor-pointer"
                >
                  <option value="none">Group: None</option>
                  <option value="author">Group: Author</option>
                  <option value="series">Group: Series</option>
                  <option value="status">Group: Status</option>
                  <option value="format">Group: Format</option>
                </select>

                <select
                  value={sortField}
                  onChange={(e) => {
                    const next = e.target.value as SortField;
                    setSortField(next);
                    setSortDirection(next === 'title' || next === 'author' ? 'asc' : 'desc');
                  }}
                  aria-label="Sort books"
                  className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] cursor-pointer"
                >
                  <option value="addedAt">Date Added</option>
                  <option value="recent">Recently Read</option>
                  <option value="title">Title</option>
                  <option value="author">Author</option>
                  <option value="progress">Progress</option>
                  <option value="format">Format</option>
                </select>

                {/* Display Options Popover (Cover Size + Card Details) */}
                {viewMode === 'grid' && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setDisplayPopoverOpen((v) => !v)}
                      title="Cover size and card detail options"
                      aria-expanded={displayPopoverOpen}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                        displayPopoverOpen
                          ? 'border-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Display</span>
                    </button>

                    {displayPopoverOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setDisplayPopoverOpen(false)}
                        />
                        <div className="absolute right-0 top-10 z-40">
                          <DisplayOptionsPopover
                            coverSize={libraryPrefs.coverSize}
                            cardDetails={libraryPrefs.cardDetails}
                            onCoverSizeChange={(coverSize) => updateLibraryPrefs({coverSize})}
                            onCardDetailsChange={updateCardDetails}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (isSelectionMode) {
                      handleClearSelection();
                    } else {
                      setIsSelectionMode(true);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                    isSelectionMode || selectedIds.size > 0
                      ? 'border-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>{isSelectionMode ? 'Done' : 'Select'}</span>
                </button>

                <div
                  role="group"
                  aria-label="Library view mode"
                  className="inline-flex items-center p-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sidebar)]"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    title="Cover Grid view"
                    aria-label="Cover Grid view"
                    className={`p-1.5 rounded transition-colors cursor-pointer ${
                      viewMode === 'grid'
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    title="Compact Table view"
                    aria-label="Compact Table view"
                    className={`p-1.5 rounded transition-colors cursor-pointer ${
                      viewMode === 'table'
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active Tag Filter Summary Strip */}
          {!isHighlightsHubActive && selectedTags.length > 0 && (
            <div className="px-5 lg:px-8 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-[var(--text-muted)]">Filtered by tags:</span>
              {selectedTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedTags((prev) => prev.filter((item) => item !== t))}
                  className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline cursor-pointer"
                >
                  <span>{t}</span>
                  <X className="w-3 h-3" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                Clear tags
              </button>
            </div>
          )}

          {/* Library Content Viewport */}
          <main className="flex-1 overflow-y-auto flex flex-col">
            {isHydrating ? (
              <div className="flex-1 flex items-center justify-center p-12">
                <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <div className="w-4 h-4 rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)] animate-spin" />
                  <span>Loading offline library...</span>
                </div>
              </div>
            ) : isHighlightsHubActive ? (
              <HighlightsHubView
                books={books}
                highlights={allHighlights}
                onOpenPassage={(book, unitIndex) => void openBookInTab(book.id, unitIndex)}
                onUpdateHighlight={(updated) => void handleUpdateHighlight(updated)}
                onDeleteHighlight={(id) => void handleDeleteHighlight(id)}
                onBackToBooks={() => setActiveFilter({kind: 'smart', id: 'all'})}
              />
            ) : books.length === 0 ? (
              <EmptyLibraryDropzone
                onFilesSelected={(files) => void handleImportFiles(files)}
                onBrowseClick={() => fileInputRef.current?.click()}
                isImporting={isImporting}
              />
            ) : visibleBooks.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <p className="font-serif-editorial text-lg font-medium text-[var(--text-primary)]">
                  No matching books
                </p>
                <p className="mt-1.5 text-xs text-[var(--text-secondary)] max-w-sm">
                  No books in your offline library match the current folder, category, tag, or
                  search criteria.
                </p>
                {hasActiveSubFilters && (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="mt-4 px-4 py-2 text-xs font-medium rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="p-5 lg:p-8 pb-24">
                {/* Reading Overview Strip + Continue Reading Shelf */}
                {showContinueReadingShelf && (
                  <ContinueReadingShelf
                    books={books}
                    totalHighlightsCount={allHighlights.length}
                    onOpenBook={(book) => void openBookInTab(book.id)}
                    onInspectBook={handleInspectBook}
                    onOpenHighlightsHub={() =>
                      setActiveFilter({kind: 'smart', id: 'highlights'})
                    }
                  />
                )}

                {/* Grouped or Flat Catalog */}
                <div className="space-y-9">
                  {groupedBooks.map((group) => {
                    const isGrouped = libraryPrefs.groupBy !== 'none';
                    const isCollapsed = isGrouped && collapsedGroups.has(group.key);

                    return (
                      <section key={group.key}>
                        {isGrouped && (
                          <div className="mb-4 pb-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => toggleGroupCollapse(group.key)}
                              className="inline-flex items-center gap-2 text-left cursor-pointer group"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
                              )}
                              <h2 className="font-serif-editorial text-base font-semibold text-[var(--text-primary)]">
                                {group.label}
                              </h2>
                              <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                                {group.books.length}
                              </span>
                            </button>
                          </div>
                        )}

                        {!isCollapsed &&
                          (viewMode === 'grid' ? (
                            <BookGrid
                              books={group.books}
                              categories={categories}
                              selectedIds={selectedIds}
                              isSelectionMode={isSelectionMode}
                              coverSize={libraryPrefs.coverSize}
                              cardDetails={libraryPrefs.cardDetails}
                              inspectorOpen={libraryPrefs.inspectorOpen}
                              inspectedBookId={inspectedBook?.id ?? null}
                              onOpenBook={(book) => void openBookInTab(book.id)}
                              onInspectBook={handleInspectBook}
                              onEditBook={(book) => setEditingBookId(book.id)}
                              onToggleFavorite={(book) => void handleToggleFavorite(book)}
                              onToggleSelect={handleToggleSelect}
                            />
                          ) : (
                            <BookTable
                              books={group.books}
                              categories={categories}
                              folders={folders}
                              selectedIds={selectedIds}
                              allSelected={allVisibleSelected}
                              inspectorOpen={libraryPrefs.inspectorOpen}
                              inspectedBookId={inspectedBook?.id ?? null}
                              sortField={sortField}
                              sortDirection={sortDirection}
                              onSortChange={handleSortFieldClick}
                              onToggleSelect={handleToggleSelect}
                              onToggleSelectAll={handleToggleSelectAllVisible}
                              onOpenBook={(book) => void openBookInTab(book.id)}
                              onInspectBook={handleInspectBook}
                              onEditBook={(book) => setEditingBookId(book.id)}
                              onToggleFavorite={(book) => void handleToggleFavorite(book)}
                            />
                          ))}
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
          </main>
        </div>

        {/* Dockable Right-Side Book Inspector Pane */}
        {!isHighlightsHubActive && books.length > 0 && (
          <BookInspector
            book={inspectedBook}
            isOpen={libraryPrefs.inspectorOpen}
            folders={folders}
            categories={categories}
            highlights={inspectedHighlights}
            bookmarks={inspectedBookmarks}
            onClose={() => updateLibraryPrefs({inspectorOpen: false})}
            onOpenBook={(book, unitIndex) => void openBookInTab(book.id, unitIndex)}
            onUpdateBook={(updated) => void handleUpdateBook(updated)}
            onEditMetadata={(book) => setEditingBookId(book.id)}
            onDeleteBook={(id) => void handleDeleteSingleBook(id)}
          />
        )}
      </div>

      {/* Global File Drag-and-Drop Overlay */}
      {isGlobalDragOver && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-canvas)]/90 backdrop-blur-[2px] flex items-center justify-center p-8 pointer-events-none">
          <div className="w-full max-w-lg rounded-xl border-2 border-dashed border-[var(--accent)] bg-[var(--bg-elevated)] px-10 py-14 text-center shadow-2xl">
            <BookUp className="w-8 h-8 text-[var(--accent)] mx-auto mb-3" />
            <h2 className="font-serif-editorial text-xl font-semibold text-[var(--text-primary)]">
              Drop books to import offline
            </h2>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              Supports PDF, EPUB, and MOBI formats · Saved directly to IndexedDB
            </p>
          </div>
        </div>
      )}

      {/* Floating Bulk Selection Bar */}
      {!isHighlightsHubActive && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalVisibleCount={visibleBooks.length}
          onSelectAll={() => setSelectedIds(new Set(visibleBooks.map((b) => b.id)))}
          onClearSelection={handleClearSelection}
          onBulkEdit={() => setBulkEditOpen(true)}
          onBulkFavorite={() => void handleBulkFavorite()}
          onBulkDelete={() => setBulkDeleteOpen(true)}
        />
      )}

      {/* Cmd/Ctrl+K Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        books={books}
        folders={folders}
        categories={categories}
        highlights={allHighlights}
        theme={prefs.theme}
        inspectorOpen={libraryPrefs.inspectorOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenBook={(book, unitIndex) => void openBookInTab(book.id, unitIndex)}
        onSelectFolder={(folderId) => setActiveFilter({kind: 'folder', id: folderId})}
        onSelectCategory={(categoryId) => setActiveFilter({kind: 'category', id: categoryId})}
        onOpenHighlightsHub={() => setActiveFilter({kind: 'smart', id: 'highlights'})}
        onImportBooks={() => fileInputRef.current?.click()}
        onToggleTheme={toggleTheme}
        onToggleInspector={() =>
          updateLibraryPrefs({inspectorOpen: !libraryPrefs.inspectorOpen})
        }
      />

      {/* Duplicate Import Resolution Modal */}
      {pendingDuplicates.length > 0 && (
        <DuplicateImportModal
          items={pendingDuplicates}
          onResolve={(decisions) => void handleResolveDuplicates(decisions)}
          onCancel={() => setPendingDuplicates([])}
        />
      )}

      {/* Metadata Editor Drawer */}
      {editingBook && (
        <MetadataDrawer
          book={editingBook}
          folders={folders}
          categories={categories}
          existingTags={existingTagNames}
          onSave={(updated) => void handleSaveMetadata(updated)}
          onDelete={(id) => void handleDeleteSingleBook(id)}
          onCreateFolder={handleCreateFolder}
          onCreateCategory={handleCreateCategory}
          onClose={() => setEditingBookId(null)}
        />
      )}

      {/* Bulk Edit Modal */}
      {bulkEditOpen && (
        <BulkEditModal
          selectedCount={selectedIds.size}
          folders={folders}
          categories={categories}
          existingTags={existingTagNames}
          onApply={(patch) => void handleApplyBulkEdit(patch)}
          onClose={() => setBulkEditOpen(false)}
        />
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteOpen && selectedBookRecords.length > 0 && (
        <ConfirmDeleteModal
          booksToDelete={selectedBookRecords}
          onConfirm={() => void handleConfirmBulkDelete()}
          onClose={() => setBulkDeleteOpen(false)}
        />
      )}

      <OfflineIndicator />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
