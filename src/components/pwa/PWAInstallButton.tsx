import {Download, X} from 'lucide-react';
import React, {useState} from 'react';
import {usePWAInstall} from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
        <span>{isIOS ? 'Install on iOS' : 'Install Desktop App'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-serif-editorial text-lg font-semibold text-[var(--text-primary)]">
                {isIOS ? 'Install Folio on iOS' : 'Install Folio as Desktop App'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2 text-sm text-[var(--text-secondary)] list-decimal list-inside">
                <li>
                  Tap the <strong className="text-[var(--text-primary)]">Share</strong> button in
                  Safari&apos;s toolbar.
                </li>
                <li>
                  Scroll down and tap{' '}
                  <strong className="text-[var(--text-primary)]">Add to Home Screen</strong>.
                </li>
                <li>Launch Folio offline anytime directly from your home screen.</li>
              </ol>
            ) : (
              <div className="mt-4 space-y-2.5 text-sm text-[var(--text-secondary)]">
                <p>
                  Folio is configured as an offline-first Progressive Web App. All imported books
                  and annotations stay saved locally in IndexedDB.
                </p>
                <p>
                  In Chrome, Edge, or Brave, click the{' '}
                  <strong className="text-[var(--text-primary)]">Install App</strong> icon in the
                  browser address bar or open the browser menu and select{' '}
                  <strong className="text-[var(--text-primary)]">Install Folio</strong>.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full py-2 px-4 rounded-md text-xs font-medium bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
