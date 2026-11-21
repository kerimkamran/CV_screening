import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './api';
import { applyLang } from './i18n';
import { OracleSettings } from './pages/OracleAdmin';

// Stage 3, S3-INT-14a: the admin Oracle card (checks A2-A15, the unit ones).
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const SETTINGS = {
  linkPolicy: 'open',
  requireEuAi: true,
  goneInSource: 'flag',
  categories: ['Resume', 'CV'],
  clientId: null,
  scope: null,
};
const BASE = {
  available: true,
  example: 'https://xxxx.fa.em2.example',
  suffix: '.example-ending',
  notOracleAddress: 'x',
  settings: SETTINGS,
  connection: null,
};
const ACTIVE = {
  ...BASE,
  connection: {
    address: 'https://pod.fa.em2.example',
    user: 'parallax.integration',
    authMode: 'basic',
    tokenUrl: null,
    enabled: true,
    enabledAt: '2026-11-20T10:00:00Z',
    authFailedAt: null,
    lastTestAt: '2026-11-21T09:00:00Z',
    lastTestCode: 'ok',
    passwordSaved: true,
    passwordSetAt: '2026-11-20T10:00:00Z',
    passwordExpiresOn: null,
    clientSecretSaved: false,
    notice: { by: 'Admin', at: '2026-11-20T10:00:00Z', effectiveFrom: null },
  },
};

let calls: { method: string; url: string; body: unknown }[] = [];
let view: unknown = BASE;
let answer: unknown = { code: 'ok', enabled: true };
function serve(getStatus = 200) {
  calls = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/admin/integrations/oracle') && method === 'GET')
      return getStatus === 404
        ? json({ message: 'Oracle import is not available in this environment.' }, 404)
        : json(view);
    if (url.endsWith('/runs')) return json({ runs: [] });
    if (url.endsWith('/settings')) return json(view);
    if (url.endsWith('/deactivate')) return json({ enabled: false, cancelled: 0 });
    return json(answer);
  });
}
const posts = () => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
  session.set('t');
  applyLang('en');
  view = BASE;
  answer = { code: 'ok', enabled: true };
});
afterEach(() => vi.unstubAllGlobals());

describe('Oracle admin card', () => {
  it('switch off: one sentence, no input, no button (A2)', async () => {
    serve(404);
    render(<OracleSettings />);
    expect(
      await screen.findByText('Oracle import is not available in this environment.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('before activation: 3 inputs, 1 tick-box, Activate, Show and a closed Advanced (A3); the example comes from the API (A11)', async () => {
    serve();
    render(<OracleSettings />);
    await screen.findByRole('button', { name: 'Activate' });
    expect(screen.getByLabelText(/^Oracle API address/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^User name/)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Show', 'Activate']);
    expect(screen.getByText(/Example: https:\/\/xxxx\.fa\.em2\.example/)).toBeInTheDocument();
  });

  it('missing items: 0 requests, one line each, focus on the first (A4)', async () => {
    serve();
    render(<OracleSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Activate' }));
    expect(posts()).toHaveLength(0);
    for (const s of [
      'Paste the Oracle API address.',
      'Type the user name.',
      'Type the password.',
      'Tick the box to confirm that applicants are told.',
    ])
      expect(screen.getByText(s)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Oracle API address/)).toHaveFocus();
  });

  async function fill() {
    await userEvent.type(
      await screen.findByLabelText(/^Oracle API address/),
      'https://pod.fa.em2.example/hcmRestApi/x',
    );
    await userEvent.type(screen.getByLabelText(/^User name/), 'parallax.integration');
    await userEvent.type(screen.getByLabelText('Password'), 'SECRET-PASSWORD-123');
    await userEvent.click(screen.getByRole('checkbox'));
  }

  it('one click sends exactly one activate, no optional setting (A5, A12); each code shows its one line (A6, A7)', async () => {
    const lines: Record<string, string> = {
      auth_failed: 'Sign-in failed. Oracle did not accept this user name and password.',
      empty_scope:
        'Connected, but this account sees no vacancies. Ask the Oracle team to give it access to Recruiting, then try again.',
      unreachable: 'The address could not be reached. Check it and try again.',
    };
    for (const [code, text] of Object.entries(lines)) {
      answer = { code, enabled: false };
      serve();
      const { unmount } = render(<OracleSettings />);
      await fill();
      await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
      const line = await screen.findByText(text);
      expect(posts()).toHaveLength(1);
      expect(Object.keys(posts()[0]!.body as object).sort()).toEqual([
        'address',
        'notice',
        'password',
        'user',
      ]);
      if (code !== 'empty_scope') {
        const tied = code === 'auth_failed' ? /^User name/ : /^Oracle API address/;
        expect(screen.getByLabelText(tied)).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText(tied).getAttribute('aria-describedby')).toBe(line.id);
      }
      expect(screen.getByText('Not connected')).toBeInTheDocument();
      unmount();
    }
  });

  it('not an Oracle address: the sentence the server sent (A6, line 5)', async () => {
    answer = {
      code: 'not_oracle_address',
      enabled: false,
      message:
        'This is not an Oracle address. It must start with https:// and end in .example-ending.',
    };
    serve();
    render(<OracleSettings />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText(/This is not an Oracle address/)).toBeInTheDocument();
  });

  it('after activation: Active, the lines, 3 buttons, no password input, and the password nowhere (A8, A9)', async () => {
    serve();
    const { container, rerender } = render(<OracleSettings />);
    await fill();
    view = ACTIVE;
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await screen.findByText('Test again');
    rerender(<OracleSettings />);
    expect(screen.getByText('Active', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/Active since/)).toBeInTheDocument();
    expect(screen.getByText(/Last check OK/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(expect.arrayContaining(['Test again', 'Replace password', 'Turn off']));
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(container.innerHTML).not.toContain('SECRET-PASSWORD-123');
  });

  it('Test again: 1 call; enabled false turns the card off and keeps the line (A10, A15)', async () => {
    view = ACTIVE;
    answer = { code: 'auth_failed', enabled: false };
    serve();
    render(<OracleSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Test again' }));
    view = { ...ACTIVE, connection: { ...ACTIVE.connection, enabled: false } };
    await screen.findByText('Sign-in failed. Oracle did not accept this user name and password.');
    expect(posts().filter((c) => c.url.endsWith('/test'))).toHaveLength(1);
  });

  it('Turn off asks once with focus on Cancel, then sends 1 deactivate (A10)', async () => {
    view = ACTIVE;
    serve();
    render(<OracleSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.click(screen.getAllByRole('button', { name: 'Turn off' })[0]!);
    await waitFor(() =>
      expect(posts().filter((c) => c.url.endsWith('/deactivate'))).toHaveLength(1),
    );
  });

  it('password expiry: warn from 14 days before, error after, none when far (A13)', async () => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    for (const [n, re] of [
      [10, /The Oracle password expires on/],
      [-1, /The Oracle password expired on/],
      [30, null],
    ] as const) {
      view = { ...ACTIVE, connection: { ...ACTIVE.connection, passwordExpiresOn: day(n) } };
      serve();
      const { unmount } = render(<OracleSettings />);
      await screen.findByRole('button', { name: 'Test again' });
      if (re) expect(screen.getByText(re)).toBeInTheDocument();
      else expect(screen.queryByText(/The Oracle password expire/)).toBeNull();
      unmount();
    }
  });

  it('Advanced: closed; its Save sends 1 PUT with the values and no activate or test (A14)', async () => {
    view = ACTIVE;
    serve();
    const { container } = render(<OracleSettings />);
    await screen.findByRole('button', { name: 'Test again' });
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    await userEvent.click(screen.getByText('Advanced'));
    const eu = screen.getByRole('checkbox', {
      name: 'Only use an AI company that processes in the EU',
    });
    expect(eu).toBeChecked();
    expect(document.getElementById(eu.getAttribute('aria-describedby')!)).toHaveTextContent(/DPO/);
    await userEvent.click(eu);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toMatch(/\/settings$/);
    expect(sent[0]!.body).toMatchObject({
      requireEuAi: false,
      linkPolicy: 'open',
      goneInSource: 'flag',
    });
  });
});
