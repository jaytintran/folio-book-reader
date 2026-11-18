import type {ParsedChapter, SearchMatch} from '../types/library';

export const WORDS_PER_MINUTE = 240;
export const PDF_MINUTES_PER_PAGE = 1.5;

export interface ChapterMetric {
  index: number;
  title: string;
  wordCount: number;
  startWordOffset: number;
  startPct: number; // 0..100
  plainText: string;
}

export interface BookReadingMetrics {
  chapters: ChapterMetric[];
  totalWords: number;
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

  const totalWords = Math.max(
    1,
    counts.reduce((sum, n) => sum + n, 0)
  );

  let running = 0;
  const metrics: ChapterMetric[] = chapters.map((ch, idx) => {
    const startWordOffset = running;
    const startPct = (running / totalWords) * 100;
    running += counts[idx];
    return {
      index: idx,
      title: ch.title || `Section ${idx + 1}`,
      wordCount: counts[idx],
      startWordOffset,
      startPct,
      plainText: plainTexts[idx],
    };
  });

  return {chapters: metrics, totalWords};
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
