export interface NarrationWord {
  index: number;
  text: string;
  startInSentence: number;
  endInSentence: number;
  weight: number;
}

export interface PdfSentenceSegment {
  spanIndex: number;
  startInSpan: number;
  endInSpan: number;
  startInSentence: number;
  endInSentence: number;
}

export interface NarrationSentence {
  index: number;
  unitIndex: number;
  rawText: string;
  spokenText: string;
  words: NarrationWord[];
  /** Character offsets in the reflowable block's text nodes */
  domStart?: number;
  domEnd?: number;
  /** Mapped span segments in a PDF page text layer */
  pdfSegments?: PdfSentenceSegment[];
  /** Estimated spoken duration at 1.0x in seconds */
  estimatedSec: number;
}

const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'eg',
  'ie',
  'fig',
  'ch',
  'no',
  'vol',
  'pp',
  'p',
  'ed',
  'rev',
  'gen',
  'col',
  'lt',
  'sgt',
  'capt',
  'inc',
  'ltd',
  'co',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
]);

const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'DT',
  'DD',
  'FIGCAPTION',
  'TD',
  'TH',
  'PRE',
  'DIV',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'HR',
  'BR',
]);

export function cleanSpokenText(raw: string, skipNoise: boolean): string {
  let out = raw.replace(/\s+/g, ' ').trim();
  if (!skipNoise) return out;

  // Strip raw URLs
  out = out.replace(/https?:\/\/\S+|www\.\S+/gi, '');
  // Strip bracketed numeric or single-letter footnote references like [1], [12, 13], [a]
  out = out.replace(/\[\s*(?:\d+(?:\s*[-–,]\s*\d+)*|[a-z*†‡])\s*\]/gi, '');
  // Strip standalone page markers like "Page 14" or "- 14 -"
  if (/^(?:page\s+\d+(?:\s+of\s+\d+)?|[-–—•·\s]*\d{1,4}[-–—•·\s]*)$/i.test(out)) {
    return '';
  }
  // Collapse decorative divider symbols
  out = out.replace(/[•·■□▪▫◆◇★☆]{2,}/g, ' ');
  out = out.replace(/[-_=*~]{3,}/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

export function tokenizeWords(sentenceText: string): NarrationWord[] {
  const words: NarrationWord[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(sentenceText)) !== null) {
    const wordText = match[0];
    const alphaLen = wordText.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '').length;
    let weight = Math.max(1.8, alphaLen * 0.85 + 1.2);
    // Natural breath pause weights for punctuation
    if (/[,;:—–]$/.test(wordText)) weight += 2.2;
    else if (/[.!?…]["'”’)\]]*$/.test(wordText)) weight += 3.0;

    words.push({
      index: idx++,
      text: wordText,
      startInSentence: match.index,
      endInSentence: match.index + wordText.length,
      weight,
    });
  }

  return words;
}

export function estimateSentenceDurationSec(spokenText: string): number {
  const wordCount = spokenText.split(/\s+/).filter(Boolean).length;
  // ~155 words per minute (~2.58 words/sec) typical literary narration pace
  return Math.max(1.1, wordCount / 2.55);
}

/**
 * Splits a block of text into sentence ranges [start, end) while respecting
 * common abbreviations and gently subdividing overly long sentences (> 260 chars).
 */
export function splitBlockIntoSentenceRanges(text: string): Array<{start: number; end: number}> {
  const ranges: Array<{start: number; end: number}> = [];
  const len = text.length;
  let start = 0;

  const pushSlice = (rawStart: number, rawEnd: number) => {
    let s = rawStart;
    let e = rawEnd;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e <= s) return;

    // Subdivide very long sentences on clause boundaries for snappy TTS latency & tight word sync
    const MAX_LEN = 260;
    if (e - s > MAX_LEN) {
      let cursor = s;
      while (e - cursor > MAX_LEN) {
        const searchEnd = Math.min(e, cursor + MAX_LEN);
        const minSplit = cursor + 90;
        let splitAt = -1;
        // Prefer semicolon, colon, em-dash, or comma near target length
        for (let k = searchEnd; k >= minSplit; k--) {
          const ch = text[k];
          if (ch === ';' || ch === ':' || ch === '—' || ch === '–' || ch === ',') {
            splitAt = k + 1;
            break;
          }
        }
        if (splitAt === -1) {
          // Fall back to space
          for (let k = searchEnd; k >= minSplit; k--) {
            if (/\s/.test(text[k])) {
              splitAt = k;
              break;
            }
          }
        }
        if (splitAt === -1 || splitAt <= cursor) break;
        let subEnd = splitAt;
        while (subEnd > cursor && /\s/.test(text[subEnd - 1])) subEnd--;
        if (subEnd > cursor) ranges.push({start: cursor, end: subEnd});
        cursor = splitAt;
        while (cursor < e && /\s/.test(text[cursor])) cursor++;
      }
      if (cursor < e) {
        ranges.push({start: cursor, end: e});
      }
      return;
    }

    ranges.push({start: s, end: e});
  };

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      // Advance past consecutive punctuation or closing quotes/parens
      let endIdx = i + 1;
      while (endIdx < len && /[.!?…"'”’)\]]/.test(text[endIdx])) {
        endIdx++;
      }

      // Must be end of text or followed by whitespace
      if (endIdx < len && !/\s/.test(text[endIdx])) {
        continue;
      }

      // Check for abbreviations or single initials before '.'
      if (ch === '.') {
        const before = text.slice(Math.max(start, i - 12), i);
        const wordMatch = before.match(/([A-Za-z]+)$/);
        if (wordMatch) {
          const w = wordMatch[1].toLowerCase();
          if (ABBREVIATIONS.has(w) || (w.length === 1 && /[A-Z]/.test(wordMatch[1]))) {
            continue;
          }
        }
        // Decimal numbers like 3.14
        if (i > 0 && /\d/.test(text[i - 1]) && i + 1 < len && /\d/.test(text[i + 1])) {
          continue;
        }
      }

      pushSlice(start, endIdx);
      start = endIdx;
      i = endIdx - 1;
    }
  }

  if (start < len) {
    pushSlice(start, len);
  }

  return ranges;
}

interface TextNodeOffset {
  node: Text;
  start: number;
  end: number;
}

function isNoiseElement(el: Element | null, skipNoise: boolean): boolean {
  if (!el) return false;
  if (el.closest('script, style, noscript, svg, math')) return true;
  if (!skipNoise) return false;
  if (el.closest('sup, nav, footer')) return true;
  if (
    el.closest(
      '[role="doc-noteref"], [role="doc-pagebreak"], [epub\\:type~="noteref"], [epub\\:type~="pagebreak"], .footnote, .page-number'
    )
  ) {
    return true;
  }
  return false;
}

function getClosestBlockAncestor(node: Node, root: HTMLElement): Element {
  let cur: Element | null = node.parentElement;
  while (cur && cur !== root) {
    if (BLOCK_TAGS.has(cur.tagName)) return cur;
    cur = cur.parentElement;
  }
  return root;
}

export function collectReflowableTextNodes(
  container: HTMLElement,
  skipNoise: boolean
): {fullText: string; offsets: TextNodeOffset[]; blockBreakIndices: Set<number>} {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const offsets: TextNodeOffset[] = [];
  const blockBreakIndices = new Set<number>();

  let fullText = '';
  let lastBlock: Element | null = null;
  let node = walker.nextNode();

  while (node) {
    const val = node.nodeValue || '';
    const parentEl = node.parentElement;
    if (val.length > 0 && !isNoiseElement(parentEl, skipNoise)) {
      const block = getClosestBlockAncestor(node, container);
      if (lastBlock && block !== lastBlock) {
        blockBreakIndices.add(fullText.length);
        // Synthetic newline separator between blocks so sentences never run together
        fullText += '\n';
      }
      lastBlock = block;
      const start = fullText.length;
      fullText += val;
      offsets.push({node: node as Text, start, end: start + val.length});
    }
    node = walker.nextNode();
  }

  return {fullText, offsets, blockBreakIndices};
}

export function extractReflowableNarrationMap(
  container: HTMLElement,
  unitIndex: number,
  skipNoise: boolean
): NarrationSentence[] {
  const {fullText} = collectReflowableTextNodes(container, skipNoise);
  const sentences: NarrationSentence[] = [];
  if (!fullText.trim()) return sentences;

  // Split by synthetic block newlines first so headings & paragraphs always form distinct sentences
  let cursor = 0;
  let sentenceIdx = 0;
  const blocks = fullText.split('\n');

  for (let b = 0; b < blocks.length; b++) {
    const blockText = blocks[b];
    const blockStart = cursor;
    cursor += blockText.length + 1; // +1 for '\n'

    if (!blockText.trim()) continue;
    const subRanges = splitBlockIntoSentenceRanges(blockText);
    for (const r of subRanges) {
      const rawText = blockText.slice(r.start, r.end);
      const spokenText = cleanSpokenText(rawText, skipNoise);
      if (!spokenText || !/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF]/.test(spokenText)) {
        continue;
      }
      const words = tokenizeWords(rawText);
      if (words.length === 0) continue;

      sentences.push({
        index: sentenceIdx++,
        unitIndex,
        rawText: rawText.replace(/\s+/g, ' ').trim(),
        spokenText,
        words,
        domStart: blockStart + r.start,
        domEnd: blockStart + r.end,
        estimatedSec: estimateSentenceDurationSec(spokenText),
      });
    }
  }

  return sentences;
}

export function clearTtsDomHighlights(container: HTMLElement | null): void {
  if (!container) return;
  const spans = container.querySelectorAll('span.folio-tts-word, span.folio-tts-sentence');
  if (spans.length === 0) return;

  // Unwrap innermost word spans first, then sentence spans
  const ordered = Array.from(spans).reverse();
  for (const span of ordered) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  }
  container.normalize();
}

function wrapDomRange(
  offsets: TextNodeOffset[],
  rangeStart: number,
  rangeEnd: number,
  className: string
): HTMLElement | null {
  let firstEl: HTMLElement | null = null;
  const involved = offsets.filter((o) => o.end > rangeStart && o.start < rangeEnd);

  for (const seg of involved) {
    const localStart = Math.max(0, rangeStart - seg.start);
    const localEnd = Math.min(seg.node.nodeValue?.length ?? 0, rangeEnd - seg.start);
    if (localEnd <= localStart) continue;

    const textNode = seg.node;
    const value = textNode.nodeValue || '';
    const before = value.slice(0, localStart);
    const middle = value.slice(localStart, localEnd);
    const after = value.slice(localEnd);

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));

    const span = document.createElement('span');
    span.className = className;
    span.textContent = middle;
    if (!firstEl) firstEl = span;
    frag.appendChild(span);

    if (after) frag.appendChild(document.createTextNode(after));
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return firstEl;
}

export function applyTtsDomHighlight(
  container: HTMLElement,
  sentence: NarrationSentence,
  activeWordIndex: number,
  skipNoise: boolean
): {sentenceEl: HTMLElement | null; wordEl: HTMLElement | null} {
  clearTtsDomHighlights(container);
  if (sentence.domStart === undefined || sentence.domEnd === undefined) {
    return {sentenceEl: null, wordEl: null};
  }

  // First pass: wrap active sentence
  const {offsets: sentenceOffsets} = collectReflowableTextNodes(container, skipNoise);
  const sentenceEl = wrapDomRange(
    sentenceOffsets,
    sentence.domStart,
    sentence.domEnd,
    'folio-tts-sentence'
  );

  // Second pass: wrap active word inside the sentence
  let wordEl: HTMLElement | null = null;
  if (activeWordIndex >= 0 && activeWordIndex < sentence.words.length) {
    const w = sentence.words[activeWordIndex];
    const wordStart = sentence.domStart + w.startInSentence;
    const wordEnd = sentence.domStart + w.endInSentence;
    const {offsets: wordOffsets} = collectReflowableTextNodes(container, skipNoise);
    wordEl = wrapDomRange(wordOffsets, wordStart, wordEnd, 'folio-tts-word');
  }

  return {sentenceEl, wordEl};
}

export function findSentenceAtDomPoint(
  container: HTMLElement,
  sentences: NarrationSentence[],
  clientX: number,
  clientY: number,
  skipNoise: boolean
): number | null {
  if (sentences.length === 0) return null;

  let caretNode: Node | null = null;
  let caretOffset = 0;

  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => {offsetNode: Node; offset: number} | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      caretNode = pos.offsetNode;
      caretOffset = pos.offset;
    }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range) {
      caretNode = range.startContainer;
      caretOffset = range.startOffset;
    }
  }

  if (!caretNode || !container.contains(caretNode)) return null;

  // Map caretNode + caretOffset to global char offset in container
  const {offsets} = collectReflowableTextNodes(container, skipNoise);
  let targetNode: Node = caretNode;
  if (targetNode.nodeType !== Node.TEXT_NODE) {
    const child = targetNode.childNodes[Math.min(caretOffset, targetNode.childNodes.length - 1)];
    if (child && child.nodeType === Node.TEXT_NODE) {
      targetNode = child;
      caretOffset = 0;
    }
  }

  const entry = offsets.find((o) => o.node === targetNode);
  if (!entry) return null;
  const globalPos = entry.start + Math.min(caretOffset, entry.end - entry.start);

  // Exact match
  const exact = sentences.find(
    (s) => s.domStart !== undefined && s.domEnd !== undefined && globalPos >= s.domStart && globalPos <= s.domEnd
  );
  if (exact) return exact.index;

  // Nearest sentence
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of sentences) {
    if (s.domStart === undefined || s.domEnd === undefined) continue;
    const dist =
      globalPos < s.domStart ? s.domStart - globalPos : globalPos > s.domEnd ? globalPos - s.domEnd : 0;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = s.index;
    }
  }
  return bestIdx;
}

export function findFirstVisibleReflowableSentence(
  container: HTMLElement,
  viewportEl: HTMLElement | null,
  sentences: NarrationSentence[],
  skipNoise: boolean
): number {
  if (sentences.length === 0 || !viewportEl) return 0;
  const vpRect = viewportEl.getBoundingClientRect();
  const {offsets} = collectReflowableTextNodes(container, skipNoise);
  const range = document.createRange();

  for (const s of sentences) {
    if (s.domStart === undefined) continue;
    const seg = offsets.find((o) => o.end > s.domStart! && o.start <= s.domStart!);
    if (!seg) continue;
    const localStart = Math.max(0, s.domStart - seg.start);
    const localEnd = Math.min(seg.node.nodeValue?.length ?? 0, localStart + 1);
    if (localEnd <= localStart) continue;
    try {
      range.setStart(seg.node, localStart);
      range.setEnd(seg.node, localEnd);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (
        rect.bottom >= vpRect.top + 24 &&
        rect.top <= vpRect.bottom &&
        rect.right >= vpRect.left &&
        rect.left <= vpRect.right
      ) {
        return s.index;
      }
    } catch {
      // ignore detached text nodes
    }
  }

  return 0;
}

/* -------------------------------------------------------------------------- */
/* PDF Text-Layer Sentence Extraction & Visual Word Sync                      */
/* -------------------------------------------------------------------------- */

export interface PdfSpanMeta {
  spanIndex: number;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function extractPdfPageSentences(
  spans: PdfSpanMeta[],
  pageNumber: number,
  pageHeight: number,
  skipNoise: boolean
): NarrationSentence[] {
  if (spans.length === 0) return [];

  // Filter out top/bottom running headers, footers, and isolated margin page numbers when skipNoise is on
  const topCutoff = pageHeight * 0.068;
  const bottomCutoff = pageHeight * 0.925;

  const filtered = spans.filter((sp) => {
    const trimmed = sp.text.trim();
    if (!trimmed) return false;
    if (!skipNoise) return true;
    const inMargin = sp.top < topCutoff || sp.top + sp.height > bottomCutoff;
    if (inMargin) {
      // Pure numbers or short running headers/footers in top/bottom margins
      if (/^[-–—•·\s]*\d{1,4}[-–—•·\s]*$/.test(trimmed)) return false;
      if (trimmed.length <= 55 && !/[.!?]$/.test(trimmed)) return false;
    }
    return true;
  });

  if (filtered.length === 0) return [];

  // Group into reading-order visual lines (tolerance based on font height)
  const sorted = [...filtered].sort((a, b) => {
    const tol = Math.max(4, Math.min(a.height, b.height) * 0.55);
    if (Math.abs(a.top - b.top) <= tol) return a.left - b.left;
    return a.top - b.top;
  });

  // Concatenate into page stream with exact span segment tracking
  let fullText = '';
  const spanMap: Array<{
    spanIndex: number;
    startInFull: number;
    endInFull: number;
    text: string;
  }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const sp = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    if (prev) {
      const lineGap = sp.top - prev.top;
      const lineH = Math.max(10, prev.height);
      if (lineGap > lineH * 1.65) {
        fullText += '\n';
      } else if (!fullText.endsWith(' ') && !fullText.endsWith('\n') && !sp.text.startsWith(' ')) {
        fullText += ' ';
      }
    }
    const startInFull = fullText.length;
    fullText += sp.text;
    spanMap.push({
      spanIndex: sp.spanIndex,
      startInFull,
      endInFull: fullText.length,
      text: sp.text,
    });
  }

  const sentences: NarrationSentence[] = [];
  let sentenceIdx = 0;
  let cursor = 0;
  const blocks = fullText.split('\n');

  for (const block of blocks) {
    const blockStart = cursor;
    cursor += block.length + 1;
    if (!block.trim()) continue;

    const ranges = splitBlockIntoSentenceRanges(block);
    for (const r of ranges) {
      const globalStart = blockStart + r.start;
      const globalEnd = blockStart + r.end;
      const rawText = fullText.slice(globalStart, globalEnd);
      const spokenText = cleanSpokenText(rawText, skipNoise);
      if (!spokenText || !/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF]/.test(spokenText)) {
        continue;
      }

      const words = tokenizeWords(rawText);
      if (words.length === 0) continue;

      const pdfSegments: PdfSentenceSegment[] = [];
      for (const sm of spanMap) {
        if (sm.endInFull <= globalStart || sm.startInFull >= globalEnd) continue;
        const overlapStart = Math.max(sm.startInFull, globalStart);
        const overlapEnd = Math.min(sm.endInFull, globalEnd);
        if (overlapEnd <= overlapStart) continue;
        pdfSegments.push({
          spanIndex: sm.spanIndex,
          startInSpan: overlapStart - sm.startInFull,
          endInSpan: overlapEnd - sm.startInFull,
          startInSentence: overlapStart - globalStart,
          endInSentence: overlapEnd - globalStart,
        });
      }

      sentences.push({
        index: sentenceIdx++,
        unitIndex: pageNumber,
        rawText: rawText.replace(/\s+/g, ' ').trim(),
        spokenText,
        words,
        pdfSegments,
        estimatedSec: estimateSentenceDurationSec(spokenText),
      });
    }
  }

  return sentences;
}
