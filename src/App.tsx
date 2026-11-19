/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  BookUp,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutGrid,
  List,
  Menu,
  Moon,
  PanelRight,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AddBooksToFolderModal} from './components/library/AddBooksToFolderModal';
import {
  BookContextMenu,
  type BookContextMenuState,
} from './components/library/BookContextMenu';
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
import {FloatingFolderDropDock} from './components/library/FloatingFolderDropDock';
import {
  FolderDropActionModal,
  type PendingFolderDrop,
} from './components/library/FolderDropActionModal';
import {HighlightsHubView} from './components/library/HighlightsHubView';
import {ImportBackupModal} from './components/library/ImportBackupModal';
import {
  LibrarySidebar,
  type ActiveLibraryFilter,
} from './components/library/LibrarySidebar';
import {MetadataDrawer} from './components/library/MetadataDrawer';
import {MobileBookActionSheet} from './components/library/MobileBookActionSheet';
import {MobileBookList} from './components/library/MobileBookList';
import {MobileBottomNav} from './components/library/MobileBottomNav';
import {MobileFilterSortSheet} from './components/library/MobileFilterSortSheet';
import {
  MobileOrganizeSheet,
  type MobileOrganizePayload,
} from './components/library/MobileOrganizeSheet';
import {ViewFoldersSection} from './components/library/ViewFoldersSection';
import {OfflineIndicator} from './components/pwa/OfflineIndicator';
import {ReaderTabStrip} from './components/reader/ReaderTabStrip';
import {ReaderView} from './components/reader/ReaderView';
import {ToastContainer} from './components/ui/ToastContainer';
import {useKeyboardSmoothScroll} from './hooks/useKeyboardSmoothScroll';
import {
  requestPersistentLocalStorage,
  useOfflineDesktopPWA,
} from './hooks/useOfflineDesktopPWA';
import {usePreferences} from './hooks/usePreferences';
import {
  exportLibraryBackupZip,
  parseLibraryBackupZip,
  type ParsedBackupArchive,
} from './lib/backup';
import {libraryDb} from './lib/db';
import {
  flattenFoldersHierarchy,
  getBookFolderIds,
  getFolderColorHex,
  getFolderDescendantIds,
  withBookFolderIds,
} from './lib/formatters';
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
  ReadingStatus,
  SortDirection,
  SortField,
  ToastMessage,
  ViewFolderRecord,
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

function hasBookDragPayload(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return (
    dt.types.includes('application/x-folio-book-ids') ||
    dt.types.includes('application/x-folio-book-id')
  );
}

function extractDraggedBookIds(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const multi = dt.getData('application/x-folio-book-ids');
  if (multi) {
    try {
      const parsed = JSON.parse(multi);
      if (Array.isArray(parsed)) {
        const ids = parsed.filter((id): id is string => typeof id === 'string');
        if (ids.length > 0) return ids;
      }
    } catch {
      // ignore
    }
  }
  const single = dt.getData('application/x-folio-book-id');
  return single ? [single] : [];
}

export default function App() {
  const {
    prefs,
    libraryPrefs,
    updatePreferences,
    updateLibraryPrefs,
    updateCardDetails,
    toggleSidebarSection,
    setViewFolderDisplay,
    setViewFolderCardLayout,
    setHideFiledBooks,
    restorePreferencesFromBackup,
    toggleTheme,
    resetTypography,
  } = usePreferences();

  const [isHydrating, setIsHydrating] = useState(true);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [viewFolders, setViewFolders] = useState<ViewFolderRecord[]>([]);
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
  const [bulkEditTargetIds, setBulkEditTargetIds] = useState<string[] | null>(null);
  const [pendingDeleteBookIds, setPendingDeleteBookIds] = useState<string[] | null>(null);
  const [contextMenu, setContextMenu] = useState<BookContextMenuState | null>(null);

  // Mobile-specific sheets
  const [mobileFilterSheetOpen, setMobileFilterSheetOpen] = useState(false);
  const [quickActionBookId, setQuickActionBookId] = useState<string | null>(null);
  const [mobileOrganizeBookIds, setMobileOrganizeBookIds] = useState<string[] | null>(null);

  // Per-view folder drill-in, floating drop dock & add-books modal state
  const [activeViewFolderId, setActiveViewFolderId] = useState<string | null>(null);
  const [addBooksFolderId, setAddBooksFolderId] = useState<string | null>(null);
  const [isRenamingDrilledFolder, setIsRenamingDrilledFolder] = useState(false);
  const [drilledRenameDraft, setDrilledRenameDraft] = useState('');
  const [pendingFolderDrop, setPendingFolderDrop] = useState<PendingFolderDrop | null>(null);
  const [isDraggingBook, setIsDraggingBook] = useState(false);
  const [isBackBreadcrumbDragOver, setIsBackBreadcrumbDragOver] = useState(false);
  const [isFoldersOutOfView, setIsFoldersOutOfView] = useState(false);
  const libraryMainRef = useRef<HTMLElement>(null);
  const foldersSentinelRef = useRef<HTMLDivElement>(null);

  // Global desktop smooth continuous WASD scrolling (Library, Reader & Carousels)
  useKeyboardSmoothScroll(true);

  // Backup export / import state
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isParsingBackup, setIsParsingBackup] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<ParsedBackupArchive | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

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

  const reloadLibraryData = useCallback(async () => {
    const [
      loadedBooks,
      loadedFolders,
      loadedViewFolders,
      loadedCategories,
      loadedHighlights,
      loadedBookmarks,
    ] = await Promise.all([
      libraryDb.getAllBooks(),
      libraryDb.getAllFolders(),
      libraryDb.getAllViewFolders(),
      libraryDb.getAllCategories(),
      libraryDb.getAllHighlights(),
      libraryDb.getAllBookmarks(),
    ]);
    setBooks(loadedBooks);
    setFolders(loadedFolders);
    setViewFolders(loadedViewFolders);
    setCategories(loadedCategories);
    setAllHighlights(loadedHighlights);
    setAllBookmarks(loadedBookmarks);
    const validIds = new Set(loadedBooks.map((b) => b.id));
    setOpenBookIds((prev) => prev.filter((id) => validIds.has(id)));
    return {
      books: loadedBooks,
      folders: loadedFolders,
      viewFolders: loadedViewFolders,
      categories: loadedCategories,
    };
  }, []);

  // Hydrate offline library from IndexedDB on mount
  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        await reloadLibraryData();
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
  }, [reloadLibraryData, notify]);

  // Track active internal book drags to highlight breadcrumb & floating drop dock
  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      if (hasBookDragPayload(e.dataTransfer)) {
        setIsDraggingBook(true);
        setContextMenu(null);
      }
    };
    const onDragDone = () => {
      setIsDraggingBook(false);
      setIsBackBreadcrumbDragOver(false);
    };
    window.addEventListener('dragstart', onDragStart);
    window.addEventListener('dragend', onDragDone);
    window.addEventListener('drop', onDragDone);
    return () => {
      window.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('dragend', onDragDone);
      window.removeEventListener('drop', onDragDone);
    };
  }, []);


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
        if (!getBookFolderIds(book).some((id) => activeFolderDescendants.has(id))) return false;
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

  // Active view key for per-view folders (distinct per smart view, folder, category, or tag view)
  const activeViewKey = useMemo(() => {
    if (selectedTags.length > 0) {
      const normalized = [...selectedTags]
        .map((t) => t.toLowerCase())
        .sort()
        .join('|');
      return `tag:${normalized}`;
    }
    return `${activeFilter.kind}:${activeFilter.id}`;
  }, [activeFilter, selectedTags]);

  // Reset drilled-in view folder when switching views
  useEffect(() => {
    setActiveViewFolderId(null);
    setIsRenamingDrilledFolder(false);
  }, [activeViewKey]);

  const currentViewFolders = useMemo(
    () =>
      viewFolders
        .filter((f) => f.viewKey === activeViewKey)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [viewFolders, activeViewKey]
  );

  // Observe whether the top folders section has scrolled out of view in the library canvas
  useEffect(() => {
    const root = libraryMainRef.current;
    const sentinel = foldersSentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === 'undefined') {
      setIsFoldersOutOfView(false);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const rootTop = entry.rootBounds?.top ?? 0;
        const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.bottom <= rootTop + 12;
        setIsFoldersOutOfView(scrolledPast);
      },
      {root, threshold: 0}
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    isHydrating,
    books.length,
    activeFilter,
    activeViewFolderId,
    currentViewFolders.length,
    readingBookId,
  ]);

  const activeDrilledFolder = useMemo(
    () =>
      activeViewFolderId
        ? currentViewFolders.find((f) => f.id === activeViewFolderId) ?? null
        : null,
    [currentViewFolders, activeViewFolderId]
  );

  const addBooksTargetFolder = useMemo(
    () =>
      addBooksFolderId
        ? viewFolders.find((f) => f.id === addBooksFolderId) ?? null
        : null,
    [viewFolders, addBooksFolderId]
  );

  const filedBookIdsInView = useMemo(() => {
    const visibleIdSet = new Set(visibleBooks.map((b) => b.id));
    const filed = new Set<string>();
    for (const folder of currentViewFolders) {
      for (const bid of folder.bookIds) {
        if (visibleIdSet.has(bid)) {
          filed.add(bid);
        }
      }
    }
    return filed;
  }, [currentViewFolders, visibleBooks]);

  const viewFolderDisplayMode = libraryPrefs.viewFolderDisplayByView[activeViewKey] ?? 'card';
  const viewFolderCardLayout = libraryPrefs.viewFolderCardLayoutByView[activeViewKey] ?? 'stacked';
  const hideFiledBooksInView = libraryPrefs.hideFiledBooksByView[activeViewKey] ?? true;

  const activeSidebarFolder = useMemo(
    () =>
      activeFilter.kind === 'folder'
        ? folders.find((f) => f.id === activeFilter.id) ?? null
        : null,
    [activeFilter, folders]
  );

  const activeSidebarParentFolder = useMemo(
    () =>
      activeSidebarFolder?.parentId
        ? folders.find((f) => f.id === activeSidebarFolder.parentId) ?? null
        : null,
    [activeSidebarFolder, folders]
  );

  // Books displayed in the main grid/table (either drilled-in folder contents or ungrouped view books)
  const displayedBooks = useMemo(() => {
    if (activeDrilledFolder) {
      const idSet = new Set(activeDrilledFolder.bookIds);
      return visibleBooks.filter((b) => idSet.has(b.id));
    }
    if (hideFiledBooksInView && filedBookIdsInView.size > 0) {
      return visibleBooks.filter((b) => !filedBookIdsInView.has(b.id));
    }
    return visibleBooks;
  }, [activeDrilledFolder, visibleBooks, hideFiledBooksInView, filedBookIdsInView]);

  // Catalog Grouping Pipeline
  const groupedBooks = useMemo<Array<{key: string; label: string; books: BookRecord[]}>>(() => {
    const groupBy = libraryPrefs.groupBy;
    if (groupBy === 'none') {
      return [{key: '__all__', label: '', books: displayedBooks}];
    }

    const map = new Map<string, {label: string; books: BookRecord[]; order?: number}>();
    const statusOrder: Record<BookRecord['status'], {label: string; order: number}> = {
      reading: {label: 'Currently Reading', order: 0},
      unread: {label: 'Unread', order: 1},
      finished: {label: 'Finished', order: 2},
    };

    for (const book of displayedBooks) {
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
  }, [displayedBooks, libraryPrefs.groupBy]);

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

  const activeViewLabel = useMemo(() => {
    if (selectedTags.length > 0) {
      return selectedTags.length === 1
        ? `#${selectedTags[0]}`
        : `Tags (${selectedTags.join(', ')})`;
    }
    return activeViewHeading.title;
  }, [selectedTags, activeViewHeading.title]);

  // File Import Pipeline with Duplicate Detection
  const handleImportFiles = useCallback(
    async (fileList: FileList | File[]): Promise<BookRecord[]> => {
      const files = Array.from(fileList);
      if (files.length === 0) return [];
      void requestPersistentLocalStorage();

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
      return imported;
    },
    [activeFilter, books, notify]
  );

  // Desktop OS "Open With Folio" handler: open existing match or import & open single book directly
  const handleFilesLaunchedFromOS = useCallback(
    async (files: File[]) => {
      if (files.length === 1) {
        const file = files[0];
        const existingMatch = books.find(
          (b) =>
            b.fileName.toLowerCase() === file.name.toLowerCase() &&
            b.fileSize === file.size
        );
        if (existingMatch) {
          setOpenBookIds((prev) =>
            prev.includes(existingMatch.id) ? prev : [...prev, existingMatch.id]
          );
          setReadingBookId(existingMatch.id);
          return;
        }
        const imported = await handleImportFiles([file]);
        if (imported.length === 1) {
          const openedId = imported[0].id;
          setOpenBookIds((prev) => (prev.includes(openedId) ? prev : [...prev, openedId]));
          setReadingBookId(openedId);
        }
        return;
      }

      await handleImportFiles(files);
    },
    [books, handleImportFiles]
  );

  // Offline Desktop PWA lifecycle: persistent storage, background update notices, & OS file launcher
  useOfflineDesktopPWA({
    isHydrating,
    onFilesLaunchedFromOS: handleFilesLaunchedFromOS,
    onNotify: notify,
  });

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
            folderIds: defaultFolderId ? [defaultFolderId] : [],
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
      setBooks((prev) =>
        prev.map((b) => {
          const fids = getBookFolderIds(b);
          return fids.includes(id)
            ? withBookFolderIds(
                b,
                fids.filter((fid) => fid !== id)
              )
            : b;
        })
      );
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
  const executeDropToSidebarFolder = useCallback(
    async (bookIds: string[], folderId: string, mode: 'add' | 'move') => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => {
        if (!idSet.has(b.id)) return false;
        const current = getBookFolderIds(b);
        if (mode === 'add') return !current.includes(folderId);
        return !(current.length === 1 && current[0] === folderId);
      });
      if (targets.length === 0) return;

      const updated = targets.map((b) => {
        const current = getBookFolderIds(b);
        const nextIds = mode === 'add' ? [...current, folderId] : [folderId];
        return withBookFolderIds(b, nextIds);
      });
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      const verb = mode === 'add' ? 'Added' : 'Moved';
      notify(
        updated.length === 1
          ? `${verb} "${updated[0].title}" to ${folder.name}`
          : `${verb} ${updated.length} books to ${folder.name}`,
        'success'
      );
    },
    [books, folders, notify]
  );

  const handleDropBooksToFolder = useCallback(
    async (bookIds: string[], folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      const idSet = new Set(bookIds);
      const draggedBooks = books.filter((b) => idSet.has(b.id));
      if (draggedBooks.length === 0) return;

      const folderNameById = new Map(folders.map((f) => [f.id, f.name]));
      const existingOtherFolderIds = new Set<string>();
      for (const b of draggedBooks) {
        for (const fid of getBookFolderIds(b)) {
          if (fid !== folderId && folderNameById.has(fid)) {
            existingOtherFolderIds.add(fid);
          }
        }
      }

      if (existingOtherFolderIds.size > 0) {
        setPendingFolderDrop({
          kind: 'sidebar',
          targetFolderId: folderId,
          targetFolderName: folder.name,
          bookIds: draggedBooks.map((b) => b.id),
          bookTitles: draggedBooks.map((b) => b.title),
          existingFolderNames: Array.from(existingOtherFolderIds)
            .map((id) => folderNameById.get(id))
            .filter((name): name is string => Boolean(name)),
        });
        return;
      }

      await executeDropToSidebarFolder(
        draggedBooks.map((b) => b.id),
        folderId,
        'add'
      );
    },
    [books, folders, executeDropToSidebarFolder]
  );

  const handleRemoveBooksFromSidebarFolder = useCallback(
    async (bookIds: string[], folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      const idSet = new Set(bookIds);
      const descendants = getFolderDescendantIds(folders, folderId);
      const targets = books.filter(
        (b) => idSet.has(b.id) && getBookFolderIds(b).some((fid) => descendants.has(fid))
      );
      if (targets.length === 0) return;

      const updated = targets.map((b) => {
        const current = getBookFolderIds(b);
        const nextIds = current.filter((fid) => !descendants.has(fid));
        return withBookFolderIds(b, nextIds);
      });
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      notify(
        updated.length === 1
          ? `Removed "${updated[0].title}" from "${folder.name}"`
          : `Removed ${updated.length} books from "${folder.name}"`,
        'info'
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

  // Per-View Folders CRUD & Book Assignment
  const handleCreateViewFolder = useCallback(
    async (name: string): Promise<ViewFolderRecord | undefined> => {
      const trimmed = name.trim();
      if (!trimmed) return undefined;
      const folder: ViewFolderRecord = {
        id: makeId('vfolder'),
        viewKey: activeViewKey,
        name: trimmed,
        bookIds: [],
        createdAt: Date.now(),
      };
      await libraryDb.saveViewFolder(folder);
      setViewFolders((prev) => [...prev, folder]);
      notify(`Created folder "${trimmed}" in ${activeViewLabel}`, 'success');
      return folder;
    },
    [activeViewKey, activeViewLabel, notify]
  );

  const handleRenameViewFolder = useCallback(
    async (folderId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const target = viewFolders.find((f) => f.id === folderId);
      if (!target || target.name === trimmed) return;
      const updated: ViewFolderRecord = {...target, name: trimmed};
      await libraryDb.saveViewFolder(updated);
      setViewFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
      notify(`Renamed folder to "${trimmed}"`, 'success');
    },
    [viewFolders, notify]
  );

  const handleDeleteViewFolder = useCallback(
    async (folderId: string) => {
      const target = viewFolders.find((f) => f.id === folderId);
      await libraryDb.deleteViewFolder(folderId);
      setViewFolders((prev) => prev.filter((f) => f.id !== folderId));
      setActiveViewFolderId((curr) => (curr === folderId ? null : curr));
      setAddBooksFolderId((curr) => (curr === folderId ? null : curr));
      notify(
        target ? `Deleted folder "${target.name}" (books kept)` : 'Folder deleted',
        'info'
      );
    },
    [viewFolders, notify]
  );

  const handleSaveViewFolderBooks = useCallback(
    async (folderId: string, nextBookIds: string[]) => {
      const target = viewFolders.find((f) => f.id === folderId);
      if (!target) return;
      const deduped = Array.from(new Set(nextBookIds));
      const updated: ViewFolderRecord = {...target, bookIds: deduped};
      await libraryDb.saveViewFolder(updated);
      setViewFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
      setAddBooksFolderId(null);
      notify(`Updated "${target.name}" (${deduped.length} books)`, 'success');
    },
    [viewFolders, notify]
  );

  const executeDropToViewFolder = useCallback(
    async (bookIds: string[], folderId: string, mode: 'add' | 'move') => {
      const target = viewFolders.find((f) => f.id === folderId);
      if (!target) return;
      const idSet = new Set(bookIds);

      const foldersToSave: ViewFolderRecord[] = [];
      let changedCount = 0;

      const nextViewFolders = viewFolders.map((vf) => {
        if (vf.id === folderId) {
          const existingSet = new Set(vf.bookIds);
          const toAdd = bookIds.filter((id) => !existingSet.has(id));
          if (toAdd.length > 0) {
            changedCount = toAdd.length;
            const updated: ViewFolderRecord = {...vf, bookIds: [...vf.bookIds, ...toAdd]};
            foldersToSave.push(updated);
            return updated;
          }
          return vf;
        }
        if (mode === 'move' && vf.viewKey === target.viewKey) {
          const filtered = vf.bookIds.filter((id) => !idSet.has(id));
          if (filtered.length !== vf.bookIds.length) {
            const updated: ViewFolderRecord = {...vf, bookIds: filtered};
            foldersToSave.push(updated);
            return updated;
          }
        }
        return vf;
      });

      if (foldersToSave.length === 0) return;

      await Promise.all(foldersToSave.map((vf) => libraryDb.saveViewFolder(vf)));
      setViewFolders(nextViewFolders);
      const count = changedCount || bookIds.length;
      const verb = mode === 'add' ? 'Added' : 'Moved';
      notify(
        count === 1
          ? `${verb} book to "${target.name}"`
          : `${verb} ${count} books to "${target.name}"`,
        'success'
      );
    },
    [viewFolders, notify]
  );

  const handleDropBooksToViewFolder = useCallback(
    async (bookIds: string[], folderId: string) => {
      const target = viewFolders.find((f) => f.id === folderId);
      if (!target) return;
      const idSet = new Set(bookIds);
      const draggedBooks = books.filter((b) => idSet.has(b.id));
      if (draggedBooks.length === 0) return;

      const otherFoldersInSameView = viewFolders.filter(
        (vf) =>
          vf.viewKey === target.viewKey &&
          vf.id !== folderId &&
          vf.bookIds.some((bid) => idSet.has(bid))
      );

      if (otherFoldersInSameView.length > 0) {
        setPendingFolderDrop({
          kind: 'view',
          targetFolderId: folderId,
          targetFolderName: target.name,
          bookIds: draggedBooks.map((b) => b.id),
          bookTitles: draggedBooks.map((b) => b.title),
          existingFolderNames: otherFoldersInSameView.map((vf) => vf.name),
        });
        return;
      }

      await executeDropToViewFolder(
        draggedBooks.map((b) => b.id),
        folderId,
        'add'
      );
    },
    [books, viewFolders, executeDropToViewFolder]
  );

  const handleRemoveBooksFromViewFolder = useCallback(
    async (bookIds: string[], folderId: string) => {
      const target = viewFolders.find((f) => f.id === folderId);
      if (!target) return;
      const idSet = new Set(bookIds);
      const removedIds = target.bookIds.filter((id) => idSet.has(id));
      if (removedIds.length === 0) return;

      const updated: ViewFolderRecord = {
        ...target,
        bookIds: target.bookIds.filter((id) => !idSet.has(id)),
      };
      await libraryDb.saveViewFolder(updated);
      setViewFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));

      if (removedIds.length === 1) {
        const bookTitle = books.find((b) => b.id === removedIds[0])?.title;
        notify(
          bookTitle
            ? `Removed "${bookTitle}" from "${target.name}"`
            : `Removed book from "${target.name}"`,
          'info'
        );
      } else {
        notify(`Removed ${removedIds.length} books from "${target.name}"`, 'info');
      }
    },
    [books, viewFolders, notify]
  );

  const handleRemoveBookFromViewFolder = useCallback(
    async (bookId: string, folderId: string) => {
      await handleRemoveBooksFromViewFolder([bookId], folderId);
    },
    [handleRemoveBooksFromViewFolder]
  );

  // Full ZIP Backup Export & Import Handlers
  const handleExportBackup = useCallback(async () => {
    if (isExportingBackup) return;
    setIsExportingBackup(true);
    try {
      const {blob, fileName, bookCount} = await exportLibraryBackupZip(prefs, libraryPrefs);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(
        `Exported backup (${bookCount} ${bookCount === 1 ? 'book' : 'books'})`,
        'success',
        fileName
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Backup export failed';
      notify('Could not export backup', 'error', msg);
    } finally {
      setIsExportingBackup(false);
    }
  }, [isExportingBackup, prefs, libraryPrefs, notify]);

  const handleSelectImportBackupFile = useCallback(
    async (file: File) => {
      if (isParsingBackup) return;
      setIsParsingBackup(true);
      try {
        const parsed = await parseLibraryBackupZip(file);
        setPendingBackup(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid Folio backup ZIP archive';
        notify('Could not read backup archive', 'error', msg);
      } finally {
        setIsParsingBackup(false);
      }
    },
    [isParsingBackup, notify]
  );

  const handleConfirmImportBackup = useCallback(
    async (mode: 'merge' | 'replace') => {
      if (!pendingBackup || isRestoringBackup) return;
      setIsRestoringBackup(true);
      try {
        const stats = await libraryDb.restoreBackup(pendingBackup.snapshot, mode);
        if (mode === 'replace') {
          restorePreferencesFromBackup(
            pendingBackup.readerPreferences,
            pendingBackup.libraryPreferences
          );
          setOpenBookIds([]);
          setReadingBookId(null);
          setActiveFilter({kind: 'smart', id: 'all'});
          setSelectedTags([]);
          setActiveViewFolderId(null);
          setInspectedBookId(null);
        }
        await reloadLibraryData();
        setPendingBackup(null);
        notify(
          mode === 'replace'
            ? `Library replaced with ${stats.booksAdded} ${stats.booksAdded === 1 ? 'book' : 'books'}`
            : `Merged ${stats.booksAdded} ${stats.booksAdded === 1 ? 'book' : 'books'}${
                stats.booksSkipped > 0 ? ` (${stats.booksSkipped} already present)` : ''
              }`,
          'success'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to restore backup';
        notify('Backup import failed', 'error', msg);
      } finally {
        setIsRestoringBackup(false);
      }
    },
    [pendingBackup, isRestoringBackup, restorePreferencesFromBackup, reloadLibraryData, notify]
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
      setViewFolders((prev) =>
        prev.map((vf) =>
          vf.bookIds.includes(bookId)
            ? {...vf, bookIds: vf.bookIds.filter((id) => id !== bookId)}
            : vf
        )
      );
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
          const ids = displayedBooks.map((b) => b.id);
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
    [displayedBooks]
  );

  const handleToggleSelectAllVisible = useCallback(() => {
    const visibleIds = displayedBooks.map((b) => b.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }, [displayedBooks, selectedIds]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    lastSelectedIdRef.current = null;
  }, []);

  // Bulk Edit Studio apply (Per-View Folders + Sidebar Folders + Tags + Metadata + Reading/Favorite)
  const handleApplyBulkEdit = useCallback(
    async (patch: BulkEditPatch) => {
      const targetIdSet = new Set(bulkEditTargetIds ?? []);
      const targetBooks = books.filter((b) => targetIdSet.has(b.id));
      if (targetBooks.length === 0) return;

      const targetIds = targetBooks.map((b) => b.id);

      // 1. Update Per-View Folders
      if (patch.addViewFolderIds.length > 0 || patch.removeViewFolderIds.length > 0) {
        const addVfSet = new Set(patch.addViewFolderIds);
        const removeVfSet = new Set(patch.removeViewFolderIds);
        const foldersToSave: ViewFolderRecord[] = [];
        const nextViewFolders = viewFolders.map((vf) => {
          if (addVfSet.has(vf.id)) {
            const nextBookIds = Array.from(new Set([...vf.bookIds, ...targetIds]));
            const updated: ViewFolderRecord = {...vf, bookIds: nextBookIds};
            foldersToSave.push(updated);
            return updated;
          }
          if (removeVfSet.has(vf.id)) {
            const nextBookIds = vf.bookIds.filter((id) => !targetIdSet.has(id));
            const updated: ViewFolderRecord = {...vf, bookIds: nextBookIds};
            foldersToSave.push(updated);
            return updated;
          }
          return vf;
        });

        if (foldersToSave.length > 0) {
          await Promise.all(foldersToSave.map((vf) => libraryDb.saveViewFolder(vf)));
          setViewFolders(nextViewFolders);
        }
      }

      // 2. Update Book records
      const needsBookUpdate =
        patch.addSidebarFolderIds.length > 0 ||
        patch.removeSidebarFolderIds.length > 0 ||
        patch.addTags.length > 0 ||
        patch.removeTags.length > 0 ||
        patch.author !== undefined ||
        patch.series !== undefined ||
        patch.publisher !== undefined ||
        patch.language !== undefined ||
        patch.categoryAction !== 'keep' ||
        patch.statusAction !== 'keep' ||
        patch.favoriteAction !== 'keep' ||
        patch.resetProgress;

      if (needsBookUpdate) {
        const removeTagLower = new Set(patch.removeTags.map((t) => t.toLowerCase()));
        const removeSidebarSet = new Set(patch.removeSidebarFolderIds);

        const updatedBooks = targetBooks.map((book) => {
          let nextFolderIds = getBookFolderIds(book).filter((id) => !removeSidebarSet.has(id));
          if (patch.addSidebarFolderIds.length > 0) {
            nextFolderIds = [...nextFolderIds, ...patch.addSidebarFolderIds];
          }

          let nextCategoryId = book.categoryId;
          if (patch.categoryAction === 'set') nextCategoryId = patch.categoryId;
          if (patch.categoryAction === 'clear') nextCategoryId = null;

          let nextStatus = book.status;
          let nextProgress = book.progress;
          let nextLocation = book.currentLocation;

          if (patch.resetProgress) {
            nextProgress = 0;
            nextLocation = {unitIndex: book.format === 'pdf' ? 1 : 0, scrollRatio: 0};
            if (patch.statusAction === 'keep') {
              nextStatus = 'unread';
            }
          }

          if (patch.statusAction !== 'keep') {
            nextStatus = patch.statusAction;
            if (nextStatus === 'finished') nextProgress = 100;
            if (nextStatus === 'unread') nextProgress = 0;
            if (nextStatus === 'reading' && nextProgress === 0) nextProgress = 1;
          }

          let nextFavorite = book.isFavorite;
          if (patch.favoriteAction === 'favorite') nextFavorite = true;
          if (patch.favoriteAction === 'unfavorite') nextFavorite = false;

          const nextTags = book.tags.filter((t) => !removeTagLower.has(t.toLowerCase()));
          for (const t of patch.addTags) {
            if (!nextTags.some((e) => e.toLowerCase() === t.toLowerCase())) {
              nextTags.push(t);
            }
          }

          return withBookFolderIds(
            {
              ...book,
              ...(patch.author !== undefined ? {author: patch.author} : {}),
              ...(patch.series !== undefined ? {series: patch.series} : {}),
              ...(patch.publisher !== undefined ? {publisher: patch.publisher} : {}),
              ...(patch.language !== undefined ? {language: patch.language} : {}),
              categoryId: nextCategoryId,
              status: nextStatus,
              progress: nextProgress,
              currentLocation: nextLocation,
              isFavorite: nextFavorite,
              tags: nextTags,
            },
            nextFolderIds
          );
        });

        await libraryDb.updateBooksBatch(updatedBooks);
        const updatedMap = new Map(updatedBooks.map((b) => [b.id, b]));
        setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      }

      setBulkEditTargetIds(null);
      notify(
        targetBooks.length === 1
          ? `Updated "${targetBooks[0].title}"`
          : `Updated ${targetBooks.length} books`,
        'success'
      );
    },
    [books, viewFolders, bulkEditTargetIds, notify]
  );

  // Right-click Context Menu Handlers (single book or full active selection)
  const handleOpenBookContextMenu = useCallback(
    (book: BookRecord, e: React.MouseEvent) => {
      const targetBookIds =
        selectedIds.has(book.id) && selectedIds.size > 1
          ? Array.from(selectedIds)
          : [book.id];
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetBookIds,
        primaryBookId: book.id,
      });
    },
    [selectedIds]
  );

  const handleContextToggleViewFolder = useCallback(
    async (bookIds: string[], folderId: string, add: boolean) => {
      const target = viewFolders.find((vf) => vf.id === folderId);
      if (!target) return;
      const idSet = new Set(bookIds);
      const nextBookIds = add
        ? Array.from(new Set([...target.bookIds, ...bookIds]))
        : target.bookIds.filter((id) => !idSet.has(id));
      const updated: ViewFolderRecord = {...target, bookIds: nextBookIds};
      await libraryDb.saveViewFolder(updated);
      setViewFolders((prev) => prev.map((vf) => (vf.id === folderId ? updated : vf)));
      notify(
        add
          ? bookIds.length === 1
            ? `Added book to "${target.name}"`
            : `Added ${bookIds.length} books to "${target.name}"`
          : bookIds.length === 1
            ? `Removed book from "${target.name}"`
            : `Removed ${bookIds.length} books from "${target.name}"`,
        add ? 'success' : 'info'
      );
    },
    [viewFolders, notify]
  );

  const handleContextToggleSidebarFolder = useCallback(
    async (bookIds: string[], folderId: string, add: boolean) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => idSet.has(b.id));
      if (targets.length === 0) return;

      const updated = targets.map((b) => {
        const current = getBookFolderIds(b);
        const nextIds = add
          ? [...current, folderId]
          : current.filter((fid) => fid !== folderId);
        return withBookFolderIds(b, nextIds);
      });
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      notify(
        add
          ? updated.length === 1
            ? `Added "${updated[0].title}" to "${folder.name}"`
            : `Added ${updated.length} books to "${folder.name}"`
          : updated.length === 1
            ? `Removed "${updated[0].title}" from "${folder.name}"`
            : `Removed ${updated.length} books from "${folder.name}"`,
        add ? 'success' : 'info'
      );
    },
    [books, folders, notify]
  );

  const handleContextCreateViewFolderAndAssign = useCallback(
    async (name: string, bookIds: string[]) => {
      const created = await handleCreateViewFolder(name);
      if (!created || bookIds.length === 0) return;
      const updated: ViewFolderRecord = {
        ...created,
        bookIds: Array.from(new Set(bookIds)),
      };
      await libraryDb.saveViewFolder(updated);
      setViewFolders((prev) => prev.map((vf) => (vf.id === updated.id ? updated : vf)));
    },
    [handleCreateViewFolder]
  );

  const handleContextCreateSidebarFolderAndAssign = useCallback(
    async (name: string, bookIds: string[]) => {
      const created = await handleCreateFolder(name);
      if (!created || bookIds.length === 0) return;
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => idSet.has(b.id));
      if (targets.length === 0) return;
      const updated = targets.map((b) => withBookFolderIds(b, [...getBookFolderIds(b), created.id]));
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
    },
    [handleCreateFolder, books]
  );

  const handleContextSetReadingStatus = useCallback(
    async (bookIds: string[], status: ReadingStatus) => {
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => idSet.has(b.id));
      if (targets.length === 0) return;
      const updated = targets.map((b) => {
        const nextProgress =
          status === 'finished' ? 100 : status === 'unread' ? 0 : Math.max(1, b.progress);
        return {...b, status, progress: nextProgress};
      });
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      const label =
        status === 'finished' ? 'Finished' : status === 'reading' ? 'Currently Reading' : 'Unread';
      notify(
        updated.length === 1
          ? `Marked "${updated[0].title}" as ${label}`
          : `Marked ${updated.length} books as ${label}`,
        'success'
      );
    },
    [books, notify]
  );

  const handleContextSetFavorite = useCallback(
    async (bookIds: string[], favorite: boolean) => {
      const idSet = new Set(bookIds);
      const targets = books.filter((b) => idSet.has(b.id) && b.isFavorite !== favorite);
      if (targets.length === 0) return;
      const updated = targets.map((b) => ({...b, isFavorite: favorite}));
      await libraryDb.updateBooksBatch(updated);
      const updatedMap = new Map(updated.map((b) => [b.id, b]));
      setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      notify(
        favorite
          ? updated.length === 1
            ? `Added "${updated[0].title}" to Favorites`
            : `Added ${updated.length} books to Favorites`
          : updated.length === 1
            ? `Removed "${updated[0].title}" from Favorites`
            : `Removed ${updated.length} books from Favorites`,
        'success'
      );
    },
    [books, notify]
  );

  // Mobile Organize & Move sheet apply (1 or N books)
  const handleApplyMobileOrganize = useCallback(
    async (payload: MobileOrganizePayload) => {
      const bookIdSet = new Set(payload.bookIds);
      if (bookIdSet.size === 0) return;

      // 1. Update per-view folders
      if (payload.addToViewFolderIds.length > 0 || payload.removeFromViewFolderIds.length > 0) {
        const addSet = new Set(payload.addToViewFolderIds);
        const removeSet = new Set(payload.removeFromViewFolderIds);
        const updatedFolders: ViewFolderRecord[] = [];
        const nextViewFolders = viewFolders.map((vf) => {
          if (addSet.has(vf.id)) {
            const nextBookIds = Array.from(new Set([...vf.bookIds, ...payload.bookIds]));
            const updated: ViewFolderRecord = {...vf, bookIds: nextBookIds};
            updatedFolders.push(updated);
            return updated;
          }
          if (removeSet.has(vf.id)) {
            const nextBookIds = vf.bookIds.filter((id) => !bookIdSet.has(id));
            const updated: ViewFolderRecord = {...vf, bookIds: nextBookIds};
            updatedFolders.push(updated);
            return updated;
          }
          return vf;
        });

        await Promise.all(updatedFolders.map((vf) => libraryDb.saveViewFolder(vf)));
        setViewFolders(nextViewFolders);
      }

      // 2. Update books (Sidebar folders, Category, Tags)
      const needsBookUpdate =
        payload.addToSidebarFolderIds.length > 0 ||
        payload.removeFromSidebarFolderIds.length > 0 ||
        payload.categoryChange.mode !== 'keep' ||
        payload.addTags.length > 0 ||
        payload.removeTags.length > 0;

      if (needsBookUpdate) {
        const removeTagLower = new Set(payload.removeTags.map((t) => t.toLowerCase()));
        const removeSidebarSet = new Set(payload.removeFromSidebarFolderIds);
        const targets = books.filter((b) => bookIdSet.has(b.id));
        const updatedBooks = targets.map((book) => {
          let nextFolderIds = getBookFolderIds(book).filter((id) => !removeSidebarSet.has(id));
          if (payload.addToSidebarFolderIds.length > 0) {
            nextFolderIds = [...nextFolderIds, ...payload.addToSidebarFolderIds];
          }

          let nextCategoryId = book.categoryId;
          if (payload.categoryChange.mode === 'set') {
            nextCategoryId = payload.categoryChange.categoryId;
          } else if (payload.categoryChange.mode === 'clear') {
            nextCategoryId = null;
          }

          const nextTags = book.tags.filter((t) => !removeTagLower.has(t.toLowerCase()));
          for (const t of payload.addTags) {
            if (!nextTags.some((e) => e.toLowerCase() === t.toLowerCase())) {
              nextTags.push(t);
            }
          }

          return withBookFolderIds(
            {
              ...book,
              categoryId: nextCategoryId,
              tags: nextTags,
            },
            nextFolderIds
          );
        });

        await libraryDb.updateBooksBatch(updatedBooks);
        const updatedMap = new Map(updatedBooks.map((b) => [b.id, b]));
        setBooks((prev) => prev.map((b) => updatedMap.get(b.id) ?? b));
      }

      if (payload.bookIds.length > 1) {
        handleClearSelection();
      }
      notify(
        payload.bookIds.length === 1
          ? 'Book organization updated'
          : `Organized ${payload.bookIds.length} books`,
        'success'
      );
    },
    [books, viewFolders, handleClearSelection, notify]
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

  // Confirmed Delete (used by both Bulk Delete and Right-Click Context Menu Delete)
  const handleConfirmDeleteBooks = useCallback(async () => {
    const ids = pendingDeleteBookIds ?? [];
    if (ids.length === 0) return;
    await libraryDb.deleteBooks(ids);
    const idSet = new Set(ids);
    setBooks((prev) => prev.filter((b) => !idSet.has(b.id)));
    setViewFolders((prev) =>
      prev.map((vf) =>
        vf.bookIds.some((id) => idSet.has(id))
          ? {...vf, bookIds: vf.bookIds.filter((id) => !idSet.has(id))}
          : vf
      )
    );
    setAllHighlights((prev) => prev.filter((h) => !idSet.has(h.bookId)));
    setAllBookmarks((prev) => prev.filter((bm) => !idSet.has(bm.bookId)));
    setOpenBookIds((prev) => prev.filter((id) => !idSet.has(id)));
    setReadingBookId((curr) => (curr && idSet.has(curr) ? null : curr));
    setInspectedBookId((curr) => (curr && idSet.has(curr) ? null : curr));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      if (next.size === 0) setIsSelectionMode(false);
      return next;
    });
    setPendingDeleteBookIds(null);
    notify(
      ids.length === 1
        ? 'Deleted 1 book from local storage'
        : `Deleted ${ids.length} books from local storage`,
      'info'
    );
  }, [pendingDeleteBookIds, notify]);

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

  const bulkEditTargetBooks = useMemo(() => {
    if (!bulkEditTargetIds || bulkEditTargetIds.length === 0) return [];
    const idSet = new Set(bulkEditTargetIds);
    return books.filter((b) => idSet.has(b.id));
  }, [books, bulkEditTargetIds]);

  const pendingDeleteBookRecords = useMemo(() => {
    if (!pendingDeleteBookIds || pendingDeleteBookIds.length === 0) return [];
    const idSet = new Set(pendingDeleteBookIds);
    return books.filter((b) => idSet.has(b.id));
  }, [books, pendingDeleteBookIds]);

  const quickActionBook = useMemo(
    () => (quickActionBookId ? books.find((b) => b.id === quickActionBookId) ?? null : null),
    [books, quickActionBookId]
  );

  const mobileOrganizeTargetBooks = useMemo(() => {
    if (!mobileOrganizeBookIds || mobileOrganizeBookIds.length === 0) return [];
    const idSet = new Set(mobileOrganizeBookIds);
    return books.filter((b) => idSet.has(b.id));
  }, [books, mobileOrganizeBookIds]);

  const mobileActiveFilterCount =
    (formatFilter !== 'all' ? 1 : 0) +
    (libraryPrefs.groupBy !== 'none' ? 1 : 0) +
    (sortField !== 'addedAt' ? 1 : 0);

  const allVisibleSelected =
    displayedBooks.length > 0 && displayedBooks.every((b) => selectedIds.has(b.id));

  const hasActiveSubFilters =
    searchQuery.trim().length > 0 ||
    formatFilter !== 'all' ||
    selectedTags.length > 0 ||
    activeFilter.kind !== 'smart' ||
    activeFilter.id !== 'all';

  const showContinueReadingShelf =
    !activeDrilledFolder &&
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
    setActiveViewFolderId(null);
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
          sidebarWidth={libraryPrefs.sidebarWidth}
          isExportingBackup={isExportingBackup}
          isParsingBackup={isParsingBackup}
          onSidebarWidthChange={(sidebarWidth) => updateLibraryPrefs({sidebarWidth})}
          onToggleSection={toggleSidebarSection}
          onSelectFilter={(filter) => {
            setActiveFilter(filter);
            setActiveViewFolderId(null);
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
          onExportBackup={() => void handleExportBackup()}
          onSelectImportBackupFile={(file) => void handleSelectImportBackupFile(file)}
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* Main Library Workspace */}
        <div className="flex-1 min-w-0 flex flex-col h-full">
          {/* Mobile Compact Top Header (< lg) */}
          <header
            className={`lg:hidden border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0 ${
              openBookRecords.length === 0 ? 'pt-safe' : ''
            }`}
          >
            <div className="h-[52px] px-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  aria-label="Open navigation drawer"
                  className="min-w-[44px] min-h-[44px] -ml-1.5 flex items-center justify-center rounded-lg text-[var(--text-secondary)] active:bg-[var(--bg-surface-hover)] cursor-pointer shrink-0"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <h1 className="font-serif-editorial text-lg font-semibold text-[var(--text-primary)] truncate">
                  {activeViewHeading.title}
                </h1>
                <span className="font-mono-tabular text-xs text-[var(--text-muted)] shrink-0 ml-0.5">
                  {isHighlightsHubActive ? allHighlights.length : visibleBooks.length}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${prefs.theme === 'sepia' ? 'Dark' : 'Sepia'} theme`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-[var(--text-primary)] active:bg-[var(--bg-surface-hover)] cursor-pointer"
                >
                  {prefs.theme === 'sepia' ? (
                    <Moon className="w-[18px] h-[18px] text-[var(--accent)]" />
                  ) : (
                    <Sun className="w-[18px] h-[18px] text-[var(--accent)]" />
                  )}
                </button>

                {books.length > 0 && !isHighlightsHubActive && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isSelectionMode) {
                        handleClearSelection();
                      } else {
                        setIsSelectionMode(true);
                      }
                    }}
                    className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      isSelectionMode || selectedIds.size > 0
                        ? 'border-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)]'
                    }`}
                  >
                    {isSelectionMode ? 'Done' : 'Select'}
                  </button>
                )}
              </div>
            </div>
          </header>

          {/* Desktop Top Workspace Header (lg+, unchanged) */}
          <header className="hidden lg:flex h-14 px-5 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] items-center justify-between gap-6 shrink-0">
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

          {/* Mobile Compact Search, Filter Sheet & Grid/List Bar (< lg) */}
          {books.length > 0 && !isHighlightsHubActive && (
            <div className="flex lg:hidden px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] items-center gap-2 shrink-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search books, authors..."
                  aria-label="Search library"
                  className="w-full h-10 pl-9 pr-9 text-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-[var(--text-muted)] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setMobileFilterSheetOpen(true)}
                aria-label="Filter and sort options"
                className={`relative min-w-[42px] h-10 px-2.5 rounded-lg border inline-flex items-center justify-center gap-1.5 text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                  mobileActiveFilterCount > 0
                    ? 'border-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                {mobileActiveFilterCount > 0 && (
                  <span className="font-mono-tabular text-[11px] font-semibold">
                    {mobileActiveFilterCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setViewMode((m) => (m === 'grid' ? 'table' : 'grid'))}
                aria-label={viewMode === 'grid' ? 'Switch to compact list view' : 'Switch to grid view'}
                className="min-w-[42px] h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                {viewMode === 'grid' ? (
                  <List className="w-4 h-4" />
                ) : (
                  <LayoutGrid className="w-4 h-4" />
                )}
              </button>
            </div>
          )}

          {/* Desktop Secondary Filter / Search / Group / Display Toolbar (lg+, unchanged) */}
          {books.length > 0 && !isHighlightsHubActive && (
            <div className="hidden lg:flex px-5 lg:px-8 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex-wrap items-center justify-between gap-3 shrink-0">
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
          <main
            ref={libraryMainRef}
            data-folio-vscroll="true"
            onScroll={() => {
              if (contextMenu) setContextMenu(null);
            }}
            className="flex-1 overflow-y-auto flex flex-col relative"
          >
            {/* Scroll-Aware Floating Folder Drop Dock (appears while dragging past top folders) */}
            {!isHydrating && !isHighlightsHubActive && books.length > 0 && (
              <FloatingFolderDropDock
                visible={isDraggingBook && isFoldersOutOfView}
                activeViewLabel={activeViewLabel}
                currentViewFolders={activeDrilledFolder ? [] : currentViewFolders}
                sidebarFolders={folders}
                activeFolderRemovalTarget={
                  activeDrilledFolder
                    ? {kind: 'view', id: activeDrilledFolder.id, name: activeDrilledFolder.name}
                    : activeSidebarFolder
                      ? {
                          kind: 'sidebar',
                          id: activeSidebarFolder.id,
                          name: activeSidebarFolder.name,
                        }
                      : null
                }
                onDropToViewFolder={(bookIds, folderId) =>
                  void handleDropBooksToViewFolder(bookIds, folderId)
                }
                onDropToSidebarFolder={(bookIds, folderId) =>
                  void handleDropBooksToFolder(bookIds, folderId)
                }
                onDropToRemoveFromCurrentFolder={(bookIds) => {
                  if (activeDrilledFolder) {
                    void handleRemoveBooksFromViewFolder(bookIds, activeDrilledFolder.id);
                  } else if (activeSidebarFolder) {
                    void handleRemoveBooksFromSidebarFolder(bookIds, activeSidebarFolder.id);
                  }
                }}
              />
            )}

            {isHydrating ? (
              <div className="flex-1 flex items-center justify-center p-12">
                <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <div className="w-4 h-4 rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)] animate-spin" />
                  <span>Loading offline library...</span>
                </div>
              </div>
            ) : isHighlightsHubActive ? (
              <div className="flex-1 flex flex-col pb-20 lg:pb-0">
                <HighlightsHubView
                  books={books}
                  highlights={allHighlights}
                  onOpenPassage={(book, unitIndex) => void openBookInTab(book.id, unitIndex)}
                  onUpdateHighlight={(updated) => void handleUpdateHighlight(updated)}
                  onDeleteHighlight={(id) => void handleDeleteHighlight(id)}
                  onBackToBooks={() => setActiveFilter({kind: 'smart', id: 'all'})}
                />
              </div>
            ) : books.length === 0 ? (
              <div className="flex-1 flex flex-col pb-20 lg:pb-0">
                <EmptyLibraryDropzone
                  onFilesSelected={(files) => void handleImportFiles(files)}
                  onBrowseClick={() => fileInputRef.current?.click()}
                  isImporting={isImporting}
                />
              </div>
            ) : (
              <div className="p-4 sm:p-5 lg:p-8 pb-28 lg:pb-24 flex-1 flex flex-col">
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

                {/* Drilled-In View Folder Breadcrumb Header OR Sidebar Folder Breadcrumb + Per-View Folders Section */}
                <div ref={foldersSentinelRef}>
                {activeDrilledFolder ? (
                  <div className="mb-6 pb-4 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveViewFolderId(null);
                          setIsRenamingDrilledFolder(false);
                        }}
                        onDragOver={(e) => {
                          if (hasBookDragPayload(e.dataTransfer)) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            setIsBackBreadcrumbDragOver(true);
                          }
                        }}
                        onDragLeave={() => setIsBackBreadcrumbDragOver(false)}
                        onDrop={(e) => {
                          const ids = extractDraggedBookIds(e.dataTransfer);
                          if (ids.length > 0) {
                            e.preventDefault();
                            void handleRemoveBooksFromViewFolder(ids, activeDrilledFolder.id);
                          }
                          setIsBackBreadcrumbDragOver(false);
                          setIsDraggingBook(false);
                        }}
                        title={`Click to go back, or drop a book here to remove it from "${activeDrilledFolder.name}"`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                          isBackBreadcrumbDragOver
                            ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                            : isDraggingBook
                              ? 'border-dashed border-[var(--accent)] bg-[var(--bg-accent-subtle)]/60 text-[var(--accent)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                        }`}
                      >
                        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {isBackBreadcrumbDragOver
                            ? `Drop to remove from "${activeDrilledFolder.name}"`
                            : isDraggingBook
                              ? `Drop here to remove from folder`
                              : `Back to ${activeViewLabel}`}
                        </span>
                      </button>

                      <span className="text-xs text-[var(--text-muted)]">/</span>

                      {isRenamingDrilledFolder ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleRenameViewFolder(activeDrilledFolder.id, drilledRenameDraft);
                            setIsRenamingDrilledFolder(false);
                          }}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            type="text"
                            autoFocus
                            value={drilledRenameDraft}
                            onChange={(e) => setDrilledRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setIsRenamingDrilledFolder(false);
                            }}
                            className="px-2.5 py-1 text-xs rounded border border-[var(--accent)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                          />
                          <button
                            type="submit"
                            aria-label="Save folder title"
                            className="p-1.5 rounded bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsRenamingDrilledFolder(false)}
                            aria-label="Cancel rename"
                            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder className="w-4 h-4 text-[var(--accent)] shrink-0" />
                          <h2 className="font-serif-editorial text-lg font-semibold text-[var(--text-primary)] truncate">
                            {activeDrilledFolder.name}
                          </h2>
                          <span className="font-mono-tabular text-xs text-[var(--text-muted)] shrink-0">
                            {displayedBooks.length}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setAddBooksFolderId(activeDrilledFolder.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Books</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDrilledRenameDraft(activeDrilledFolder.name);
                          setIsRenamingDrilledFolder(true);
                        }}
                        title="Rename folder"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Rename</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteViewFolder(activeDrilledFolder.id)}
                        title="Delete folder (books remain in library)"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--danger)] hover:border-[var(--danger)]/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Delete</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Active Sidebar Folder Back Breadcrumb (supports drag-to-remove single book) */}
                    {activeSidebarFolder && (
                      <div className="mb-6 pb-4 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (activeSidebarParentFolder) {
                                setActiveFilter({kind: 'folder', id: activeSidebarParentFolder.id});
                              } else {
                                setActiveFilter({kind: 'smart', id: 'all'});
                              }
                            }}
                            onDragOver={(e) => {
                              if (hasBookDragPayload(e.dataTransfer)) {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                setIsBackBreadcrumbDragOver(true);
                              }
                            }}
                            onDragLeave={() => setIsBackBreadcrumbDragOver(false)}
                            onDrop={(e) => {
                              const ids = extractDraggedBookIds(e.dataTransfer);
                              if (ids.length > 0) {
                                e.preventDefault();
                                void handleRemoveBooksFromSidebarFolder(ids, activeSidebarFolder.id);
                              }
                              setIsBackBreadcrumbDragOver(false);
                              setIsDraggingBook(false);
                            }}
                            title={`Click to go back, or drop a book here to remove it from "${activeSidebarFolder.name}"`}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                              isBackBreadcrumbDragOver
                                ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                                : isDraggingBook
                                  ? 'border-dashed border-[var(--accent)] bg-[var(--bg-accent-subtle)]/60 text-[var(--accent)]'
                                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                            }`}
                          >
                            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {isBackBreadcrumbDragOver
                                ? `Drop to remove from "${activeSidebarFolder.name}"`
                                : isDraggingBook
                                  ? `Drop here to remove from folder`
                                  : activeSidebarParentFolder
                                    ? `Back to ${activeSidebarParentFolder.name}`
                                    : 'Back to All Books'}
                            </span>
                          </button>

                          <span className="text-xs text-[var(--text-muted)]">/</span>

                          <div className="flex items-center gap-2 min-w-0">
                            <Folder
                              className="w-4 h-4 shrink-0"
                              style={{
                                color:
                                  getFolderColorHex(activeSidebarFolder.color) ?? 'var(--accent)',
                              }}
                            />
                            <h2 className="font-serif-editorial text-lg font-semibold text-[var(--text-primary)] truncate">
                              {activeSidebarFolder.name}
                            </h2>
                            <span className="font-mono-tabular text-xs text-[var(--text-muted)] shrink-0">
                              {visibleBooks.length}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <ViewFoldersSection
                      viewLabel={activeViewLabel}
                      viewFolders={currentViewFolders}
                      viewBooks={visibleBooks}
                      displayMode={viewFolderDisplayMode}
                      cardLayout={viewFolderCardLayout}
                      hideFiledBooks={hideFiledBooksInView}
                      filedBooksCount={filedBookIdsInView.size}
                      coverSize={libraryPrefs.coverSize}
                      inspectorOpen={libraryPrefs.inspectorOpen}
                      inspectedBookId={inspectedBook?.id ?? null}
                      onDisplayModeChange={(mode) => setViewFolderDisplay(activeViewKey, mode)}
                      onCardLayoutChange={(layout) => setViewFolderCardLayout(activeViewKey, layout)}
                      onToggleHideFiled={() =>
                        setHideFiledBooks(activeViewKey, !hideFiledBooksInView)
                      }
                      onCreateFolder={(name) => void handleCreateViewFolder(name)}
                      onRenameFolder={(folderId, name) =>
                        void handleRenameViewFolder(folderId, name)
                      }
                      onDeleteFolder={(folderId) => void handleDeleteViewFolder(folderId)}
                      onOpenFolder={(folderId) => {
                        setActiveViewFolderId(folderId);
                        setSelectedIds(new Set());
                      }}
                      onRequestAddBooks={(folder) => setAddBooksFolderId(folder.id)}
                      onDropBooksToViewFolder={(bookIds, folderId) =>
                        void handleDropBooksToViewFolder(bookIds, folderId)
                      }
                      onRemoveBookFromViewFolder={(bookId, folderId) =>
                        void handleRemoveBookFromViewFolder(bookId, folderId)
                      }
                      onOpenBook={(book) => void openBookInTab(book.id)}
                      onInspectBook={handleInspectBook}
                    />
                  </>
                )}
                </div>

                {/* Main Catalog Area (Ungrouped Books or Drilled-In Folder Books) */}
                {activeDrilledFolder && displayedBooks.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
                    <Folder className="w-8 h-8 text-[var(--text-muted)] mb-3" />
                    <p className="font-serif-editorial text-lg font-medium text-[var(--text-primary)]">
                      {searchQuery.trim()
                        ? 'No matching books in this folder'
                        : `"${activeDrilledFolder.name}" is empty`}
                    </p>
                    <p className="mt-1.5 text-xs text-[var(--text-secondary)] max-w-sm">
                      {searchQuery.trim()
                        ? 'Try clearing your search or format filter to see all books in this folder.'
                        : 'Add books from this view into this folder to organize your shelf.'}
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAddBooksFolderId(activeDrilledFolder.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Books</span>
                      </button>
                      {searchQuery.trim() && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="px-4 py-2 text-xs font-medium rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
                        >
                          Clear Search
                        </button>
                      )}
                    </div>
                  </div>
                ) : visibleBooks.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
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
                ) : displayedBooks.length === 0 && hideFiledBooksInView && filedBookIdsInView.size > 0 ? (
                  <div className="py-10 px-6 rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 text-center">
                    <p className="text-xs text-[var(--text-secondary)]">
                      All {filedBookIdsInView.size}{' '}
                      {filedBookIdsInView.size === 1 ? 'book' : 'books'} in {activeViewLabel} are
                      organized inside folders above.
                    </p>
                    <button
                      type="button"
                      onClick={() => setHideFiledBooks(activeViewKey, false)}
                      className="mt-2.5 text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      Show filed books below
                    </button>
                  </div>
                ) : (
                  <div className="space-y-9">
                    {!activeDrilledFolder && currentViewFolders.length > 0 && (
                      <div className="flex items-center justify-between -mb-5">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                          {hideFiledBooksInView && filedBookIdsInView.size > 0
                            ? 'Ungrouped Books'
                            : 'All Books in View'}{' '}
                          <span className="font-mono-tabular font-normal">
                            ({displayedBooks.length})
                          </span>
                        </h3>
                      </div>
                    )}
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
                                onQuickAction={(book) => setQuickActionBookId(book.id)}
                                onContextMenuBook={handleOpenBookContextMenu}
                                onRemoveFromFolder={
                                  activeDrilledFolder
                                    ? (book) =>
                                        void handleRemoveBookFromViewFolder(
                                          book.id,
                                          activeDrilledFolder.id
                                        )
                                    : undefined
                                }
                              />
                            ) : (
                              <>
                                <div className="md:hidden">
                                  <MobileBookList
                                    books={group.books}
                                    categories={categories}
                                    selectedIds={selectedIds}
                                    isSelectionMode={isSelectionMode}
                                    onOpenBook={(book) => void openBookInTab(book.id)}
                                    onQuickAction={(book) => setQuickActionBookId(book.id)}
                                    onToggleSelect={handleToggleSelect}
                                  />
                                </div>
                                <div className="hidden md:block">
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
                                    onContextMenuBook={handleOpenBookContextMenu}
                                  />
                                </div>
                              </>
                            ))}
                        </section>
                      );
                    })}
                  </div>
                )}
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

      {/* Floating Bulk Selection Bar (Desktop) & Thumb-Zone Bottom Bar (Mobile) */}
      {!isHighlightsHubActive && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalVisibleCount={displayedBooks.length}
          onSelectAll={() => setSelectedIds(new Set(displayedBooks.map((b) => b.id)))}
          onClearSelection={handleClearSelection}
          onBulkEdit={() => setBulkEditTargetIds(Array.from(selectedIds))}
          onMobileOrganize={() => setMobileOrganizeBookIds(Array.from(selectedIds))}
          onBulkFavorite={() => void handleBulkFavorite()}
          onBulkDelete={() => setPendingDeleteBookIds(Array.from(selectedIds))}
        />
      )}

      {/* Mobile Primary Bottom Tab Bar (< lg) */}
      <MobileBottomNav
        activeFilter={activeFilter}
        selectedTagsCount={selectedTags.length}
        isDrawerOpen={mobileSidebarOpen}
        isSelectionActive={isSelectionMode || selectedIds.size > 0}
        isImporting={isImporting}
        onSelectLibrary={() => {
          setActiveFilter({kind: 'smart', id: 'all'});
          setSelectedTags([]);
          setActiveViewFolderId(null);
          setMobileSidebarOpen(false);
        }}
        onSelectReading={() => {
          setActiveFilter({kind: 'smart', id: 'reading'});
          setActiveViewFolderId(null);
          setMobileSidebarOpen(false);
        }}
        onSelectHighlights={() => {
          setActiveFilter({kind: 'smart', id: 'highlights'});
          setActiveViewFolderId(null);
          setMobileSidebarOpen(false);
        }}
        onOpenBrowseDrawer={() => setMobileSidebarOpen(true)}
        onImportBooks={() => fileInputRef.current?.click()}
      />

      {/* Mobile Filter, Sort & Display Bottom Sheet */}
      <MobileFilterSortSheet
        isOpen={mobileFilterSheetOpen}
        formatFilter={formatFilter}
        groupBy={libraryPrefs.groupBy}
        sortField={sortField}
        sortDirection={sortDirection}
        coverSize={libraryPrefs.coverSize}
        cardDetails={libraryPrefs.cardDetails}
        hasViewFolders={currentViewFolders.length > 0 && !activeDrilledFolder}
        hideFiledBooks={hideFiledBooksInView}
        hasActiveFilters={mobileActiveFilterCount > 0}
        onFormatChange={setFormatFilter}
        onGroupByChange={(groupBy) => {
          updateLibraryPrefs({groupBy});
          setCollapsedGroups(new Set());
        }}
        onSortFieldChange={(next) => {
          setSortField(next);
          setSortDirection(next === 'title' || next === 'author' ? 'asc' : 'desc');
        }}
        onToggleSortDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        onCoverSizeChange={(coverSize) => updateLibraryPrefs({coverSize})}
        onCardDetailsChange={updateCardDetails}
        onToggleHideFiled={() => setHideFiledBooks(activeViewKey, !hideFiledBooksInView)}
        onResetFilters={() => {
          setFormatFilter('all');
          updateLibraryPrefs({groupBy: 'none'});
          setSortField('addedAt');
          setSortDirection('desc');
          setCollapsedGroups(new Set());
        }}
        onClose={() => setMobileFilterSheetOpen(false)}
      />

      {/* Mobile Per-Book Quick Action Sheet */}
      <MobileBookActionSheet
        book={quickActionBook}
        activeDrilledFolderName={activeDrilledFolder?.name ?? activeSidebarFolder?.name ?? null}
        onClose={() => setQuickActionBookId(null)}
        onReadBook={(book) => void openBookInTab(book.id)}
        onInspectBook={handleInspectBook}
        onOrganizeBook={(book) => setMobileOrganizeBookIds([book.id])}
        onToggleFavorite={(book) => void handleToggleFavorite(book)}
        onEditMetadata={(book) => setEditingBookId(book.id)}
        onSelectBook={(book) => {
          setIsSelectionMode(true);
          handleToggleSelect(book.id, false);
        }}
        onRemoveFromViewFolder={
          activeDrilledFolder
            ? (book) => void handleRemoveBookFromViewFolder(book.id, activeDrilledFolder.id)
            : activeSidebarFolder
              ? (book) => void handleRemoveBooksFromSidebarFolder([book.id], activeSidebarFolder.id)
              : undefined
        }
        onDeleteBook={(id) => void handleDeleteSingleBook(id)}
      />

      {/* Responsive Organize Drawer (Desktop right slide-in / Mobile bottom sheet) */}
      <MobileOrganizeSheet
        isOpen={mobileOrganizeTargetBooks.length > 0}
        targetBooks={mobileOrganizeTargetBooks}
        activeViewLabel={activeViewLabel}
        currentViewFolders={currentViewFolders}
        sidebarFolders={folders}
        categories={categories}
        existingTags={existingTagNames}
        onCreateViewFolder={handleCreateViewFolder}
        onCreateSidebarFolder={(name) => handleCreateFolder(name)}
        onApply={handleApplyMobileOrganize}
        onClose={() => setMobileOrganizeBookIds(null)}
      />

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

      {/* Redesigned Two-Column Bulk Edit Studio Modal */}
      {bulkEditTargetBooks.length > 0 && (
        <BulkEditModal
          selectedBooks={bulkEditTargetBooks}
          activeViewLabel={activeViewLabel}
          currentViewFolders={currentViewFolders}
          folders={folders}
          categories={categories}
          existingTags={existingTagNames}
          onCreateViewFolder={handleCreateViewFolder}
          onCreateFolder={(name) => handleCreateFolder(name)}
          onApply={(patch) => void handleApplyBulkEdit(patch)}
          onClose={() => setBulkEditTargetIds(null)}
        />
      )}

      {/* Delete Confirmation Modal (Bulk & Context Menu) */}
      {pendingDeleteBookRecords.length > 0 && (
        <ConfirmDeleteModal
          booksToDelete={pendingDeleteBookRecords}
          onConfirm={() => void handleConfirmDeleteBooks()}
          onClose={() => setPendingDeleteBookIds(null)}
        />
      )}

      {/* Add Books to View Folder Modal */}
      {addBooksTargetFolder && (
        <AddBooksToFolderModal
          folder={addBooksTargetFolder}
          availableBooks={visibleBooks}
          onSave={(folderId, nextBookIds) => void handleSaveViewFolderBooks(folderId, nextBookIds)}
          onClose={() => setAddBooksFolderId(null)}
        />
      )}

      {/* Import Full ZIP Backup Modal */}
      {pendingBackup && (
        <ImportBackupModal
          backup={pendingBackup}
          existingBooksCount={books.length}
          isRestoring={isRestoringBackup}
          onConfirm={(mode) => void handleConfirmImportBackup(mode)}
          onCancel={() => {
            if (!isRestoringBackup) setPendingBackup(null);
          }}
        />
      )}

      {/* Folder Drag-and-Drop Add vs. Move Confirmation Modal */}
      <FolderDropActionModal
        pendingDrop={pendingFolderDrop}
        onAdd={() => {
          if (!pendingFolderDrop) return;
          const drop = pendingFolderDrop;
          setPendingFolderDrop(null);
          if (drop.kind === 'sidebar') {
            void executeDropToSidebarFolder(drop.bookIds, drop.targetFolderId, 'add');
          } else {
            void executeDropToViewFolder(drop.bookIds, drop.targetFolderId, 'add');
          }
        }}
        onMove={() => {
          if (!pendingFolderDrop) return;
          const drop = pendingFolderDrop;
          setPendingFolderDrop(null);
          if (drop.kind === 'sidebar') {
            void executeDropToSidebarFolder(drop.bookIds, drop.targetFolderId, 'move');
          } else {
            void executeDropToViewFolder(drop.bookIds, drop.targetFolderId, 'move');
          }
        }}
        onCancel={() => setPendingFolderDrop(null)}
      />

      {/* Right-Click Context Menu for Book Cards & Table Rows */}
      <BookContextMenu
        menuState={contextMenu}
        books={books}
        activeViewLabel={activeViewLabel}
        currentViewFolders={currentViewFolders}
        sidebarFolders={folders}
        activeFolderRemovalName={activeDrilledFolder?.name ?? activeSidebarFolder?.name ?? null}
        selectedIds={selectedIds}
        onClose={() => setContextMenu(null)}
        onOpenBook={(book) => void openBookInTab(book.id)}
        onInspectBook={handleInspectBook}
        onEditMetadata={(book) => setEditingBookId(book.id)}
        onBulkEditBooks={(bookIds) => setBulkEditTargetIds(bookIds)}
        onOrganizeBooks={(bookIds) => setMobileOrganizeBookIds(bookIds)}
        onToggleViewFolderMembership={(bookIds, folderId, add) =>
          void handleContextToggleViewFolder(bookIds, folderId, add)
        }
        onToggleSidebarFolderMembership={(bookIds, folderId, add) =>
          void handleContextToggleSidebarFolder(bookIds, folderId, add)
        }
        onCreateViewFolderAndAssign={handleContextCreateViewFolderAndAssign}
        onCreateSidebarFolderAndAssign={handleContextCreateSidebarFolderAndAssign}
        onRemoveFromCurrentFolder={
          activeDrilledFolder
            ? (bookIds) => void handleRemoveBooksFromViewFolder(bookIds, activeDrilledFolder.id)
            : activeSidebarFolder
              ? (bookIds) =>
                  void handleRemoveBooksFromSidebarFolder(bookIds, activeSidebarFolder.id)
              : undefined
        }
        onSetReadingStatus={(bookIds, status) =>
          void handleContextSetReadingStatus(bookIds, status)
        }
        onSetFavorite={(bookIds, favorite) => void handleContextSetFavorite(bookIds, favorite)}
        onToggleSelectBook={(bookId) => handleToggleSelect(bookId, false)}
        onClearSelection={handleClearSelection}
        onRequestDeleteBooks={(bookIds) => setPendingDeleteBookIds(bookIds)}
      />

      <OfflineIndicator />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
