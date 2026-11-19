import DOMPurify from 'dompurify';
import JSZip from 'jszip';
import type {
  ImportMetadataResult,
  ParsedChapter,
  ParsedReflowableBook,
  ParsedTocItem,
} from '../../types/library';

const FOLIO_ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

const SELF_CLOSING_NON_VOID_RE =
  /<(a|div|span|p|title|h[1-6]|li|dt|dd|td|th|section|article|aside|header|footer|nav|figure|figcaption|blockquote|pre|code|em|strong|b|i|u|sup|sub|small|cite|q)\b([^>]*?)\s*\/>/gi;

function safeDecodeUri(val: string): string {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

function normalizePath(baseDir: string, relPath: string): string {
  const cleanRaw = relPath.trim().split('#')[0].split('?')[0].replace(/\\/g, '/');
  const cleanRel = safeDecodeUri(cleanRaw);
  if (cleanRel.startsWith('/')) return cleanRel.slice(1);
  const parts = (baseDir ? `${baseDir}/${cleanRel}` : cleanRel).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function getDirName(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

function parseXml(text: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return parser.parseFromString(text, 'text/html');
  }
  return doc;
}

function parseChapterDocument(rawHtml: string, parser: DOMParser): Document {
  const looksXml = /<\?xml|\bxmlns=|<[a-z]+\b[^>]*\/>/i.test(rawHtml);
  if (looksXml) {
    const xhtmlDoc = parser.parseFromString(rawHtml, 'application/xhtml+xml');
    if (!xhtmlDoc.querySelector('parsererror') && xhtmlDoc.querySelector('body')) {
      return xhtmlDoc;
    }
  }
  const expanded = rawHtml.replace(SELF_CLOSING_NON_VOID_RE, '<$1$2></$1>');
  return parser.parseFromString(expanded, 'text/html');
}

function getZipFileCaseInsensitive(zip: JSZip, targetPath: string): JSZip.JSZipObject | null {
  const normalized = targetPath.replace(/^\.\//, '').replace(/^\/+/, '');
  const direct = zip.file(normalized);
  if (direct) return direct;
  const lower = normalized.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    const cleanName = name.replace(/^\.\//, '').replace(/^\/+/, '');
    if (cleanName.toLowerCase() === lower || safeDecodeUri(cleanName).toLowerCase() === lower) {
      return zip.files[name];
    }
  }
  return null;
}

function getFirstText(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  // Fallback for XML namespaces like dc:title
  for (const sel of selectors) {
    const localName = sel.includes(':') ? sel.split(':')[1] : sel;
    const els = doc.getElementsByTagNameNS('*', localName);
    if (els.length > 0 && els[0].textContent?.trim()) {
      return els[0].textContent.trim();
    }
  }
  return '';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function locateOpf(zip: JSZip): Promise<{opfPath: string; opfDoc: Document; opfDir: string}> {
  const containerFile = getZipFileCaseInsensitive(zip, 'META-INF/container.xml');
  let opfPath = '';

  if (containerFile) {
    const containerXml = await containerFile.async('string');
    const containerDoc = parseXml(containerXml);
    const rootfile = containerDoc.querySelector('rootfile[full-path]');
    opfPath = rootfile?.getAttribute('full-path') || '';
  }

  if (!opfPath) {
    const found = Object.keys(zip.files).find((k) => k.toLowerCase().endsWith('.opf'));
    if (!found) {
      throw new Error('Invalid EPUB archive: OPF package manifest not found.');
    }
    opfPath = found;
  }

  const opfFile = getZipFileCaseInsensitive(zip, opfPath);
  if (!opfFile) {
    throw new Error('EPUB manifest file is missing from the archive.');
  }
  const opfText = await opfFile.async('string');
  const opfDoc = parseXml(opfText);
  return {opfPath, opfDoc, opfDir: getDirName(opfPath)};
}

function buildManifestMap(opfDoc: Document, opfDir: string) {
  const byId = new Map<string, {href: string; fullPath: string; mediaType: string; properties: string}>();
  const items = Array.from(opfDoc.querySelectorAll('manifest > item, item'));

  for (const item of items) {
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    const mediaType = item.getAttribute('media-type') || '';
    const properties = item.getAttribute('properties') || '';
    if (!id || !href) continue;
    byId.set(id, {
      href,
      fullPath: normalizePath(opfDir, href),
      mediaType,
      properties,
    });
  }
  return byId;
}

async function extractCoverDataUrl(
  zip: JSZip,
  opfDoc: Document,
  manifest: Map<string, {href: string; fullPath: string; mediaType: string; properties: string}>
): Promise<string | null> {
  let coverItem: {fullPath: string; mediaType: string} | undefined;

  // 1. EPUB3 cover-image property
  for (const item of manifest.values()) {
    if (item.properties.split(/\s+/).includes('cover-image')) {
      coverItem = item;
      break;
    }
  }

  // 2. EPUB2 <meta name="cover" content="cover-id" />
  if (!coverItem) {
    const metaCover = opfDoc.querySelector('meta[name="cover"]');
    const coverId = metaCover?.getAttribute('content');
    if (coverId && manifest.has(coverId)) {
      coverItem = manifest.get(coverId);
    }
  }

  // 3. Heuristic match on manifest image items named "cover"
  if (!coverItem) {
    for (const [id, item] of manifest.entries()) {
      if (
        item.mediaType.startsWith('image/') &&
        (id.toLowerCase().includes('cover') || item.href.toLowerCase().includes('cover'))
      ) {
        coverItem = item;
        break;
      }
    }
  }

  if (!coverItem) return null;
  const imgFile = getZipFileCaseInsensitive(zip, coverItem.fullPath);
  if (!imgFile) return null;

  try {
    const bytes = await imgFile.async('arraybuffer');
    const blob = new Blob([bytes], {type: coverItem.mediaType || 'image/jpeg'});
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

export async function extractEpubMetadata(
  buffer: ArrayBuffer,
  fallbackTitle: string
): Promise<ImportMetadataResult> {
  const zip = await JSZip.loadAsync(buffer);
  const {opfDoc, opfDir} = await locateOpf(zip);
  const manifest = buildManifestMap(opfDoc, opfDir);

  const title = getFirstText(opfDoc, ['dc\\:title', 'title']) || fallbackTitle;
  const author = getFirstText(opfDoc, ['dc\\:creator', 'creator']) || 'Unknown Author';
  const publisher = getFirstText(opfDoc, ['dc\\:publisher', 'publisher']);
  const rawDate = getFirstText(opfDoc, ['dc\\:date', 'date']);
  const yearMatch = rawDate.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  const year = yearMatch ? yearMatch[1] : '';
  const language = getFirstText(opfDoc, ['dc\\:language', 'language']) || 'en';
  const rawDesc = getFirstText(opfDoc, ['dc\\:description', 'description']);
  const description = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref, itemref'));
  const totalUnits = Math.max(1, spineRefs.length);
  const coverDataUrl = await extractCoverDataUrl(zip, opfDoc, manifest);

  return {
    title,
    author,
    publisher,
    year,
    language,
    description,
    coverDataUrl,
    totalUnits,
    format: 'epub',
  };
}

function extractHashAnchor(href: string): string | undefined {
  const hashPos = href.indexOf('#');
  if (hashPos === -1) return undefined;
  const raw = href.slice(hashPos + 1).trim();
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function parseEpubForReading(buffer: ArrayBuffer): Promise<ParsedReflowableBook> {
  const zip = await JSZip.loadAsync(buffer);
  const {opfDoc, opfDir} = await locateOpf(zip);
  const manifest = buildManifestMap(opfDoc, opfDir);
  const cleanupUrls: string[] = [];

  // Map image assets to blob URLs lazily
  const assetUrlCache = new Map<string, string>();
  async function resolveAssetUrl(fullPath: string, fallbackBaseDir?: string, rawSrc?: string): Promise<string | null> {
    const candidates = [fullPath];
    if (fallbackBaseDir !== undefined && rawSrc) {
      candidates.push(normalizePath(fallbackBaseDir, rawSrc));
    }
    if (rawSrc) {
      candidates.push(normalizePath('', rawSrc));
    }

    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (assetUrlCache.has(key)) return assetUrlCache.get(key)!;
      const file = getZipFileCaseInsensitive(zip, candidate);
      if (!file) continue;
      const ext = candidate.split('.').pop()?.toLowerCase() || '';
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        jfif: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
      };
      const bytes = await file.async('arraybuffer');
      const blob = new Blob([bytes], {type: mimeMap[ext] || 'image/jpeg'});
      const url = URL.createObjectURL(blob);
      cleanupUrls.push(url);
      assetUrlCache.set(key, url);
      return url;
    }
    return null;
  }

  // Spine order (filtered to files that actually exist in archive so chapter indices match 1:1)
  const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref, itemref'));
  const spineEntries: Array<{path: string; file: JSZip.JSZipObject}> = [];
  const spinePathToIndex = new Map<string, number>();

  for (const ref of spineRefs) {
    const idref = ref.getAttribute('idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;
    const file = getZipFileCaseInsensitive(zip, item.fullPath);
    if (!file) continue;
    const idx = spineEntries.length;
    spineEntries.push({path: item.fullPath, file});
    spinePathToIndex.set(item.fullPath.toLowerCase(), idx);
  }

  // Extract Chapters
  const chapters: ParsedChapter[] = [];
  const htmlParser = new DOMParser();

  for (let i = 0; i < spineEntries.length; i++) {
    const {path: chapterPath, file} = spineEntries[i];
    const chapterDir = getDirName(chapterPath);

    const rawHtml = await file.async('string');
    const doc = parseChapterDocument(rawHtml, htmlParser);

    // Resolve embedded <img> elements to local Blob URLs
    const imgs = Array.from(doc.querySelectorAll('img'));
    for (const img of imgs) {
      const src = (img.getAttribute('src') || '').trim();
      if (!src || src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) {
        continue;
      }
      const target = normalizePath(chapterDir, src);
      const blobUrl = await resolveAssetUrl(target, opfDir, src);
      if (blobUrl) {
        img.setAttribute('src', blobUrl);
      } else {
        img.remove();
      }
    }

    // Resolve SVG <image> elements and unwrap single-image cover/illustration SVGs into crisp <img>
    const svgs = Array.from(doc.querySelectorAll('svg'));
    for (const svg of svgs) {
      const svgImages = Array.from(svg.querySelectorAll('image'));
      for (const svgImg of svgImages) {
        const href = (
          svgImg.getAttribute('xlink:href') ||
          svgImg.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
          svgImg.getAttribute('href') ||
          ''
        ).trim();
        if (!href || href.startsWith('data:') || href.startsWith('http') || href.startsWith('blob:')) {
          continue;
        }
        const target = normalizePath(chapterDir, href);
        const blobUrl = await resolveAssetUrl(target, opfDir, href);
        if (blobUrl) {
          svgImg.setAttribute('href', blobUrl);
          svgImg.setAttribute('xlink:href', blobUrl);
        }
      }

      const hasVectorShapes = Boolean(
        svg.querySelector('path, circle, ellipse, rect, polygon, polyline, line, text, use')
      );
      if (svgImages.length === 1 && !hasVectorShapes) {
        const resolvedHref =
          svgImages[0].getAttribute('href') || svgImages[0].getAttribute('xlink:href') || '';
        if (resolvedHref) {
          const replacementImg = doc.createElement('img');
          replacementImg.setAttribute('src', resolvedHref);
          replacementImg.setAttribute('alt', i === 0 ? 'Cover' : 'Illustration');
          svg.replaceWith(replacementImg);
        }
      }
    }

    // Preserve anchor targets across chapters without ID collisions in continuous scroll DOM
    const anchorEls = Array.from(doc.querySelectorAll('[id], a[name]'));
    for (const el of anchorEls) {
      const rawId = el.getAttribute('id') || el.getAttribute('name') || '';
      if (!rawId) continue;
      el.setAttribute('data-folio-target-id', rawId);
      el.setAttribute('id', `folio-ch-${i}-${rawId}`);
    }

    // Normalize <a> tags: unwrap anchor-only <a> (without href) so prose never gets underlined as a link
    const allAnchors = Array.from(doc.querySelectorAll('a'));
    for (const link of allAnchors) {
      const rawHref = (link.getAttribute('href') || '').trim();
      if (!rawHref) {
        const span = doc.createElement('span');
        const targetId = link.getAttribute('data-folio-target-id');
        const scopedId = link.getAttribute('id');
        if (scopedId) span.setAttribute('id', scopedId);
        if (targetId) span.setAttribute('data-folio-target-id', targetId);
        while (link.firstChild) {
          span.appendChild(link.firstChild);
        }
        link.replaceWith(span);
        continue;
      }

      if (/^(mailto:|tel:)/i.test(rawHref)) continue;
      if (/^javascript:/i.test(rawHref)) {
        link.removeAttribute('href');
        continue;
      }

      if (/^https?:\/\//i.test(rawHref)) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        continue;
      }

      const hashPos = rawHref.indexOf('#');
      const filePart = hashPos === -1 ? rawHref : rawHref.slice(0, hashPos);
      const anchorId = extractHashAnchor(rawHref);
      const targetPath = filePart
        ? normalizePath(chapterDir, filePart).toLowerCase()
        : chapterPath.toLowerCase();
      const targetIdx =
        spinePathToIndex.get(targetPath) ??
        (filePart ? spinePathToIndex.get(normalizePath(opfDir, filePart).toLowerCase()) : undefined);

      if (targetIdx !== undefined) {
        link.setAttribute('data-folio-chapter', String(targetIdx));
        if (anchorId) {
          link.setAttribute('data-folio-anchor', anchorId);
        }
        link.setAttribute('href', `#folio-ch-${targetIdx}${anchorId ? `-${anchorId}` : ''}`);

        const epubType = (
          link.getAttribute('epub:type') ||
          link.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
          ''
        ).toLowerCase();
        const role = (link.getAttribute('role') || '').toLowerCase();
        const cls = (link.getAttribute('class') || '').toLowerCase();
        const insideSup = Boolean(link.closest('sup'));
        const hashLooksLikeNote =
          Boolean(anchorId) && /^(?:fn|note|ftn|endnote|footnote|n)[-_:.]?\d+/i.test(anchorId!);
        const isNoteref =
          epubType.includes('noteref') ||
          role === 'doc-noteref' ||
          cls.includes('noteref') ||
          cls.includes('footnote') ||
          insideSup ||
          (hashLooksLikeNote && !link.closest('nav'));

        if (isNoteref) {
          link.setAttribute('data-folio-noteref', 'true');
        }
      }
    }

    // Strip embedded inline stylesheets/scripts so reader theme controls remain authoritative
    doc.querySelectorAll('script, style, link[rel="stylesheet"]').forEach((el) => el.remove());

    // Strip hardcoded color/background-color inline styles so Sepia & Dark themes always stay legible
    doc.querySelectorAll('[style]').forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.style?.removeProperty?.('color');
      htmlEl.style?.removeProperty?.('background');
      htmlEl.style?.removeProperty?.('background-color');
      htmlEl.style?.removeProperty?.('font-family');
      htmlEl.style?.removeProperty?.('font-size');
      htmlEl.style?.removeProperty?.('line-height');
    });

    const heading =
      doc.querySelector('h1, h2, h3, title')?.textContent?.replace(/\s+/g, ' ').trim() ||
      `Section ${i + 1}`;

    // Serialize through HTML DOM nodes so non-void tags (<a>, <div>, <span>) always have explicit closing tags
    const bodyEl = doc.querySelector('body') || doc.documentElement;
    let bodyHtml = rawHtml;
    if (bodyEl) {
      const htmlContainer = document.createElement('div');
      for (const child of Array.from(bodyEl.childNodes)) {
        htmlContainer.appendChild(document.importNode(child, true));
      }
      bodyHtml = htmlContainer.innerHTML;
    }

    const cleanHtml = DOMPurify.sanitize(bodyHtml, {
      ALLOWED_URI_REGEXP: FOLIO_ALLOWED_URI_REGEXP,
      ADD_TAGS: ['svg', 'image', 'section', 'article', 'figure', 'figcaption', 'aside'],
      ADD_ATTR: [
        'xlink:href',
        'viewBox',
        'preserveAspectRatio',
        'data-folio-target-id',
        'data-folio-chapter',
        'data-folio-anchor',
        'data-folio-noteref',
        'role',
      ],
    });

    chapters.push({
      index: i,
      title: heading.slice(0, 120),
      html: cleanHtml,
      spinePath: chapterPath,
    });
  }

  // Extract Table of Contents (EPUB3 NAV first, then EPUB2 NCX)
  const toc: ParsedTocItem[] = [];

  const navItem = Array.from(manifest.values()).find((item) =>
    item.properties.split(/\s+/).includes('nav')
  );

  if (navItem) {
    const navFile = getZipFileCaseInsensitive(zip, navItem.fullPath);
    if (navFile) {
      const navHtml = await navFile.async('string');
      const navDoc = htmlParser.parseFromString(navHtml, 'text/html');
      const navDir = getDirName(navItem.fullPath);
      const navEl =
        navDoc.querySelector('nav[epub\\:type="toc"], nav[role="doc-toc"], nav') || navDoc.body;

      const walkOl = (container: Element, depth: number) => {
        const items = Array.from(container.children).filter(
          (c) => c.tagName.toLowerCase() === 'li'
        );
        for (const li of items) {
          const link = li.querySelector(':scope > a, :scope > span');
          const label = link?.textContent?.replace(/\s+/g, ' ').trim();
          const href = link?.getAttribute('href') || '';
          if (label && href) {
            const full = normalizePath(navDir, href).toLowerCase();
            const unitIndex = spinePathToIndex.get(full);
            if (unitIndex !== undefined) {
              toc.push({
                id: `toc-${toc.length}`,
                title: label,
                unitIndex,
                depth,
                href,
                anchorId: extractHashAnchor(href),
              });
            }
          }
          const nested = li.querySelector(':scope > ol, :scope > ul');
          if (nested) walkOl(nested, depth + 1);
        }
      };

      const rootList = navEl.querySelector('ol, ul');
      if (rootList) walkOl(rootList, 0);
    }
  }

  // Fallback to EPUB2 NCX
  if (toc.length === 0) {
    const spineEl = opfDoc.querySelector('spine');
    const tocId = spineEl?.getAttribute('toc');
    const ncxItem =
      (tocId ? manifest.get(tocId) : undefined) ||
      Array.from(manifest.values()).find((i) => i.mediaType.includes('dtbncx'));

    if (ncxItem) {
      const ncxFile = getZipFileCaseInsensitive(zip, ncxItem.fullPath);
      if (ncxFile) {
        const ncxXml = await ncxFile.async('string');
        const ncxDoc = parseXml(ncxXml);
        const ncxDir = getDirName(ncxItem.fullPath);

        const walkNavPoints = (parent: Element, depth: number) => {
          const points = Array.from(parent.children).filter(
            (el) => el.localName === 'navPoint'
          );
          for (const pt of points) {
            const label = pt.querySelector('navLabel > text')?.textContent?.trim();
            const src = pt.querySelector('content')?.getAttribute('src') || '';
            if (label && src) {
              const full = normalizePath(ncxDir, src).toLowerCase();
              const unitIndex = spinePathToIndex.get(full);
              if (unitIndex !== undefined) {
                toc.push({
                  id: `toc-${toc.length}`,
                  title: label,
                  unitIndex,
                  depth,
                  href: src,
                  anchorId: extractHashAnchor(src),
                });
              }
            }
            walkNavPoints(pt, depth + 1);
          }
        };

        const navMap = ncxDoc.querySelector('navMap');
        if (navMap) walkNavPoints(navMap, 0);
      }
    }
  }

  // Fallback TOC from chapters if neither NAV nor NCX had entries
  if (toc.length === 0) {
    chapters.forEach((ch, idx) => {
      toc.push({
        id: `toc-${idx}`,
        title: ch.title || `Chapter ${idx + 1}`,
        unitIndex: idx,
        depth: 0,
      });
    });
  } else {
    // Improve chapter titles from TOC labels
    for (const item of toc) {
      if (chapters[item.unitIndex] && chapters[item.unitIndex].title.startsWith('Section ')) {
        chapters[item.unitIndex].title = item.title;
      }
    }
  }

  return {
    chapters: chapters.length > 0 ? chapters : [{index: 0, title: 'Document', html: '<p>No readable content found in this EPUB.</p>'}],
    toc,
    cleanupUrls,
  };
}
