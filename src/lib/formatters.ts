import type {CoverStyle, FolderColor, FolderRecord, HighlightColor} from '../types/library';

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatShortDate(timestamp: number | null): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(timestamp);
}

export const COVER_PALETTES: Array<{
  name: string;
  bg: string;
  spine: string;
  ink: string;
  accent: string;
}> = [
  {name: 'Espresso', bg: '#2F2620', spine: '#1E1814', ink: '#F3ECE1', accent: '#C8844A'},
  {name: 'Botanical', bg: '#26332D', spine: '#19221E', ink: '#EDF2EE', accent: '#9BB59E'},
  {name: 'Oxblood', bg: '#3B2825', spine: '#281B18', ink: '#F5EAE7', accent: '#D08C7C'},
  {name: 'Harbor', bg: '#272E38', spine: '#1A1F26', ink: '#EBF0F5', accent: '#8FA8C2'},
  {name: 'Walnut', bg: '#403425', spine: '#2C2319', ink: '#F7F0E4', accent: '#D4A86A'},
  {name: 'Damson', bg: '#322B38', spine: '#221D27', ink: '#F2EEF5', accent: '#B29BC2'},
];

export const COVER_STYLES: Array<{
  id: CoverStyle;
  label: string;
  summary: string;
}> = [
  {id: 'editorial', label: 'Classic Editorial', summary: 'Spine band with serif typography'},
  {id: 'minimal', label: 'Minimalist Band', summary: 'Clean upper title plate and calm lower field'},
  {id: 'framed', label: 'Framed Plate', summary: 'Fine inner border with centered title'},
  {id: 'swiss', label: 'Swiss Grid', summary: 'Bold geometric rules and crisp left alignment'},
];

export const FOLDER_COLORS: Array<{
  id: FolderColor;
  label: string;
  swatch: string;
}> = [
  {id: 'neutral', label: 'Neutral', swatch: '#8E8477'},
  {id: 'sienna', label: 'Sienna', swatch: '#B35D36'},
  {id: 'sage', label: 'Sage', swatch: '#5B8A68'},
  {id: 'slate', label: 'Slate Blue', swatch: '#4B799F'},
  {id: 'ochre', label: 'Ochre', swatch: '#C28E36'},
  {id: 'plum', label: 'Plum', swatch: '#8A5D8F'},
];

export function getFolderColorHex(color?: FolderColor): string | undefined {
  if (!color || color === 'neutral') return undefined;
  return FOLDER_COLORS.find((c) => c.id === color)?.swatch;
}

export const HIGHLIGHT_COLORS: Array<{
  id: HighlightColor;
  label: string;
  swatch: string;
}> = [
  {id: 'amber', label: 'Amber', swatch: '#D99B2B'},
  {id: 'sage', label: 'Sage', swatch: '#62986C'},
  {id: 'sky', label: 'Slate Blue', swatch: '#4A86B3'},
  {id: 'rose', label: 'Rose', swatch: '#C4646C'},
];

export interface FlattenedFolderOption {
  folder: FolderRecord;
  depth: number;
  pathLabel: string;
}

export function flattenFoldersHierarchy(folders: FolderRecord[]): FlattenedFolderOption[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const childrenMap = new Map<string | null, FolderRecord[]>();

  for (const folder of folders) {
    const parentKey = folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    const list = childrenMap.get(parentKey) ?? [];
    list.push(folder);
    childrenMap.set(parentKey, list);
  }

  for (const list of childrenMap.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const result: FlattenedFolderOption[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number, prefix: string) => {
    const items = childrenMap.get(parentId) ?? [];
    for (const folder of items) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      const pathLabel = prefix ? `${prefix} / ${folder.name}` : folder.name;
      result.push({folder, depth, pathLabel});
      walk(folder.id, depth + 1, pathLabel);
    }
  };

  walk(null, 0, '');
  return result;
}

export function getFolderDescendantIds(folders: FolderRecord[], rootFolderId: string): Set<string> {
  const result = new Set<string>([rootFolderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export async function compressCoverImageToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid image file'));
      el.src = objectUrl;
    });

    const maxWidth = 600;
    const maxHeight = 800;
    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
