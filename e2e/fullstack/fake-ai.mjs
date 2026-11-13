// The fake AI for the full-stack UAT journeys (UAT plan 2.3). It stands in for the provider's HTTP
// API (the Anthropic message format), so the whole pipeline runs as in production while the
// answers are the same on every run:
//  - a job description: the requirements are read from its "Required:" and "Nice to have:" lines
//    (English and Azerbaijani), as a careful reader would;
//  - a CV: each requirement is "met" with the line that contains its first word, else "not_found";
//  - SenAI's candidate panel ("second reader"): an answer built from the evidence package;
//  - the admin connection test: "ok"; the model list: two invented models;
//  - anything else (e.g. SenAI's question reader): text that is not JSON, so SenAI falls back to
//    its rules, exactly as when the model is unavailable.
// Modes (set through the control server): scripted, fail (HTTP 500), slow (delay, then scripted).

export const state = { mode: 'scripted', delayMs: 0, calls: [] };

const words = (s) =>
  s
    .split(/[,.;]| and | və /)
    .map((x) => x.trim())
    .filter((x) => x.length > 2);

function requirementsFrom(jd) {
  const req = [];
  const add = (text, classification, weight) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t && !req.some((r) => r.text.toLowerCase() === t.toLowerCase()))
      req.push({ text: t, classification, weight, confidence: 'high' });
  };
  const line = (re) => [...jd.matchAll(re)].map((m) => m[1]).join(' ');
  const must = line(/(?:Required|Requirements|Must have|Tələb olunur|Tələblər)\s*:\s*([^\n]+)/gi);
  const nice = line(/(?:Nice to have|Preferred|Advantage|Üstünlük|Arzuolunan)\s*:\s*([^\n]+)/gi);
  for (const w of words(must)) add(shorten(w), 'mandatory', 10);
  for (const w of words(nice)) add(shorten(w), 'preferred', 5);
  if (req.length === 0) {
    add('BGP routing', 'mandatory', 10);
    add('Kubernetes', 'mandatory', 10);
    add('Python scripting', 'preferred', 5);
  }
  return req.slice(0, 12);
}

/** "BGP routing experience in a carrier network" → "BGP routing experience". */
function shorten(s) {
  const cut = s.split(/ in | for | ilə | üçün /)[0];
  return cut.length > 60 ? cut.slice(0, 60) : cut;
}

function assess(user) {
  const criteria = JSON.parse(user.slice(user.indexOf('['), user.indexOf('\n\n<<<CV_START>>>')));
  const cv = user.slice(user.indexOf('<<<CV_START>>>'));
  const name = /Name: ([^\n]+)/.exec(cv)?.[1]?.trim() ?? 'Unknown Person';
  return {
    candidate: { name },
    summary: `Candidate summary for ${name}.`,
    assessments: criteria.map((c) => {
      // The longest word of the requirement that appears in the CV decides (BGP, Kubernetes…).
      const keys = c.text
        .split(/[^\p{L}\p{N}+#.]+/u)
        .filter((w) => w.length >= 3)
        .sort((a, b) => b.length - a.length);
      for (const key of keys) {
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const line = new RegExp(`[^\\n]*${esc}[^\\n]*`, 'i').exec(cv)?.[0]?.trim();
        if (line && !line.startsWith('<<<'))
          return {
            id: c.id,
            status: 'met',
            confidence: 'high',
            evidence: [line.slice(0, 300)],
            rationale: 'Stated in the CV.',
          };
      }
      return {
        id: c.id,
        status: 'not_found',
        confidence: 'high',
        evidence: [],
        rationale: 'Not found in the CV.',
      };
    }),
  };
}

function secondReader(user) {
  const m = /EVIDENCE PACKAGES?:\n([\s\S]*?)\n\n(?:EARLIER|THE RECRUITER|QUESTION)/.exec(user);
  let pkg = null;
  try {
    pkg = m ? JSON.parse(m[1]) : null;
  } catch {
    pkg = null;
  }
  const p = Array.isArray(pkg) ? pkg[0] : pkg;
  const first = p?.passages?.[0];
  return {
    headline: `${p?.candidate ?? 'The candidate'} matches on what the record shows.`,
    claims: [
      first
        ? { text: 'A stated experience is in the CV.', source: first.id, quote: first.text }
        : { text: 'See the tally.', source: 'MATCH' },
    ],
    cant_see: "The CV doesn't mention everything; that is not evidence of a gap.",
    questions: [
      { text: 'Tell me about a recent project.', source: p?.requirements?.[0]?.id ?? '' },
    ],
    outcome: 'held',
  };
}

export function answer(system, user) {
  if (/single word: ok/i.test(system)) return 'ok';
  if (system.includes('convert a job description')) {
    const jd = user.includes('<<<') ? user : user;
    return JSON.stringify({ requirements: requirementsFrom(jd) });
  }
  if (user.includes('<<<CV_START>>>')) return JSON.stringify(assess(user));
  if (system.includes('second reader')) return JSON.stringify(secondReader(user));
  return 'The fake model has no scripted answer for this.';
}

/** A fetch-compatible function for AiGateway.fetcher. */
export async function fakeFetch(url, init = {}) {
  const u = String(url);
  if ((init.method ?? 'GET') === 'GET' && /\/models/.test(u))
    return new Response(
      JSON.stringify({
        data: [
          { id: 'claude-fake-1', display_name: 'Claude Fake 1 (UAT)' },
          { id: 'claude-fake-2', display_name: 'Claude Fake 2 (UAT)' },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const body = JSON.parse(String(init.body ?? '{}'));
  const system = String(body.system ?? '');
  const user = String(body.messages?.[0]?.content ?? '');
  state.calls.push({ at: new Date().toISOString(), url: u, system, user });
  if (state.calls.length > 2000) state.calls.splice(0, 1000);
  if (state.mode === 'fail')
    return new Response(JSON.stringify({ error: { message: 'fake outage' } }), { status: 500 });
  if (state.mode === 'slow' || state.delayMs)
    await new Promise((r) => setTimeout(r, state.delayMs || 5000));
  const text = answer(system, user);
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
