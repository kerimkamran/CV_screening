import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, Role } from '../api';
import { resetAssistantConfigCache, takePendingQuestion } from '../assistant';
import { applyLang } from '../i18n';
import { Home } from './Home';

// Home is the menu of what a person can do. What it shows follows their roles; each tile is a real
// link; the assistant prompt exists only when the assistant is on; and it reads in both languages.

const CFG = {
  enabled: true,
  name: 'SenAI',
  features: { challenge: true, compare: true, interview: true, challengeRecruiter: true },
  unavailableMessage: '',
};
const vacancy = (id: string, title: string, archived = false) => ({
  id,
  title,
  archived,
  status: 'open',
});

function stub(opts: { assistant?: boolean; vacancies?: unknown[] | 'fail' } = {}) {
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/assistant/config')) return json({ ...CFG, enabled: !!opts.assistant });
    if (url.includes('/vacancies?'))
      return opts.vacancies === 'fail'
        ? json({ message: 'down' }, 500)
        : json(opts.vacancies ?? []);
    return json({}, 404);
  });
}

const person = (roles: Role[], name: string | null = 'Aysel Mammadova'): Me => ({
  userId: 'u1',
  email: 'a@x.az',
  displayName: name,
  roles,
});
const view = (
  roles: Role[],
  flags: { isTa?: boolean; isAdmin?: boolean; isGov?: boolean },
  now = new Date(2026, 10, 17, 9, 0),
  name: string | null = 'Aysel Mammadova',
) =>
  render(
    <Home
      me={person(roles, name)}
      isTa={!!flags.isTa}
      isAdmin={!!flags.isAdmin}
      isGov={!!flags.isGov}
      now={now}
    />,
  );
const links = () =>
  screen.getAllByRole('link').map((a) => [a.textContent ?? '', a.getAttribute('href')]);
const hrefOf = (name: RegExp | string) => screen.getByRole('link', { name }).getAttribute('href');

beforeEach(() => {
  resetAssistantConfigCache();
  takePendingQuestion();
});
afterEach(() => {
  vi.unstubAllGlobals();
  applyLang('en');
});

describe('Home', () => {
  it('greets by the time of day, with the first name, under a heading named Home', async () => {
    stub();
    const { unmount } = view(['TA_PARTNER'], { isTa: true }, new Date(2026, 10, 17, 9));
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Good morning, Aysel')).toBeInTheDocument();
    expect(screen.getByText('What would you like to do today?')).toBeInTheDocument();
    unmount();
    view(['TA_PARTNER'], { isTa: true }, new Date(2026, 10, 17, 14));
    expect(screen.getByText('Good afternoon, Aysel')).toBeInTheDocument();
  });

  it('says Welcome when there is no name, and "Good evening" after six', () => {
    stub();
    const { unmount } = view(['TA_PARTNER'], { isTa: true }, new Date(2026, 10, 17, 20));
    expect(screen.getByText('Good evening, Aysel')).toBeInTheDocument();
    unmount();
    view(['TA_PARTNER'], { isTa: true }, new Date(2026, 10, 17, 9), null);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('gives a recruiter the screening functions as real links, and nothing for administrators', async () => {
    stub();
    view(['TA_PARTNER'], { isTa: true });
    const menu = within(screen.getByRole('region', { name: 'Screen candidates' }));
    expect(menu.getByRole('link', { name: /^New vacancy/ })).toHaveAttribute(
      'href',
      '#/vacancies/new',
    );
    expect(menu.getByRole('link', { name: /^Vacancies/ })).toHaveAttribute('href', '#/vacancies');
    expect(menu.getByRole('link', { name: /^Candidates/ })).toHaveAttribute('href', '#/candidates');
    expect(menu.getByRole('link', { name: /^Shared with me/ })).toHaveAttribute(
      'href',
      '#/reports',
    );
    expect(hrefOf('Change password')).toBe('#/password');
    expect(hrefOf('Security')).toBe('#/security');
    expect(links().some(([, h]) => h?.startsWith('#/admin'))).toBe(false);
    // The assistant is off: no prompt, no Ask tile.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Ask/ })).toBeNull();
  });

  it('adds the prompt and the Ask tile when the assistant is on, and sends what was typed', async () => {
    stub({ assistant: true });
    view(['TA_PARTNER'], { isTa: true });
    const prompt = await screen.findByRole('textbox', {
      name: 'Ask SenAI about your candidates',
    });
    expect(screen.getByRole('button', { name: /^Ask SenAI Ask about/ })).toBeInTheDocument();
    await userEvent.type(prompt, 'Who knows BGP?{Enter}');
    expect(takePendingQuestion()).toBe('Who knows BGP?');
    expect(prompt).toHaveValue('');
  });

  it('lists the last vacancies as one-tap chips, skipping archived ones, and stays quiet on a failure', async () => {
    stub({
      vacancies: [
        vacancy('V1', 'Backend Engineer'),
        vacancy('V2', 'Old role', true),
        vacancy('V3', 'Network Lead'),
      ],
    });
    const { unmount } = view(['TA_PARTNER'], { isTa: true });
    const chip = await screen.findByRole('link', { name: 'Backend Engineer' });
    expect(chip).toHaveAttribute('href', '#/vacancies/V1');
    expect(screen.getByRole('link', { name: 'Network Lead' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Old role' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Pick up where you left off' })).toBeInTheDocument();
    unmount();

    stub({ vacancies: 'fail' });
    view(['TA_PARTNER'], { isTa: true });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Change password' })).toBeVisible(),
    );
    expect(screen.queryByRole('heading', { name: 'Pick up where you left off' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives an administrator the administration functions and the old explanation', () => {
    stub();
    view(['ADMIN'], { isAdmin: true });
    const menu = within(screen.getByRole('region', { name: 'Administration' }));
    expect(menu.getByRole('link', { name: /^Users/ })).toHaveAttribute('href', '#/admin');
    expect(menu.getByRole('link', { name: /^AI models/ })).toHaveAttribute('href', '#/admin/ai');
    expect(menu.getByRole('link', { name: /^SenAI/ })).toHaveAttribute('href', '#/admin/assistant');
    expect(menu.getByRole('link', { name: /^Fairness monitoring/ })).toHaveAttribute(
      'href',
      '#/admin/monitoring',
    );
    expect(menu.getByRole('link', { name: /^Data retention/ })).toHaveAttribute(
      'href',
      '#/admin/retention',
    );
    expect(
      screen.getByText(
        'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.',
      ),
    ).toBeInTheDocument();
    // Candidate data is for recruiters: no tile leads there.
    expect(links().some(([, h]) => h === '#/candidates' || h === '#/vacancies/new')).toBe(false);
    expect(hrefOf('Shared with me')).toBe('#/reports');
  });

  it('gives governance monitoring and the assistant review, and nothing else of the admin area', () => {
    stub();
    view(['GOVERNANCE'], { isGov: true });
    const menu = within(screen.getByRole('region', { name: 'Oversight' }));
    expect(menu.getByRole('link', { name: /^Fairness monitoring/ })).toHaveAttribute(
      'href',
      '#/admin/monitoring',
    );
    expect(menu.getByRole('link', { name: /^SenAI/ })).toHaveAttribute('href', '#/admin/assistant');
    expect(menu.getByRole('link', { name: /^Shared with me/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Users/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^AI models/ })).toBeNull();
  });

  it('shows an administrator who also recruits both sets', () => {
    stub();
    view(['ADMIN', 'TA_PARTNER'], { isTa: true, isAdmin: true });
    expect(screen.getByRole('region', { name: 'Screen candidates' })).toBeInTheDocument();
    const admin = within(screen.getByRole('region', { name: 'Administration' }));
    expect(admin.getAllByRole('link')).toHaveLength(5);
  });

  it('reads in Azerbaijani: greeting, group names, tiles and prompt', async () => {
    applyLang('az');
    stub({ assistant: true });
    view(['TA_PARTNER'], { isTa: true });
    expect(screen.getByText('Sabahınız xeyir, Aysel')).toBeInTheDocument();
    const menu = within(screen.getByRole('region', { name: 'Namizədləri yoxlayın' }));
    expect(menu.getByRole('link', { name: /^Yeni vakansiya/ })).toBeInTheDocument();
    expect(menu.getByRole('link', { name: /^Vakansiyalar/ })).toBeInTheDocument();
    expect(menu.getByRole('link', { name: /^Namizədlər/ })).toBeInTheDocument();
    expect(
      await screen.findByRole('textbox', { name: /adlı köməkçidən namizədləriniz/ }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Parolu dəyişin' })).toBeInTheDocument();
    // No English function name is left on the page.
    const text = document.body.textContent ?? '';
    for (const en of [
      'Screen candidates',
      'New vacancy',
      'Shared with me',
      'Pick up where',
      'Describe a role',
      'Search every analyzed',
      'What would you like',
      'Good morning',
    ])
      expect(text, en).not.toContain(en);
  });
});
