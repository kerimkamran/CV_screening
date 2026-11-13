import { useState } from 'react';
import { api } from './api';
import { applyLang, LANG_NAME, LANGS, useLang, useT, type Lang } from './i18n';
import {
  applyBackground,
  BACKGROUND_LABEL,
  BACKGROUND_SWATCH,
  BACKGROUNDS,
  type BackgroundChoice,
} from './theme';

/** Language switch (spec 13). Saved per person when signed in; kept in the browser either way. */
export function LanguageSwitch({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const lang = useLang();
  function choose(next: Lang) {
    applyLang(next);
    if (signedIn) void api.put('/me/preferences', { language: next }).catch(() => undefined);
  }
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t('Language')}</span>
      <select
        aria-label={t('Language')}
        className="rounded border border-edge bg-card px-1.5 py-0.5 text-ink pointer-coarse:min-h-11 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        value={lang}
        onChange={(e) => choose(e.target.value as Lang)}
      >
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANG_NAME[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Background menu (spec 4.2): four labelled swatches plus "Match my device". Saved per user. */
export function Appearance({
  value,
  onChange,
}: {
  value: BackgroundChoice | null;
  onChange: (b: BackgroundChoice | null) => void;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);

  async function choose(next: BackgroundChoice) {
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
    // The picker opens in place (it pushes the rest of the menu down), so it never covers
    // 'Sign out' and never leaves the screen (SD-37).
    <details
      className="open:basis-full"
      onToggle={(e) => {
        const d = e.currentTarget;
        // In a short window the menu scrolls: bring the opened picker fully into view.
        if (d.open) d.querySelector('fieldset')?.scrollIntoView?.({ block: 'nearest' });
      }}
    >
      <summary className="flex cursor-pointer list-none items-center rounded px-1 text-ink hover:underline pointer-coarse:min-h-11 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none">
        {t('Background')}
      </summary>
      <fieldset className="mt-2 w-full rounded-2xl border border-line bg-card p-3">
        <legend className="sr-only">{t('Page background')}</legend>
        {/* Two columns on touch screens, so the taller choices still fit a short window. */}
        <div className="space-y-1 pointer-coarse:grid pointer-coarse:grid-cols-2 pointer-coarse:gap-1 pointer-coarse:space-y-0">
          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-hover pointer-coarse:min-h-11">
            <input
              type="radio"
              className="shrink-0 pointer-coarse:h-11 pointer-coarse:w-5"
              name="background"
              checked={value === 'auto'}
              onChange={() => void choose('auto')}
            />
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 rounded-full border border-edge"
              style={{ background: 'linear-gradient(90deg,#fff 50%,#0a1530 50%)' }}
            />
            <span>{t('Match my device')}</span>
          </label>
          {BACKGROUNDS.map((b) => (
            <label
              key={b}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-hover pointer-coarse:min-h-11"
            >
              <input
                type="radio"
                className="shrink-0 pointer-coarse:h-11 pointer-coarse:w-5"
                name="background"
                checked={value === b || (value === null && b === 'grey')}
                onChange={() => void choose(b)}
              />
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 rounded-full border border-edge"
                style={{ background: BACKGROUND_SWATCH[b] }}
              />
              <span>{t(BACKGROUND_LABEL[b])}</span>
            </label>
          ))}
        </div>
        {failed && (
          <p role="alert" className="mt-2 text-xs text-warn-text">
            {t('Could not save your choice. It applies on this device only for now.')}
          </p>
        )}
      </fieldset>
    </details>
  );
}
