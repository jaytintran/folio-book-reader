export type BookFormat = 'pdf' | 'epub' | 'mobi';

export type ReadingStatus = 'unread' | 'reading' | 'finished';

export type ThemeMode = 'sepia' | 'dark';

export type HighlightColor = 'amber' | 'sage' | 'sky' | 'rose';

export type CoverStyle = 'editorial' | 'minimal' | 'framed' | 'swiss';

export type FolderColor = 'neutral' | 'sienna' | 'sage' | 'slate' | 'ochre' | 'plum';

export type CoverSize = 'compact' | 'standard' | 'large';

export type GroupByField = 'none' | 'author' | 'series' | 'status' | 'format';

export type SidebarSectionKey = 'library' | 'folders' | 'categories' | 'tags';

export type ViewFolderDisplayMode = 'card' | 'carousel';

export type ViewFolderCardLayout = 'stacked' | 'auto' | '2x2' | '3x3' | '4x4';

export interface CardDetailOptions {
  subtitle: boolean;
  author: boolean;
  format: boolean;
  category: boolean;
  progress: boolean;
  tags: boolean;
}

export interface LibraryPreferences {
  coverSize: CoverSize;
  groupBy: GroupByField;
  cardDetails: CardDetailOptions;
  inspectorOpen: boolean;
  collapsedSidebarSections: Record<SidebarSectionKey, boolean>;
  sidebarWidth: number;
  viewFolderDisplayByView: Record<string, ViewFolderDisplayMode>;
  viewFolderCardLayoutByView: Record<string, ViewFolderCardLayout>;
  hideFiledBooksByView: Record<string, boolean>;
}

export type LibraryViewMode = 'grid' | 'table';

export type SmartView =
  | 'all'
  | 'reading'
  | 'unread'
  | 'finished'
  | 'favorites'
  | 'highlights';

export type SortField =
  | 'recent'
  | 'addedAt'
  | 'title'
  | 'author'
  | 'progress'
  | 'format';

export type SortDirection = 'asc' | 'desc';

export interface BookLocation {
  /** 0-based chapter index for EPUB/MOBI, or 1-based page number for PDF */
  unitIndex: number;
  /** 0..1 scroll ratio within chapter/page */
  scrollRatio: number;
  /** Human-readable chapter or page label */
  label?: string;
}

export interface BookRecord {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  format: BookFormat;
  fileName: string;
  fileSize: number;
  addedAt: number;
  lastReadAt: number | null;
  categoryId: string | null;
  folderId: string | null;
  folderIds?: string[];
  tags: string[];
  series: string;
  publisher: string;
  year: string;
  language: string;
  description: string;
  isFavorite: boolean;
  coverDataUrl: string | null;
  coverPaletteIndex: number;
  coverStyle?: CoverStyle;
  progress: number; // 0..100
  status: ReadingStatus;
  totalUnits: number; // chapters or pages
  currentLocation: BookLocation;
}

export interface BookFileBlob {
  bookId: string;
  data: ArrayBuffer;
  mimeType: string;
}

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  color?: FolderColor;
  createdAt: number;
}

export interface ViewFolderRecord {
  id: string;
  viewKey: string;
  name: string;
  bookIds: string[];
  createdAt: number;
}

export interface CategoryRecord {
  id: string;
  name: string;
  createdAt: number;
}

export interface BookmarkRecord {
  id: string;
  bookId: string;
  unitIndex: number;
  scrollRatio: number;
  label: string;
  excerpt: string;
  createdAt: number;
}

export interface HighlightRecord {
  id: string;
  bookId: string;
  unitIndex: number;
  selectedText: string;
  prefixContext: string;
  suffixContext: string;
  color: HighlightColor;
  note: string;
  createdAt: number;
}

export interface ReaderPreferences {
  theme: ThemeMode;
  fontFamily: 'serif' | 'sans' | 'mono';
  fontSize: number; // px, 14..26
  lineHeight: number; // 1.35..2.1
  pageWidth: number; // px, 580..920
  readingLayout: 'scroll' | 'page' | 'spread';
  textAlign: 'left' | 'justify';
  paragraphSpacing: number; // em, 0.3..1.8
  textIndent: number; // em, 0..2.2
  pdfZoom: number; // 0.6..2.2
  pdfFitMode: 'width' | 'manual';
  pdfLayout: 'continuous' | 'single';
  pdfThemeTone: boolean; // apply sepia/dark tone filter to PDF pages
  autoHideChrome: boolean;
  pinHeader: boolean;
  pinBottomBar: boolean;
  pinLeftSidebar: boolean;
}

export interface SearchMatch {
  id: string;
  unitIndex: number;
  unitLabel: string;
  snippetBefore: string;
  matchText: string;
  snippetAfter: string;
  occurrenceInUnit: number;
}

export interface ParsedTocItem {
  id: string;
  title: string;
  unitIndex: number;
  depth: number;
  href?: string;
  anchorId?: string;
}

export interface ParsedChapter {
  index: number;
  title: string;
  html: string;
  spinePath?: string;
}

export interface ParsedReflowableBook {
  chapters: ParsedChapter[];
  toc: ParsedTocItem[];
  cleanupUrls: string[];
}

export interface ImportMetadataResult {
  title: string;
  author: string;
  publisher: string;
  year: string;
  language: string;
  description: string;
  coverDataUrl: string | null;
  totalUnits: number;
  format: BookFormat;
}

export interface ToastMessage {
  id: string;
  title: string;
  detail?: string;
  tone: 'info' | 'success' | 'error';
}

export type NarratorTone = 'calm' | 'storyteller' | 'crisp';

export type SleepTimerMode = 'off' | '15m' | '30m' | '45m' | 'chapter';

export interface BookVoiceOverride {
  deviceVoiceUri: string | null;
  tone: NarratorTone;
  rate: number; // 0.7 .. 2.5
}

export interface VoicePreferences extends BookVoiceOverride {
  skipNoise: boolean;
  tapToRead: boolean;
  perBookOverrides: Record<string, BookVoiceOverride>;
}

