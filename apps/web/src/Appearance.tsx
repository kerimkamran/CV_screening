import { useState } from 'react';
import { api } from './api';
import {
  applyBackground,
  BACKGROUND_LABEL,
  BACKGROUND_SWATCH,
  BACKGROUNDS,
  type Background,
} from './theme';

/** Background menu (spec 4.2): four labelled swatches plus "Match my device". Saved per user. */
export function Appearance({
  value,
  onChange,
}: {
  value: Background | null;
  onChange: (b: Background | null) => void;
}) {
  const [failed, setFailed] = useState(false);

  async function choose(next: Background | null) {
    onChange(next);
    applyBackground(next);
    try {
      await api.put('/me/preferences', { background: next });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded px-1 text-ink hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none">
        Background
      </summary>
      <fieldset className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-line bg-card p-3 shadow-lg">
        <legend className="sr-only">Page background</legend>
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-hover">
            <input
              type="radio"
              name="background"
              checked={value === null}
              onChange={() => void choose(null)}
            />
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 rounded-full border border-edge"
              style={{ background: 'linear-gradient(90deg,#fff 50%,#0a1530 50%)' }}
            />
            <span>Match my device</span>
          </label>
          {BACKGROUNDS.map((b) => (
            <label
              key={b}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-hover"
            >
              <input
                type="radio"
                name="background"
                checked={value === b}
                onChange={() => void choose(b)}
              />
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 rounded-full border border-edge"
                style={{ background: BACKGROUND_SWATCH[b] }}
              />
              <span>{BACKGROUND_LABEL[b]}</span>
            </label>
          ))}
        </div>
        {failed && (
          <p role="alert" className="mt-2 text-xs text-warn-text">
            Could not save your choice. It applies on this device only for now.
          </p>
        )}
      </fieldset>
    </details>
  );
}
