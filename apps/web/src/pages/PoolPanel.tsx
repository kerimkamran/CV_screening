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
import { reviewHref } from '../review';
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
    documentId: string;
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
    /** Skill search: the line of the resume where the skill is written, with the word itself. */
    passages?: { skill: string; text?: string; hit?: string }[];
  }[];
  /** Rediscovery (switch on): a resume of another vacancy that can be analyzed for this one. */
  analyze?: { matchId: string; vacancyId: string; label: string }[];
  /** Words searched as written because the dictionary does not know them. */
  unknownSkills?: string[];
  /** Skill search across vacancies: each vacancy shown with how many resumes mention the skills. */
  groups?: { vacancyId: string; title: string; total: number }[];
  /** Similar vacancies: an offer to review their requirements in this vacancy's Role card. */
  copy?: { fromId: string; toId: string; title: string; shared: number; of: number }[];
  /** Compare, doctor, changes, what-if, recall: a small table written by the server. */
  table?: { head: string[]; rows: { cells: string[]; tag?: 'must' | 'nice' }[] };
  /** Where to go next: a candidate or a vacancy. */
  actions?: { label: string; href: string }[];
  /** The table can be copied as text (interview kit). */
  copyable?: boolean;
  /** "How I got this": how the question was read and what the answer used. */
  receipt?: { read: string; by: 'rules' | 'model'; sources: string[]; asOf: string };
  /** What the answer is about (vacancy, skills, filters), shown as chips so a wrong reading is visible. */
  used?: { kind: string; text: string }[];
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
    async (
      message: string,
      extra: {
        pick?: string;
        showAll?: boolean;
        echo?: boolean;
        without?: { kind: 'skill' | 'band' | 'mark' | 'top'; text?: string };
      } = {},
    ) => {
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
            without: extra.without,
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
    const list = listRef.current;
    if (!list) return;
    // A new answer is read from its first line (a long result list would otherwise jump to its end);
    // the "looking…" line and the user's own message go to the bottom.
    const last = items[items.length - 1];
    const answers = list.querySelectorAll<HTMLElement>('[data-answer]');
    const top = last?.role === 'assistant' && !busy ? answers[answers.length - 1] : null;
    if (top) list.scrollTo?.({ top: Math.max(0, top.offsetTop - list.offsetTop - 8) });
    else list.scrollTo?.({ top: list.scrollHeight });
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
  const lastAnswerId = [...items].reverse().find((i) => i.role === 'assistant')?.id;
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
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85dvh] flex-col rounded-t-xl border border-line bg-card shadow-xl sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-dvh sm:max-h-none sm:w-96 sm:rounded-none sm:border-y-0 sm:border-r-0"
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
          tabIndex={0}
          className="relative min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
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
                canEdit={it.id === lastAnswerId}
                onRemove={(c) =>
                  void send(`− ${c.text}`, {
                    without: { kind: c.kind as 'skill' | 'band' | 'mark' | 'top', text: c.text },
                  })
                }
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
  canEdit,
  onRemove,
}: {
  answer: PoolAnswer;
  busy: boolean;
  onPick: (id: string) => void;
  onAll: () => void;
  onSuggest: (q: string) => void;
  canEdit: boolean;
  onRemove: (chip: { kind: string; text: string }) => void;
}) {
  const t = useT();
  return (
    <div
      className="space-y-2 rounded-2xl border border-line p-3 text-sm"
      data-kind={a.kind}
      data-answer
    >
      <p className="font-medium">{a.headline}</p>
      {a.vacancy && a.kind === 'pool' && (
        <p className="text-xs text-ink-3">
          <a className="text-link hover:underline" href={`#/vacancies/${a.vacancy.id}`}>
            {a.vacancy.title}
          </a>
        </p>
      )}
      {a.used && a.used.length > 0 && a.kind === 'pool' && (
        <ul className="flex flex-wrap gap-1" aria-label={t('Used for this answer')}>
          {a.used.map((u) => {
            const removable = canEdit && ['skill', 'band', 'mark', 'top'].includes(u.kind);
            return (
              <li
                key={`${u.kind}:${u.text}`}
                className="flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-xs text-ink-2"
                data-chip={u.kind}
              >
                {u.text}
                {removable && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t('Remove filter {name}', { name: u.text })}
                    className="rounded px-0.5 text-ink-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    onClick={() => onRemove(u)}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {a.unknownSkills && a.unknownSkills.length > 0 && a.kind === 'pool' && (
        <SuggestWords words={a.unknownSkills} />
      )}
      {a.notes.map((n) => (
        <p key={n} className="text-ink-2">
          {n}
        </p>
      ))}
      {a.table && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {a.table.head.map((h, i) => (
                  <th key={i} scope="col" className="border-b border-line px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.table.rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {r.cells.map((c, j) => (
                    <td key={j} className="px-2 py-1 align-top">
                      {c}
                      {j === 0 && r.tag === 'must' && (
                        <span className="ml-1 rounded bg-page px-1 text-ink-3">{t('must')}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.copy && a.copy.length > 0 && (
        <ul className="space-y-1" aria-label={t('Copy requirements')}>
          {a.copy.map((c) => (
            <li key={c.fromId}>
              <button
                type="button"
                className="rounded-full border border-edge px-3 py-1 text-left hover:bg-hover"
                onClick={() => {
                  try {
                    sessionStorage.setItem(`cv-copy-reqs:${c.toId}`, c.fromId);
                  } catch {
                    /* without storage the person opens the vacancy and copies by hand */
                  }
                  window.location.hash = `#/vacancies/${c.toId}`;
                }}
              >
                {t('Review the requirements of {title} to copy', { title: c.title })}
              </button>
            </li>
          ))}
        </ul>
      )}
      {a.analyze && a.analyze.length > 0 && a.vacancy && (
        <AnalyzeHere items={a.analyze} vacancyTitle={a.vacancy.title} />
      )}
      {a.actions && a.actions.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {a.actions.map((x) => (
            <li key={x.href}>
              <a
                className="inline-block rounded-md border border-edge px-3 py-1 text-link hover:bg-page"
                href={x.href}
              >
                {x.label}
              </a>
            </li>
          ))}
        </ul>
      )}
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
              {a.groups && a.rows[i - 1]?.vacancyTitle !== r.vacancyTitle && (
                <p className="mb-1 flex flex-wrap items-baseline gap-x-2 border-b border-line pb-1 text-sm font-semibold text-ink">
                  <span>{r.vacancyTitle}</span>
                  <span className="text-xs font-normal text-ink-2">
                    {t('{n} resumes mention it', {
                      n: a.groups.find((g) => g.title === r.vacancyTitle)?.total ?? 0,
                    })}
                  </span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-ink-3">{i + 1}.</span>
                <a
                  className="font-medium text-link hover:underline"
                  href={reviewHref(r.documentId)}
                >
                  {r.label}
                </a>
                <span className="tabular-nums">{r.score}%</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_STYLE[r.band]}`}
                >
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
              {r.passages?.some((p) => p.text) && (
                <p className="ml-7 mt-1 text-xs italic text-ink-3">
                  {t('Mentioned in the resume, not assessed')}
                </p>
              )}
              {r.passages
                ?.filter((p) => p.text)
                .map((p, k) => (
                  <blockquote
                    key={k}
                    className="ml-7 mt-1 border-l-2 border-line pl-2 text-xs text-ink-2"
                  >
                    <HighlightedPassage text={p.text!} hit={p.hit} />
                  </blockquote>
                ))}
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
      {a.copyable && a.table && <CopyTable table={a.table} />}
      {a.receipt && (
        <details className="text-xs text-ink-3">
          <summary className="cursor-pointer">{t('How I got this')}</summary>
          <p className="mt-1">
            {t('Read as')}: {a.receipt.read}
            {' · '}
            {a.receipt.by === 'model' ? t('A model read the question') : t('Read by rules')}
            {' · '}
            {a.receipt.sources.join(', ')}
          </p>
        </details>
      )}
      <p className="text-xs text-ink-3">{t('As of {time}', { time: ago(a.asOf) })}</p>
    </div>
  );
}

/** A line of a resume with the word that matched in bold. Text is plain: no markup is ever rendered. */
function HighlightedPassage({ text, hit }: { text: string; hit?: string }) {
  const i = hit ? text.toLowerCase().indexOf(hit.toLowerCase()) : -1;
  if (!hit || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-warn px-0.5 font-medium text-ink">
        {text.slice(i, i + hit.length)}
      </mark>
      {text.slice(i + hit.length)}
    </>
  );
}

/** Copies a table as tab-separated text, for pasting into a document or an e-mail. */
function CopyTable({ table }: { table: NonNullable<PoolAnswer['table']> }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    const text = [table.head, ...table.rows.map((r) => r.cells)]
      .map((r) => r.join('\t'))
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" className={btnSecondary} onClick={() => void copy()}>
      {done ? t('Copied') : t('Copy')}
    </button>
  );
}

/** A word the dictionary does not know was searched as written; the person may suggest it to the administrator. */
function SuggestWords({ words }: { words: string[] }) {
  const t = useT();
  const [sent, setSent] = useState<Record<string, 'ok' | 'error'>>({});
  async function suggest(w: string) {
    try {
      await api.post('/assistant/skills/suggest', { label: w, kind: 'tool', aliases: [] });
      setSent((s) => ({ ...s, [w]: 'ok' }));
    } catch {
      setSent((s) => ({ ...s, [w]: 'error' }));
    }
  }
  return (
    <ul className="space-y-1 text-xs text-ink-2" aria-label={t('Words not in the dictionary')}>
      {words.map((w) => (
        <li key={w}>
          {t('"{word}" is not in the dictionary, so it was searched as written.', { word: w })}{' '}
          {sent[w] === 'ok' ? (
            <span role="status">{t('Suggested. An administrator will review it.')}</span>
          ) : (
            <button
              type="button"
              className="text-link underline"
              onClick={() => void suggest(w)}
              aria-label={t('Suggest {word} to the administrator', { word: w })}
            >
              {sent[w] === 'error' ? t('Could not send. Try again') : t('Suggest it')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Analyze for this vacancy": a button per suggested resume. Nothing happens until it is pressed. */
function AnalyzeHere({
  items,
  vacancyTitle,
}: {
  items: { matchId: string; vacancyId: string; label: string }[];
  vacancyTitle: string;
}) {
  const t = useT();
  const [state, setState] = useState<Record<string, string>>({});
  async function go(it: { matchId: string; vacancyId: string }) {
    setState((s) => ({ ...s, [it.matchId]: 'busy' }));
    try {
      await api.post('/assistant/rediscovery/analyze', {
        matchId: it.matchId,
        vacancyId: it.vacancyId,
      });
      setState((s) => ({ ...s, [it.matchId]: 'done' }));
    } catch (e) {
      setState((s) => ({ ...s, [it.matchId]: `error:${errMsg(e)}` }));
    }
  }
  return (
    <ul className="space-y-1" aria-label={t('Analyze for this vacancy')}>
      {items.map((it) => {
        const st = state[it.matchId];
        return (
          <li key={it.matchId} className="flex flex-wrap items-center gap-2">
            {st === 'done' ? (
              <span role="status" className="text-xs text-ok-ink">
                {t('{name} was added to {vacancy}. The analysis is running.', {
                  name: it.label,
                  vacancy: vacancyTitle,
                })}
              </span>
            ) : (
              <button
                type="button"
                className={btnSecondary}
                disabled={st === 'busy'}
                onClick={() => void go(it)}
              >
                {t('Analyze {name} for {vacancy}', { name: it.label, vacancy: vacancyTitle })}
              </button>
            )}
            {st?.startsWith('error:') && (
              <span role="alert" className="text-xs text-err-ink">
                {st.slice(6)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
