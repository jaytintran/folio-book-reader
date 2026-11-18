import {AlertCircle, CheckCircle2, Info, X} from 'lucide-react';
import React from 'react';
import type {ToastMessage} from '../../types/library';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({toasts, onDismiss}) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-lg text-xs"
        >
          {toast.tone === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
          ) : toast.tone === 'error' ? (
            <AlertCircle className="w-4 h-4 text-[var(--danger)] shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium leading-snug">{toast.title}</div>
            {toast.detail && (
              <div className="text-[var(--text-secondary)] mt-0.5 leading-snug">{toast.detail}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
