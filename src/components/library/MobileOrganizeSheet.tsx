import {Check, Folder, FolderPlus, Plus, Tag} from 'lucide-react';
import React, {useEffect, useMemo, useState} from 'react';
import {
  flattenFoldersHierarchy,
  getBookFolderIds,
  getFolderColorHex,
} from '../../lib/formatters';
import type {
  BookRecord,
  CategoryRecord,
  FolderRecord,
  ViewFolderRecord,
} from '../../types/library';
import {BottomSheet} from '../ui/BottomSheet';

export interface MobileOrganizePayload {
  bookIds: string[];
  addToViewFolderIds: string[];
  removeFromViewFolderIds: string[];
  addToSidebarFolderIds: string[];
  removeFromSidebarFolderIds: string[];
  categoryChange: {mode: 'keep' | 'set' | 'clear'; categoryId: string | null};
  addTags: string[];
  removeTags: string[];
}

interface MobileOrganizeSheetProps {
  isOpen: boolean;
  targetBooks: BookRecord[];
  activeViewLabel: string;
  currentViewFolders: ViewFolderRecord[];
  sidebarFolders: FolderRecord[];
  categories: CategoryRecord[];
  existingTags: string[];
  onCreateViewFolder: (name: string) => Promise<ViewFolderRecord | undefined> | void;
  onApply: (payload: MobileOrganizePayload) => Promise<void> | void;
  onClose: () => void;
}

export const MobileOrganizeSheet: React.FC<MobileOrganizeSheetProps> = ({
  isOpen,
  targetBooks,
  activeViewLabel,
  currentViewFolders,
  sidebarFolders,
  categories,
  existingTags,
  onCreateViewFolder,
  onApply,
  onClose,
}) => {
  const isSingle = targetBooks.length === 1;
  const singleBook = isSingle ? targetBooks[0] : null;
  const targetBookIds = useMemo(() => targetBooks.map((b) => b.id), [targetBooks]);

  // View folder membership toggles
  const [selectedViewFolderIds, setSelectedViewFolderIds] = useState<Set<string>>(new Set());
  const [initialViewFolderIds, setInitialViewFolderIds] = useState<Set<string>>(new Set());
  const [newViewFolderName, setNewViewFolderName] = useState('');
  const [creatingViewFolder, setCreatingViewFolder] = useState(false);

  // Global Sidebar Folder multi-select membership toggles
  const [selectedSidebarFolderIds, setSelectedSidebarFolderIds] = useState<Set<string>>(new Set());
  const [initialSidebarFolderIds, setInitialSidebarFolderIds] = useState<Set<string>>(new Set());

  const [categoryMode, setCategoryMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Tags
  const [tagsToAdd, setTagsToAdd] = useState<Set<string>>(new Set());
  const [tagsToRemove, setTagsToRemove] = useState<Set<string>>(new Set());
  const [newTagDraft, setNewTagDraft] = useState('');

  const flatSidebarFolders = useMemo(
    () => flattenFoldersHierarchy(sidebarFolders),
    [sidebarFolders]
  );

  const targetKey = targetBookIds.join(',');

  // Initialize state whenever sheet opens for a target selection
  useEffect(() => {
    if (!isOpen || targetBooks.length === 0) return;

    const initialVf = new Set<string>();
    for (const vf of currentViewFolders) {
      if (targetBooks.every((b) => vf.bookIds.includes(b.id))) {
        initialVf.add(vf.id);
      }
    }
    setInitialViewFolderIds(initialVf);
    setSelectedViewFolderIds(new Set(initialVf));

    const initialSf = new Set<string>();
    for (const sf of sidebarFolders) {
      if (targetBooks.every((b) => getBookFolderIds(b).includes(sf.id))) {
        initialSf.add(sf.id);
      }
    }
    setInitialSidebarFolderIds(initialSf);
    setSelectedSidebarFolderIds(new Set(initialSf));

    if (singleBook) {
      if (singleBook.categoryId) {
        setCategoryMode('set');
        setSelectedCategoryId(singleBook.categoryId);
      } else {
        setCategoryMode('clear');
        setSelectedCategoryId(null);
      }
    } else {
      setCategoryMode('keep');
      setSelectedCategoryId(null);
    }

    setTagsToAdd(new Set());
    setTagsToRemove(new Set());
    setNewTagDraft('');
    setNewViewFolderName('');
    setCreatingViewFolder(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, targetKey]);

  const toggleViewFolder = (folderId: string) => {
    setSelectedViewFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const toggleSidebarFolder = (folderId: string) => {
    setSelectedSidebarFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleQuickCreateViewFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newViewFolderName.trim();
    if (!trimmed) return;
    const created = await onCreateViewFolder(trimmed);
    if (created) {
      setSelectedViewFolderIds((prev) => new Set(prev).add(created.id));
    }
    setNewViewFolderName('');
    setCreatingViewFolder(false);
  };

  const singleBookTagSet = useMemo(
    () => new Set((singleBook?.tags ?? []).map((t) => t.toLowerCase())),
    [singleBook]
  );

  const toggleTag = (tag: string) => {
    const lower = tag.toLowerCase();
    if (singleBook) {
      const originallyHas = singleBookTagSet.has(lower);
      if (originallyHas) {
        setTagsToRemove((prev) => {
          const next = new Set(prev);
          if (next.has(tag)) next.delete(tag);
          else next.add(tag);
          return next;
        });
      } else {
        setTagsToAdd((prev) => {
          const next = new Set(prev);
          if (next.has(tag)) next.delete(tag);
          else next.add(tag);
          return next;
        });
      }
    } else {
      setTagsToAdd((prev) => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return next;
      });
    }
  };

  const handleAddCustomTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagDraft.trim();
    if (!trimmed) return;
    setTagsToAdd((prev) => new Set(prev).add(trimmed));
    setNewTagDraft('');
  };

  const allDisplayTags = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of existingTags) map.set(t.toLowerCase(), t);
    for (const t of tagsToAdd) map.set(t.toLowerCase(), t);
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [existingTags, tagsToAdd]);

  const handleApply = async () => {
    const addToViewFolderIds: string[] = [];
    const removeFromViewFolderIds: string[] = [];
    for (const vf of currentViewFolders) {
      const nowSelected = selectedViewFolderIds.has(vf.id);
      const wasSelected = initialViewFolderIds.has(vf.id);
      if (nowSelected && !wasSelected) addToViewFolderIds.push(vf.id);
      if (!nowSelected && wasSelected) removeFromViewFolderIds.push(vf.id);
    }

    const addToSidebarFolderIds: string[] = [];
    const removeFromSidebarFolderIds: string[] = [];
    for (const sf of sidebarFolders) {
      const nowSelected = selectedSidebarFolderIds.has(sf.id);
      const wasSelected = initialSidebarFolderIds.has(sf.id);
      if (nowSelected && !wasSelected) addToSidebarFolderIds.push(sf.id);
      if (!nowSelected && wasSelected) removeFromSidebarFolderIds.push(sf.id);
    }

    await onApply({
      bookIds: targetBookIds,
      addToViewFolderIds,
      removeFromViewFolderIds,
      addToSidebarFolderIds,
      removeFromSidebarFolderIds,
      categoryChange: {mode: categoryMode, categoryId: selectedCategoryId},
      addTags: Array.from(tagsToAdd),
      removeTags: Array.from(tagsToRemove),
    });
    onClose();
  };

  if (!isOpen || targetBooks.length === 0) return null;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isSingle ? 'Organize Book' : `Organize ${targetBooks.length} Books`}
      subtitle={singleBook ? singleBook.title : 'File selected books into folders, categories, or tags'}
      ariaLabel="Organize books"
      maxHeightClass="max-h-[88dvh]"
      footer={
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm font-medium text-[var(--text-primary)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            className="flex-1 h-11 rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] text-sm font-medium active:opacity-90 cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-6">
        {/* Per-View Folders in current view */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Folders in {activeViewLabel}
            </p>
            <button
              type="button"
              onClick={() => setCreatingViewFolder((v) => !v)}
              className="min-h-[34px] px-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>

          {creatingViewFolder && (
            <form onSubmit={(e) => void handleQuickCreateViewFolder(e)} className="mb-2.5 flex gap-2">
              <input
                type="text"
                autoFocus
                value={newViewFolderName}
                onChange={(e) => setNewViewFolderName(e.target.value)}
                placeholder="Folder name..."
                className="flex-1 h-10 px-3 text-xs rounded-lg border border-[var(--accent)] bg-[var(--bg-input)] text-[var(--text-primary)]"
              />
              <button
                type="submit"
                className="h-10 px-3.5 rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-medium cursor-pointer"
              >
                Create
              </button>
            </form>
          )}

          {currentViewFolders.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-2">
              No folders in {activeViewLabel} yet. Tap &ldquo;New&rdquo; to create one.
            </p>
          ) : (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
              {currentViewFolders.map((vf) => {
                const checked = selectedViewFolderIds.has(vf.id);
                return (
                  <button
                    key={vf.id}
                    type="button"
                    onClick={() => toggleViewFolder(vf.id)}
                    className="w-full min-h-[46px] px-3.5 flex items-center justify-between gap-2 text-left cursor-pointer active:bg-[var(--bg-surface-hover)]"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Folder className="w-4 h-4 text-[var(--accent)] shrink-0" />
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {vf.name}
                      </span>
                    </span>
                    <span
                      className={`w-5 h-5 rounded flex items-center justify-center border shrink-0 ${
                        checked
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-contrast)]'
                          : 'border-[var(--border-strong)] text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Global Sidebar Folders (Multi-Select) */}
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Library Folders
          </p>
          {flatSidebarFolders.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-1">
              No library folders created yet.
            </p>
          ) : (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
              {flatSidebarFolders.map(({folder, pathLabel}) => {
                const checked = selectedSidebarFolderIds.has(folder.id);
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => toggleSidebarFolder(folder.id)}
                    className="w-full min-h-[46px] px-3.5 flex items-center justify-between gap-2 text-left cursor-pointer active:bg-[var(--bg-surface-hover)]"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Folder
                        className="w-4 h-4 shrink-0"
                        style={{color: getFolderColorHex(folder.color) ?? 'var(--text-muted)'}}
                      />
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {pathLabel}
                      </span>
                    </span>
                    <span
                      className={`w-5 h-5 rounded flex items-center justify-center border shrink-0 ${
                        checked
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-contrast)]'
                          : 'border-[var(--border-strong)] text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Category */}
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Category
          </p>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
            {!isSingle && (
              <button
                type="button"
                onClick={() => {
                  setCategoryMode('keep');
                  setSelectedCategoryId(null);
                }}
                className="w-full min-h-[44px] px-3.5 flex items-center justify-between text-xs font-medium text-[var(--text-secondary)] cursor-pointer"
              >
                <span>Keep existing categories</span>
                {categoryMode === 'keep' && (
                  <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCategoryMode('clear');
                setSelectedCategoryId(null);
              }}
              className="w-full min-h-[44px] px-3.5 flex items-center justify-between text-xs font-medium text-[var(--text-primary)] cursor-pointer"
            >
              <span>None</span>
              {categoryMode === 'clear' && (
                <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
              )}
            </button>
            {categories.map((cat) => {
              const active = categoryMode === 'set' && selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategoryMode('set');
                    setSelectedCategoryId(cat.id);
                  }}
                  className="w-full min-h-[44px] px-3.5 flex items-center justify-between gap-2 text-left cursor-pointer active:bg-[var(--bg-surface-hover)]"
                >
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {cat.name}
                  </span>
                  {active && <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* Tags */}
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {isSingle ? 'Tags' : 'Add Tags to Selected'}
          </p>
          <form onSubmit={handleAddCustomTag} className="flex gap-2 mb-2.5">
            <input
              type="text"
              value={newTagDraft}
              onChange={(e) => setNewTagDraft(e.target.value)}
              placeholder="Add new tag..."
              className="flex-1 h-10 px-3 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="h-10 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-primary)] inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          {allDisplayTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allDisplayTags.map((tag) => {
                const lower = tag.toLowerCase();
                const isActive = singleBook
                  ? (singleBookTagSet.has(lower) && !tagsToRemove.has(tag)) || tagsToAdd.has(tag)
                  : tagsToAdd.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`min-h-[38px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      isActive
                        ? 'border-[var(--accent)] bg-[var(--bg-accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </BottomSheet>
  );
};
