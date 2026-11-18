import { useEffect, useRef } from 'react';
import { locale, useT } from '../i18n';
import type { Adjustments, Kind } from '../api';
import { KIND_NAME } from '../results-logic';
import { btnSecondary, Notice, when } from '../ui';

/**
 * Requirements drawer (design spec 6.2.5). Three states for each requirement. A change re-ranks
 * the list in place without re-reading any resume; "Back to original" restores the first ranking
 * in one tap, and the history keeps who changed what and when so nobody can quietly tune the list
 * toward a favourite.
 */
export function RequirementsDrawer(props: {
  data: Adjustments;
  note: string;
  error: string;
  busy: boolean;
  onChange: (requirementId: string, to: Kind) => void;
  onReset: () => void;
  onClose: () => void;
  /** A requirement to point at when the drawer is opened from the assistant. */
  focusId?: string | null;
  /** An archived vacancy: the choices are shown, not changeable. */
  readOnly?: boolean;
}) {
  const t = useT();
  const { data } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const { onClose, focusId } = props;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  /*
   * A real modal (SD-35, RQ-01/04): shown with showModal(), so it sits in the top layer above the
   * app header, the page behind is inert with a backdrop, Esc closes it, and focus goes back to
   * the button that opened it. Opened once; the 4 s refreshes never move the focus.
   */
  useEffect(() => {
    const d = ref.current;
    const back = document.activeElement as HTMLElement | null;
    if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeRef.current();
      if (e.key !== 'Tab' || !d) return;
      // Keep Tab inside the drawer: past the last control it would go to the browser's own bar.
      const items = [
        ...d.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => {
        if (el.getClientRects().length === 0) return false;
        // Of a group of radio buttons only one is a Tab stop: the chosen one, or the first.
        if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
          const group = [
            ...d.querySelectorAll<HTMLInputElement>(
              `input[type=radio][name="${CSS.escape(el.name)}"]`,
            ),
          ];
          return el === (group.find((r) => r.checked) ?? group[0]);
        }
        return true;
      });
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const now = document.activeElement;
      if (e.shiftKey && (now === first || now === d)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (now === last || now === d)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (d?.open) d.close();
      back?.focus?.();
    };
  }, []);
  useEffect(() => {
    const target = focusId ? document.getElementById(`req-row-${focusId}`) : null;
    if (target) {
      target.scrollIntoView?.({ block: 'center' });
      target.querySelector<HTMLInputElement>('input:checked')?.focus();
    } else ref.current?.focus();
  }, [focusId]);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label={t('Requirements')}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      style={{ display: 'block' }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-0 border-l border-line bg-card p-5 text-ink shadow-xl backdrop:bg-black/30 focus:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('Requirements')}</h2>
          <p className="text-sm text-ink-2" role="status">
            {data.changeCount === 0
              ? t('No changes since the first scan.')
              : data.changeCount === 1
                ? t('{n} change since the first scan.', { n: data.changeCount })
                : t('{n} changes since the first scan.', { n: data.changeCount })}
          </p>
        </div>
        <button className={btnSecondary} onClick={props.onClose}>
          {t('Close')}
        </button>
      </div>
      <p className="mt-2 text-sm text-ink-3">
        {t(
          'Change what counts and the list re-ranks. No CV is read again. A missing must-have lowers the match; it never hides anyone.',
        )}
      </p>

      {props.error && <Notice kind="error">{props.error}</Notice>}
      {props.note && (
        <p className="mt-2 rounded-md border border-line bg-sel p-2 text-sm" role="status">
          {props.note}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {data.requirements.map((r) => (
          <fieldset
            key={r.id}
            id={`req-row-${r.id}`}
            className={`rounded-md border p-3 ${props.focusId === r.id ? 'border-accent bg-sel' : 'border-line'}`}
            disabled={props.busy || props.readOnly}
          >
            <legend className="px-1 text-sm font-medium">
              {r.text}
              {r.current !== r.original && (
                <span className="ml-2 text-xs font-normal text-ink-3">
                  {t('changed (was {kind})', {
                    kind: t(KIND_NAME[r.original]).toLocaleLowerCase(locale()),
                  })}
                </span>
              )}
            </legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {(['mandatory', 'preferred', 'ignore'] as Kind[]).map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`req-${r.id}`}
                    checked={r.current === k}
                    onChange={() => props.onChange(r.id, k)}
                  />
                  {t(KIND_NAME[k])}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {data.knockouts.length > 0 && (
        <p className="mt-3 text-sm text-ink-3">
          {t('Knockout rules ({n}) are not changed here. They only send a CV to a human look.', {
            n: data.knockouts.length,
          })}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={btnSecondary}
          disabled={data.changeCount === 0 || props.busy || props.readOnly}
          onClick={props.onReset}
        >
          {t('Back to original')}
        </button>
      </div>

      {data.changes.length > 0 && (
        <section aria-label={t('History of changes')} className="mt-5">
          <h3 className="text-sm font-semibold">{t('History')}</h3>
          <ul className="mt-1 space-y-1 text-sm text-ink-2">
            {data.changes.map((c) => (
              <li key={c.id}>
                {c.reset
                  ? t('Back to original')
                  : t('{requirement}: {from} to {to}', {
                      requirement: c.requirement ?? '',
                      from: t(KIND_NAME[c.from!]).toLocaleLowerCase(locale()),
                      to: t(KIND_NAME[c.to!]).toLocaleLowerCase(locale()),
                    })}{' '}
                · {c.by} · {when(c.at)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>
  );
}
