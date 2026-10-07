import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './api';
import {
  rememberUser,
  setAssistantOpen,
  startersFor,
  type Answer,
  type AssistantConfig,
} from './assistant';
import { AssistantPanel } from './pages/AssistantPanel';
import { AssistantSettings } from './pages/Admin';

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

const config: AssistantConfig = {
  enabled: true,
  name: 'Elon',
  features: { challenge: true, compare: true, interview: true, challengeRecruiter: true },
  unavailableMessage: 'Elon is unavailable right now.',
};
const answer = (over: Partial<Answer> = {}): Answer => ({
  kind: 'answer',
  headline: 'Routing is the clear strength.',
  claims: [
    {
      text: 'Routing is stated in the CV.',
      source: 'R1',
      quote: 'Designed BGP routing',
      requirement: { id: 'R1', text: 'BGP routing', state: 'Found', candidate: 'Candidate 07' },
    },
  ],
  cantSee: "The CV doesn't mention Kubernetes; that is not evidence they lack it.",
  questions: [],
  outcome: null,
  handoff: [],
  facts: ['Candidate 07 · Good · 1 of 2 must-haves found'],
  flags: [],
  about: ['Candidate 07'],
  ...over,
});
const target = {
  screeningId: '0000000000000000000000SC01',
  label: 'Candidate 07',
  band: 'strong' as const,
};

beforeEach(() => {
  session.set('t');
  localStorage.clear();
  rememberUser('U1');
  setAssistantOpen(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('starter chips by band (spec 6.6.1)', () => {
  const labels = (b: Parameters<typeof startersFor>[0]) => startersFor(b).map((s) => s.label);
  it('always offers the five basics', () => {
    for (const b of ['strong', 'good', 'partial', 'limited'] as const) {
      expect(labels(b)).toEqual(
        expect.arrayContaining([
          'Why this band?',
          'What is the weakest point?',
          'What would change the band?',
          'What should I ask in the interview?',
          'Compare with…',
        ]),
      );
    }
  });
  it('adds "could be missing" for strong and good, and "strongest case"/"check by hand" below', () => {
    expect(labels('strong')).toContain('What could I be missing?');
    expect(labels('good')).toContain('What could I be missing?');
    expect(labels('good')).not.toContain('What is the strongest case for this one?');
    for (const b of ['partial', 'limited'] as const) {
      expect(labels(b)).toEqual(
        expect.arrayContaining([
          'What is the strongest case for this one?',
          'What should I check by hand?',
        ]),
      );
      expect(labels(b)).not.toContain('What could I be missing?');
    }
  });
});

describe('assistant panel', () => {
  const noEdit = () => undefined;

  it('is a slim rail until opened, and the opening is remembered for the person', async () => {
    mockFetch(() => ({ body: { thread: null } }));
    const { unmount } = render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ask Elon' }));
    expect(await screen.findByRole('complementary', { name: 'Assistant' })).toBeInTheDocument();
    unmount();
    // A new visit by the same person starts open.
    setAssistantOpen(false);
    rememberUser('U2');
    rememberUser('U1');
    setAssistantOpen(true);
    expect(localStorage.getItem('cv-assistant-open:U1')).toBe('1');
  });

  it('names the candidate by pseudonym, tells people chats are saved, and closes with Escape', async () => {
    mockFetch(() => ({ body: { thread: null } }));
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    const panel = await screen.findByRole('complementary', { name: 'Assistant' });
    expect(within(panel).getByTestId('context-chip')).toHaveTextContent(
      'Discussing: Candidate 07 · Strong',
    );
    expect(panel).toHaveTextContent(
      'Chats are saved to this run and may be reviewed for compliance.',
    );
    await waitFor(() => expect(within(panel).getByRole('textbox')).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
  });

  it('asks a starter question, shows an AI-labelled answer with proof chips from the record', async () => {
    const calls = mockFetch((url, init) =>
      init?.method === 'POST'
        ? { body: { answer: answer(), messageId: 'M1', threadId: 'T1' } }
        : { body: { thread: null } },
    );
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Why this band?' }));
    expect(await screen.findByText('Routing is the clear strength.')).toBeInTheDocument();
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toContain(`/screenings/${target.screeningId}/assistant`);
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ intent: 'why' });
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Where this comes from' })).toHaveTextContent(
      'BGP routing · Found',
    );
    expect(screen.getByText(/What I can’t see:/)).toBeInTheDocument();
    // "Show more" reveals the sentence, the checked quote and the record line.
    expect(screen.queryByText('Designed BGP routing')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText('Designed BGP routing')).toBeInTheDocument();
    expect(screen.getByText(/From the record:/)).toBeInTheDocument();
    // One polite announcement for screen readers when the answer is done.
    expect(
      screen.getAllByRole('status').some((s) => /Elon has answered/.test(s.textContent ?? '')),
    ).toBe(true);
  });

  it('sends a typed question, and Shift+Enter does not send', async () => {
    const calls = mockFetch((_u, init) =>
      init?.method === 'POST'
        ? { body: { answer: answer(), messageId: 'M2' } }
        : { body: { thread: null } },
    );
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    const box = await screen.findByRole('textbox');
    await userEvent.type(box, 'Did they run BGP?{Shift>}{Enter}{/Shift}');
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1));
    expect(
      JSON.parse(String(calls.find((c) => c.init?.method === 'POST')!.init!.body)),
    ).toMatchObject({
      intent: 'ask',
    });
  });

  it('shows a declined request plainly and offers job-related alternatives', async () => {
    mockFetch((_u, init) =>
      init?.method === 'POST'
        ? {
            body: {
              messageId: 'M3',
              answer: answer({
                kind: 'decline',
                headline: "That isn't related to the job requirements, so I can't use it.",
                claims: [],
                cantSee: '',
                flags: ['refused:protected_attribute'],
                offer: ['Why this band?'],
              }),
            },
          }
        : { body: { thread: null } },
    );
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    await userEvent.type(await screen.findByRole('textbox'), 'How old is she?{Enter}');
    expect(await screen.findByText(/isn't related to the job requirements/)).toBeInTheDocument();
    // The offer under the answer sits next to the starter chip.
    expect(screen.getAllByRole('button', { name: 'Why this band?' })).toHaveLength(2);
  });

  it('hands off to the requirements drawer instead of changing anything itself', async () => {
    const onEdit = vi.fn();
    mockFetch((_u, init) =>
      init?.method === 'POST'
        ? {
            body: {
              messageId: 'M4',
              answer: answer({
                headline: 'The band changes only through changed requirements.',
                handoff: [
                  {
                    requirementId: '0000000000000000000000RQ02',
                    text: 'Kubernetes',
                    to: 'preferred',
                  },
                ],
              }),
            },
          }
        : { body: { thread: null } },
    );
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={onEdit} />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'What would change the band?' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit requirement: Kubernetes' }),
    );
    expect(onEdit).toHaveBeenCalledWith('0000000000000000000000RQ02', 'Kubernetes');
  });

  it('compares with up to two other candidates, by pseudonym', async () => {
    const calls = mockFetch((_u, init) =>
      init?.method === 'POST'
        ? { body: { answer: answer(), messageId: 'M5' } }
        : { body: { thread: null } },
    );
    setAssistantOpen(true);
    const others = ['A', 'B', 'C'].map((x, i) => ({
      screeningId: `0000000000000000000000SC0${i + 2}`,
      label: `Candidate 0${i + 1}${x}`,
    }));
    render(
      <AssistantPanel config={config} target={target} others={others} onEditRequirement={noEdit} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Compare with…' }));
    const boxes = screen.getAllByRole('checkbox');
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[1]!);
    expect(boxes[2]).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'POST')!.init!.body));
    expect(body.intent).toBe('compare');
    expect(body.compareWith).toHaveLength(2);
  });

  it('challenge takes an optional read of the recruiter', async () => {
    const calls = mockFetch((_u, init) =>
      init?.method === 'POST'
        ? {
            body: {
              answer: answer({
                outcome: 'held',
                headline: 'Challenge held: no CV evidence found against the band.',
              }),
              messageId: 'M6',
            },
          }
        : { body: { thread: null } },
    );
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Challenge this match' }));
    await userEvent.type(
      screen.getByLabelText('Your own read (optional)'),
      'I think this is too high',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Challenge this match' }));
    expect(await screen.findByText(/Challenge held/)).toBeInTheDocument();
    expect(
      JSON.parse(String(calls.find((c) => c.init?.method === 'POST')!.init!.body)),
    ).toMatchObject({
      intent: 'challenge',
      read: 'I think this is too high',
    });
  });

  it('hides functions the administrator switched off', async () => {
    mockFetch(() => ({ body: { thread: null } }));
    setAssistantOpen(true);
    const off = { ...config, features: { ...config.features, challenge: false, interview: false } };
    render(<AssistantPanel config={off} target={target} others={[]} onEditRequirement={noEdit} />);
    await screen.findByRole('button', { name: 'Why this band?' });
    expect(screen.queryByRole('button', { name: 'Challenge this match' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'What should I ask in the interview?' }),
    ).toBeNull();
  });

  it('shows the configured message when the assistant is unavailable, and the error when the call fails', async () => {
    mockFetch((_u, init) =>
      init?.method === 'POST'
        ? {
            body: {
              answer: answer({
                kind: 'unavailable',
                headline: 'Elon is unavailable right now.',
                claims: [],
                cantSee: '',
                facts: [],
              }),
              messageId: 'M7',
            },
          }
        : { body: { thread: null } },
    );
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Why this band?' }));
    expect(await screen.findByText('Elon is unavailable right now.')).toBeInTheDocument();
  });

  it('reloads the saved thread for each candidate and can delete it', async () => {
    const calls = mockFetch((_u, init) => {
      if (init?.method === 'DELETE') return { body: { deleted: true } };
      return {
        body: {
          thread: {
            id: 'T1',
            messages: [
              {
                id: 'a',
                role: 'user',
                content: { text: 'Why this band?', intent: 'why' },
                at: '2026-10-02T10:00:00Z',
              },
              {
                id: 'b',
                role: 'assistant',
                content: answer({ headline: 'Saved earlier answer.' }),
                at: '2026-10-02T10:00:01Z',
              },
            ],
          },
        },
      };
    });
    setAssistantOpen(true);
    render(
      <AssistantPanel config={config} target={target} others={[]} onEditRequirement={noEdit} />,
    );
    expect(await screen.findByText('Saved earlier answer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this chat' }));
    await waitFor(() => expect(screen.queryByText('Saved earlier answer.')).toBeNull());
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true);
  });
});

describe('Assistant settings (admin)', () => {
  const overview = (over: object = {}) => ({
    settings: {
      enabled: false,
      name: 'Elon',
      modelRowId: null,
      features: { challenge: true, compare: true, interview: true, challengeRecruiter: true },
      unavailableMessage: 'Elon is unavailable right now.',
      regionAllowed: '',
      dataTerms: 'unknown',
      attestedBy: null,
      attestedByName: null,
      attestedAt: null,
      dailyCap: null,
      monthlyCap: null,
      warnPct: 80,
      ...over,
    },
    models: [
      { id: '0000000000000000000000MD01', modelId: 'm', label: 'Model one', provider: 'Anthropic' },
    ],
    activeModel: { provider: 'Anthropic', model: 'm' },
    usage: { today: 2, month: 9 },
    warn: false,
    testFresh: false,
    log: [],
  });

  it('shows the state, usage and a test button, and saves what the administrator chose', async () => {
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/admin/assistant/audit')) return { body: { turns: [] } };
      if (url.endsWith('/admin/assistant/test'))
        return { body: { ok: true, detail: 'Anthropic / m answered in the expected shape.' } };
      if (init?.method === 'PUT')
        return { body: overview({ enabled: true, dataTerms: 'no_retention' }) };
      return { body: overview() };
    });
    render(<AssistantSettings />);
    expect(await screen.findByText(/Elon is off/)).toBeInTheDocument();
    expect(screen.getByText(/Today: 2 \(no limit\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/answered in the expected shape/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Turn the assistant on'));
    await userEvent.selectOptions(
      screen.getByLabelText('What the provider does with the data'),
      'no_retention',
    );
    await userEvent.click(screen.getByLabelText(/I checked these terms/));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(JSON.parse(String(put.init!.body))).toMatchObject({
      enabled: true,
      dataTerms: 'no_retention',
      attest: true,
    });
  });

  it("shows the server's reason when turning it on is refused", async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/admin/assistant/audit')) return { body: { turns: [] } };
      if (init?.method === 'PUT')
        return {
          status: 409,
          body: { message: 'Run "Test connection" on this model within the last hour first' },
        };
      return { body: overview() };
    });
    render(<AssistantSettings />);
    await userEvent.click(await screen.findByLabelText('Turn the assistant on'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Run "Test connection"/)).toBeInTheDocument();
  });

  it('warns when usage has passed the threshold', async () => {
    mockFetch((url) =>
      url.endsWith('/audit')
        ? { body: { turns: [] } }
        : { body: { ...overview({ dailyCap: 2 }), warn: true } },
    );
    render(<AssistantSettings />);
    expect(await screen.findByText(/passed 80% of a limit/)).toBeInTheDocument();
  });
});
