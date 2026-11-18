import DOMPurify from 'dompurify';
import type {
  ImportMetadataResult,
  ParsedChapter,
  ParsedReflowableBook,
  ParsedTocItem,
} from '../../types/library';

interface PalmDbRecordInfo {
  offset: number;
  length: number;
}

interface ParsedMobiBinary {
  title: string;
  author: string;
  publisher: string;
  year: string;
  language: string;
  description: string;
  coverDataUrl: string | null;
  rawHtml: string;
  images: Map<number, string>;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  const end = Math.min(view.byteLength, offset + length);
  for (let i = offset; i < end; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function decompressPalmDoc(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i++];
    if (c === 0) {
      out.push(0);
    } else if (c >= 1 && c <= 8) {
      // Literal next c bytes
      for (let j = 0; j < c && i < input.length; j++) {
        out.push(input[i++]);
      }
    } else if (c <= 0x7f) {
      out.push(c);
    } else if (c >= 0xc0) {
      // Space + (c ^ 0x80)
      out.push(0x20, c ^ 0x80);
    } else {
      // LZ77 back-reference (0x80..0xbf)
      if (i >= input.length) break;
      const next = input[i++];
      const combined = (c << 8) | next;
      const distance = (combined >> 3) & 0x07ff;
      const length = (combined & 0x07) + 3;
      const start = out.length - distance;
      if (distance > 0 && start >= 0) {
        for (let j = 0; j < length; j++) {
          out.push(out[start + j] ?? 0x20);
        }
      }
    }
  }
  return new Uint8Array(out);
}

function stripTrailingEntries(record: Uint8Array, extraFlags: number): Uint8Array {
  let size = record.length;
  // Bits 1..15 indicate variable-length trailing entries
  for (let bit = 15; bit >= 1; bit--) {
    if ((extraFlags & (1 << bit)) !== 0) {
      // Read backwards variable-width integer (stop bit = 0x80)
      let num = 0;
      let shift = 0;
      let pos = size - 1;
      while (pos >= 0 && pos >= size - 4) {
        const b = record[pos];
        num |= (b & 0x7f) << shift;
        shift += 7;
        pos--;
        if ((b & 0x80) !== 0) break;
      }
      if (num > 0 && num <= size) {
        size -= num;
      }
    }
  }
  // Bit 0 indicates multibyte overlap count
  if ((extraFlags & 1) !== 0 && size > 0) {
    const overlap = (record[size - 1] & 0x03) + 1;
    if (overlap <= size) {
      size -= overlap;
    }
  }
  return record.subarray(0, Math.max(0, size));
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

function uint8ToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function parseMobiBinary(buffer: ArrayBuffer, fallbackTitle: string): ParsedMobiBinary {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (buffer.byteLength < 80) {
    throw new Error('File is too small to be a valid MOBI document.');
  }

  const pdbName = readAscii(view, 0, 32).replace(/_/g, ' ').trim();
  const ident = readAscii(view, 60, 8);
  if (ident !== 'BOOKMOBI' && ident !== 'TEXtREAd') {
    throw new Error('Unrecognized MOBI/PRC header. Only standard DRM-free MOBI/PRC files are supported.');
  }

  const recordCount = view.getUint16(76, false);
  if (recordCount < 2) {
    throw new Error('MOBI file contains no readable records.');
  }

  const records: PalmDbRecordInfo[] = [];
  for (let i = 0; i < recordCount; i++) {
    const entryOffset = 78 + i * 8;
    const recOffset = view.getUint32(entryOffset, false);
    records.push({offset: recOffset, length: 0});
  }
  for (let i = 0; i < recordCount; i++) {
    const nextOffset = i + 1 < recordCount ? records[i + 1].offset : buffer.byteLength;
    records[i].length = Math.max(0, nextOffset - records[i].offset);
  }

  // Record 0: PalmDOC header + MOBI header + EXTH header
  const rec0Offset = records[0].offset;
  const compression = view.getUint16(rec0Offset + 0, false);
  const textRecordCount = view.getUint16(rec0Offset + 8, false);
  const encryption = view.getUint16(rec0Offset + 12, false);

  if (encryption !== 0) {
    throw new Error('This MOBI file is DRM-encrypted and cannot be opened offline.');
  }
  if (compression === 17480) {
    throw new Error('HUFF/CDIC-compressed MOBI files are not supported. Please convert to EPUB or standard PalmDOC MOBI.');
  }

  let title = pdbName || fallbackTitle;
  let author = 'Unknown Author';
  let publisher = '';
  let year = '';
  let language = 'en';
  let description = '';
  let encoding = 65001; // UTF-8 default
  let firstImageIndex = -1;
  let extraFlags = 0;
  let coverOffsetRel = -1;

  // Check MOBI header at rec0Offset + 16
  if (rec0Offset + 24 < buffer.byteLength && readAscii(view, rec0Offset + 16, 4) === 'MOBI') {
    const mobiHeaderLen = view.getUint32(rec0Offset + 20, false);
    encoding = view.getUint32(rec0Offset + 28, false);
    const fullNameOffset = view.getUint32(rec0Offset + 84, false);
    const fullNameLen = view.getUint32(rec0Offset + 88, false);
    const rawFirstImg = view.getUint32(rec0Offset + 108, false);
    if (rawFirstImg < recordCount) {
      firstImageIndex = rawFirstImg;
    }
    const exthFlags = view.getUint32(rec0Offset + 128, false);

    if (mobiHeaderLen >= 228 && rec0Offset + 244 <= buffer.byteLength) {
      extraFlags = view.getUint16(rec0Offset + 242, false);
    }

    const decoder = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8', {fatal: false});

    if (fullNameLen > 0 && rec0Offset + fullNameOffset + fullNameLen <= buffer.byteLength) {
      const decodedTitle = decoder
        .decode(bytes.subarray(rec0Offset + fullNameOffset, rec0Offset + fullNameOffset + fullNameLen))
        .trim();
      if (decodedTitle) title = decodedTitle;
    }

    // Parse EXTH metadata block if flag bit 6 (0x40) is set
    if ((exthFlags & 0x40) !== 0) {
      const exthOffset = rec0Offset + 16 + mobiHeaderLen;
      if (exthOffset + 12 <= buffer.byteLength && readAscii(view, exthOffset, 4) === 'EXTH') {
        const exthCount = view.getUint32(exthOffset + 8, false);
        let cursor = exthOffset + 12;
        for (let r = 0; r < exthCount && cursor + 8 <= buffer.byteLength; r++) {
          const recType = view.getUint32(cursor, false);
          const recLen = view.getUint32(cursor + 4, false);
          if (recLen < 8 || cursor + recLen > buffer.byteLength) break;
          const payload = bytes.subarray(cursor + 8, cursor + recLen);

          if (recType === 100) {
            const val = decoder.decode(payload).trim();
            if (val) author = val;
          } else if (recType === 101) {
            publisher = decoder.decode(payload).trim();
          } else if (recType === 103) {
            description = decoder.decode(payload).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          } else if (recType === 106) {
            const pubDate = decoder.decode(payload).trim();
            const m = pubDate.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
            if (m) year = m[1];
          } else if (recType === 503) {
            const val = decoder.decode(payload).trim();
            if (val) title = val;
          } else if (recType === 524) {
            language = decoder.decode(payload).trim() || language;
          } else if (recType === 201 && payload.length >= 4) {
            coverOffsetRel = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false);
          }

          cursor += recLen;
        }
      }
    }
  }

  // Extract images starting at firstImageIndex
  const images = new Map<number, string>();
  let coverDataUrl: string | null = null;

  if (firstImageIndex > 0 && firstImageIndex < recordCount) {
    let imgIdx = 1; // MOBI recindex is 1-based
    for (let r = firstImageIndex; r < recordCount; r++) {
      const rec = records[r];
      const recBytes = bytes.subarray(rec.offset, rec.offset + rec.length);
      const mime = detectImageMime(recBytes);
      if (mime) {
        const dataUrl = uint8ToDataUrl(recBytes, mime);
        images.set(imgIdx, dataUrl);
        if (coverOffsetRel >= 0 && r === firstImageIndex + coverOffsetRel) {
          coverDataUrl = dataUrl;
        }
        if (!coverDataUrl && imgIdx === 1) {
          coverDataUrl = dataUrl;
        }
      }
      imgIdx++;
    }
  }

  // Decompress text records (1..textRecordCount)
  const decoder = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8', {fatal: false});
  const textChunks: Uint8Array[] = [];
  const maxTextRec = Math.min(textRecordCount, recordCount - 1);

  for (let i = 1; i <= maxTextRec; i++) {
    const rec = records[i];
    let slice: Uint8Array = bytes.subarray(rec.offset, rec.offset + rec.length);
    if (extraFlags !== 0) {
      slice = stripTrailingEntries(slice, extraFlags);
    }
    if (compression === 2) {
      textChunks.push(decompressPalmDoc(slice));
    } else {
      textChunks.push(slice);
    }
  }

  const totalLen = textChunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of textChunks) {
    merged.set(chunk, pos);
    pos += chunk.length;
  }

  const rawHtml = decoder.decode(merged);

  return {
    title,
    author,
    publisher,
    year,
    language,
    description,
    coverDataUrl,
    rawHtml,
    images,
  };
}

function splitMobiIntoChapters(rawHtml: string, images: Map<number, string>): ParsedChapter[] {
  // Replace MOBI recindex image references with extracted data URLs
  const withImages = rawHtml.replace(
    /<img([^>]*?)recindex=["']?(\d+)["']?([^>]*?)>/gi,
    (_m, pre, recIdx, post) => {
      const num = parseInt(recIdx, 10);
      const url = images.get(num);
      if (!url) return '';
      return `<img${pre} src="${url}" ${post}>`;
    }
  );

  // Split by <mbp:pagebreak/> if present
  let segments = withImages
    .split(/<mbp:pagebreak\s*\/?>/i)
    .map((s) => s.trim())
    .filter((s) => s.replace(/<[^>]+>/g, '').trim().length > 20 || s.includes('<img'));

  // If no explicit pagebreaks, split on major headings or wrap plain text
  if (segments.length <= 1) {
    const isHtml = /<(p|div|h1|h2|h3|br|body)\b/i.test(withImages);
    if (!isHtml) {
      // Plain text PalmDOC
      const paragraphs = withImages
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${p.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br/>')}</p>`);

      segments = [];
      const perChapter = 45;
      for (let i = 0; i < paragraphs.length; i += perChapter) {
        segments.push(paragraphs.slice(i, i + perChapter).join('\n'));
      }
    } else {
      const byHeadings = withImages
        .split(/(?=<h[12]\b[^>]*>)/i)
        .map((s) => s.trim())
        .filter((s) => s.replace(/<[^>]+>/g, '').trim().length > 20);
      if (byHeadings.length > 1) {
        segments = byHeadings;
      } else {
        segments = [withImages];
      }
    }
  }

  const parser = new DOMParser();
  const chapters: ParsedChapter[] = [];

  segments.forEach((seg, index) => {
    const doc = parser.parseFromString(seg, 'text/html');
    doc.querySelectorAll('script, style').forEach((el) => el.remove());
    doc.querySelectorAll('[style]').forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.removeProperty('color');
      htmlEl.style.removeProperty('background');
      htmlEl.style.removeProperty('background-color');
      htmlEl.style.removeProperty('font-family');
    });

    const heading =
      doc.querySelector('h1, h2, h3, b, strong')?.textContent?.replace(/\s+/g, ' ').trim() ||
      `Section ${index + 1}`;

    const cleanHtml = DOMPurify.sanitize(doc.body.innerHTML, {
      ADD_TAGS: ['section', 'article', 'figure', 'figcaption'],
    });

    if (cleanHtml.trim().length > 0) {
      chapters.push({
        index: chapters.length,
        title: heading.slice(0, 100),
        html: cleanHtml,
      });
    }
  });

  if (chapters.length === 0) {
    chapters.push({
      index: 0,
      title: 'Document',
      html: '<p>No readable text content was found in this MOBI file.</p>',
    });
  }

  return chapters;
}

export async function extractMobiMetadata(
  buffer: ArrayBuffer,
  fallbackTitle: string
): Promise<ImportMetadataResult> {
  const parsed = parseMobiBinary(buffer, fallbackTitle);
  const chapters = splitMobiIntoChapters(parsed.rawHtml, parsed.images);

  return {
    title: parsed.title,
    author: parsed.author,
    publisher: parsed.publisher,
    year: parsed.year,
    language: parsed.language,
    description: parsed.description,
    coverDataUrl: parsed.coverDataUrl,
    totalUnits: Math.max(1, chapters.length),
    format: 'mobi',
  };
}

export async function parseMobiForReading(
  buffer: ArrayBuffer,
  fallbackTitle: string
): Promise<ParsedReflowableBook> {
  const parsed = parseMobiBinary(buffer, fallbackTitle);
  const chapters = splitMobiIntoChapters(parsed.rawHtml, parsed.images);
  const toc: ParsedTocItem[] = chapters.map((ch, idx) => ({
    id: `mobi-toc-${idx}`,
    title: ch.title || `Section ${idx + 1}`,
    unitIndex: idx,
    depth: 0,
  }));

  return {
    chapters,
    toc,
    cleanupUrls: [],
  };
}
