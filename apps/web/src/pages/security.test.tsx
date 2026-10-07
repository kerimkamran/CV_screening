import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../api';
import { Login } from './Login';
import { Security } from './Security';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init);
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}
beforeEach(() => session.set(null));
afterEach(() => vi.unstubAllGlobals());

describe('two-step sign-in', () => {
  it('asks for the code after the password, then signs in with it', async () => {
    const calls = mockFetch((_u, init) => {
      const b = JSON.parse(String(init?.body ?? '{}')) as { code?: string };
      return b.code === '123456'
        ? { body: { token: 'tok', expiresIn: 3600, mustChangePassword: false } }
        : { status: 401, body: { message: 'Enter the 6-digit code', code: 'mfa_required' } };
    });
    const done = vi.fn();
    render(<Login onSignedIn={done} />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.az');
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const field = await screen.findByLabelText(/Code from your authenticator app/);
    expect(done).not.toHaveBeenCalled();
    await userEvent.type(field, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(JSON.parse(String(calls.at(-1)!.init!.body))).toMatchObject({ code: '123456' });
    expect(session.get()).toBe('tok');
  });

  it('sets up, confirms with a code and shows the recovery codes once', async () => {
    let on = false;
    mockFetch((url) => {
      if (url.endsWith('/auth/mfa/setup'))
        return { body: { secret: 'ABCDEFGHIJKLMNOP', uri: 'otpauth://totp/x' } };
      if (url.endsWith('/auth/mfa/enable')) {
        on = true;
        return { body: { enabled: true, recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'] } };
      }
      return { body: { enabled: on, recoveryCodesLeft: on ? 2 : 0, available: true } };
    });
    render(<Security />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up two-step sign-in' }));
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('ABCDEFGHIJKLMNOP');
    await userEvent.type(screen.getByLabelText('Code shown in the app'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('aaaaa-bbbbb')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(screen.queryByText('aaaaa-bbbbb')).not.toBeInTheDocument();
    expect(await screen.findByText(/Recovery codes left: 2/)).toBeInTheDocument();
  });
});
