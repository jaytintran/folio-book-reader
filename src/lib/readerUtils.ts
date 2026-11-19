import type {ParsedChapter, SearchMatch} from '../types/library';

export const WORDS_PER_MINUTE = 240;
export const WORDS_PER_VIRTUAL_PAGE = 260;
export const PDF_MINUTES_PER_PAGE = 1.5;

export interface ChapterMetric {
  index: number;
  title: string;
  wordCount: number;
  startWordOffset: number;
  startPct: number; // 0..100
  startVirtualPage: number; // 1-based
  virtualPageCount: number;
  plainText: string;
}

export interface BookReadingMetrics {
  chapters: ChapterMetric[];
  totalWords: number;
  totalVirtualPages: number;
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeReflowableMetrics(chapters: ParsedChapter[]): BookReadingMetrics {
  const plainTexts = chapters.map((ch) => stripHtmlToText(ch.html));
  const counts = plainTexts.map((txt) => {
    if (!txt) return 1;
    const words = txt.split(/\s+/).filter(Boolean).length;
    return Math.max(1, words);
  });
  const virtualCounts = chapters.map((ch, idx) => {
    const mediaMatches = ch.html.match(/<(?:img|svg)\b/gi);
    const mediaCount = mediaMatches ? mediaMatches.length : 0;
    const effectiveWords = counts[idx] + mediaCount * 65;
    return Math.max(1, Math.round(effectiveWords / WORDS_PER_VIRTUAL_PAGE));
  });

  const totalWords = Math.max(
    1,
    counts.reduce((sum, n) => sum + n, 0)
  );

  let running = 0;
  let runningPages = 1;
  const metrics: ChapterMetric[] = chapters.map((ch, idx) => {
    const startWordOffset = running;
    const startPct = (running / totalWords) * 100;
    const startVirtualPage = runningPages;
    const virtualPageCount = virtualCounts[idx];
    running += counts[idx];
    runningPages += virtualPageCount;
    return {
      index: idx,
      title: ch.title || `Section ${idx + 1}`,
      wordCount: counts[idx],
      startWordOffset,
      startPct,
      startVirtualPage,
      virtualPageCount,
      plainText: plainTexts[idx],
    };
  });

  const totalVirtualPages = Math.max(1, runningPages - 1);

  return {chapters: metrics, totalWords, totalVirtualPages};
}

export function getVirtualPageAtLocation(
  metrics: BookReadingMetrics,
  unitIndex: number,
  scrollRatio: number
): number {
  if (metrics.chapters.length === 0) return 1;
  const clampedUnit = Math.min(metrics.chapters.length - 1, Math.max(0, unitIndex));
  const ch = metrics.chapters[clampedUnit];
  const clampedRatio = Math.min(1, Math.max(0, scrollRatio));
  const offset = Math.round(clampedRatio * Math.max(0, ch.virtualPageCount - 1));
  return Math.min(metrics.totalVirtualPages, Math.max(1, ch.startVirtualPage + offset));
}

export function getLocationForVirtualPage(
  metrics: BookReadingMetrics,
  virtualPage: number
): {unitIndex: number; scrollRatio: number; chapter: ChapterMetric} {
  const clampedPage = Math.min(metrics.totalVirtualPages, Math.max(1, Math.round(virtualPage)));
  let match = metrics.chapters[0];
  for (const ch of metrics.chapters) {
    if (ch.startVirtualPage <= clampedPage) match = ch;
    else break;
  }
  const offset = Math.max(0, clampedPage - match.startVirtualPage);
  const scrollRatio =
    match.virtualPageCount > 1
      ? Math.min(0.98, offset / Math.max(1, match.virtualPageCount - 1))
      : 0;
  return {unitIndex: match.index, scrollRatio, chapter: match};
}

export function formatReadingTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '< 1 min';
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hrs = Math.floor(rounded / 60);
  const rem = rounded % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function searchTextUnits(
  units: Array<{unitIndex: number; unitLabel: string; text: string}>,
  rawQuery: string,
  maxMatches = 250
): SearchMatch[] {
  const query = rawQuery.trim();
  if (query.length < 2) return [];
  const lowerQuery = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const unit of units) {
    if (!unit.text) continue;
    const lowerText = unit.text.toLowerCase();
    let searchPos = 0;
    let occurrenceInUnit = 0;

    while (searchPos < lowerText.length) {
      const idx = lowerText.indexOf(lowerQuery, searchPos);
      if (idx === -1) break;

      const snippetStart = Math.max(0, idx - 46);
      const snippetEnd = Math.min(unit.text.length, idx + query.length + 58);
      const before = (snippetStart > 0 ? '…' : '') + unit.text.slice(snippetStart, idx);
      const matchText = unit.text.slice(idx, idx + query.length);
      const after =
        unit.text.slice(idx + query.length, snippetEnd) +
        (snippetEnd < unit.text.length ? '…' : '');

      matches.push({
        id: `m-${unit.unitIndex}-${occurrenceInUnit}-${idx}`,
        unitIndex: unit.unitIndex,
        unitLabel: unit.unitLabel,
        snippetBefore: before,
        matchText,
        snippetAfter: after,
        occurrenceInUnit,
      });

      occurrenceInUnit += 1;
      searchPos = idx + Math.max(1, query.length);
      if (matches.length >= maxMatches) return matches;
    }
  }

  return matches;
}
