import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Tabs drawn as a segmented control whose highlight glides to the chosen tab (parallax motion).
 * Until the highlight has been measured (first paint, or where layout cannot be measured) the chosen
 * tab paints its own background, so the choice is always visible. Roles and keys are the usual tab
 * pattern: the buttons are `role="tab"` inside a `role="tablist"`.
 */
export function Segmented<K extends string>({
  items,
  value,
  onChange,
  label,
  className = '',
  stretch = false,
  panelId,
}: {
  items: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  className?: string;
  /** Tabs share the width equally (phones). */
  stretch?: boolean;
  /** The id of the panel each tab shows (aria-controls). */
  panelId?: (k: K) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const read = () => {
      const el = Array.from(root.querySelectorAll<HTMLElement>('[data-k]')).find(
        (e) => e.dataset.k === value,
      );
      setPill(el && el.offsetWidth > 0 ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(root);
    return () => ro.disconnect();
  }, [value, items.length]);

  return (
    <div
      ref={box}
      role="tablist"
      aria-label={label}
      className={`relative flex gap-1 rounded-md border border-line bg-card p-1 ${className}`}
      // ARIA tabs: one tab stop; the arrow keys, Home and End move to a tab and choose it.
      onKeyDown={(e) => {
        const at = items.findIndex((i) => i.key === value);
        const n = items.length;
        const to =
          e.key === 'ArrowRight'
            ? (at + 1) % n
            : e.key === 'ArrowLeft'
              ? (at - 1 + n) % n
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? n - 1
                  : -1;
        if (to < 0 || at < 0) return;
        e.preventDefault();
        onChange(items[to]!.key);
        box.current?.querySelector<HTMLElement>(`[data-k="${items[to]!.key}"]`)?.focus();
      }}
    >
      {pill && (
        <span
          aria-hidden="true"
          className="m-pill absolute top-1 bottom-1 left-0 rounded bg-accent shadow-sm"
          style={{ translate: `${pill.x}px 0`, width: pill.w }}
        />
      )}
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            data-k={it.key}
            role="tab"
            type="button"
            aria-selected={on}
            aria-controls={panelId?.(it.key)}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(it.key)}
            className={`relative rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${stretch ? 'flex-1 py-1.5' : ''} ${
              on
                ? `text-on-accent forced-colors:outline-2 forced-colors:outline-offset-1 ${pill ? '' : 'bg-accent'}`
                : 'text-ink-2 hover:text-ink'
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
