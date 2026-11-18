import {Plus, Trash2, X} from 'lucide-react';
import React, {useMemo, useState} from 'react';
import {
  flattenFoldersHierarchy,
  formatFileSize,
  formatShortDate,
} from '../../lib/formatters';
import type {
  BookRecord,
  CategoryRecord,
  CoverStyle,
  FolderRecord,
  ReadingStatus,
} from '../../types/library';
import {BookCover} from './BookCover';
import {CoverCustomizer} from './CoverCustomizer';

interface MetadataDrawerProps {
  book: BookRecord;
  folders: FolderRecord[];
  categories: CategoryRecord[];
  existingTags: string[];
  onSave: (updated: BookRecord) => void;
  onDelete: (bookId: string) => void;
  onCreateFolder: (name: string) => Promise<FolderRecord>;
  onCreateCategory: (name: string) => Promise<CategoryRecord>;
  onClose: () => void;
}

export const MetadataDrawer: React.FC<MetadataDrawerProps> = ({
  book,
  folders,
  categories,
  existingTags,
  onSave,
  onDelete,
  onCreateFolder,
  onCreateCategory,
  onClose,
}) => {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [series, setSeries] = useState(book.series);
  const [publisher, setPublisher] = useState(book.publisher);
  const [year, setYear] = useState(book.year);
  const [language, setLanguage] = useState(book.language);
  const [description, setDescription] = useState(book.description);
  const [categoryId, setCategoryId] = useState<string>(book.categoryId ?? '');
  const [folderId, setFolderId] = useState<string>(book.folderId ?? '');
  const [status, setStatus] = useState<ReadingStatus>(book.status);
  const [isFavorite, setIsFavorite] = useState(book.isFavorite);
  const [tags, setTags] = useState<string[]>(book.tags);
  const [tagInput, setTagInput] = useState('');
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(book.coverDataUrl);
  const [coverPaletteIndex, setCoverPaletteIndex] = useState<number>(book.coverPaletteIndex);
  const [coverStyle, setCoverStyle] = useState<CoverStyle>(book.coverStyle ?? 'editorial');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [quickFolder, setQuickFolder] = useState('');
  const [showQuickFolder, setShowQuickFolder] = useState(false);
  const [quickCategory, setQuickCategory] = useState('');
  const [showQuickCategory, setShowQuickCategory] = useState(false);

  const flatFolders = useMemo(() => flattenFoldersHierarchy(folders), [folders]);

  const addTagsFromString = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setTags((prev) => {
      const next = [...prev];
      for (const t of parts) {
        if (!next.some((existing) => existing.toLowerCase() === t.toLowerCase())) {
          next.push(t);
        }
      }
      return next;
    });
    setTagInput('');
  };

  const removeTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pendingTag = tagInput.trim();
    const finalTags = pendingTag
      ? Array.from(new Set([...tags, ...pendingTag.split(',').map((s) => s.trim()).filter(Boolean)]))
      : tags;

    const updatedProgress =
      status === 'finished' ? 100 : status === 'unread' ? 0 : Math.max(1, book.progress);

    onSave({
      ...book,
      title: title.trim() || book.title,
      author: author.trim() || 'Unknown Author',
      series: series.trim(),
      publisher: publisher.trim(),
      year: year.trim(),
      language: language.trim() || 'en',
      description: description.trim(),
      categoryId: categoryId || null,
      folderId: folderId || null,
      status,
      progress: status === book.status ? book.progress : updatedProgress,
      isFavorite,
      tags: finalTags,
      coverDataUrl,
      coverPaletteIndex,
      coverStyle,
    });
  };

  const suggestedTags = existingTags.filter(
    (t) =>
      !tags.some((curr) => curr.toLowerCase() === t.toLowerCase()) &&
      (tagInput.trim() === '' || t.toLowerCase().includes(tagInput.trim().toLowerCase()))
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/45"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit metadata for ${book.title}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg h-full bg-[var(--bg-elevated)] border-l border-[var(--border-subtle)] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="h-14 px-6 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
          <h2 className="font-serif-editorial text-lg font-semibold text-[var(--text-primary)]">
            Edit Metadata
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close metadata editor"
            className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form id="metadata-edit-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Cover + Customizer */}
          <div className="space-y-4 pb-5 border-b border-[var(--border-subtle)]">
            <div className="flex gap-4 items-start">
              <div className="w-24 shrink-0">
                <BookCover
                  title={title || book.title}
                  author={author || book.author}
                  format={book.format}
                  coverDataUrl={coverDataUrl}
                  paletteIndex={coverPaletteIndex}
                  coverStyle={coverStyle}
                />
              </div>
              <div className="flex-1 min-w-0 text-xs text-[var(--text-secondary)] space-y-1">
                <p className="truncate font-medium text-[var(--text-primary)]" title={book.fileName}>
                  {book.fileName}
                </p>
                <p className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                  {book.format.toUpperCase()} · {formatFileSize(book.fileSize)} · Added{' '}
                  {formatShortDate(book.addedAt)}
                </p>
              </div>
            </div>

            <CoverCustomizer
              title={title || book.title}
              author={author || book.author}
              format={book.format}
              coverDataUrl={coverDataUrl}
              coverPaletteIndex={coverPaletteIndex}
              coverStyle={coverStyle}
              onChange={(patch) => {
                if ('coverDataUrl' in patch) setCoverDataUrl(patch.coverDataUrl ?? null);
                if (patch.coverPaletteIndex !== undefined)
                  setCoverPaletteIndex(patch.coverPaletteIndex);
                if (patch.coverStyle !== undefined) setCoverStyle(patch.coverStyle);
              }}
            />
          </div>

          {/* Title & Author */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Author
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Series
                </label>
                <input
                  type="text"
                  value={series}
                  onChange={(e) => setSeries(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>
          </div>

          {/* Organization: Category, Folder, Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Category</label>
                <button
                  type="button"
                  onClick={() => setShowQuickCategory((v) => !v)}
                  className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                >
                  + New
                </button>
              </div>
              {showQuickCategory ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={quickCategory}
                    onChange={(e) => setQuickCategory(e.target.value)}
                    placeholder="Category name"
                    className="flex-1 min-w-0 px-2.5 py-2 text-xs rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!quickCategory.trim()) return;
                      const created = await onCreateCategory(quickCategory.trim());
                      setCategoryId(created.id);
                      setQuickCategory('');
                      setShowQuickCategory(false);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-md bg-[var(--accent)] text-[var(--accent-contrast)] cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                >
                  <option value="">Uncategorized</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Folder</label>
                <button
                  type="button"
                  onClick={() => setShowQuickFolder((v) => !v)}
                  className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                >
                  + New
                </button>
              </div>
              {showQuickFolder ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={quickFolder}
                    onChange={(e) => setQuickFolder(e.target.value)}
                    placeholder="Folder name"
                    className="flex-1 min-w-0 px-2.5 py-2 text-xs rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!quickFolder.trim()) return;
                      const created = await onCreateFolder(quickFolder.trim());
                      setFolderId(created.id);
                      setQuickFolder('');
                      setShowQuickFolder(false);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-md bg-[var(--accent)] text-[var(--accent-contrast)] cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
                >
                  <option value="">No folder</option>
                  {flatFolders.map(({folder, pathLabel}) => (
                    <option key={folder.id} value={folder.id}>
                      {pathLabel}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Reading Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ReadingStatus)}
                className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
              >
                <option value="unread">Unread</option>
                <option value="reading">Currently Reading</option>
                <option value="finished">Finished</option>
              </select>
            </div>

            <label className="flex items-center gap-2.5 pt-5 text-sm text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={isFavorite}
                onChange={(e) => setIsFavorite(e.target.checked)}
                className="w-4 h-4 accent-[var(--accent)] rounded cursor-pointer"
              />
              <span>Mark as Favorite</span>
            </label>
          </div>

          {/* Tags Editor */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Tags
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTagsFromString(tagInput);
                  }
                }}
                placeholder="Type a tag and press Enter..."
                className="flex-1 min-w-0 px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <button
                type="button"
                onClick={() => addTagsFromString(tagInput)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removeTag(t)}
                    title={`Remove tag "${t}"`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--danger)] hover:text-[var(--danger)] transition-colors cursor-pointer"
                  >
                    <span>{t}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}

            {suggestedTags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
                <span>Suggestions:</span>
                {suggestedTags.slice(0, 6).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addTagsFromString(s)}
                    className="text-[var(--text-secondary)] hover:text-[var(--accent)] underline underline-offset-2 cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Publishing Details */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-1">
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Publisher
              </label>
              <input
                type="text"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Year
              </label>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2024"
                className="w-full px-3 py-2 text-sm font-mono-tabular rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Language
              </label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Synopsis &amp; Notes
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summary or personal notes about this book..."
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-y"
            />
          </div>
        </form>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3 shrink-0 bg-[var(--bg-surface)]">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onDelete(book.id)}
                className="px-3 py-2 text-xs font-medium rounded-md bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)] cursor-pointer whitespace-nowrap"
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--bg-surface-hover)] rounded-md cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Book
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-md border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="metadata-edit-form"
              className="px-4 py-2 text-xs font-medium rounded-md bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer whitespace-nowrap"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
