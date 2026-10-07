import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { btnPrimary, Card, errMsg, Notice, when } from '../ui';

interface Group {
  group: string;
  files: number;
  scored: number;
  meanScore: number | null;
  favourableRate: number | null;
  needsLookRate: number | null;
  unreadRate: number | null;
  impactRatio: number | null;
  flag: 'ok' | 'review' | 'not_enough_data';
}
interface Fairness {
  generatedAt: string;
  totals: { files: number; scored: number; unread: number };
  dimensions: { key: string; label: string; groups: Group[]; suppressed: number }[];
  method: { favourable: string; rule: string; privacy: string };
}
interface ArmSummary {
  arm: 'masked' | 'unmasked';
  pairs: number;
  differing: number;
  meanAbsDelta: number;
  maxAbsDelta: number;
  worst: { template: string; variant: string; delta: number } | null;
  noise: number;
  verdict: 'consistent' | 'review' | 'incomplete';
}
interface Run {
  id: string;
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  startedBy: string | null;
  progress: number;
  total: number;
  error: string | null;
  provider: string | null;
  model: string | null;
  result: { summary: ArmSummary[] } | null;
}
interface Runs {
  runs: Run[];
  design: { variants: { key: string; label: string; change: string }[] };
}

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const FLAG = {
  ok: 'OK',
  review: 'Review',
  not_enough_data: 'Not enough data yet',
} as const;
const VERDICT = {
  consistent: 'Consistent',
  review: 'Review',
  incomplete: 'Incomplete',
} as const;
const GROUP_NAME: Record<string, string> = {
  az: 'Azerbaijani',
  ru: 'Russian',
  en: 'English',
  pdf: 'PDF',
  docx: 'Word',
  txt: 'Text',
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

/** Fairness monitoring for the people responsible for the tool: administrators and governance. */
export function Monitoring({ canRun }: { canRun: boolean }) {
  const t = useT();
  const [fair, setFair] = useState<Fairness | null>(null);
  const [runs, setRuns] = useState<Runs | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([
        api.get<Fairness>('/admin/fairness'),
        api.get<Runs>('/admin/eval'),
      ]);
      setFair(f);
      setRuns(r);
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const running = runs?.runs.some((r) => r.state === 'running') ?? false;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [running, load]);

  async function start() {
    setBusy(true);
    try {
      await api.post('/admin/eval/paired', {});
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const latest = runs?.runs.find((r) => r.state !== 'running');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('Fairness monitoring')}</h1>
      {error && <Notice kind="error">{error}</Notice>}

      <Card title={t('Paired-CV test')}>
        <p className="text-sm text-ink-2">
          {t(
            'Sends the same synthetic CV many times through the real scoring path, changing only the name, personal details or a career-break line. A fair tool gives the same score every time.',
          )}
        </p>
        {runs && (
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-3">
            {runs.design.variants.map((v) => (
              <li key={v.key}>
                {v.label}: {v.change}
              </li>
            ))}
          </ul>
        )}
        {canRun && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className={btnPrimary} disabled={busy || running} onClick={() => void start()}>
              {running ? t('Running…') : t('Run the paired-CV test')}
            </button>
            <span className="text-xs text-ink-3">
              {t(
                'Uses the active AI model: 48 short calls. Only synthetic CVs are used, never candidate data.',
              )}
            </span>
          </div>
        )}
        {runs?.runs[0]?.state === 'running' && (
          <p role="status" className="mt-2 text-sm">
            {t('{done} of {total} calls done', {
              done: runs.runs[0].progress,
              total: runs.runs[0].total,
            })}
          </p>
        )}
        {latest && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-ink-3">
              {t('Last run {when} by {who}, model {model}', {
                when: when(latest.finishedAt ?? latest.startedAt),
                who: latest.startedBy ?? '',
                model: `${latest.provider ?? ''} / ${latest.model ?? ''}`,
              })}
            </p>
            {latest.state === 'failed' ? (
              <Notice kind="error">{latest.error ?? t('The run failed.')}</Notice>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-ink-3">
                      <th className="py-1 pr-3">{t('Arm')}</th>
                      <th className="py-1 pr-3">{t('Result')}</th>
                      <th className="py-1 pr-3">{t('Pairs that differ')}</th>
                      <th className="py-1 pr-3">{t('Largest score change')}</th>
                      <th className="py-1 pr-3">{t('Model noise')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.result?.summary.map((s) => (
                      <tr key={s.arm} className="border-b border-line">
                        <td className="py-1 pr-3">
                          {s.arm === 'masked'
                            ? t('As the tool works (identity masked)')
                            : t('Without masking (for comparison)')}
                        </td>
                        <td className="py-1 pr-3 font-medium">{t(VERDICT[s.verdict])}</td>
                        <td className="py-1 pr-3">
                          {s.differing} / {s.pairs}
                        </td>
                        <td className="py-1 pr-3">
                          {s.maxAbsDelta}
                          {s.worst ? ` (${s.worst.variant}, ${s.worst.template})` : ''}
                        </td>
                        <td className="py-1 pr-3">{s.noise}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-ink-3">
              {t(
                'A difference is a score change above 5 points plus the model’s own noise. "Review" is a prompt to look, not a finding.',
              )}
            </p>
          </div>
        )}
      </Card>

      <Card title={t('Outcomes by group')}>
        {!fair ? (
          <p className="text-sm text-ink-3">{t('Loading…')}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">{t(fair.method.privacy)}</p>
            <p className="text-xs text-ink-3">
              {t('{files} files, {scored} scored, {unread} could not be read.', {
                files: fair.totals.files,
                scored: fair.totals.scored,
                unread: fair.totals.unread,
              })}
            </p>
            {fair.dimensions.map((d) => (
              <div key={d.key}>
                <h2 className="text-base font-medium">{t(d.label)}</h2>
                {d.groups.length === 0 ? (
                  <p className="text-sm text-ink-3">{t('No group is large enough to show yet.')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-ink-3">
                          <th className="py-1 pr-3">{t('Group')}</th>
                          <th className="py-1 pr-3">{t('Files')}</th>
                          <th className="py-1 pr-3">{t('Scored')}</th>
                          <th className="py-1 pr-3">{t('Average score')}</th>
                          <th className="py-1 pr-3">{t('Strong or Good')}</th>
                          <th className="py-1 pr-3">{t('Needs a human look')}</th>
                          <th className="py-1 pr-3">{t('Not readable')}</th>
                          <th className="py-1 pr-3">{t('Compared with the best group')}</th>
                          <th className="py-1 pr-3">{t('Flag')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.groups.map((g) => (
                          <tr key={g.group} className="border-b border-line">
                            <td className="py-1 pr-3">{t(GROUP_NAME[g.group] ?? g.group)}</td>
                            <td className="py-1 pr-3">{g.files}</td>
                            <td className="py-1 pr-3">{g.scored}</td>
                            <td className="py-1 pr-3">{g.meanScore ?? '–'}</td>
                            <td className="py-1 pr-3">{pct(g.favourableRate)}</td>
                            <td className="py-1 pr-3">{pct(g.needsLookRate)}</td>
                            <td className="py-1 pr-3">{pct(g.unreadRate)}</td>
                            <td className="py-1 pr-3">{pct(g.impactRatio)}</td>
                            <td className="py-1 pr-3 font-medium">{t(FLAG[g.flag])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {d.suppressed > 0 && (
                  <p className="text-xs text-ink-3">
                    {t('{n} files are in groups too small to show.', { n: d.suppressed })}
                  </p>
                )}
              </div>
            ))}
            <p className="text-xs text-ink-3">{t(fair.method.rule)}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
