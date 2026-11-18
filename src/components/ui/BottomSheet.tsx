import {X} from 'lucide-react';
import React, {useEffect} from 'react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  ariaLabel: string;
  maxHeightClass?: string;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  hideHeader?: boolean;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  ariaLabel,
  maxHeightClass = 'max-h-[85dvh]',
  headerActions,
  footer,
  hideHeader = false,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxHeightClass} rounded-t-2xl border-t border-x border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl flex flex-col overflow-hidden animate-folio-sheet-up`}
      >
        {/* Top Grab Handle */}
        <div className="pt-2.5 pb-1.5 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--border-strong)]" />
        </div>

        {!hideHeader && (title || headerActions) && (
          <div className="px-4 pb-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              {title && (
                <h2 className="font-serif-editorial text-base font-semibold text-[var(--text-primary)] truncate">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{subtitle}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:bg-[var(--bg-surface-hover)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>

        {footer ? (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 pt-3 pb-3 pb-safe shrink-0">
            {footer}
          </div>
        ) : (
          <div className="pb-safe shrink-0" />
        )}
      </div>
    </div>
  );
};
