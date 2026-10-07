import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  setAssistantOpen,
  SKILL_MARK,
  startersFor,
  useAssistantOpen,
  type Answer,
  type AssistantConfig,
  type Intent,
  type ThreadMessage,
} from '../assistant';
import { getLang, tr, useT } from '../i18n';
import { type MatchBand } from '../results-logic';
import { btnPrimary, btnSecondary, errMsg } from '../ui';

export interface AssistantTarget {
  screeningId: string;
  /** The pseudonym, never the revealed name. */
  label: string;
  band: MatchBand;
}

type Item =
  { id: string; role: 'user'; text: string } | { id: string; role: 'assistant'; answer: Answer };

const toItems = (messages: ThreadMessage[]): Item[] =>
  messages.map((m) =>
    m.role === 'user'
      ? { id: m.id, role: 'user', text: m.content.text ?? '' }
      : { id: m.id, role: 'assistant', answer: m.content as Answer },
  );

const ASK_LIMIT = 1000;

/**
 * The assistant panel (design spec 6.6.1): closed by default as a slim rail; docked on wide screens,
 * an overlay on tablets and a bottom sheet on phones. One conversation per candidate, kept for the
 * recruiter only. Answers come from the stored match and are checked on the server.
 */
export function AssistantPanel(props: {
  config: AssistantConfig;
  target: AssistantTarget | null;
  /** Other candidates in this scan that "Compare with…" can offer (pseudonyms). */
  others: { screeningId: string; label: string }[];
  onEditRequirement: (requirementId: string, text: string) => void;
}) {
  const { config, target } = props;
  const t = useT();
  const open = useAssistantOpen();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [announce, setAnnounce] = useState('');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [challenging, setChallenging] = useState(false);
  const [read, setRead] = useState('');
  const turn = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sid = target?.screeningId ?? null;

  // One thread per candidate: load it when the candidate changes.
  useEffect(() => {
    turn.current++;
    setItems([]);
    setError('');
    setBusy(false);
    setPicking(false);
    setChallenging(false);
    setAnnounce('');
    if (!open || !sid) return;
    let alive = true;
    api.get<{ thread: { messages: ThreadMessage[] } | null }>(`/screenings/${sid}/assistant`).then(
      (r) => alive && setItems(toItems(r.thread?.messages ?? [])),
      (e) => alive && setError(errMsg(e)),
    );
    return () => {
      alive = false;
    };
  }, [sid, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, sid]);
  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [items, busy]);

  const send = useCallback(
    async (
      intent: Intent,
      message: string,
      extra: { compareWith?: string[]; read?: string } = {},
    ) => {
      if (!sid || busy) return;
      const mine = ++turn.current;
      const shown = intent === 'ask' ? message : startersLabel(intent, message);
      setItems((i) => [...i, { id: `u${mine}`, role: 'user', text: shown }]);
      setBusy(true);
      setError('');
      setAnnounce('');
      try {
        const r = await api.post<{ answer: Answer; messageId: string }>(
          `/screenings/${sid}/assistant`,
          {
            intent,
            message: intent === 'ask' ? message : '',
            language: getLang(),
            ...extra,
          },
        );
        if (turn.current !== mine) return; // stopped, or another candidate was opened
        setItems((i) => [...i, { id: r.messageId, role: 'assistant', answer: r.answer }]);
        setAnnounce(tr('{name} has answered.', { name: config.name }));
      } catch (e) {
        if (turn.current === mine) setError(errMsg(e));
      } finally {
        if (turn.current === mine) setBusy(false);
      }
    },
    [sid, busy, config.name],
  );

  const stop = () => {
    turn.current++;
    setBusy(false);
    setItems((i) => [
      ...i,
      {
        id: `s${turn.current}`,
        role: 'assistant',
        answer: {
          kind: 'unavailable',
          headline: tr('Stopped. Nothing was changed.'),
          claims: [],
          cantSee: '',
          questions: [],
          outcome: null,
          handoff: [],
          facts: [],
          flags: ['stopped'],
          about: [],
        },
      },
    ]);
  };

  async function clearChat() {
    if (!sid) return;
    try {
      await api.del(`/screenings/${sid}/assistant`);
      setItems([]);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setAssistantOpen(true)}
        aria-label={t('Ask {name}', { name: config.name })}
        className="fixed right-0 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-lg border border-r-0 border-edge bg-card px-2 py-3 text-sm shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Orb />
        <span style={{ writingMode: 'vertical-rl' }} className="font-medium">
          {t('Ask {name}', { name: config.name })}
        </span>
      </button>
    );
  }

  const starters = target ? startersFor(target.band) : [];
  const bandName = target
    ? {
        strong: t('Strong'),
        good: t('Good'),
        partial: t('Partial'),
        limited: t('Limited'),
        human: t('Needs a human look'),
      }[target.band]
    : '';
  return (
    <aside
      aria-label={t('Assistant')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setAssistantOpen(false);
        }
      }}
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85vh] flex-col rounded-t-xl border border-line bg-card shadow-xl sm:inset-y-0 sm:bottom-auto sm:left-auto sm:right-0 sm:max-h-none sm:w-96 sm:rounded-none sm:border-y-0 sm:border-r-0"
    >
      <header className="flex items-start justify-between gap-2 border-b border-line p-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Orb />
            {config.name}
          </h2>
          {target ? (
            <p className="mt-1 truncate text-sm text-ink-2" data-testid="context-chip">
              {t('Discussing: {label} · {band}', { label: target.label, band: bandName })}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-3">{t('Select a candidate to talk about.')}</p>
          )}
        </div>
        <button type="button" className={btnSecondary} onClick={() => setAssistantOpen(false)}>
          {t('Close')}
        </button>
      </header>

      <p className="border-b border-line px-3 py-2 text-xs text-ink-3">
        {t('Chats are saved to this run and may be reviewed for compliance.')}
      </p>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        aria-label={t('Conversation')}
      >
        {items.length === 0 && !busy && target && (
          <p className="text-sm text-ink-2">
            {t('{name} explains the stored match for {label}. It does not score, rank or decide.', {
              name: config.name,
              label: target.label,
            })}
          </p>
        )}
        {items.map((it) =>
          it.role === 'user' ? (
            <p key={it.id} className="ml-8 rounded-lg bg-sel p-2 text-sm">
              {it.text}
            </p>
          ) : (
            <AnswerView
              key={it.id}
              answer={it.answer}
              onEdit={props.onEditRequirement}
              onAsk={(q) => {
                const s = starters.find((x) => x.label === q || t(x.label) === q);
                void (s ? send(s.intent, s.label) : send('ask', q));
              }}
            />
          ),
        )}
        {busy && (
          <div className="flex items-center gap-3 text-sm text-ink-2" role="status">
            <span>{t('{name} is reading the record…', { name: config.name })}</span>
            <button type="button" className="text-link underline" onClick={stop}>
              {t('Stop')}
            </button>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-err-line bg-err p-2 text-sm text-err-ink"
          >
            {error}
          </p>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {target && (
        <div className="space-y-2 border-t border-line p-3">
          {picking ? (
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">
                {t('Compare {label} with (up to 2)', { label: target.label })}
              </legend>
              {props.others.length === 0 && (
                <p className="text-ink-3">{t('No other scored candidates.')}</p>
              )}
              {props.others.slice(0, 30).map((o) => (
                <label key={o.screeningId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.includes(o.screeningId)}
                    disabled={!picked.includes(o.screeningId) && picked.length >= 2}
                    onChange={(e) =>
                      setPicked((p) =>
                        e.target.checked
                          ? [...p, o.screeningId]
                          : p.filter((x) => x !== o.screeningId),
                      )
                    }
                  />
                  {o.label}
                </label>
              ))}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={picked.length === 0 || busy}
                  onClick={() => {
                    void send('compare', '', { compareWith: picked });
                    setPicking(false);
                    setPicked([]);
                  }}
                >
                  {t('Compare')}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setPicking(false)}>
                  {t('Cancel')}
                </button>
              </div>
            </fieldset>
          ) : challenging ? (
            <div className="space-y-2 text-sm">
              <label className="block">
                <span className="mb-1 block font-medium">{t('Your own read (optional)')}</span>
                <textarea
                  className="block w-full rounded-md border border-edge p-2"
                  rows={2}
                  maxLength={400}
                  value={read}
                  onChange={(e) => setRead(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() => {
                    void send('challenge', '', read.trim() ? { read: read.trim() } : {});
                    setChallenging(false);
                    setRead('');
                  }}
                >
                  {t('Challenge this match')}
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setChallenging(false)}
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label={t('Suggested questions')}>
              {starters
                .filter(
                  (s) =>
                    s.intent !== 'compare' || (config.features.compare && props.others.length > 0),
                )
                .filter((s) => s.intent !== 'interview' || config.features.interview)
                .map((s) => (
                  <li key={s.intent}>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-full border border-edge bg-card px-3 py-1 text-sm hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                      onClick={() =>
                        s.intent === 'compare' ? setPicking(true) : void send(s.intent, s.label)
                      }
                    >
                      {t(s.label)}
                    </button>
                  </li>
                ))}
              {config.features.challenge && (
                <li>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-dashed border-edge bg-card px-3 py-1 text-sm hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                    onClick={() => setChallenging(true)}
                  >
                    {t('Challenge this match')}
                  </button>
                </li>
              )}
            </ul>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const m = text.trim();
              if (!m || busy) return;
              setText('');
              void send('ask', m);
            }}
          >
            <label className="min-w-0 flex-1 text-sm">
              <span className="sr-only">
                {t('Ask {name} about {label}', { name: config.name, label: target.label })}
              </span>
              <textarea
                ref={inputRef}
                rows={2}
                maxLength={ASK_LIMIT}
                value={text}
                placeholder={t('Ask about {label}…', { label: target.label })}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                className="block w-full rounded-md border border-edge p-2"
              />
            </label>
            <button type="submit" className={btnPrimary} disabled={busy || !text.trim()}>
              {t('Send')}
            </button>
          </form>
          {items.length > 0 && (
            <button
              type="button"
              className="text-xs text-link underline"
              onClick={() => void clearChat()}
            >
              {t('Delete this chat')}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

const startersLabel = (intent: Intent, fallback: string) =>
  intent === 'compare'
    ? tr('Compare these candidates')
    : intent === 'challenge'
      ? tr('Challenge this match')
      : tr(fallback);

function Orb() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-5 shrink-0 rounded-full border border-edge"
      style={{ background: 'radial-gradient(circle at 35% 30%, #F5C461, #8FC4FF 70%)' }}
    />
  );
}

function AnswerView({
  answer: a,
  onEdit,
  onAsk,
}: {
  answer: Answer;
  onEdit: (requirementId: string, text: string) => void;
  onAsk: (q: string) => void;
}) {
  const t = useT();
  const [more, setMore] = useState(false);
  const stateName = {
    Found: t('Found'),
    'Partly found': t('Partly found'),
    'Not found in this CV': t('Not found in this CV'),
    Unclear: t('Unclear'),
  };
  const tone =
    a.kind === 'unavailable' || a.kind === 'unverified'
      ? 'border-warn-line bg-warn text-warn-ink'
      : 'border-line bg-card';
  const hasMore =
    a.claims.some((c) => c.quote) ||
    a.claims.length > 0 ||
    a.facts.length > 0 ||
    a.questions.length > 0;
  return (
    <div className={`mr-4 space-y-2 rounded-lg border p-3 text-sm ${tone}`}>
      <p>
        <span
          className="mr-2 rounded border border-edge px-1 text-xs font-semibold text-ink-2"
          title={t('Written by an AI from the stored match')}
        >
          {t('AI')}
        </span>
        <span className="font-medium">{a.headline}</span>
      </p>
      {a.outcome && a.kind === 'answer' && (
        <p className="text-ink-2">
          {a.outcome === 'gap' ? t('A gap was found in the evidence.') : t('The match held up.')}
        </p>
      )}
      {a.claims.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('Where this comes from')}>
          {a.claims.map((c, i) =>
            c.requirement ? (
              <li
                key={i}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  c.requirement.state === 'Found'
                    ? 'border-ok-line bg-ok text-ok-ink'
                    : c.requirement.state === 'Partly found'
                      ? 'border-warn-line bg-warn text-warn-ink'
                      : 'border-edge bg-card text-ink-2'
                }`}
              >
                <span aria-hidden="true">{SKILL_MARK[c.requirement.state]} </span>
                {a.about.length > 1 ? `${c.requirement.candidate}: ` : ''}
                {c.requirement.text} · {stateName[c.requirement.state]}
              </li>
            ) : (
              <li
                key={i}
                className="rounded-full border border-edge px-2.5 py-0.5 text-xs text-ink-2"
              >
                {t('Match tally')}
              </li>
            ),
          )}
        </ul>
      )}
      {more && (
        <div className="space-y-2">
          {a.claims.map((c, i) => (
            <div key={i}>
              <p>{c.text}</p>
              {c.quote && (
                <blockquote className="mt-1 border-l-4 border-accent pl-3 text-ink-2">
                  {c.quote}
                </blockquote>
              )}
            </div>
          ))}
          {a.questions.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5">
              {a.questions.map((q, i) => (
                <li key={i}>{q.text}</li>
              ))}
            </ol>
          )}
          {a.facts.length > 0 && (
            <p className="text-xs text-ink-3">
              {t('From the record: {facts}', { facts: a.facts.join(' | ') })}
            </p>
          )}
        </div>
      )}
      {a.cantSee && (
        <p className="text-ink-2">
          <span className="font-medium">{t('What I can’t see:')} </span>
          {a.cantSee}
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          className="text-link underline"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          {more ? t('Show less') : t('Show more')}
        </button>
      )}
      {a.handoff.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {a.handoff.map((h) => (
            <button
              key={h.requirementId}
              type="button"
              className={btnSecondary}
              onClick={() => onEdit(h.requirementId, h.text)}
            >
              {t('Edit requirement: {text}', { text: h.text })}
            </button>
          ))}
        </div>
      )}
      {a.offer && a.offer.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {a.offer.map((o) => (
            <button
              key={o}
              type="button"
              className="rounded-full border border-edge px-3 py-1 hover:bg-page"
              onClick={() => onAsk(o)}
            >
              {t(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
