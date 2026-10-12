import { useCallback, useEffect, useState } from 'react';
import { api, type Classification, type Criteria, type Requirement } from '../api';
import { useT } from '../i18n';
import { btnPrimary, btnSecondary, Card, errMsg, Field, input, Notice } from '../ui';

// ------------------------------------------------------------------ criteria

const CLASS_LABEL: Record<Classification, string> = {
  mandatory: 'Mandatory',
  preferred: 'Preferred',
  informational: 'Informational (not scored)',
  disqualifier: 'Knockout rule (routes to review)',
};

const blank = (): Requirement => ({
  text: '',
  classification: 'mandatory',
  weight: 10,
  rule: null,
});

export function CriteriaTab({ id }: { id: string }) {
  const t = useT();
  const [c, setC] = useState<Criteria | null>(null);
  const [rows, setRows] = useState<Requirement[]>([]);
  const [jd, setJd] = useState('');
  const [editJd, setEditJd] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);

  const apply = (x: Criteria) => {
    setC(x);
    setRows(x.current?.requirements ?? []);
    setDirty(false);
  };
  const load = useCallback(async () => {
    try {
      apply(await api.get<Criteria>(`/vacancies/${id}/criteria`));
      setJd((await api.get<{ body: string }>(`/vacancies/${id}/jd`)).body);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    setOk('');
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const frozen = c?.current?.frozen ?? false;
  const edit = (i: number, patch: Partial<Requirement>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const setClass = (i: number, cl: Classification) =>
    edit(i, {
      classification: cl,
      weight: cl === 'mandatory' ? 10 : cl === 'preferred' ? 5 : null,
      rule: cl === 'disqualifier' ? { type: 'must_contain_any', terms: [] } : null,
    });
  const payload = () => ({
    requirements: rows.map((r) => ({
      text: r.text,
      classification: r.classification,
      weight: r.weight,
      rule: r.rule,
      confidence: r.confidence ?? null,
    })),
  });

  return (
    <div className="space-y-4">
      <Notice kind="info">
        {t('The AI proposes criteria from the job description.')} <strong>{t('You decide')}</strong>
        {t(
          ': edit, add or remove anything, then freeze. Frozen criteria cannot change, so every score can be traced to exactly what was used.',
        )}
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      {ok && <Notice kind="ok">{ok}</Notice>}

      <Card
        title={t('Job description')}
        actions={
          <button className={btnSecondary} onClick={() => setEditJd((e) => !e)}>
            {editJd ? t('Close') : t('Edit text')}
          </button>
        }
      >
        {editJd ? (
          <div className="space-y-2">
            <textarea
              className={`${input} h-48 font-mono`}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
            <button
              className={btnPrimary}
              disabled={!!busy}
              onClick={() =>
                run('jd', async () => {
                  await api.put(`/vacancies/${id}/jd`, { jdText: jd });
                  setEditJd(false);
                  setOk(t('Saved as a new version. Extract criteria again to refresh the draft.'));
                })
              }
            >
              {t('Save new version')}
            </button>
          </div>
        ) : (
          <p className="max-h-40 overflow-auto whitespace-pre-wrap text-sm text-ink-2">{jd}</p>
        )}
      </Card>

      <Card
        title={
          c?.current
            ? frozen
              ? t('Criteria · version {n} · frozen', { n: c.current.version })
              : t('Criteria · version {n} · draft', { n: c.current.version })
            : t('Criteria')
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {!frozen && (
              <button
                className={btnSecondary}
                disabled={
                  !!busy ||
                  (rows.length > 0 &&
                    !window.confirm(t('Replace the current draft with new AI suggestions?')))
                }
                onClick={() =>
                  run('extract', async () =>
                    apply(await api.post<Criteria>(`/vacancies/${id}/criteria/extract`)),
                  )
                }
              >
                {busy === 'extract' ? t('Extracting…') : t('Extract with AI')}
              </button>
            )}
            {frozen && (
              <button
                className={btnSecondary}
                disabled={!!busy}
                onClick={() =>
                  run('nv', async () =>
                    apply(await api.post<Criteria>(`/vacancies/${id}/criteria/new-version`)),
                  )
                }
              >
                {t('Create new version to edit')}
              </button>
            )}
          </div>
        }
      >
        {rows.length === 0 && !frozen && (
          <p className="text-sm text-ink-3">
            {t('No criteria yet. Extract them with AI or add your own.')}
          </p>
        )}
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.id ?? i} className="rounded-md border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_14rem_6rem_auto]">
                <Field label={t('Criterion')}>
                  <input
                    className={input}
                    disabled={frozen}
                    value={r.text}
                    onChange={(e) => edit(i, { text: e.target.value })}
                  />
                </Field>
                <Field label={t('Type')}>
                  <select
                    className={input}
                    disabled={frozen}
                    value={r.classification}
                    onChange={(e) => setClass(i, e.target.value as Classification)}
                  >
                    {(Object.keys(CLASS_LABEL) as Classification[]).map((k) => (
                      <option key={k} value={k}>
                        {t(CLASS_LABEL[k])}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('Weight')}>
                  <input
                    className={input}
                    type="number"
                    min={1}
                    max={100}
                    disabled={
                      frozen ||
                      (r.classification !== 'mandatory' && r.classification !== 'preferred')
                    }
                    value={r.weight ?? ''}
                    onChange={(e) =>
                      edit(i, { weight: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </Field>
                {!frozen && (
                  <div className="flex items-end">
                    <button
                      className={btnSecondary}
                      onClick={() => (
                        setRows((rs) => rs.filter((_, j) => j !== i)),
                        setDirty(true)
                      )}
                      aria-label={t('Remove criterion {n}', { n: i + 1 })}
                    >
                      {t('Remove')}
                    </button>
                  </div>
                )}
              </div>
              {r.classification === 'disqualifier' && r.rule && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[14rem_1fr]">
                  <Field label={t('Rule')}>
                    <select
                      className={input}
                      disabled={frozen}
                      value={r.rule.type}
                      onChange={(e) =>
                        edit(i, {
                          rule: { ...r.rule!, type: e.target.value as 'must_contain_any' },
                        })
                      }
                    >
                      <option value="must_contain_any">
                        {t('Flag if the CV contains NONE of these words')}
                      </option>
                      <option value="must_not_contain_any">
                        {t('Flag if the CV contains ANY of these words')}
                      </option>
                    </select>
                  </Field>
                  <Field
                    label={t('Words (comma-separated)')}
                    hint={t(
                      'Matched as whole words, ignoring case. Include likely synonyms and languages. A match only sends the CV to human review; nobody is rejected automatically.',
                    )}
                  >
                    <input
                      className={input}
                      disabled={frozen}
                      value={r.rule.terms.join(', ')}
                      onChange={(e) =>
                        edit(i, {
                          rule: {
                            ...r.rule!,
                            terms: e.target.value
                              .split(',')
                              .map((w) => w.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              )}
              {(r.confidence === 'low' || r.confidence === 'medium') && !dirty && (
                <p className="mt-1 text-xs text-warn-text">
                  {r.confidence === 'low'
                    ? t('The AI was unsure about this one. Please check it.')
                    : t('The AI was moderately sure about this one. Please check it.')}
                </p>
              )}
            </div>
          ))}
        </div>
        {!frozen && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={btnSecondary}
              onClick={() => (setRows((rs) => [...rs, blank()]), setDirty(true))}
            >
              {t('Add criterion')}
            </button>
            <button
              className={btnSecondary}
              disabled={!!busy || !dirty}
              onClick={() =>
                run(
                  'save',
                  async () => (
                    apply(await api.put<Criteria>(`/vacancies/${id}/criteria`, payload())),
                    setOk(t('Draft saved.'))
                  ),
                )
              }
            >
              {t('Save draft')}
            </button>
            <button
              className={btnPrimary}
              disabled={!!busy || rows.length === 0}
              onClick={() =>
                run('freeze', async () => {
                  if (
                    !window.confirm(
                      t(
                        'Freeze these criteria? They cannot be edited afterwards (you can create a new version).',
                      ),
                    )
                  )
                    return;
                  if (dirty) await api.put(`/vacancies/${id}/criteria`, payload());
                  apply(await api.post<Criteria>(`/vacancies/${id}/criteria/freeze`));
                  setOk(t('Criteria frozen. You can now upload CVs.'));
                })
              }
            >
              {t('Freeze criteria')}
            </button>
          </div>
        )}
        {frozen && c?.versions && c.versions.length > 1 && (
          <p className="mt-3 text-xs text-ink-3">
            {t(
              'After creating and freezing a new version, choose “Re-analyze” on the Resumes card.',
            )}
          </p>
        )}
      </Card>
    </div>
  );
}

export const NOTICE_TEXT = `Our recruitment team uses an AI-assisted tool to help read and compare applications against the requirements of the role. The tool produces a suggested ranking with the evidence behind it. It does not make decisions: every shortlisting or rejection decision is made by a member of our recruitment team, who reviews your application. You may ask us for a human review of your application, for access to your data, or for its deletion, by contacting HR.`;
