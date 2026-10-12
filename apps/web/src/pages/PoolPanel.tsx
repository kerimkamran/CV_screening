import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  setAssistantOpen,
  SLOGAN,
  takePendingQuestion,
  useAssistantOpen,
  useAssistantScope,
  usePendingQuestion,
  type AssistantConfig,
} from '../assistant';
import { Mark as Logo } from '../brand';
import { getLang, tr, useT } from '../i18n';
import { ago, BAND_NAME, BAND_STYLE, MARK_STYLE, type Band } from '../pool';
import { btnPrimary, btnSecondary, errMsg } from '../ui';

/** What the server writes for a pool question (apps/api pool-assistant.service.ts). */
export interface PoolAnswer {
  kind: 'pool' | 'ask_which' | 'confirm' | 'no_match' | 'decline' | 'help';
  headline: string;
  notes: string[];
  vacancy: { id: string; title: string; status: string } | null;
  options: { id: string; title: string; status: string }[];
  counts: { total: number; analyzed: number; shortlist: number; outOfDate: number } | null;
  rows: {
    matchId: string;
    label: string;
    score: number;
    band: Band;
    mustFound: number;
    mustTotal: number;
    decision: 'new' | 'shortlist' | 'maybe' | 'not_now';
    decisionLabel: string;
    outOfDate: boolean;
    strengths: string[];
    missing: string[];
    /** Skill search: the vacancy the resume was analyzed for, and how often each skill is written. */
    vacancyTitle?: string;
    skillHits?: { skill: string; count: number }[];
  }[];
  more: number;
  asOf: string;
  suggestions: string[];
  flags: string[];
  language: 'en' | 'az' | 'ru';
}

type Item =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; answer: PoolAnswer };
interface Conversation {
  id: string;
  title: string;
  vacancyTitle: string | null;
  updatedAt: string;
}

/**
 * SenAI over the pool, opened from the Ask bar (Development Plan WP 4.4, 4.5, 4.7). Docked beside the
 * page on wide screens, a side sheet on tablets, a bottom sheet on phones. Answers are written by
 * the server from the same rows the lists show; they carry an "As of" time.
 */
export function PoolPanel({ config }: { config: AssistantConfig }) {
  const t = useT();
  const open = useAssistantOpen();
  const scope = useAssistantScope();
  const queued = usePendingQuestion();
  const scopeId = scope?.id;
  const [items, setItems] = useState<Item[]>([]);
  const [cid, setCid] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [announce, setAnnounce] = useState('');
  const [history, setHistory] = useState<Conversation[] | null>(null);
  const turn = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(
    async (message: string, extra: { pick?: string; showAll?: boolean; echo?: boolean } = {}) => {
      if (busy || !message.trim()) return;
      const mine = ++turn.current;
      if (extra.echo !== false)
        setItems((i) => [...i, { id: `u${mine}`, role: 'user', text: message }]);
      setBusy(true);
      setError('');
      setAnnounce('');
      try {
        const r = await api.post<{ conversationId: string; messageId: string; answer: PoolAnswer }>(
          '/assistant/ask',
          {
            message,
            conversationId: cid,
            vacancyId: scopeId,
            language: getLang(),
            pick: extra.pick,
            showAll: extra.showAll,
          },
        );
        if (turn.current !== mine) return;
        setCid(r.conversationId);
        setItems((i) => [...i, { id: r.messageId, role: 'assistant', answer: r.answer }]);
        setAnnounce(tr('{name} has answered.', { name: config.name }));
      } catch (e) {
        if (turn.current === mine) setError(errMsg(e));
      } finally {
        if (turn.current === mine) setBusy(false);
      }
    },
    [busy, cid, scopeId, config.name],
  );

  // A question typed in the Ask bar arrives here.
  useEffect(() => {
    if (!open || !queued) return;
    const q = takePendingQuestion();
    if (q) void send(q);
  }, [open, queued, send]);

  useEffect(() => {
    if (open && !queued) inputRef.current?.focus();
  }, [open, queued]);
  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [items, busy]);

  const newChat = () => {
    turn.current++;
    setItems([]);
    setCid(undefined);
    setError('');
    setBusy(false);
    setHistory(null);
  };
  async function showHistory() {
    if (history) return setHistory(null);
    try {
      setHistory(await api.get<Conversation[]>('/assistant/conversations'));
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function reopen(id: string) {
    try {
      const c = await api.get<{
        id: string;
        messages: {
          id: string;
          role: 'user' | 'assistant';
          content: { text?: string } & Partial<PoolAnswer>;
        }[];
      }>(`/assistant/conversations/${id}`);
      setItems(
        c.messages.map((m) =>
          m.role === 'user'
            ? { id: m.id, role: 'user', text: m.content.text ?? '' }
            : { id: m.id, role: 'assistant', answer: m.content as PoolAnswer },
        ),
      );
      setCid(id);
      setHistory(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function remove(id: string) {
    try {
      await api.del(`/assistant/conversations/${id}`);
      setHistory((h) => h?.filter((c) => c.id !== id) ?? null);
      if (id === cid) newChat();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (!open) return null;
  const lastUser = [...items].reverse().find((i) => i.role === 'user') as
    { text: string } | undefined;

  return (
    <aside
      aria-label={config.name}
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
            <Logo size={20} />
            {config.name}
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">{SLOGAN}</p>
          <p className="mt-1 truncate text-sm text-ink-2" data-testid="scope-chip">
            {scope
              ? t('Searching in: {title}', { title: scope.title })
              : t('Searching in: all vacancies')}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className={btnSecondary}
            aria-expanded={history !== null}
            onClick={() => void showHistory()}
          >
            {t('History')}
          </button>
          <button type="button" className={btnSecondary} onClick={() => setAssistantOpen(false)}>
            {t('Close')}
          </button>
        </div>
      </header>

      <p className="border-b border-line px-3 py-2 text-xs text-ink-3">
        {t('Chats are private to you and may be reviewed for compliance.')}
      </p>

      {history ? (
        <div
          className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
          aria-label={t('Earlier chats')}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('Earlier chats')}</h3>
            <button type="button" className="text-sm text-link underline" onClick={newChat}>
              {t('New chat')}
            </button>
          </div>
          {history.length === 0 && <p className="text-sm text-ink-3">{t('No earlier chats.')}</p>}
          <ul className="divide-y divide-line">
            {history.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:underline"
                  onClick={() => void reopen(c.id)}
                >
                  <span className="block truncate">{c.title}</span>
                  <span className="text-xs text-ink-3">{ago(c.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="shrink-0 text-xs text-link underline"
                  aria-label={t('Delete chat: {title}', { title: c.title })}
                  onClick={() => void remove(c.id)}
                >
                  {t('Delete')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
          aria-label={t('Conversation')}
        >
          {items.length === 0 && !busy && (
            <div className="space-y-2">
              <p className="text-sm text-ink-2">
                {t(
                  '{name} finds candidates in your pool. It shows the matches; it does not decide.',
                  { name: config.name },
                )}
              </p>
              <ul className="flex flex-wrap gap-2" aria-label={t('Suggested questions')}>
                {[
                  scope
                    ? t('Find the right candidate for {vacancy}', { vacancy: scope.title })
                    : t('Find the right candidate for…'),
                  scope ? t('How many candidates for {vacancy}?', { vacancy: scope.title }) : null,
                  scope ? t('Show the Shortlist for {vacancy}', { vacancy: scope.title }) : null,
                ]
                  .filter((x): x is string => !!x)
                  .map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        className="rounded-full border border-edge bg-card px-3 py-1 text-sm hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        onClick={() =>
                          scope
                            ? void send(q)
                            : (setText(q.replace('…', '')), inputRef.current?.focus())
                        }
                      >
                        {q}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {items.map((it) =>
            it.role === 'user' ? (
              <p key={it.id} className="ml-8 rounded-lg bg-sel p-2 text-sm">
                {it.text}
              </p>
            ) : (
              <PoolAnswerView
                key={it.id}
                answer={it.answer}
                busy={busy}
                onPick={(id) => void send(lastUser?.text ?? '', { pick: id, echo: false })}
                onAll={() =>
                  void send(lastUser?.text ?? '', {
                    pick: it.answer.vacancy?.id,
                    showAll: true,
                    echo: false,
                  })
                }
                onSuggest={(q) => void send(q)}
              />
            ),
          )}
          {busy && (
            <p className="text-sm text-ink-2" role="status">
              {t('{name} is looking…', { name: config.name })}
            </p>
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
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const m = text.trim();
          if (!m || busy) return;
          setText('');
          setHistory(null);
          void send(m);
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="sr-only">{t('Ask {name}', { name: config.name })}</span>
          <textarea
            ref={inputRef}
            rows={2}
            maxLength={1000}
            value={text}
            placeholder={SLOGAN}
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
    </aside>
  );
}

function PoolAnswerView({
  answer: a,
  busy,
  onPick,
  onAll,
  onSuggest,
}: {
  answer: PoolAnswer;
  busy: boolean;
  onPick: (id: string) => void;
  onAll: () => void;
  onSuggest: (q: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-lg border border-line p-3 text-sm" data-kind={a.kind}>
      <p className="font-medium">{a.headline}</p>
      {a.vacancy && a.kind === 'pool' && (
        <p className="text-xs text-ink-3">
          <a className="text-link hover:underline" href={`#/vacancies/${a.vacancy.id}`}>
            {a.vacancy.title}
          </a>
        </p>
      )}
      {a.notes.map((n) => (
        <p key={n} className="text-ink-2">
          {n}
        </p>
      ))}
      {a.options.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t('Vacancies')}>
          {a.options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={busy}
                className="w-full rounded-md border border-edge px-3 py-1.5 text-left hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                onClick={() => onPick(o.id)}
              >
                {o.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {a.rows.length > 0 && (
        <ol className="divide-y divide-line" aria-label={t('Candidates')}>
          {a.rows.map((r, i) => (
            <li key={r.matchId} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-ink-3">{i + 1}.</span>
                <a
                  className="font-medium text-link hover:underline"
                  href={`#/candidates/${r.matchId}`}
                >
                  {r.label}
                </a>
                <span className="tabular-nums">{r.score}%</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BAND_STYLE[r.band]}`}>
                  {t(BAND_NAME[r.band])}
                </span>
                {r.decision !== 'new' && (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${MARK_STYLE[r.decision]}`}
                  >
                    {t(r.decisionLabel)}
                  </span>
                )}
                {r.outOfDate && <span className="text-xs text-warn-text">{t('Out of date')}</span>}
                {r.vacancyTitle && !a.vacancy && (
                  <span className="text-xs text-ink-2">· {r.vacancyTitle}</span>
                )}
              </div>
              {r.skillHits && r.skillHits.length > 0 && (
                <p className="ml-7 text-xs font-medium text-ink">
                  {t('In the resume')}:{' '}
                  {r.skillHits.map((h) => `${h.skill} ×${h.count}`).join(', ')}
                </p>
              )}
              <p className="ml-7 text-xs text-ink-2">
                {t('{found} of {total} must-haves found', {
                  found: r.mustFound,
                  total: r.mustTotal,
                })}
                {r.strengths.length > 0 && ` · ${r.strengths.join(', ')}`}
                {r.missing.length > 0 && ` · ${t('Not found')}: ${r.missing.join(', ')}`}
              </p>
            </li>
          ))}
        </ol>
      )}
      {a.more > 0 && (
        <button type="button" className="text-link underline" disabled={busy} onClick={onAll}>
          {t('Show all ({n} more)', { n: a.more })}
        </button>
      )}
      {a.suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {a.suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="rounded-full border border-edge px-3 py-1 hover:bg-page"
                onClick={() => onSuggest(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-3">{t('As of {time}', { time: ago(a.asOf) })}</p>
    </div>
  );
}
