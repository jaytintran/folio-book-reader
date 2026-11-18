import {X} from 'lucide-react';
import React, {useMemo, useState} from 'react';
import {flattenFoldersHierarchy} from '../../lib/formatters';
import type {CategoryRecord, FolderRecord, ReadingStatus} from '../../types/library';

export interface BulkEditPatch {
  folderAction: 'keep' | 'set' | 'clear';
  folderId: string | null;
  categoryAction: 'keep' | 'set' | 'clear';
  categoryId: string | null;
  statusAction: 'keep' | ReadingStatus;
  addTags: string[];
  removeTags: string[];
}

interface BulkEditModalProps {
  selectedCount: number;
  folders: FolderRecord[];
  categories: CategoryRecord[];
  existingTags: string[];
  onApply: (patch: BulkEditPatch) => void;
  onClose: () => void;
}

export const BulkEditModal: React.FC<BulkEditModalProps> = ({
  selectedCount,
  folders,
  categories,
  existingTags,
  onApply,
  onClose,
}) => {
  const [folderSelect, setFolderSelect] = useState<string>('__keep__');
  const [categorySelect, setCategorySelect] = useState<string>('__keep__');
  const [statusAction, setStatusAction] = useState<'keep' | ReadingStatus>('keep');
  const [addTagsInput, setAddTagsInput] = useState('');
  const [removeTagsInput, setRemoveTagsInput] = useState('');

  const flatFolders = useMemo(() => flattenFoldersHierarchy(folders), [folders]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parseTags = (raw: string) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    onApply({
      folderAction:
        folderSelect === '__keep__' ? 'keep' : folderSelect === '__clear__' ? 'clear' : 'set',
      folderId:
        folderSelect !== '__keep__' && folderSelect !== '__clear__' ? folderSelect : null,
      categoryAction:
        categorySelect === '__keep__'
          ? 'keep'
          : categorySelect === '__clear__'
            ? 'clear'
            : 'set',
      categoryId:
        categorySelect !== '__keep__' && categorySelect !== '__clear__' ? categorySelect : null,
      statusAction,
      addTags: parseTags(addTagsInput),
      removeTags: parseTags(removeTagsInput),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bulk edit books"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h2 className="font-serif-editorial text-lg font-semibold text-[var(--text-primary)]">
              Bulk Edit Books
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Updating <span className="font-mono-tabular">{selectedCount}</span> selected{' '}
              {selectedCount === 1 ? 'book' : 'books'}. Untouched fields stay unchanged.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk edit modal"
            className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Folder
            </label>
            <select
              value={folderSelect}
              onChange={(e) => setFolderSelect(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
            >
              <option value="__keep__">Keep existing folders</option>
              <option value="__clear__">Remove from folder</option>
              {flatFolders.map(({folder, pathLabel}) => (
                <option key={folder.id} value={folder.id}>
                  Move to: {pathLabel}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Category
            </label>
            <select
              value={categorySelect}
              onChange={(e) => setCategorySelect(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
            >
              <option value="__keep__">Keep existing categories</option>
              <option value="__clear__">Clear category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  Set to: {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Reading Status
            </label>
            <select
              value={statusAction}
              onChange={(e) => setStatusAction(e.target.value as 'keep' | ReadingStatus)}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
            >
              <option value="keep">Keep existing status</option>
              <option value="unread">Mark as Unread</option>
              <option value="reading">Mark as Currently Reading</option>
              <option value="finished">Mark as Finished</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Add Tags (comma separated)
            </label>
            <input
              type="text"
              value={addTagsInput}
              onChange={(e) => setAddTagsInput(e.target.value)}
              placeholder="e.g. philosophy, 2026-reading"
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          {existingTags.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Remove Tags (comma separated)
              </label>
              <input
                type="text"
                value={removeTagsInput}
                onChange={(e) => setRemoveTagsInput(e.target.value)}
                placeholder="Tags to strip from selection..."
                className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          )}

          <div className="pt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-md border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium rounded-md bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
            >
              Apply to {selectedCount} {selectedCount === 1 ? 'Book' : 'Books'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
