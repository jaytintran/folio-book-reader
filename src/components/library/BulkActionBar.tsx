import {CheckSquare, Pencil, Star, Trash2, X} from 'lucide-react';
import React from 'react';

interface BulkActionBarProps {
  selectedCount: number;
  totalVisibleCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkEdit: () => void;
  onBulkFavorite: () => void;
  onBulkDelete: () => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  totalVisibleCount,
  onSelectAll,
  onClearSelection,
  onBulkEdit,
  onBulkFavorite,
  onBulkDelete,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk selection actions"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)] flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl"
    >
      <span className="font-mono-tabular text-xs font-medium text-[var(--text-primary)] pr-2 border-r border-[var(--border-subtle)] whitespace-nowrap">
        {selectedCount} selected
      </span>

      {selectedCount < totalVisibleCount && (
        <button
          type="button"
          onClick={onSelectAll}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer whitespace-nowrap"
        >
          <CheckSquare className="w-3.5 h-3.5" />
          Select All ({totalVisibleCount})
        </button>
      )}

      <button
        type="button"
        onClick={onBulkEdit}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer whitespace-nowrap"
      >
        <Pencil className="w-3.5 h-3.5" />
        Bulk Edit
      </button>

      <button
        type="button"
        onClick={onBulkFavorite}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer whitespace-nowrap"
      >
        <Star className="w-3.5 h-3.5" />
        Favorite
      </button>

      <button
        type="button"
        onClick={onBulkDelete}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded text-[var(--danger)] hover:bg-[var(--bg-surface-hover)] cursor-pointer whitespace-nowrap"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Delete
      </button>

      <button
        type="button"
        onClick={onClearSelection}
        aria-label="Clear selection"
        className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
