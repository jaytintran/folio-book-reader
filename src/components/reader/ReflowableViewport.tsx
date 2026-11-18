import {ChevronLeft, ChevronRight, StickyNote, X} from 'lucide-react';
import React, {useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {HIGHLIGHT_COLORS} from '../../lib/formatters';
import type {
  HighlightColor,
  HighlightRecord,
  ParsedChapter,
  ReaderPreferences,
} from '../../types/library';

interface SelectionMenuState {
  text: string;
  prefix: string;
  suffix: string;
  x: number;
  y: number;
}

export interface ReflowableNavHandle {
  stepPrev: () => void;
  stepNext: () => void;
}

interface ReflowableViewportProps {
  navRef?: React.Ref<ReflowableNavHandle>;
  chapters: ParsedChapter[];
  chapterIndex: number;
  initialScrollRatio: number;
  prefs: ReaderPreferences;
  chapterHighlights: HighlightRecord[];
  searchHighlight: {query: string; occurrenceInUnit: number; nonce: number} | null;
  headerPinned: boolean;
  bottomBarPinned: boolean;
  topOverlayActive: boolean;
  bottomOverlayActive: boolean;
  onChapterChange: (nextIndex: number, initialRatio?: number) => void;
  onScrollProgress: (scrollRatio: number) => void;
  onCreateHighlight: (payload: {
    selectedText: string;
    prefixContext: string;
    suffixContext: string;
    color: HighlightColor;
    note: string;
  }) => void;
  onFocusHighlight: (highlightId: string) => void;
  onScrollDirection?: (dir: 'up' | 'down') => void;
  onCenterTap?: () => void;
}

function applyHighlightsToDom(container: HTMLElement, highlights: HighlightRecord[]) {
  if (highlights.length === 0) return;

  for (const hl of highlights) {
    const target = hl.selectedText.trim();
    if (!target || target.length < 2) continue;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      if (
        node.nodeValue &&
        node.parentElement &&
        !node.parentElement.closest('mark.folio-hl')
      ) {
        textNodes.push(node as Text);
      }
      node = walker.nextNode();
    }

    let fullText = '';
    const offsets: Array<{node: Text; start: number; end: number}> = [];
    for (const tn of textNodes) {
      const start = fullText.length;
      const val = tn.nodeValue || '';
      fullText += val;
      offsets.push({node: tn, start, end: start + val.length});
    }

    let matchIndex = -1;
    if (hl.prefixContext) {
      const searchWithPrefix = hl.prefixContext + hl.selectedText;
      const idx = fullText.indexOf(searchWithPrefix);
      if (idx !== -1) {
        matchIndex = idx + hl.prefixContext.length;
      }
    }
    if (matchIndex === -1) {
      matchIndex = fullText.indexOf(hl.selectedText);
    }
    if (matchIndex === -1) continue;

    const matchEnd = matchIndex + hl.selectedText.length;
    const involved = offsets.filter((o) => o.end > matchIndex && o.start < matchEnd);

    for (const seg of involved) {
      const localStart = Math.max(0, matchIndex - seg.start);
      const localEnd = Math.min(seg.node.nodeValue?.length ?? 0, matchEnd - seg.start);
      if (localEnd <= localStart) continue;

      const textNode = seg.node;
      const value = textNode.nodeValue || '';
      const before = value.slice(0, localStart);
      const middle = value.slice(localStart, localEnd);
      const after = value.slice(localEnd);

      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));

      const mark = document.createElement('mark');
      mark.className = `folio-hl folio-hl-${hl.color}`;
      mark.dataset.highlightId = hl.id;
      if (hl.note) mark.title = hl.note;
      mark.textContent = middle;
      frag.appendChild(mark);

      if (after) frag.appendChild(document.createTextNode(after));
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }
}

function applySearchMatchHighlight(
  container: HTMLElement,
  query: string,
  occurrenceInUnit: number
): HTMLElement | null {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue) textNodes.push(node as Text);
    node = walker.nextNode();
  }

  let fullText = '';
  const offsets: Array<{node: Text; start: number; end: number}> = [];
  for (const tn of textNodes) {
    const start = fullText.length;
    const val = tn.nodeValue || '';
    fullText += val;
    offsets.push({node: tn, start, end: start + val.length});
  }

  const lowerFull = fullText.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  let searchPos = 0;
  let foundIdx = -1;

  for (let count = 0; count <= occurrenceInUnit; count++) {
    const idx = lowerFull.indexOf(lowerQuery, searchPos);
    if (idx === -1) break;
    foundIdx = idx;
    searchPos = idx + lowerQuery.length;
  }

  if (foundIdx === -1) return null;

  const matchEnd = foundIdx + trimmed.length;
  const involved = offsets.filter((o) => o.end > foundIdx && o.start < matchEnd);
  let firstMark: HTMLElement | null = null;

  for (const seg of involved) {
    const localStart = Math.max(0, foundIdx - seg.start);
    const localEnd = Math.min(seg.node.nodeValue?.length ?? 0, matchEnd - seg.start);
    if (localEnd <= localStart) continue;

    const textNode = seg.node;
    const value = textNode.nodeValue || '';
    const before = value.slice(0, localStart);
    const middle = value.slice(localStart, localEnd);
    const after = value.slice(localEnd);

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));

    const mark = document.createElement('mark');
    mark.className = 'folio-search-match';
    mark.textContent = middle;
    if (!firstMark) firstMark = mark;
    frag.appendChild(mark);

    if (after) frag.appendChild(document.createTextNode(after));
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return firstMark;
}

export const ReflowableViewport: React.FC<ReflowableViewportProps> = ({
  navRef,
  chapters,
  chapterIndex,
  initialScrollRatio,
  prefs,
  chapterHighlights,
  searchHighlight,
  headerPinned,
  bottomBarPinned,
  topOverlayActive,
  bottomOverlayActive,
  onChapterChange,
  onScrollProgress,
  onCreateHighlight,
  onFocusHighlight,
  onScrollDirection,
  onCenterTap,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const spreadFrameRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef<number>(0);

  const [spreadDims, setSpreadDims] = useState<{width: number; height: number}>({
    width: 900,
    height: 620,
  });
  const [spreadIndex, setSpreadIndex] = useState<number>(0);
  const [totalSpreads, setTotalSpreads] = useState<number>(1);

  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteColor, setNoteColor] = useState<HighlightColor>('amber');
  const [noteText, setNoteText] = useState('');

  const chapter = chapters[chapterIndex] ?? chapters[0];
  const hasPrevChapter = chapterIndex > 0;
  const hasNextChapter = chapterIndex < chapters.length - 1;
  const isSpread = prefs.readingLayout === 'spread';

  const isTwoColumn = spreadDims.width >= 720;
  const columnGap = isTwoColumn ? 56 : 32;
  const spreadStepPx = spreadDims.width + columnGap;

  // Measure spread viewport dimensions
  useEffect(() => {
    if (!isSpread) return;
    const el = spreadFrameRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 160 && rect.height > 160) {
        setSpreadDims({
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        });
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isSpread]);

  // Render chapter HTML, persistent highlights, and active search match
  useEffect(() => {
    const el = proseRef.current;
    if (!el || !chapter) return;

    el.innerHTML = chapter.html;
    applyHighlightsToDom(el, chapterHighlights);

    let searchEl: HTMLElement | null = null;
    if (searchHighlight && searchHighlight.query.trim().length >= 2) {
      searchEl = applySearchMatchHighlight(
        el,
        searchHighlight.query,
        searchHighlight.occurrenceInUnit
      );
    }

    const raf = window.requestAnimationFrame(() => {
      if (isSpread) {
        const scrollW = el.scrollWidth;
        const count = Math.max(1, Math.ceil((scrollW + columnGap - 4) / spreadStepPx));
        setTotalSpreads(count);

        if (searchEl) {
          const offsetLeft = searchEl.offsetLeft;
          const targetSpread = Math.min(count - 1, Math.max(0, Math.floor(offsetLeft / spreadStepPx)));
          setSpreadIndex(targetSpread);
          onScrollProgress(count > 1 ? targetSpread / (count - 1) : 0);
        } else {
          const restored =
            initialScrollRatio >= 0.99
              ? count - 1
              : Math.min(count - 1, Math.max(0, Math.round(initialScrollRatio * (count - 1))));
          setSpreadIndex(restored);
        }
      } else {
        const scroller = scrollContainerRef.current;
        if (!scroller) return;
        if (searchEl) {
          searchEl.scrollIntoView({behavior: 'smooth', block: 'center'});
        } else {
          const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = Math.round(maxScroll * initialScrollRatio);
          lastScrollTopRef.current = scroller.scrollTop;
        }
      }
    });

    setSelectionMenu(null);
    setNoteOpen(false);
    return () => window.cancelAnimationFrame(raf);
  }, [
    chapter,
    chapterHighlights,
    searchHighlight,
    isSpread,
    spreadDims.width,
    spreadDims.height,
    prefs.fontFamily,
    prefs.fontSize,
    prefs.lineHeight,
    prefs.paragraphSpacing,
    prefs.textIndent,
    prefs.textAlign,
    prefs.pageWidth,
    initialScrollRatio,
    columnGap,
    spreadStepPx,
  ]);

  const stepPrev = useCallback(() => {
    if (isSpread) {
      if (spreadIndex > 0) {
        const next = spreadIndex - 1;
        setSpreadIndex(next);
        onScrollProgress(totalSpreads > 1 ? next / (totalSpreads - 1) : 0);
        onScrollDirection?.('down');
      } else if (hasPrevChapter) {
        onChapterChange(chapterIndex - 1, 1);
      }
    } else if (hasPrevChapter) {
      onChapterChange(chapterIndex - 1, 0);
    }
  }, [
    isSpread,
    spreadIndex,
    totalSpreads,
    hasPrevChapter,
    chapterIndex,
    onChapterChange,
    onScrollProgress,
    onScrollDirection,
  ]);

  const stepNext = useCallback(() => {
    if (isSpread) {
      if (spreadIndex < totalSpreads - 1) {
        const next = spreadIndex + 1;
        setSpreadIndex(next);
        onScrollProgress(totalSpreads > 1 ? next / (totalSpreads - 1) : 1);
        onScrollDirection?.('down');
      } else if (hasNextChapter) {
        onChapterChange(chapterIndex + 1, 0);
      }
    } else if (hasNextChapter) {
      onChapterChange(chapterIndex + 1, 0);
    }
  }, [
    isSpread,
    spreadIndex,
    totalSpreads,
    hasNextChapter,
    chapterIndex,
    onChapterChange,
    onScrollProgress,
    onScrollDirection,
  ]);

  useImperativeHandle(navRef, () => ({stepPrev, stepNext}), [stepPrev, stepNext]);

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stepPrev, stepNext]);

  const handleScroll = () => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const top = scroller.scrollTop;
    const delta = top - lastScrollTopRef.current;
    if (delta > 14 && top > 48) {
      onScrollDirection?.('down');
      lastScrollTopRef.current = top;
    } else if (delta < -14 || top <= 24) {
      onScrollDirection?.('up');
      lastScrollTopRef.current = top;
    }

    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, top / maxScroll)) : 0;
    onScrollProgress(ratio);
  };

  const handleMouseUp = () => {
    const prose = proseRef.current;
    if (!prose) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (!noteOpen) setSelectionMenu(null);
      return;
    }

    const range = sel.getRangeAt(0);
    if (!prose.contains(range.commonAncestorContainer)) {
      if (!noteOpen) setSelectionMenu(null);
      return;
    }

    const selectedText = sel.toString().trim();
    if (selectedText.length < 2) {
      if (!noteOpen) setSelectionMenu(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const fullText = prose.textContent || '';
    const idx = fullText.indexOf(selectedText);
    const prefix = idx > 0 ? fullText.slice(Math.max(0, idx - 24), idx) : '';
    const suffix =
      idx !== -1 ? fullText.slice(idx + selectedText.length, idx + selectedText.length + 24) : '';

    setSelectionMenu({
      text: selectedText,
      prefix,
      suffix,
      x: Math.min(window.innerWidth - 160, Math.max(160, rect.left + rect.width / 2)),
      y: Math.max(72, rect.top - 12),
    });
    setNoteOpen(false);
    setNoteText('');
  };

  const touchStartRef = useRef<{x: number; y: number; time: number} | null>(null);
  const justSwipedRef = useRef(false);

  const turnPageMobile = useCallback(
    (dir: 'prev' | 'next') => {
      if (isSpread) {
        if (dir === 'next') stepNext();
        else stepPrev();
        return;
      }
      const scroller = scrollContainerRef.current;
      if (scroller) {
        const pageStep = Math.max(240, scroller.clientHeight * 0.84);
        if (dir === 'next') {
          const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24;
          if (!atBottom) {
            scroller.scrollBy({top: pageStep, behavior: 'smooth'});
            return;
          }
          if (hasNextChapter) onChapterChange(chapterIndex + 1, 0);
        } else {
          if (scroller.scrollTop > 32) {
            scroller.scrollBy({top: -pageStep, behavior: 'smooth'});
            return;
          }
          if (hasPrevChapter) onChapterChange(chapterIndex - 1, 0);
        }
      } else {
        if (dir === 'next') stepNext();
        else stepPrev();
      }
    },
    [isSpread, stepNext, stepPrev, hasNextChapter, hasPrevChapter, chapterIndex, onChapterChange]
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.innerWidth >= 1024 || e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartRef.current = {x: t.clientX, y: t.clientY, time: Date.now()};
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (window.innerWidth >= 1024 || !touchStartRef.current || e.changedTouches.length !== 1) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const elapsed = Date.now() - start.time;

    if (elapsed < 600 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      justSwipedRef.current = true;
      window.setTimeout(() => {
        justSwipedRef.current = false;
      }, 280);
      turnPageMobile(dx < 0 ? 'next' : 'prev');
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (justSwipedRef.current) return;
    const el = e.target as HTMLElement | null;
    if (!el) return;

    const hlMark = el.closest('mark.folio-hl') as HTMLElement | null;
    if (hlMark?.dataset.highlightId) {
      onFocusHighlight(hlMark.dataset.highlightId);
      return;
    }

    if (el.closest('a, button, input, textarea, select')) return;

    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

    // On mobile viewports (<1024px), outer 20% edge zones turn pages and center 60% toggles bars
    if (window.innerWidth < 1024) {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (relX < 0.2) {
        turnPageMobile('prev');
        return;
      }
      if (relX > 0.8) {
        turnPageMobile('next');
        return;
      }
    }

    onCenterTap?.();
  };

  const commitHighlight = (color: HighlightColor, note = '') => {
    if (!selectionMenu) return;
    onCreateHighlight({
      selectedText: selectionMenu.text,
      prefixContext: selectionMenu.prefix,
      suffixContext: selectionMenu.suffix,
      color,
      note,
    });
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
    setNoteOpen(false);
    setNoteText('');
  };

  const fontClass =
    prefs.fontFamily === 'sans'
      ? 'font-sans-ui'
      : prefs.fontFamily === 'mono'
        ? 'font-mono-tabular'
        : 'font-serif-editorial';

  const proseCustomStyles = {
    fontSize: `${prefs.fontSize}px`,
    lineHeight: prefs.lineHeight,
    '--folio-para-gap': `${prefs.paragraphSpacing}em`,
    '--folio-text-align': prefs.textAlign,
    '--folio-text-indent': `${prefs.textIndent}em`,
  } as React.CSSProperties;

  const canGoPrev = isSpread ? spreadIndex > 0 || hasPrevChapter : hasPrevChapter;
  const canGoNext = isSpread ? spreadIndex < totalSpreads - 1 || hasNextChapter : hasNextChapter;

  const spreadTopPad = headerPinned
    ? 'pt-5'
    : topOverlayActive
      ? 'pt-26'
      : 'pt-6';
  const spreadBottomPad = bottomBarPinned
    ? 'pb-5'
    : bottomOverlayActive
      ? 'pb-16'
      : 'pb-6';
  const scrollTopPad = headerPinned ? 'pt-10' : 'pt-28';
  const scrollBottomPad = bottomBarPinned ? 'pb-14' : 'pb-28';

  return (
    <div className="flex-1 min-w-0 h-full relative bg-[var(--bg-canvas)] flex flex-col overflow-hidden">
      {isSpread ? (
        /* Two-Page Book Spread Viewport */
        <div
          onClick={handleCanvasClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`flex-1 min-h-0 flex flex-col justify-between px-5 sm:px-14 transition-[padding] duration-180 ${spreadTopPad} ${spreadBottomPad}`}
        >
          <div
            className="mx-auto w-full flex-1 min-h-0 flex flex-col relative"
            style={{maxWidth: `${Math.min(1260, prefs.pageWidth + 460)}px`}}
          >
            {/* Subtle top running header inside spread */}
            <div className="mb-4 pb-2 border-b border-[var(--border-subtle)]/70 flex items-center justify-between text-[11px] text-[var(--text-muted)] shrink-0">
              <span className="truncate">{chapter?.title}</span>
              <span className="font-mono-tabular shrink-0 ml-4">
                Spread {spreadIndex + 1} / {totalSpreads}
              </span>
            </div>

            {/* Paginated Multi-Column Frame */}
            <div ref={spreadFrameRef} className="relative flex-1 min-h-0 overflow-hidden">
              {/* Subtle vertical center codex gutter divider when 2 columns are active */}
              {isTwoColumn && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[var(--border-subtle)]/75"
                />
              )}

              <div
                ref={proseRef}
                onMouseUp={handleMouseUp}
                onTouchEnd={handleMouseUp}
                className={`folio-prose folio-spread-content ${fontClass} transition-transform duration-200 ease-out`}
                style={{
                  ...proseCustomStyles,
                  height: `${spreadDims.height}px`,
                  columnWidth: `${isTwoColumn ? Math.floor((spreadDims.width - columnGap) / 2) : spreadDims.width}px`,
                  columnGap: `${columnGap}px`,
                  transform: `translateX(-${spreadIndex * spreadStepPx}px)`,
                }}
              />
            </div>

            {/* Subtle Side Page-Turn Buttons */}
            <button
              type="button"
              disabled={!canGoPrev}
              onClick={(e) => {
                e.stopPropagation();
                stepPrev();
              }}
              aria-label="Previous spread"
              className="hidden sm:flex items-center justify-center absolute -left-9 top-1/2 -translate-y-1/2 w-8 h-14 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]/80 disabled:opacity-20 disabled:pointer-events-none transition-colors cursor-pointer z-20"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={(e) => {
                e.stopPropagation();
                stepNext();
              }}
              aria-label="Next spread"
              className="hidden sm:flex items-center justify-center absolute -right-9 top-1/2 -translate-y-1/2 w-8 h-14 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]/80 disabled:opacity-20 disabled:pointer-events-none transition-colors cursor-pointer z-20"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        /* Continuous Vertical Scroll Viewport */
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onClick={handleCanvasClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] relative"
        >
          <div
            className={`mx-auto px-5 sm:px-10 ${scrollTopPad} ${scrollBottomPad}`}
            style={{maxWidth: `${prefs.pageWidth + 80}px`}}
          >
            {/* Quiet Chapter Header */}
            <div className="mb-8 pb-4 border-b border-[var(--border-subtle)] flex items-baseline justify-between gap-4">
              <span className="text-xs text-[var(--text-muted)] truncate">{chapter?.title}</span>
              <span className="font-mono-tabular text-[11px] text-[var(--text-muted)] shrink-0">
                {chapterIndex + 1} / {chapters.length}
              </span>
            </div>

            {/* Rendered Prose Content */}
            <div
              ref={proseRef}
              onMouseUp={handleMouseUp}
              onTouchEnd={handleMouseUp}
              className={`folio-prose ${fontClass}`}
              style={proseCustomStyles}
            />

            {/* Bottom Chapter Navigation */}
            <div className="mt-16 pt-8 border-t border-[var(--border-subtle)] flex items-center justify-between gap-4">
              <button
                type="button"
                disabled={!hasPrevChapter}
                onClick={(e) => {
                  e.stopPropagation();
                  onChapterChange(chapterIndex - 1, 0);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous Section</span>
              </button>

              <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                {chapterIndex + 1} of {chapters.length}
              </span>

              <button
                type="button"
                disabled={!hasNextChapter}
                onClick={(e) => {
                  e.stopPropagation();
                  onChapterChange(chapterIndex + 1, 0);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                <span>Next Section</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Highlight & Note Toolbar */}
      {selectionMenu && (
        <div
          style={{
            left: `${selectionMenu.x}px`,
            top: `${selectionMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl p-2"
        >
          {!noteOpen ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-1">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={`Highlight ${c.label}`}
                    aria-label={`Highlight in ${c.label}`}
                    onClick={() => commitHighlight(c.id)}
                    className="w-5 h-5 rounded-full border border-black/15 hover:scale-110 transition-transform cursor-pointer"
                    style={{backgroundColor: c.swatch}}
                  />
                ))}
              </div>
              <div className="h-4 w-px bg-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer whitespace-nowrap"
              >
                <StickyNote className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Add Note</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectionMenu(null)}
                aria-label="Dismiss selection toolbar"
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="w-72 p-1.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setNoteColor(c.id)}
                      aria-label={`Select ${c.label} highlight`}
                      className={`w-4 h-4 rounded-full cursor-pointer ${
                        noteColor === c.id
                          ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-elevated)]'
                          : 'opacity-70'
                      }`}
                      style={{backgroundColor: c.swatch}}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectionMenu(null)}
                  aria-label="Cancel note"
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                rows={3}
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Write a note for this highlight..."
                className="w-full px-2.5 py-2 text-xs rounded border border-[var(--border-strong)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNoteOpen(false)}
                  className="px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => commitHighlight(noteColor, noteText.trim())}
                  className="px-3 py-1 text-xs font-medium rounded bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Save Highlight
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
