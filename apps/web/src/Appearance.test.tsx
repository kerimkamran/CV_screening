import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageSwitch } from './Appearance';
import { applyLang, tr } from './i18n';

afterEach(() => {
  vi.unstubAllGlobals();
  applyLang('en');
});

describe('the language switch (SD-133)', () => {
  it('saves the choice to the account, and says so when the account could not keep it', async () => {
    const puts: unknown[] = [];
    let ok = true;
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      puts.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(ok ? {} : { message: 'down' }), {
        status: ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    });
    render(<LanguageSwitch signedIn />);
    const pick = screen.getByRole('combobox', { name: 'Language' });
    await userEvent.selectOptions(pick, 'az');
    await waitFor(() => expect(puts).toEqual([{ language: 'az' }]));
    expect(screen.queryByRole('alert')).toBeNull();
    ok = false;
    await userEvent.selectOptions(screen.getByRole('combobox'), 'en');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not save your choice. It applies on this device only for now.',
    );
    // The next save that works takes the message away.
    ok = true;
    await userEvent.selectOptions(screen.getByRole('combobox'), 'az');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(tr('Language')).not.toBe('');
  });

  it('does not call the server when nobody is signed in', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<LanguageSwitch signedIn={false} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'az');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
