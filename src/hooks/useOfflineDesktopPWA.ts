import {useCallback, useEffect, useRef} from 'react';
import {PWA_OFFLINE_READY_EVENT, PWA_UPDATED_EVENT} from '../main';

interface LaunchParamsLike {
  files?: ReadonlyArray<{
    kind?: 'file' | 'directory';
    name?: string;
    getFile?: () => Promise<File>;
  }>;
}

interface LaunchQueueLike {
  setConsumer: (consumer: (launchParams: LaunchParamsLike) => void | Promise<void>) => void;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueueLike;
  }
}

const SUPPORTED_EXT_RE = /\.(epub|pdf|mobi|prc)$/i;
const OFFLINE_READY_TOAST_KEY = 'folio_offline_ready_notified_v1';

export async function requestPersistentLocalStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return false;
    if (typeof navigator.storage.persisted === 'function') {
      const alreadyPersisted = await navigator.storage.persisted();
      if (alreadyPersisted) return true;
    }
    if (typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
  } catch {
    // Non-fatal on browsers without Storage Manager API support
  }
  return false;
}

interface UseOfflineDesktopPWAOptions {
  isHydrating: boolean;
  onFilesLaunchedFromOS: (files: File[]) => void | Promise<void>;
  onNotify: (title: string, tone?: 'info' | 'success' | 'error', detail?: string) => void;
}

export function useOfflineDesktopPWA({
  isHydrating,
  onFilesLaunchedFromOS,
  onNotify,
}: UseOfflineDesktopPWAOptions) {
  const pendingLaunchFilesRef = useRef<File[]>([]);
  const onFilesLaunchedRef = useRef(onFilesLaunchedFromOS);
  onFilesLaunchedRef.current = onFilesLaunchedFromOS;

  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  // 1. Request persistent storage automatically so desktop browsers never evict IndexedDB books
  useEffect(() => {
    void requestPersistentLocalStorage();
    const onAppInstalled = () => {
      void requestPersistentLocalStorage();
    };
    window.addEventListener('appinstalled', onAppInstalled);
    return () => window.removeEventListener('appinstalled', onAppInstalled);
  }, []);

  // 2. Listen for Service Worker offline-ready and background-update lifecycle notices
  useEffect(() => {
    const handleOfflineReady = () => {
      try {
        if (localStorage.getItem(OFFLINE_READY_TOAST_KEY) === '1') return;
        localStorage.setItem(OFFLINE_READY_TOAST_KEY, '1');
      } catch {
        // ignore storage restrictions
      }
      onNotifyRef.current(
        'Folio is cached for offline use',
        'success',
        'You can now launch and read your library without internet.'
      );
    };

    const handlePwaUpdated = () => {
      onNotifyRef.current(
        'Folio updated in the background',
        'info',
        'Restart or reload whenever convenient to use the latest version.'
      );
    };

    window.addEventListener(PWA_OFFLINE_READY_EVENT, handleOfflineReady);
    window.addEventListener(PWA_UPDATED_EVENT, handlePwaUpdated);
    return () => {
      window.removeEventListener(PWA_OFFLINE_READY_EVENT, handleOfflineReady);
      window.removeEventListener(PWA_UPDATED_EVENT, handlePwaUpdated);
    };
  }, []);

  // 3. Register desktop OS "Open With Folio" Launch Queue consumer for .epub, .pdf, .mobi
  useEffect(() => {
    if (typeof window === 'undefined' || !window.launchQueue?.setConsumer) return;

    window.launchQueue.setConsumer(async (launchParams) => {
      const handles = launchParams?.files;
      if (!handles || handles.length === 0) return;

      const resolvedFiles: File[] = [];
      for (const handle of handles) {
        if (typeof handle?.getFile !== 'function') continue;
        try {
          const file = await handle.getFile();
          if (SUPPORTED_EXT_RE.test(file.name)) {
            resolvedFiles.push(file);
          }
        } catch {
          // Ignore unreadable handle
        }
      }

      if (resolvedFiles.length === 0) {
        onNotifyRef.current(
          'Unsupported file format',
          'error',
          'Folio opens EPUB, PDF, and MOBI e-book files.'
        );
        return;
      }

      if (pendingLaunchFilesRef.current.length > 0) {
        pendingLaunchFilesRef.current.push(...resolvedFiles);
      } else {
        pendingLaunchFilesRef.current = resolvedFiles;
      }

      // If hydration already finished, process immediately
      if (!isHydratingRef.current) {
        const batch = pendingLaunchFilesRef.current;
        pendingLaunchFilesRef.current = [];
        void onFilesLaunchedRef.current(batch);
      }
    });
  }, []);

  const isHydratingRef = useRef(isHydrating);
  isHydratingRef.current = isHydrating;

  // Drain any OS-launched files once IndexedDB library hydration finishes
  const flushPendingLaunches = useCallback(() => {
    if (isHydrating || pendingLaunchFilesRef.current.length === 0) return;
    const batch = pendingLaunchFilesRef.current;
    pendingLaunchFilesRef.current = [];
    void onFilesLaunchedRef.current(batch);
  }, [isHydrating]);

  useEffect(() => {
    flushPendingLaunches();
  }, [flushPendingLaunches]);
}
