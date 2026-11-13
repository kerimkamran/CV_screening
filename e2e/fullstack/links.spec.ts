import { expect, test, uat } from '../ux/test';
import { accounts, api, login, RESUME, screenedVacancy, uniq } from './stack';

/**
 * UAT package E, layer L2: link review end to end (LK-05). Every person here is invented.
 */

uat(
  'LK-05',
  'Link review end to end: consent, redaction, not scored, withdraw',
  { on: ['D'], langs: 'EN' },
  async () => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await screenedVacancy(token, {
      title: uniq('UAT Links Network Engineer'),
      files: [{ name: 'farid.txt', type: 'text/plain', data: RESUME('09-farid-en-links.txt') }],
    });
    const rows = (await api(token).get(`/candidates?vacancy=${v.id}&limit=5`)).body.rows as {
      matchId: string;
    }[];
    const mid = rows[0]!.matchId;
    // While the administrator has not turned link review on, nothing is offered or read.
    const st = await api(token).get(`/assistant/candidates/${mid}/links`);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ enabled: false, links: [] });
    const rd = await api(token).post(`/assistant/candidates/${mid}/links/review`, {
      url: 'https://github.com/faridq',
    });
    expect(rd.status).toBeGreaterThanOrEqual(400);
    // The journey itself needs SenAI switched on for the whole shared L2 server (settings.enabled
    // and features.linkReview, link-review.service.ts:117-120) and an API started with
    // LINK_READER = new LinkReader({ allowLoopback: true }); fullstack/server.mjs does not offer that
    // override, and switching SenAI on would change every other package's L2 screens mid-run.
    test.skip(
      true,
      'Blocked: the L2 server has no LINK_READER override (loopback page cannot be read) and enabling SenAI globally would disturb the other packages running on the shared server',
    );
  },
);
