import { useState } from 'react';
import { api } from './api';
import { applyLang, LANG_NAME, LANGS, useLang, useT, type Lang } from './i18n';
import {
  applyBackground,
  BACKGROUND_LABEL,
  BACKGROUND_SWATCH,
  BACKGROUNDS,
  type Background,
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
        className="rounded border border-edge bg-card px-1.5 py-0.5 text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
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
  focusOnSkills = false,
  onFocusChange,
}: {
  value: Background | null;
  onChange: (b: Background | null) => void;
  focusOnSkills?: boolean;
  onFocusChange?: (on: boolean) => void;
}) {
  const t = useT();
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

  async function chooseFocus(next: boolean) {
    onFocusChange?.(next);
    try {
      await api.put('/me/preferences', { focusOnSkills: next });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded px-1 text-ink hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none">
        {t('Background')}
      </summary>
      <fieldset className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-line bg-card p-3 shadow-lg">
        <legend className="sr-only">{t('Page background')}</legend>
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
            <span>{t('Match my device')}</span>
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
              <span>{t(BACKGROUND_LABEL[b])}</span>
            </label>
          ))}
        </div>
        {onFocusChange && (
          <div className="mt-3 border-t border-line pt-3">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                role="switch"
                className="mt-1"
                checked={focusOnSkills}
                onChange={(e) => void chooseFocus(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t('Focus on skills')}</span>
                <span className="block text-xs text-ink-3">
                  {t(
                    'Hides file names and "Reveal all names" so the first look is only about skills. Hidden on screen, not a guarantee.',
                  )}
                </span>
              </span>
            </label>
          </div>
        )}
        {failed && (
          <p role="alert" className="mt-2 text-xs text-warn-text">
            {t('Could not save your choice. It applies on this device only for now.')}
          </p>
        )}
      </fieldset>
    </details>
  );
}
