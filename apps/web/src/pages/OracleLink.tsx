import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { prepareSignals } from '../done-signals';
import { useT } from '../i18n';
import { oracleApi, type LookupAnswer, type OracleState } from '../oracle';
import { type VacancyView } from '../pool';
import { btnPrimary, btnSecondary, errMsg, Field, input, when } from '../ui';

/**
 * Stage 3, S3-INT-14 (B2-B6, B17): inside the CVs card, one field and one button. Pressed too early,
 * it lists what is missing and sends nothing; then one lookup, one confirm dialog, and Start. Linked
 * afterwards: the ID as text, with Unlink when the API allows it.
 */
export function OracleLink({
  vacancy,
  oracle,
  needs,
  noticeTickedNow,
  userId,
  onStarted,
}: {
  vacancy: VacancyView;
  oracle: OracleState;
  /** What the main start button is missing (role, skill, notice), as sentences. */
  needs: string[];
  /** The notice box was ticked in this card just now (it is confirmed on Start). */
  noticeTickedNow: boolean;
  userId: string;
  onStarted: () => void;
}) {
  const t = useT();
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [found, setFound] = useState<(LookupAnswer & { ref: string }) | null>(null);
  const [asking, setAsking] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const errId = useId();

  const link = oracle.link;
  if (link) {
    return (
      <div className="space-y-1 text-sm" data-testid="oracle-link">
        <p>
          <span className="font-medium">{t('Oracle vacancy ID {ref}', { ref: link.ref })}</span>
          {link.linkedAt && (
            <span className="text-ink-3">
              {' · '}
              {t('linked {when} by {name}', {
                when: when(link.linkedAt),
                name: link.linkedBy ?? '',
              })}
            </span>
          )}
        </p>
        {link.state === 'proposed' && (
          <p className="text-ink-2">{t('The link must be approved by a team lead.')}</p>
        )}
        {link.canUnlink && !asking && (
          <button type="button" className="text-link underline" onClick={() => setAsking(true)}>
            {t('Unlink')}
          </button>
        )}
        {asking && (
          <div className="flex flex-wrap items-center gap-2" role="group">
            <span>
              {t('Unlink Oracle vacancy {ref}? CVs already imported stay in this vacancy.', {
                ref: link.ref,
              })}
            </span>
            <button
              type="button"
              className={btnSecondary}
              onClick={() =>
                void oracleApi
                  .unlink(vacancy.id)
                  .then(() => {
                    setAsking(false);
                    onStarted();
                  })
                  .catch((e) => setError(errMsg(e)))
              }
            >
              {t('Unlink')}
            </button>
            <button
              type="button"
              className={btnSecondary}
              autoFocus
              onClick={() => setAsking(false)}
            >
              {t('Cancel')}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-err-ink">
            {error}
          </p>
        )}
      </div>
    );
  }

  async function look() {
    if (busy) return;
    const want = [...needs, ...(ref.trim() ? [] : [t('Type the Oracle vacancy ID.')])];
    setError('');
    setMissing(want);
    if (want.length) return;
    // Synchronous, inside the click: the browser allows the ready signals only while it is fresh.
    prepareSignals(userId);
    setBusy(true);
    try {
      const a = await oracleApi.lookup(vacancy.id, ref.trim());
      if (!a.found) {
        setError(t('No Oracle vacancy has this ID. Check the number and try again.'));
        fieldRef.current?.focus();
      } else setFound({ ...a, ref: ref.trim() });
    } catch (e) {
      setError(errMsg(e));
      fieldRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-line pt-3" data-testid="oracle-link">
      <h3 className="text-sm font-semibold">{t('Or bring them from Oracle')}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Field
            label={t('Oracle vacancy ID')}
            hint={t('The number of the vacancy in Oracle Recruiting.')}
            error={error}
            errorId={errId}
          >
            <input
              ref={fieldRef}
              className={input}
              value={ref}
              maxLength={64}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
              onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void look();
              }}
            />
          </Field>
        </div>
        <button
          ref={buttonRef}
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => void look()}
        >
          {busy ? t('Looking in Oracle…') : t('Import CVs from Oracle')}
        </button>
      </div>
      {missing.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-ink-2" aria-live="polite">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {found && (
        <ImportDialog
          mode="import"
          answer={found}
          room={found.room ?? oracle.room}
          onClose={() => {
            setFound(null);
            buttonRef.current?.focus();
          }}
          onStart={async () => {
            // In this order: the notice (only if ticked now), the criteria (only if a draft), then the import.
            if (noticeTickedNow) await api.post(`/vacancies/${vacancy.id}/notice-confirm`);
            if (vacancy.hasDraft) await api.post(`/vacancies/${vacancy.id}/criteria/freeze`);
            await oracleApi.start(vacancy.id, { ref: found.ref, estimate: found.estimate });
            setFound(null);
            setRef('');
            onStarted();
          }}
        />
      )}
    </div>
  );
}

/**
 * The one confirm dialog (drawing 5), for the first import and for Refresh. Filled from the one
 * lookup answer; two buttons; Esc and Cancel close it with no request and focus back on the opener.
 */
export function ImportDialog({
  mode,
  answer,
  room,
  onClose,
  onStart,
}: {
  mode: 'import' | 'refresh';
  answer: LookupAnswer & { ref: string };
  room: number;
  onClose: () => void;
  onStart: () => Promise<void>;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !d) return;
      const items = [...d.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (d?.open) {
        if (typeof d.close === 'function') d.close();
        else d.removeAttribute('open');
      }
    };
  }, []);
  const n = answer.estimate ?? 0;
  const title = mode === 'refresh' ? t('Refresh from Oracle?') : t('Import CVs from Oracle?');
  return (
    <dialog
      ref={ref}
      aria-label={title}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      className="m-auto w-full max-w-md rounded-2xl border border-line bg-card p-5 text-ink shadow-xl backdrop:bg-black/30"
      data-testid="oracle-dialog"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 font-medium">
        {/* Oracle's own text (title, state) is shown as sent and never translated. */}
        {answer.title} · {answer.state}
      </p>
      <p className="text-sm text-ink-3">{t('Oracle vacancy ID {ref}', { ref: answer.ref })}</p>
      <p className="mt-3 text-sm">
        {mode === 'refresh'
          ? t(
              'About {n} applications in Oracle now. New CVs will be copied and analyzed by AI; CVs already here are not copied again. Room for {r}.',
              { n, r: room },
            )
          : t(
              'About {n} applications. Their CVs will be copied and analyzed by AI. Room for {r}.',
              { n, r: room },
            )}
      </p>
      {n > room && (
        <p className="mt-1 text-sm">{t('More applications than fit: the oldest come first.')}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-err-ink">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={() => close.current()}>
          {t('Cancel')}
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy}
          autoFocus
          onClick={() => {
            setBusy(true);
            setError('');
            onStart()
              .catch((e) => setError(errMsg(e)))
              .finally(() => setBusy(false));
          }}
        >
          {t('Start')}
        </button>
      </div>
    </dialog>
  );
}
