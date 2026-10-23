import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { nextFitLevel } from './ideUtils';

/**
 * How compact a row has to be to fit on one line. Level 0 shows everything; each higher level is narrower and
 * `maxLevel` is the last resort, which may wrap. Below `maxLevel` the row must not wrap (flex-wrap: nowrap and
 * children that don't shrink), so overflow can be measured. Watches the row and its direct children for size
 * changes, so it also reacts when the row's content changes (e.g. Run becomes Stop). Attach `ref` to the row.
 */
export function useFitLevel<T extends HTMLElement>(maxLevel: number): { ref: (el: T | null) => void; level: number } {
  const [level, setLevel] = useState(0);
  // The level asked for, and the level the DOM currently shows; measuring only makes sense when they agree.
  const levelRef = useRef(0);
  const shownRef = useRef(0);
  // Width the row needed at each level when it last overflowed there.
  const natural = useRef<(number | undefined)[]>([]);
  const current = useRef<{ el: T; observer: ResizeObserver | null; observed: WeakSet<Element> } | null>(null);

  const check = useCallback(() => {
    const el = current.current?.el;
    if (!el || levelRef.current !== shownRef.current) return;
    const available = el.clientWidth;
    if (available === 0) return; // not displayed
    const now = levelRef.current;
    const needed = el.scrollWidth;
    const next = nextFitLevel(now, maxLevel, available, needed, natural.current);
    if (next > now) natural.current[now] = needed;
    if (next !== now) {
      levelRef.current = next;
      setLevel(next);
    }
  }, [maxLevel]);

  const ref = useCallback(
    (el: T | null) => {
      current.current?.observer?.disconnect();
      current.current = null;
      if (!el) return;
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
      observer?.observe(el);
      current.current = { el, observer, observed: new WeakSet([el]) };
      check();
    },
    [check],
  );

  // Children can be added or replaced on any render.
  useLayoutEffect(() => {
    const c = current.current;
    if (!c?.observer) return;
    for (const child of Array.from(c.el.children)) {
      if (c.observed.has(child)) continue;
      c.observed.add(child);
      c.observer.observe(child);
    }
  });

  // Settle before paint after each step, so a narrow row never shows its overflowing wide version.
  useLayoutEffect(() => {
    shownRef.current = level;
    check();
  }, [check, level]);

  return { ref, level };
}
