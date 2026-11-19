import {useEffect} from 'react';

type DirectionKey = 'w' | 's' | 'a' | 'd';

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const htmlEl = el as HTMLElement;
  if (htmlEl.isContentEditable) return true;
  const tag = htmlEl.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const role = htmlEl.getAttribute('role');
  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  return Boolean(htmlEl.closest('[contenteditable="true"], [role="textbox"], [role="combobox"]'));
}

function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function canScrollVertically(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 2) return false;
  const style = window.getComputedStyle(el);
  return (
    style.overflowY === 'auto' ||
    style.overflowY === 'scroll' ||
    style.overflowY === 'overlay'
  );
}

function canScrollHorizontally(el: HTMLElement): boolean {
  if (el.scrollWidth <= el.clientWidth + 2) return false;
  const style = window.getComputedStyle(el);
  return (
    style.overflowX === 'auto' ||
    style.overflowX === 'scroll' ||
    style.overflowX === 'overlay'
  );
}

function findVerticalScrollTarget(pointerX: number, pointerY: number): HTMLElement | null {
  // 1. If a dialog/drawer is open, prefer scrolling inside it
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
  ).filter(isElementVisible);

  if (dialogs.length > 0) {
    const topDialog = dialogs[dialogs.length - 1];
    // Check hovered scrollable area inside top dialog first
    if (pointerX >= 0 && pointerY >= 0) {
      const hovered = document.elementsFromPoint(pointerX, pointerY);
      for (const node of hovered) {
        if (node instanceof HTMLElement && topDialog.contains(node) && canScrollVertically(node)) {
          return node;
        }
      }
    }
    const tagged = topDialog.querySelector<HTMLElement>('[data-folio-vscroll="true"]');
    if (tagged && isElementVisible(tagged) && canScrollVertically(tagged)) {
      return tagged;
    }
    // Fallback: largest scrollable descendant inside dialog
    const descendants = Array.from(topDialog.querySelectorAll<HTMLElement>('*')).filter(
      (el) => isElementVisible(el) && canScrollVertically(el)
    );
    if (descendants.length > 0) {
      descendants.sort((a, b) => b.clientHeight - a.clientHeight);
      return descendants[0];
    }
    return null;
  }

  // 2. Check if pointer is directly hovering a tagged vertical scroll container
  if (pointerX >= 0 && pointerY >= 0) {
    const hovered = document.elementsFromPoint(pointerX, pointerY);
    for (const node of hovered) {
      if (
        node instanceof HTMLElement &&
        node.dataset.folioVscroll === 'true' &&
        isElementVisible(node) &&
        canScrollVertically(node)
      ) {
        return node;
      }
    }
  }

  // 3. Primary visible tagged vertical scroll container (Reader viewport or Library canvas)
  const taggedList = Array.from(
    document.querySelectorAll<HTMLElement>('[data-folio-vscroll="true"]')
  ).filter((el) => isElementVisible(el) && canScrollVertically(el));

  if (taggedList.length > 0) {
    // Prefer the largest visible primary viewport
    taggedList.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return taggedList[0];
  }

  // 4. Document scrolling fallback
  const docScroller = document.scrollingElement as HTMLElement | null;
  if (docScroller && docScroller.scrollHeight > docScroller.clientHeight + 2) {
    return docScroller;
  }

  return null;
}

function findHorizontalCarouselTarget(
  pointerX: number,
  pointerY: number,
  lastHoveredCarousel: HTMLElement | null
): HTMLElement | null {
  // 1. Prefer a carousel directly under the pointer
  if (pointerX >= 0 && pointerY >= 0) {
    const hovered = document.elementsFromPoint(pointerX, pointerY);
    for (const node of hovered) {
      if (
        node instanceof HTMLElement &&
        node.dataset.folioCarousel === 'true' &&
        isElementVisible(node) &&
        canScrollHorizontally(node)
      ) {
        return node;
      }
    }
  }

  // 2. Reuse last hovered carousel if still mounted, visible, and within viewport
  if (
    lastHoveredCarousel &&
    document.contains(lastHoveredCarousel) &&
    isElementVisible(lastHoveredCarousel) &&
    canScrollHorizontally(lastHoveredCarousel)
  ) {
    const rect = lastHoveredCarousel.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      return lastHoveredCarousel;
    }
  }

  // 3. Pick the first horizontally scrollable carousel currently visible in viewport
  const carousels = Array.from(
    document.querySelectorAll<HTMLElement>('[data-folio-carousel="true"]')
  ).filter((el) => {
    if (!isElementVisible(el) || !canScrollHorizontally(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 40 && rect.top < window.innerHeight - 40;
  });

  if (carousels.length > 0) {
    return carousels[0];
  }

  return null;
}

/**
 * Global desktop smooth continuous WASD scrolling:
 * - W / S: smooth continuous vertical glide across Library canvas, Reader viewports, and open drawers
 * - A / D: smooth continuous horizontal glide across visible/hovered carousels
 * Automatically ignored while typing in inputs, textareas, selects, contenteditables,
 * when modifier keys are held, or when a context menu is open.
 */
export function useKeyboardSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const heldKeys = new Set<DirectionKey>();
    const holdStartAt: Partial<Record<DirectionKey, number>> = {};
    let rafId: number | null = null;
    let lastFrameAt = 0;
    let pointerX = -1;
    let pointerY = -1;
    let lastHoveredCarousel: HTMLElement | null = null;

    const prefersReducedMotion = () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const stopLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastFrameAt = 0;
    };

    const clearAllKeys = () => {
      heldKeys.clear();
      stopLoop();
    };

    const computeSpeed = (now: number, keys: DirectionKey[], maxSpeed: number, baseSpeed: number) => {
      let earliest = now;
      for (const k of keys) {
        const started = holdStartAt[k];
        if (started !== undefined && started < earliest) earliest = started;
      }
      const heldMs = Math.max(0, now - earliest);
      // Smooth acceleration curve over 220ms
      const t = Math.min(1, heldMs / 220);
      const eased = 1 - (1 - t) * (1 - t);
      return baseSpeed + (maxSpeed - baseSpeed) * eased;
    };

    const tick = (now: number) => {
      if (heldKeys.size === 0) {
        stopLoop();
        return;
      }

      // Guard if focus moved into an editable control while holding a key
      if (isEditableElement(document.activeElement)) {
        clearAllKeys();
        return;
      }

      const dtSeconds = lastFrameAt ? Math.min(0.04, (now - lastFrameAt) / 1000) : 1 / 60;
      lastFrameAt = now;

      const vDir = (heldKeys.has('s') ? 1 : 0) - (heldKeys.has('w') ? 1 : 0);
      const hDir = (heldKeys.has('d') ? 1 : 0) - (heldKeys.has('a') ? 1 : 0);

      if (vDir !== 0) {
        const target = findVerticalScrollTarget(pointerX, pointerY);
        if (target) {
          const speed = computeSpeed(now, ['w', 's'], 1180, 520);
          target.scrollTop += vDir * speed * dtSeconds;
        }
      }

      if (hDir !== 0) {
        const carousel = findHorizontalCarouselTarget(pointerX, pointerY, lastHoveredCarousel);
        if (carousel) {
          const speed = computeSpeed(now, ['a', 'd'], 1020, 480);
          carousel.scrollLeft += hDir * speed * dtSeconds;
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      const target = e.target as HTMLElement | null;
      const carousel = target?.closest?.<HTMLElement>('[data-folio-carousel="true"]') ?? null;
      if (carousel) {
        lastHoveredCarousel = carousel;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'w' && key !== 's' && key !== 'a' && key !== 'd') return;

      if (isEditableElement(e.target as Element | null) || isEditableElement(document.activeElement)) {
        return;
      }

      // Yield when a right-click context menu is active
      if (document.querySelector('[role="menu"]')) return;

      const dirKey = key as DirectionKey;

      // For A/D, only intercept if there's actually a scrollable carousel available
      if (dirKey === 'a' || dirKey === 'd') {
        const carousel = findHorizontalCarouselTarget(pointerX, pointerY, lastHoveredCarousel);
        if (!carousel) return;
      } else {
        const target = findVerticalScrollTarget(pointerX, pointerY);
        if (!target) return;
      }

      e.preventDefault();

      // Respect reduced motion with crisp step jumps instead of continuous animation
      if (prefersReducedMotion()) {
        if (dirKey === 'w' || dirKey === 's') {
          const target = findVerticalScrollTarget(pointerX, pointerY);
          if (target) target.scrollTop += (dirKey === 's' ? 1 : -1) * 180;
        } else {
          const carousel = findHorizontalCarouselTarget(pointerX, pointerY, lastHoveredCarousel);
          if (carousel) carousel.scrollLeft += (dirKey === 'd' ? 1 : -1) * 240;
        }
        return;
      }

      if (!heldKeys.has(dirKey)) {
        heldKeys.add(dirKey);
        holdStartAt[dirKey] = performance.now();
      }

      if (rafId === null) {
        lastFrameAt = performance.now();
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key !== 'w' && key !== 's' && key !== 'a' && key !== 'd') return;
      const dirKey = key as DirectionKey;
      heldKeys.delete(dirKey);
      delete holdStartAt[dirKey];
      if (heldKeys.size === 0) {
        stopLoop();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) clearAllKeys();
    };

    window.addEventListener('pointermove', onPointerMove, {passive: true});
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearAllKeys);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearAllKeys();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAllKeys);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled]);
}
