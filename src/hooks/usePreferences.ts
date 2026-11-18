import {useCallback, useEffect, useState} from 'react';
import type {
  CardDetailOptions,
  LibraryPreferences,
  ReaderPreferences,
  SidebarSectionKey,
  ThemeMode,
} from '../types/library';

const PREFS_STORAGE_KEY = 'folio_reader_preferences_v1';
const LIBRARY_PREFS_STORAGE_KEY = 'folio_library_preferences_v1';

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  theme: 'sepia',
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.7,
  pageWidth: 700,
  readingLayout: 'scroll',
  textAlign: 'left',
  paragraphSpacing: 1.1,
  textIndent: 0,
  pdfZoom: 1.15,
  pdfFitMode: 'width',
  pdfLayout: 'continuous',
  pdfThemeTone: true,
  autoHideChrome: true,
  pinHeader: false,
  pinBottomBar: false,
  pinLeftSidebar: false,
};

export const DEFAULT_LIBRARY_PREFERENCES: LibraryPreferences = {
  coverSize: 'standard',
  groupBy: 'none',
  cardDetails: {
    author: true,
    format: true,
    category: true,
    progress: true,
    tags: false,
  },
  inspectorOpen: false,
  collapsedSidebarSections: {
    library: false,
    folders: false,
    categories: false,
    tags: false,
  },
};

function loadPreferences(): ReaderPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      theme: parsed.theme === 'dark' ? 'dark' : 'sepia',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function loadLibraryPreferences(): LibraryPreferences {
  try {
    const raw = localStorage.getItem(LIBRARY_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_LIBRARY_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<LibraryPreferences>;
    return {
      ...DEFAULT_LIBRARY_PREFERENCES,
      ...parsed,
      cardDetails: {
        ...DEFAULT_LIBRARY_PREFERENCES.cardDetails,
        ...(parsed.cardDetails ?? {}),
      },
      collapsedSidebarSections: {
        ...DEFAULT_LIBRARY_PREFERENCES.collapsedSidebarSections,
        ...(parsed.collapsedSidebarSections ?? {}),
      },
    };
  } catch {
    return DEFAULT_LIBRARY_PREFERENCES;
  }
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<ReaderPreferences>(loadPreferences);
  const [libraryPrefs, setLibraryPrefs] = useState<LibraryPreferences>(loadLibraryPreferences);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('theme-sepia');
    } else {
      root.classList.remove('dark');
      root.classList.add('theme-sepia');
    }

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', prefs.theme === 'dark' ? '#121110' : '#F4EFE6');
    }

    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage quota issues for preferences
    }
  }, [prefs]);

  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_PREFS_STORAGE_KEY, JSON.stringify(libraryPrefs));
    } catch {
      // Ignore storage quota issues
    }
  }, [libraryPrefs]);

  const updatePreferences = useCallback((patch: Partial<ReaderPreferences>) => {
    setPrefs((prev) => ({...prev, ...patch}));
  }, []);

  const updateLibraryPrefs = useCallback((patch: Partial<LibraryPreferences>) => {
    setLibraryPrefs((prev) => ({...prev, ...patch}));
  }, []);

  const updateCardDetails = useCallback((patch: Partial<CardDetailOptions>) => {
    setLibraryPrefs((prev) => ({
      ...prev,
      cardDetails: {...prev.cardDetails, ...patch},
    }));
  }, []);

  const toggleSidebarSection = useCallback((section: SidebarSectionKey) => {
    setLibraryPrefs((prev) => ({
      ...prev,
      collapsedSidebarSections: {
        ...prev.collapsedSidebarSections,
        [section]: !prev.collapsedSidebarSections[section],
      },
    }));
  }, []);

  const toggleTheme = useCallback(() => {
    setPrefs((prev) => ({
      ...prev,
      theme: prev.theme === 'sepia' ? 'dark' : 'sepia',
    }));
  }, []);

  const setTheme = useCallback((theme: ThemeMode) => {
    setPrefs((prev) => ({...prev, theme}));
  }, []);

  const resetTypography = useCallback(() => {
    setPrefs((prev) => ({
      ...DEFAULT_PREFERENCES,
      theme: prev.theme,
      pinHeader: prev.pinHeader,
      pinBottomBar: prev.pinBottomBar,
      pinLeftSidebar: prev.pinLeftSidebar,
    }));
  }, []);

  return {
    prefs,
    libraryPrefs,
    updatePreferences,
    updateLibraryPrefs,
    updateCardDetails,
    toggleSidebarSection,
    toggleTheme,
    setTheme,
    resetTypography,
  };
}
