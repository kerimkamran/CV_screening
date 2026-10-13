import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAssistantConfigCache } from './assistant';
import { Shell } from './Shell';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAssistantConfigCache();
});

describe('what SenAI remembers, in the account menu (plan F6)', () => {
  it('shows the saved number, saves a new one and clears it', async () => {
    let top: number | null = 5;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        let body: unknown = {};
        if (url.endsWith('/assistant/config'))
          body = { enabled: true, name: 'SenAI', features: {}, unavailableMessage: '' };
        else if (url.endsWith('/assistant/preferences')) {
          if (init?.method === 'PUT')
            top = (JSON.parse(String(init.body)) as { top: number | null }).top;
          body = { top };
        } else if (url.includes('/assistant/conversations')) body = [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    render(
      <Shell
        me={{ userId: 'u', email: 'a@b.c', displayName: 'Ada Lovelace', roles: ['TA_LEAD'] }}
        isTa
        isAdmin={false}
        isGov={false}
        route="/vacancies"
        footer={null}
        onSignOut={() => undefined}
        onMe={() => undefined}
      >
        <p>page</p>
      </Shell>,
    );
    expect(await screen.findByText('Shows the top 5 unless you ask for more.')).toBeTruthy();
    const box = screen.getByLabelText('How many to show');
    await userEvent.clear(box);
    await userEvent.type(box, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Shows the top 9 unless you ask for more.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByText(/Nothing saved/)).toBeTruthy());
    expect(calls.filter((c) => c.startsWith('PUT'))).toHaveLength(2);
  });
});
