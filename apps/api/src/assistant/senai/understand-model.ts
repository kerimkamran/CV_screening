/**
 * Reading a question with a model (SenAI plan 6.2 step 4), only when the rules could not tell what
 * is meant. The model sees the question (candidate names already replaced by "Candidate NN", contact
 * details removed), the previous query, the page and the vacancy titles: never a resume. It answers
 * with a typed query, nothing else; the server checks every field again (`toQuery`) and runs the query.
 */
import {
  editDistance,
  fold,
  BASE_SKILLS,
  skillById,
  skillsInTokens,
  tokens,
  typoBudget,
} from '@cv/shared';
import { INTENTS, describe, blankQuery, modelQuerySchema, type Query, type Ref } from './query';

export const UNDERSTAND_PROMPT_VERSION = 'senai-understand-3';

export function understandSystem(): string {
  return [
    "You read a recruiter's message to an assistant that searches a pool of analyzed resumes, and you turn it into ONE JSON query. You never answer the question yourself.",
    'Read the message the way a smart colleague would. It may be in Azerbaijani (with or without special letters, or mixed with English or Russian words), English or Russian. It may be informal, ungrammatical, full of typos, missing words or punctuation, or written like a text message. Work out what the person means, not what the exact words are. Do not ask for a rephrase when a sensible reading exists.',
    `Return only a JSON object with these fields: intent (one of ${INTENTS.join(', ')}), followUp (new, replace, add, narrow, refine), skills (array of {id, text}), mode (all or any), bands (strong, good, partial, limited), decisions (new, shortlist, maybe, not_now), top (number or null), showAll (boolean), countOnly (boolean), refs (array of {kind: ordinal|last|label|shown, n}), sinceDays (number or null), whatIf ({text, to: nice|must} or null), everywhere (boolean), topic (string or null), vacancy (string or null).`,
    'Intents: find = best matches for a vacancy; count = how many; shortlist = the Shortlist; skills = who knows or has worked with something (a tool, language, certificate, domain); compare = side by side; doctor = why so few Strong or which requirement is rare; changes = what changed since a date; what_if = what if a requirement were nice-to-have or must-have; open = open a candidate or vacancy; interview = interview questions; recall = what was concluded before; about = what the assistant can see or how it got an answer; help = what a word or screen means, how to do something; prefs = always show the top N; jd = check the job description; consistency = look at the user own marks for contradictions; quality = duplicates, thin or unreadable resumes; similar = vacancies sharing requirements; rediscover = candidates of other vacancies who may fit; challenge = the person says a candidate does have a skill the analysis missed; unknown = none of these.',
    'For skills use the dictionary id when one fits (ids are listed below) and put in text the words of the message the skill came from, exactly as the person wrote them, typos included. When no id fits, id is null and text is the words as written. A skill must come from words the person wrote: never add a skill that the message, or a follow-up to the previous query, does not ask for.',
    'Follow-ups: a short message right after a previous query is a follow-up. "replace" keeps the scope and changes the skill ("excel" then "english" instead), "add" adds a skill ("also english", "həm də ingilis"), "narrow" restricts the previous result ("only Strong", "just the shortlisted"), "refine" changes only bands, marks or counts. Use the recent messages to understand what "them", "those", "the second one", "same for Python" refer to. A message that stands on its own is "new".',
    'vacancy: when the person names one of the vacancy titles you were given (even loosely: "the network job"), copy that title exactly from the list; otherwise null. Never invent a title.',
    'Never output names, never guess personal traits, never recommend hiring or rejecting. If you cannot tell what is meant, use intent "unknown".',
    'Examples (message -> JSON, shown short):',
    '"can u show me peple who knw excell and also englsh pls" -> {"intent":"skills","followUp":"new","skills":[{"id":"excel","text":"excell"},{"id":"english","text":"englsh"}],"mode":"all"}',
    '"kimlər pyton bilir" -> {"intent":"skills","skills":[{"id":"python","text":"pyton"}]}',
    '"mene excel ve ya sql bilenleri goster" -> {"intent":"skills","skills":[{"id":"excel","text":"excel"},{"id":"sql","text":"sql"}],"mode":"any"}',
    '"how many people we got for this job" -> {"intent":"count","countOnly":true}',
    '"ok and the strong only" (after a query) -> {"intent":"find","followUp":"narrow","bands":["strong"]}',
    '"whos best of them? give top 3" -> {"intent":"find","followUp":"refine","top":3}',
    '"why nobody is strong here" -> {"intent":"doctor"}',
    '"compare 1st and 3rd one" -> {"intent":"compare","refs":[{"kind":"ordinal","n":1},{"kind":"ordinal","n":3}]}',
    '"bu namizədlər arasında kim daha yaxşıdır" -> {"intent":"find"}',
    `Skill ids: ${BASE_SKILLS.map((s) => `${s.id}=${s.label}`).join(', ')}.`,
  ].join('\n');
}

export interface UnderstandInput {
  message: string;
  previous: Query | null;
  page: string | null;
  vacancies: string[];
  shown: number;
  /** The person's own last messages in this chat (oldest first), contact details removed. */
  recent: string[];
}

export function understandUser(i: UnderstandInput): string {
  return JSON.stringify({
    message: i.message,
    previousQuery: i.previous ? describe(i.previous) : null,
    onPage: i.page,
    vacancyTitles: i.vacancies.slice(0, 40),
    candidatesShownBefore: i.shown,
    recentMessages: i.recent.slice(-3),
  });
}

/** What is sent must hold only these fields. */
export const UNDERSTAND_FIELDS = [
  'message',
  'previousQuery',
  'onPage',
  'vacancyTitles',
  'candidatesShownBefore',
  'recentMessages',
];

export function parseModelQuery(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const r = modelQuerySchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** A word within a typo or two of a word of the message (as the person wrote it). */
function near(word: string, msgTokens: Set<string>): boolean {
  const budget = typoBudget(word.length);
  for (const t of msgTokens) {
    if (t === word) return true;
    if (budget > 0 && editDistance(word, t, budget) <= budget) return true;
  }
  return false;
}

/**
 * Does the message really point at this dictionary skill? Yes when the shared reader finds it in the
 * message (typos and Azerbaijani endings included), or when a word the model quoted is in the
 * message (a typo or two allowed). A skill the message does not point to is a guess, and is dropped.
 */
function pointsTo(id: string, quoted: string, message: string, msgTokens: Set<string>): boolean {
  if (skillsInTokens(tokens(message)).some((h) => h.skill.id === id)) return true;
  const words = tokens(quoted).filter((w) => w.length >= 3);
  // A paraphrase is allowed ("the tongue of Shakespeare" is English), so one quoted word is enough.
  return words.some((w) => near(w, msgTokens));
}

/**
 * The model's query, checked: skill ids must exist, a skill written out must really be in the
 * message, references must point at something shown. Anything else is dropped, not trusted.
 */
export function toQuery(
  mq: NonNullable<ReturnType<typeof parseModelQuery>>,
  message: string,
  ctx: { shown: number; now: Date },
): Query {
  const q = blankQuery();
  q.source = 'model';
  q.intent = mq.intent;
  q.followUp = mq.followUp;
  q.mode = mq.mode;
  q.bands = [...new Set(mq.bands)];
  q.decisions = [...new Set(mq.decisions)];
  q.top = mq.top;
  q.showAll = mq.showAll;
  q.countOnly = mq.countOnly;
  q.everywhere = mq.everywhere;
  q.topic = mq.topic;
  q.trigger = true;
  const folded = ` ${fold(message)} `;
  const msgTokens = new Set(tokens(message));
  for (const s of mq.skills) {
    const known = s.id ? skillById(s.id) : undefined;
    if (known) {
      // The model may only name a dictionary skill the words of the message point to.
      if (!pointsTo(known.id, s.text, message, msgTokens)) continue;
      q.skills.push({ id: known.id, label: known.label, phrase: null, words: [] });
      continue;
    }
    const phrase = fold(s.text);
    if (phrase.length < 2) continue;
    // A written-out skill must be in the message (a word, or a typo-free phrase of words).
    const inMessage =
      folded.includes(` ${phrase} `) ||
      phrase.split(' ').every((w) => msgTokens.has(w) || folded.includes(w) || near(w, msgTokens));
    if (!inMessage) continue;
    q.skills.push({
      id: null,
      label: phrase[0]!.toUpperCase() + phrase.slice(1),
      phrase,
      words: phrase.split(' '),
    });
  }
  q.skills = q.skills.slice(0, 5);
  q.refs = mq.refs
    .map((r): Ref | null =>
      r.kind === 'last'
        ? { kind: 'last' }
        : r.kind === 'shown'
          ? ctx.shown > 0
            ? { kind: 'shown' }
            : null
          : r.n
            ? { kind: r.kind, n: r.n }
            : null,
    )
    .filter((r): r is Ref => r !== null)
    .slice(0, 3);
  if (mq.sinceDays !== null) {
    const d = new Date(ctx.now.getTime() - mq.sinceDays * 86400000);
    q.since = d.toISOString().slice(0, 10);
  }
  if (mq.whatIf) q.whatIf = mq.whatIf;
  // An intent that needs a skill but has none, or one that needs references but has none, is not usable.
  if (q.intent === 'skills' && q.skills.length === 0) q.intent = 'unknown';
  if (
    (q.intent === 'compare' || q.intent === 'interview') &&
    q.refs.length === 0 &&
    ctx.shown === 0
  )
    q.intent = 'unknown';
  q.confidence = q.intent === 'unknown' ? 'low' : 'high';
  return q;
}
