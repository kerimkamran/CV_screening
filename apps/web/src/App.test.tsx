import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fetchReadiness, session } from './api';
import { AiSettings, Users } from './pages/Admin';
import { Candidate } from './pages/Candidate';
import { Results } from './pages/Results';

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

beforeEach(() => {
  window.location.hash = '';
});

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
    expect(await screen.findByText('Who fits this role?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Past scans' }));
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

const catalog = {
  companies: [
    {
      id: 'google',
      name: 'Google',
      keyHelp: 'A Gemini API key.',
      dataNote: 'Google data note.',
      extraFields: [],
      knownModels: [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      keyHelp: 'An OpenAI key.',
      dataNote: 'OpenAI data note.',
      extraFields: [
        {
          key: 'dataRegion',
          label: 'Data region',
          required: false,
          options: [
            { value: 'global', label: 'Global (default)' },
            { value: 'eu', label: 'Europe' },
          ],
        },
      ],
      knownModels: [
        { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
        { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
      ],
    },
    {
      id: 'nvidia',
      name: 'NVIDIA',
      keyHelp: 'An nvapi key.',
      dataNote: 'NVIDIA data note.',
      extraFields: [],
      knownModels: [{ id: 'nvidia/nemotron-a', label: 'Nemotron A' }],
    },
  ],
};

const overviewWith = (connections: unknown[]) => ({ active: null, connections });

describe('admin AI models', () => {
  it('adds a company in three steps: company, model (full live list), then the API key', async () => {
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/admin/ai/catalog')) return { body: catalog };
      if (url.endsWith('/admin/ai/discover'))
        return {
          body: {
            live: true,
            models: [
              { id: 'nvidia/nemotron-a', label: 'Nemotron A' },
              { id: 'nvidia/nemotron-b', label: 'Nemotron B' },
            ],
          },
        };
      if (url.endsWith('/admin/ai')) return { body: overviewWith([]) };
      if (init?.method === 'POST') return { status: 201, body: { id: 'N', added: 1 } };
      return { status: 404, body: {} };
    });
    render(<AiSettings />);
    expect(await screen.findByText(/No model is active/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Company'), 'nvidia');
    expect(screen.getByText('NVIDIA data note.')).toBeInTheDocument();
    // Before the key is added the documented models are shown and the full list cannot be loaded.
    expect(screen.getByLabelText(/nemotron-a/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load all NVIDIA models' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^API key/), 'nvapi-1234567890');
    await userEvent.click(screen.getByRole('button', { name: 'Load all NVIDIA models' }));
    expect(await screen.findByLabelText(/nemotron-b/)).toBeInTheDocument();
    const discover = calls.find((c) => c.url.endsWith('/admin/ai/discover'))!;
    expect(JSON.parse(String(discover.init!.body))).toMatchObject({
      company: 'nvidia',
      apiKey: 'nvapi-1234567890',
    });

    await userEvent.click(screen.getByLabelText(/nemotron-b/));
    await userEvent.click(
      screen.getByRole('button', { name: /Save company and model \(1 model\)/ }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/admin/ai/connections'))).toBe(true),
    );
    expect(
      JSON.parse(String(calls.find((c) => c.url.endsWith('/admin/ai/connections'))!.init!.body)),
    ).toEqual({
      company: 'nvidia',
      apiKey: 'nvapi-1234567890',
      models: [{ modelId: 'nvidia/nemotron-b', label: 'Nemotron B' }],
    });
  });

  it('shows a company’s extra options, and for an added company keeps its key and adds models', async () => {
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/admin/ai/catalog')) return { body: catalog };
      if (url.endsWith('/models/M1/test')) return { body: { ok: true, ms: 5 } };
      if (url.endsWith('/admin/ai'))
        return {
          body: overviewWith([
            {
              id: 'C1',
              company: 'openai',
              name: 'OpenAI',
              settings: {},
              keyHint: '1234',
              models: [
                {
                  id: 'M1',
                  connectionId: 'C1',
                  modelId: 'gpt-6-astra',
                  label: 'GPT-6 Astra',
                  isActive: false,
                },
              ],
            },
          ]),
        };
      if (init?.method === 'POST' || init?.method === 'PUT') return { body: {} };
      return { status: 404, body: {} };
    });
    render(<AiSettings />);
    await screen.findByText(/No model is active/);
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'openai');
    expect(screen.getAllByLabelText('Data region').length).toBeGreaterThan(0);
    expect(screen.getByText(/Key ending …1234 is on file/)).toBeInTheDocument();
    // the model already added is not offered again
    expect(screen.queryByRole('checkbox', { name: /gpt-6-astra/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/gpt-6-luna/));
    await userEvent.click(screen.getByRole('button', { name: /^Save \(1 model\)/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/admin/ai/connections/C1/models'))).toBe(true),
    );
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false); // key kept as is
    expect(
      JSON.parse(String(calls.find((c) => c.url.endsWith('/connections/C1/models'))!.init!.body)),
    ).toEqual({ models: [{ modelId: 'gpt-6-luna', label: 'GPT-6 Luna' }] });

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
});

describe('invitation links', () => {
  const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_abc';
  afterEach(() => {
    window.location.hash = '';
  });

  it('opening a link shows who it is for, lets them choose a password and signs them in', async () => {
    window.location.hash = `/set-password?token=${TOKEN}`;
    const calls = mockFetch((url) => {
      if (url.endsWith('/auth/setup-link/check'))
        return { body: { email: 'ayla@x.az', displayName: 'Ayla' } };
      if (url.endsWith('/auth/setup-password'))
        return { body: { token: 's1', expiresIn: 3600, mustChangePassword: false } };
      if (url.endsWith('/me'))
        return {
          body: { userId: 'u', displayName: 'Ayla', email: 'ayla@x.az', roles: ['TA_PARTNER'] },
        };
      return { body: [] };
    });
    render(<App check={up} />);
    expect(await screen.findByText('ayla@x.az')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^New password/), 'A-long-chosen-pass-1');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'different-pass-123');
    await userEvent.click(screen.getByRole('button', { name: 'Save password and sign in' }));
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Repeat new password'));
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'A-long-chosen-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save password and sign in' }));
    await waitFor(() => expect(session.get()).toBe('s1'));
    const sent = calls.find((c) => c.url.endsWith('/auth/setup-password'))!;
    expect(JSON.parse(String(sent.init!.body))).toEqual({
      token: TOKEN,
      newPassword: 'A-long-chosen-pass-1',
    });
  });

  it('says so plainly when a link is invalid, used or expired', async () => {
    window.location.hash = `/set-password?token=${TOKEN}`;
    mockFetch(() => ({
      status: 400,
      body: {
        message: 'This link is invalid or has expired. Ask your administrator for a new one.',
      },
    }));
    render(<App check={up} />);
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it('gives the admin a link to copy when the email could not be sent', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    mockFetch((url, init) => {
      if (url.endsWith('/admin/users') && init?.method === 'POST')
        return {
          status: 201,
          body: {
            user: { id: 'U', email: 'new@x.az', displayName: 'New' },
            emailSent: false,
            setupToken: TOKEN,
            expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
          },
        };
      return { body: [] };
    });
    render(<Users meId="me" />);
    await userEvent.type(screen.getByLabelText('Email'), 'new@x.az');
    await userEvent.type(screen.getByLabelText('Name'), 'New');
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByText(/Email could not be sent/)).toBeInTheDocument();
    const field = screen.getByLabelText('Invitation link') as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/#/set-password?token=${TOKEN}`);
    // No password is ever shown.
    expect(screen.queryByText(/temporary password/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
    expect(written).toEqual([field.value]);
  });
});

describe('page background', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-bg');
    localStorage.clear();
  });

  const signedIn = (background: string | null, saved: unknown[] = []) => {
    session.set('t');
    return mockFetch((url, init) => {
      if (url.endsWith('/me/preferences')) {
        saved.push(JSON.parse(String(init?.body)));
        return { body: {} };
      }
      if (url.endsWith('/me'))
        return {
          body: {
            userId: 'u',
            displayName: 'Ayla',
            email: 'a@x.az',
            roles: ['TA_PARTNER'],
            background,
          },
        };
      return { body: [] };
    });
  };

  it('applies the background saved for the user when they sign in', async () => {
    signedIn('sky');
    render(<App check={up} />);
    await waitFor(() => expect(document.documentElement.dataset.bg).toBe('sky'));
  });

  it('follows the device when nothing is saved', async () => {
    document.documentElement.setAttribute('data-bg', 'dark');
    signedIn(null);
    render(<App check={up} />);
    await waitFor(() => expect(document.documentElement.dataset.bg).toBeUndefined());
    expect(await screen.findByLabelText('Match my device')).toBeChecked();
  });

  it('lets the user pick one of four, saves it, and can go back to the device', async () => {
    const saved: unknown[] = [];
    signedIn(null, saved);
    render(<App check={up} />);
    await userEvent.click(await screen.findByText('Background'));
    for (const name of ['White', 'White-grey', 'Sky', 'Dark'])
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Sky'));
    await waitFor(() => expect(document.documentElement.dataset.bg).toBe('sky'));
    expect(saved).toEqual([{ background: 'sky' }]);
    expect(localStorage.getItem('cv-background')).toBe('sky');
    await userEvent.click(screen.getByLabelText('Match my device'));
    await waitFor(() => expect(document.documentElement.dataset.bg).toBeUndefined());
    expect(saved).toEqual([{ background: 'sky' }, { background: null }]);
  });
});

describe('Home: resumes and role', () => {
  const recruiter = { userId: 'u', displayName: 'Ayla', email: 'a@x.az', roles: ['TA_PARTNER'] };
  const JD =
    'We need a network engineer with strong routing, BGP and Kubernetes experience. SQL is a plus.';
  const req = (text: string, classification: string) => ({
    text,
    classification,
    weight: classification === 'mandatory' ? 10 : 5,
    rule: null,
  });
  afterEach(() => localStorage.clear());

  it('reads the requirements into chips, lets the recruiter flip one, and starts the screening', async () => {
    session.set('t');
    const calls = mockFetch((url, init) => {
      const m = init?.method ?? 'GET';
      if (url.endsWith('/me')) return { body: recruiter };
      if (url.endsWith('/vacancies') && m === 'POST') return { body: { id: 'VAC1' } };
      if (url.endsWith('/criteria/extract'))
        return {
          body: {
            versions: [],
            current: {
              id: 's',
              version: 1,
              frozen: false,
              requirements: [
                req('Routing and BGP', 'mandatory'),
                req('Kubernetes', 'mandatory'),
                req('SQL', 'preferred'),
                req('Based in Baku', 'informational'),
              ],
            },
          },
        };
      if (url.endsWith('/criteria') && m === 'PUT') return { body: {} };
      if (url.endsWith('/criteria/freeze')) return { body: {} };
      if (url.endsWith('/notice-confirm')) return { body: { confirmed: true } };
      if (url.endsWith('/documents')) return { body: { results: [] } };
      return { body: [] };
    });
    render(<App check={up} />);

    await userEvent.type(await screen.findByLabelText('Position'), 'Network Engineer');
    await userEvent.type(screen.getByLabelText(/^Requirements/), JD);
    const pdf = new File(['%PDF-1.7 cv'], 'cv_aysel.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Choose resume files'), pdf);
    expect(screen.getByText('1 resume added')).toBeInTheDocument();
    expect(screen.getByText(/1 resume · 0 key skills/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Read requirements' }));
    const bgp = await screen.findByRole('button', { name: /^Routing and BGP, must-have/ });
    expect(screen.getByRole('button', { name: /^SQL, nice-to-have/ })).toBeInTheDocument();
    expect(screen.getByText(/1 other requirement kept as text/)).toBeInTheDocument();
    expect(screen.getByText(/1 resume · 3 key skills/)).toBeInTheDocument();

    await userEvent.click(bgp); // must-have becomes nice-to-have
    expect(
      screen.getByRole('button', { name: /^Routing and BGP, nice-to-have/ }),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Add another skill'), 'Python{Enter}');
    expect(screen.getByRole('button', { name: /^Python, must-have/ })).toBeInTheDocument();

    // Without the candidate notice the button explains what is missing and sends nothing.
    await userEvent.click(screen.getByRole('button', { name: /Find the best fit/ }));
    expect(await screen.findByText('Confirm the candidate notice.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/criteria/freeze'))).toBe(false);

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /Find the best fit/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/vacancies/VAC1'));
    const sent = calls
      .filter((c) => !c.url.endsWith('/me'))
      .map((c) => c.url.replace(/^.*\/api/, ''));
    expect(sent.slice(-4)).toEqual([
      '/vacancies/VAC1/criteria',
      '/vacancies/VAC1/criteria/freeze',
      '/vacancies/VAC1/notice-confirm',
      '/vacancies/VAC1/documents',
    ]);
    const put = calls.find((c) => c.url.endsWith('/criteria') && c.init?.method === 'PUT')!;
    const body = JSON.parse(String(put.init!.body)).requirements as {
      text: string;
      classification: string;
    }[];
    expect(body.find((r) => r.text === 'Routing and BGP')!.classification).toBe('preferred');
    expect(body.find((r) => r.text === 'Python')!.classification).toBe('mandatory');
    const created = calls.find((c) => c.url.endsWith('/vacancies') && c.init?.method === 'POST')!;
    expect(JSON.parse(String(created.init!.body)).title).toBe('Network Engineer');
  });

  it('says what is missing instead of failing silently, and refuses files it cannot read', async () => {
    session.set('t');
    mockFetch((url) => (url.endsWith('/me') ? { body: recruiter } : { body: [] }));
    render(<App check={up} />);
    await userEvent.click(await screen.findByRole('button', { name: /Find the best fit/ }));
    expect(await screen.findAllByText('Add at least one resume.')).not.toHaveLength(0);
    expect(screen.getAllByText('Add the position title.').length).toBeGreaterThan(0);

    await userEvent.upload(
      screen.getByLabelText('Choose resume files'),
      new File(['x'], 'photo.png', { type: 'image/png' }),
      { applyAccept: false },
    );
    expect(screen.getByRole('alert')).toHaveTextContent('photo.png: only PDF, DOCX and TXT');
    expect(screen.queryByText(/resume added|resumes added/)).not.toBeInTheDocument();
  });

  it('reads a Word file into the requirements box, and shows one clear line when it cannot', async () => {
    session.set('t');
    let fail = false;
    mockFetch((url) => {
      if (url.endsWith('/me')) return { body: recruiter };
      if (url.endsWith('/vacancies/read-document'))
        return fail
          ? { status: 400, body: { message: 'This file is locked with a password' } }
          : { body: { filename: 'vacancy.docx', text: 'Needs Python and SQL daily.', words: 5 } };
      return { body: [] };
    });
    render(<App check={up} />);
    const word = new File(['PK'], 'vacancy.docx');
    await userEvent.upload(await screen.findByLabelText('Attach a Word file'), word);
    expect(await screen.findByText('Read vacancy.docx · 5 words')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Requirements/)).toHaveValue('Needs Python and SQL daily.');

    fail = true;
    await userEvent.upload(screen.getByLabelText('Attach a Word file'), word);
    expect(await screen.findByText('This file is locked with a password')).toBeInTheDocument();
  });
});

describe('Results: bands, names hidden, proof', () => {
  const item = (id: string, text: string, classification: string, status: string) => ({
    requirementId: id,
    text,
    classification,
    weight: classification === 'mandatory' ? 10 : 5,
    status,
    points: 1,
    earned: 0,
  });
  const cand = (n: number, score: number | null, extra: Record<string, unknown> = {}) => ({
    screeningId: `S${n}`,
    documentId: `D${n}`,
    filename: `cv_person${n}.pdf`,
    uploadedAt: `2026-10-01T10:00:0${n}Z`,
    parseStatus: 'parsed',
    erased: false,
    state: score === null ? 'manual' : 'completed',
    candidateName: `Real Name ${n}`,
    band: score === null ? 'needs_review' : 'possible_match',
    score:
      score === null
        ? null
        : {
            value: score,
            breakdown: {
              formula: 'f',
              earned: 1,
              possible: 2,
              mandatoryGaps: 1,
              items: [
                item('R1', 'Routing', 'mandatory', 'met'),
                item('R2', 'Kubernetes', 'mandatory', 'not_found'),
              ],
            },
          },
    knockoutTriggered: false,
    injectionSuspected: false,
    error: null,
    decision: null,
    ...extra,
  });
  const rows = [cand(1, 62), cand(2, 74), cand(3, 31), cand(4, null)];

  function setup() {
    session.set('t');
    return mockFetch((url) => {
      if (url.endsWith('/vacancies/V/candidates'))
        return {
          body: {
            counts: { total: 4, queued: 0, failed: 0, manual: 1, undecided: 4 },
            aiActive: true,
            candidates: rows,
          },
        };
      if (url.includes('/screenings/S2'))
        return {
          body: {
            summary: 'Six years on carrier routing; no Kubernetes in this CV.',
            assessments: [
              {
                requirementId: 'R1',
                text: 'Routing',
                status: 'met',
                rationale: 'Led BGP rollout',
                evidence: [{ quote: 'Designed the BGP peering for two carriers' }],
              },
              {
                requirementId: 'R2',
                text: 'Kubernetes',
                status: 'not_found',
                rationale: null,
                evidence: [],
              },
            ],
          },
        };
      if (url.endsWith('/reveal-names')) return { body: { revealed: 1 } };
      return { body: {} };
    });
  }

  it('shows plain bands with names hidden, and never prints a file name or a headline number', async () => {
    setup();
    render(<Results vacancyId="V" onTable={() => undefined} />);
    expect(await screen.findByText('Your constellation')).toBeInTheDocument();
    expect(screen.getByText(/No strong match in this batch/)).toBeInTheDocument();
    // Candidate 02 (74) is Good and ranks first; the 31 is Limited, inside a collapsed group.
    const cards = screen.getAllByRole('article');
    expect(cards[0]).toHaveTextContent('Candidate 02');
    expect(cards[0]).toHaveTextContent('Good');
    expect(screen.getByText(/Limited \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Needs a human look \(1\)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cv_person|Real Name/);
    expect(await screen.findByText(/Score 74 of 100/)).toBeInTheDocument(); // selected card only
    expect(cards[1]).not.toHaveTextContent(/Score \d/);
  });

  it('opens the exact CV quote behind a skill, and says what was searched when it is missing', async () => {
    setup();
    render(<Results vacancyId="V" onTable={() => undefined} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Routing: Found/ }));
    expect(
      await screen.findByText('Designed the BGP peering for two carriers'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Kubernetes: Not found/ }));
    expect(
      await screen.findByText(/Not found in this CV\. Searched for: Kubernetes/),
    ).toBeInTheDocument();
    expect(await screen.findByText(/no Kubernetes in this CV/)).toBeInTheDocument();
  });

  it('reveals one name on request, recorded on the server, and can hide it again', async () => {
    const calls = setup();
    render(<Results vacancyId="V" onTable={() => undefined} />);
    const card = (await screen.findAllByRole('article'))[0]!;
    await userEvent.click(within(card).getByRole('button', { name: 'Reveal name' }));
    await waitFor(() => expect(card).toHaveTextContent('Real Name 2'));
    const post = calls.find((c) => c.url.endsWith('/reveal-names'))!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ screeningIds: ['S2'] });
    await userEvent.click(within(card).getByRole('button', { name: 'Hide name' }));
    expect(card).not.toHaveTextContent('Real Name 2');
  });

  it('asks before revealing every name', async () => {
    const calls = setup();
    render(<Results vacancyId="V" onTable={() => undefined} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal all names' }));
    expect(
      screen.getByText('Names are hidden to keep the first look about skills. Show all?'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/reveal-names'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Real Name 2/));
  });
});
