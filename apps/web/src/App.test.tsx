import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fetchReadiness, session } from './api';
import { AiSettings } from './pages/Admin';
import { Candidate } from './pages/Candidate';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init);
      const status = r.status ?? 200;
      return new Response(JSON.stringify(r.body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const up = async () => ({ state: 'up' as const });

beforeEach(() => session.set(null));
afterEach(() => vi.unstubAllGlobals());

describe('sign-in and gates', () => {
  it('shows the sign-in form when signed out, with the AI notice and service status in the footer', async () => {
    render(<App check={up} />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(await screen.findByText('Service ready')).toBeInTheDocument();
    expect(
      screen.getByText(/Every decision about a candidate is made by a person/),
    ).toBeInTheDocument();
  });

  it('signs in, then lists vacancies for a recruiter', async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith('/auth/login'))
        return { body: { token: 't1', expiresIn: 3600, mustChangePassword: false } };
      if (url.endsWith('/me'))
        return {
          body: { userId: 'u', displayName: 'Ayla', email: 'a@x.az', roles: ['TA_PARTNER'] },
        };
      if (url.endsWith('/vacancies'))
        return {
          body: [
            {
              id: 'V',
              title: 'Backend Engineer',
              department: 'IT',
              location: 'Baku',
              createdAt: new Date().toISOString(),
              documentCount: 3,
            },
          ],
        };
      return { status: 404, body: {} };
    });
    render(<App check={up} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'a@x.az');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Backend Engineer')).toBeInTheDocument();
    expect(screen.getByText(/3 CVs/)).toBeInTheDocument();
    // The token is sent only in the Authorization header, never in a URL.
    const authed = calls.filter((c) => c.url.endsWith('/me'));
    expect((authed[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer t1');
    expect(calls.every((c) => !c.url.includes('t1'))).toBe(true);
  });

  it('confines a user with a temporary password to choosing a new one', async () => {
    session.set('tok');
    mockFetch((url) =>
      url.endsWith('/me')
        ? {
            body: {
              userId: 'u',
              displayName: 'New',
              email: 'n@x.az',
              roles: ['TA_PARTNER'],
              mustChangePassword: true,
            },
          }
        : { status: 403, body: {} },
    );
    render(<App check={up} />);
    expect(
      await screen.findByRole('heading', { name: 'Choose your own password' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vacancies' })).not.toBeInTheDocument();
  });

  it('shows administrators only the admin area, not candidate data', async () => {
    session.set('tok');
    mockFetch((url) =>
      url.endsWith('/me')
        ? { body: { userId: 'u', displayName: 'Root', email: 'r@x.az', roles: ['ADMIN'] } }
        : { body: [] },
    );
    render(<App check={up} />);
    expect(
      await screen.findByText(/Administrators manage users and AI models/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vacancies' })).not.toBeInTheDocument();
  });
});

describe('candidate review', () => {
  const detail = {
    id: 'S',
    vacancyId: 'V',
    state: 'completed',
    band: 'possible_match',
    candidateName: 'Dilara',
    candidateEmail: null,
    summary: 'Backend engineer.',
    knockout: [],
    knockoutTriggered: false,
    injectionSuspected: false,
    score: {
      value: 50,
      breakdown: { formula: 'f', earned: 5, possible: 10, mandatoryGaps: 1, items: [] },
    },
    aiProvider: 'anthropic',
    aiModel: 'm',
    error: null,
    criteriaVersion: 1,
    documentId: 'D',
    filename: 'cv.txt',
    uploadedAt: new Date().toISOString(),
    parseStatus: 'parsed',
    text: 'Built payment systems in Java.',
    textTruncated: false,
    erased: false,
    assessments: [
      {
        requirementId: 'R',
        text: 'Java',
        classification: 'mandatory',
        weight: 10,
        status: 'met',
        confidence: 'high',
        evidence: [{ start: 6, end: 29, quote: 'payment systems in Java' }],
        evidenceDropped: 0,
        rationale: 'Stated.',
      },
    ],
    decisions: [],
  };

  it('highlights verified evidence in the CV text and labels AI output', async () => {
    session.set('tok');
    mockFetch(() => ({ body: detail }));
    render(<Candidate id="S" />);
    expect(await screen.findByText('AI summary')).toBeInTheDocument();
    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('payment systems in Java');
  });

  it('will not submit a rejection until the reviewer attests they read the evidence', async () => {
    session.set('tok');
    const calls = mockFetch((url, init) =>
      init?.method === 'POST' ? { status: 201, body: { id: 'x' } } : { body: detail },
    );
    render(<Candidate id="S" />);
    await userEvent.click(await screen.findByLabelText('Reject'));
    await userEvent.type(
      screen.getByLabelText(/Reason/),
      'Missing the licence and the required experience',
    );
    const submit = screen.getByRole('button', { name: 'Record decision' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I have read the CV and the evidence myself/));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(JSON.parse(post.init!.body as string)).toMatchObject({
      outcome: 'reject',
      evidenceReviewed: true,
    });
  });
});

describe('fetchReadiness', () => {
  const res = (ok: boolean) => ({ ok }) as Response;
  it('maps 2xx to up, non-2xx and network errors to down', async () => {
    expect(await fetchReadiness(async () => res(true))).toEqual({ state: 'up' });
    expect(await fetchReadiness(async () => res(false))).toEqual({ state: 'down' });
    expect(
      await fetchReadiness(async () => {
        throw new Error('offline');
      }),
    ).toEqual({ state: 'down' });
  });
  it('only ever calls the first-party API path (AISEC-01)', async () => {
    const seen: string[] = [];
    await fetchReadiness(
      (async (u: RequestInfo | URL) => (seen.push(String(u)), res(true))) as typeof fetch,
    );
    expect(seen[0]).toMatch(/\/readyz$/);
    expect(seen[0]).not.toMatch(/^https?:/);
  });
});

describe('admin AI models', () => {
  it("lets the admin load a company's models, add several, and switch the active one", async () => {
    const overview = {
      active: null,
      connections: [
        {
          id: 'C1',
          name: 'Mistral',
          kind: 'openai_compatible',
          baseUrl: 'https://api.example.com/v1',
          keyHint: '1234',
          models: [
            { id: 'M1', connectionId: 'C1', modelId: 'small', label: 'small', isActive: false },
          ],
        },
      ],
    };
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/admin/ai')) return { body: overview };
      if (url.endsWith('/available-models'))
        return {
          body: {
            models: [
              { id: 'small', label: 'small' },
              { id: 'large', label: 'large' },
              { id: 'medium', label: 'medium' },
            ],
          },
        };
      if (url.endsWith('/models/M1/test')) return { body: { ok: true, ms: 5 } };
      if (init?.method === 'POST' || init?.method === 'PUT') return { body: {} };
      return { status: 404, body: {} };
    });
    render(<AiSettings />);
    expect(await screen.findByText(/No model is active/)).toBeInTheDocument();
    expect(screen.getByText('small')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load Mistral models' }));
    // the model already chosen is not offered again
    expect(await screen.findByLabelText('large')).toBeInTheDocument();
    expect(screen.queryByLabelText('small')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('large'));
    await userEvent.click(screen.getByLabelText('medium'));
    await userEvent.click(screen.getByRole('button', { name: /Add selected models \(2\)/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/admin/ai/connections/C1/models'))).toBe(true),
    );
    const add = calls.find((c) => c.url.endsWith('/admin/ai/connections/C1/models'))!;
    expect(
      JSON.parse(String(add.init!.body)).models.map((m: { modelId: string }) => m.modelId),
    ).toEqual(['large', 'medium']);

    await userEvent.click(screen.getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin/ai/active'))).toBe(true));
    expect(
      JSON.parse(String(calls.find((c) => c.url.endsWith('/admin/ai/active'))!.init!.body)),
    ).toEqual({ modelId: 'M1' });
    // the test ran first, so a failing model would never have been switched to
    const order = calls.map((c) => c.url);
    expect(order.findIndex((u) => u.endsWith('/models/M1/test'))).toBeLessThan(
      order.findIndex((u) => u.endsWith('/admin/ai/active')),
    );
  });

  it('adds a company of any kind, asking for a base URL only for OpenAI-compatible ones', async () => {
    const calls = mockFetch((url, init) =>
      init?.method === 'POST'
        ? { status: 201, body: { id: 'N' } }
        : { body: { active: null, connections: [] } },
    );
    render(<AiSettings />);
    await screen.findByText(/No model is active/);
    expect(screen.queryByLabelText(/^Base URL/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'openai_compatible');
    await userEvent.type(screen.getByLabelText('Name shown to administrators'), 'DeepSeek');
    await userEvent.type(screen.getByLabelText(/^Base URL/), 'https://api.example.com/v1');
    await userEvent.type(screen.getByLabelText(/^API key/), 'key-1234567890');
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === 'POST')!.init!.body))).toEqual({
      name: 'DeepSeek',
      kind: 'openai_compatible',
      apiKey: 'key-1234567890',
      baseUrl: 'https://api.example.com/v1',
    });
  });
});
