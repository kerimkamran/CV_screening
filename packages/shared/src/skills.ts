/**
 * The skills dictionary (SenAI plan F7): what people write on resumes and ask for in the Ask bar,
 * in Azerbaijani, English and Russian, with a telecom pack. One entry is one idea; the aliases are
 * the ways it is written. Everything is compared in folded form (see language.ts), so "Эксель",
 * "eksel", "Excel" and "MS Excel" are one skill and "ingilis dili" is English.
 *
 * Reading a resume with it never scores anything: it only says "mentioned in the resume".
 */
import { fold, editDistance, isEnding, typoBudget, AZ_ENDINGS } from './language.js';

export type SkillKind = 'tool' | 'language' | 'domain' | 'certificate';

export interface Skill {
  id: string;
  /** How the skill is shown in an answer. */
  label: string;
  kind: SkillKind;
  /** The ways it is written, in any language (raw; folded when the dictionary loads). */
  aliases: string[];
}

const S = (id: string, label: string, kind: SkillKind, aliases: string[]): Skill => ({
  id,
  label,
  kind,
  aliases,
});

/** The built-in dictionary. Approved admin entries are added on top by `applyCustomSkills`. */
export const BASE_SKILLS: Skill[] = [
  // Office and business tools
  S('excel', 'Excel', 'tool', [
    'excel',
    'ms excel',
    'microsoft excel',
    'эксель',
    'эксел',
    'eksel',
    'exsel',
    'exel',
    'excell',
    'ecxel',
    'vlookup',
    'pivot',
    'pivot table',
    'xlookup',
  ]),
  S('word', 'Word', 'tool', ['word', 'ms word', 'microsoft word', 'ворд']),
  S('powerpoint', 'PowerPoint', 'tool', [
    'powerpoint',
    'power point',
    'ms powerpoint',
    'пауэрпоинт',
    'презентация powerpoint',
  ]),
  S('outlook', 'Outlook', 'tool', ['outlook', 'аутлук']),
  S('office', 'MS Office', 'tool', [
    'ms office',
    'microsoft office',
    'office package',
    'office paketi',
    'ofis proqramlari',
  ]),
  S('sap', 'SAP', 'tool', ['sap', 'sap erp', 'sap hana']),
  S('oracle', 'Oracle', 'tool', ['oracle', 'оракл', 'oracle db', 'oracle database']),
  S('1c', '1C', 'tool', ['1c', '1с', '1c buxqalteriya', '1c:enterprise']),
  S('powerbi', 'Power BI', 'tool', ['power bi', 'powerbi']),
  S('tableau', 'Tableau', 'tool', ['tableau']),
  S('jira', 'Jira', 'tool', ['jira', 'confluence']),
  S('crm', 'CRM', 'tool', ['crm', 'salesforce', 'dynamics crm', 'amocrm', 'bitrix24']),
  S('figma', 'Figma', 'tool', ['figma', 'фигма']),
  S('photoshop', 'Photoshop', 'tool', ['photoshop', 'фотошоп', 'adobe photoshop']),
  S('autocad', 'AutoCAD', 'tool', ['autocad', 'автокад']),
  // Programming and data
  S('sql', 'SQL', 'tool', [
    'sql',
    'mysql',
    'postgresql',
    'postgres',
    'mssql',
    'ms sql',
    'plsql',
    'pl sql',
    't sql',
    'tsql',
    'sqlite',
  ]),
  S('python', 'Python', 'tool', ['python', 'питон', 'пайтон', 'paython']),
  S('java', 'Java', 'tool', ['java', 'джава', 'spring boot']),
  S('javascript', 'JavaScript', 'tool', [
    'javascript',
    'js',
    'typescript',
    'ts',
    'джаваскрипт',
    'ecmascript',
  ]),
  S('react', 'React', 'tool', ['react', 'reactjs', 'react js', 'реакт']),
  S('angular', 'Angular', 'tool', ['angular', 'angularjs']),
  S('nodejs', 'Node.js', 'tool', ['node', 'nodejs', 'node js']),
  S('csharp', 'C#', 'tool', ['csharp', 'c sharp']),
  S('cpp', 'C++', 'tool', ['cpp', 'c plus plus']),
  S('dotnet', '.NET', 'tool', ['dotnet', 'asp net', 'aspnet']),
  S('php', 'PHP', 'tool', ['php', 'laravel', 'пхп']),
  S('go', 'Go', 'tool', ['golang']),
  S('git', 'Git', 'tool', ['git', 'github', 'gitlab', 'bitbucket']),
  S('linux', 'Linux', 'tool', [
    'linux',
    'линукс',
    'ubuntu',
    'centos',
    'red hat',
    'redhat',
    'debian',
  ]),
  S('windows', 'Windows Server', 'tool', [
    'windows server',
    'active directory',
    'ms windows server',
  ]),
  S('docker', 'Docker', 'tool', ['docker', 'докер']),
  S('kubernetes', 'Kubernetes', 'tool', [
    'kubernetes',
    'k8s',
    'кубернетес',
    'kubernetis',
    'openshift',
    'helm',
  ]),
  S('terraform', 'Terraform', 'tool', ['terraform']),
  S('ansible', 'Ansible', 'tool', ['ansible']),
  S('jenkins', 'Jenkins', 'tool', ['jenkins', 'ci cd', 'cicd', 'gitlab ci']),
  S('aws', 'AWS', 'tool', ['aws', 'amazon web services']),
  S('azure', 'Azure', 'tool', [
    'azure microsoft',
    'microsoft azure',
    'azure cloud',
    'azure devops',
  ]),
  S('gcp', 'Google Cloud', 'tool', ['gcp', 'google cloud']),
  S('selenium', 'Selenium', 'tool', [
    'selenium',
    'cypress',
    'postman',
    'test automation',
    'avtomatlasdirilmis test',
  ]),
  S('agile', 'Agile / Scrum', 'domain', ['agile', 'scrum', 'kanban', 'аджайл', 'скрам']),
  S('itil', 'ITIL', 'certificate', ['itil']),
  S('pmp', 'PMP', 'certificate', ['pmp', 'prince2', 'pmi']),
  // Telecom pack
  S('cisco', 'Cisco', 'tool', ['cisco', 'cisko', 'циско', 'ios xe', 'nexus']),
  S('huawei', 'Huawei', 'tool', ['huawei', 'huavei', 'хуавей', 'хуавэй']),
  S('nokia', 'Nokia', 'tool', ['nokia', 'нокиа', 'alcatel lucent']),
  S('ericsson', 'Ericsson', 'tool', ['ericsson', 'эрикссон', 'ericson']),
  S('juniper', 'Juniper', 'tool', ['juniper', 'junos']),
  S('mikrotik', 'MikroTik', 'tool', ['mikrotik', 'микротик']),
  S('fortinet', 'Fortinet', 'tool', ['fortinet', 'fortigate']),
  S('paloalto', 'Palo Alto', 'tool', ['palo alto', 'paloalto']),
  S('bgp', 'BGP', 'tool', ['bgp']),
  S('ospf', 'OSPF', 'tool', ['ospf', 'isis', 'eigrp']),
  S('mpls', 'MPLS', 'tool', ['mpls', 'l3vpn', 'l2vpn', 'vpls']),
  S('vpn', 'VPN', 'tool', ['vpn', 'ipsec']),
  S('vlan', 'VLAN', 'tool', ['vlan', 'stp', 'lacp']),
  S('routing', 'Routing / switching', 'domain', [
    'routing',
    'switching',
    'marsrutlasdirma',
    'маршрутизация',
    'коммутация',
  ]),
  S('firewall', 'Firewall', 'tool', ['firewall', 'fayrvol', 'брандмауэр', 'межсетевой экран']),
  S('voip', 'VoIP', 'tool', ['voip', 'sip', 'asterisk', 'ip telephony', 'ip telefoniya']),
  S('ran', 'RAN', 'domain', [
    'ran',
    'radio access',
    'enodeb',
    'gnodeb',
    'base station',
    'baza stansiyasi',
  ]),
  S('lte', 'LTE / 5G', 'domain', ['lte', '4g', '5g', 'volte', '3g', '2g']),
  S('ossbss', 'OSS/BSS', 'domain', ['oss', 'bss', 'oss bss', 'billing', 'hesablasma sistemi']),
  S('sdh', 'SDH / DWDM', 'domain', [
    'sdh',
    'dwdm',
    'otn',
    'optik',
    'optical transport',
    'fiber',
    'fibre',
    'fiber optic',
  ]),
  S('ccna', 'CCNA', 'certificate', ['ccna']),
  S('ccnp', 'CCNP', 'certificate', ['ccnp']),
  S('ccie', 'CCIE', 'certificate', ['ccie']),
  S('hcia', 'Huawei HCIA / HCIP', 'certificate', ['hcia', 'hcip', 'hcie']),
  S('networking', 'Networking', 'domain', [
    'networking',
    'network engineering',
    'sebeke',
    'сетевой',
    'tcp ip',
    'tcpip',
  ]),
  S('monitoring', 'Monitoring', 'tool', [
    'zabbix',
    'nagios',
    'prometheus',
    'grafana',
    'solarwinds',
    'monitorinq',
  ]),
  S('cybersecurity', 'Cyber security', 'domain', [
    'cybersecurity',
    'cyber security',
    'siber tehlukesizlik',
    'infosec',
    'information security',
    'информационная безопасность',
    'penetration testing',
    'siem',
    'soc',
  ]),
  // Business domains
  S('accounting', 'Accounting', 'domain', [
    'accounting',
    'bookkeeping',
    'muhasibat',
    'muhasib',
    'buxqalteriya',
    'бухгалтерия',
    'бухгалтерский учет',
    'ifrs',
    'msfo',
    'ysbs',
  ]),
  S('finance', 'Finance', 'domain', [
    'finance',
    'financial analysis',
    'maliyye',
    'финансы',
    'budgeting',
    'budce',
  ]),
  S('sales', 'Sales', 'domain', ['sales', 'satis', 'продажи', 'b2b', 'b2c', 'key account']),
  S('marketing', 'Marketing', 'domain', [
    'marketing',
    'marketinq',
    'маркетинг',
    'smm',
    'seo',
    'digital marketing',
  ]),
  S('hr', 'HR', 'domain', [
    'hr',
    'human resources',
    'recruitment',
    'recruiting',
    'kadr',
    'insan resurslari',
    'кадры',
    'рекрутинг',
    'oracle hcm',
  ]),
  S('procurement', 'Procurement', 'domain', [
    'procurement',
    'satinalma',
    'tender',
    'закупки',
    'supply chain',
  ]),
  S('legal', 'Legal', 'domain', [
    'legal',
    'hüquq',
    'huquq',
    'yurist',
    'юрист',
    'contract management',
  ]),
  S('projectmgmt', 'Project management', 'domain', [
    'project management',
    'layihe idareetmesi',
    'layihe meneceri',
    'управление проектами',
    'project manager',
  ]),
  S('customerservice', 'Customer service', 'domain', [
    'customer service',
    'musteri xidmeti',
    'call center',
    'kol mərkəzi',
    'контакт центр',
    'колл центр',
    'customer support',
  ]),
  S('teamlead', 'Team leadership', 'domain', [
    'team lead',
    'team leader',
    'komanda rehberi',
    'руководил командой',
    'people management',
  ]),
  // Languages
  S('english', 'English', 'language', [
    'english',
    'ingilis',
    'ingilis dili',
    'ingilisce',
    'английский',
    'английск*',
    'ielts',
    'toefl',
    'ingilis dilinde',
  ]),
  S('russian', 'Russian', 'language', [
    'russian',
    'rus dili',
    'rusca',
    'русский',
    'русск*',
    'rus dilinde',
  ]),
  S('azerbaijani', 'Azerbaijani', 'language', [
    'azerbaijani',
    'azerbaycan dili',
    'azerbaycanca',
    'азербайджанск*',
    'azeri',
  ]),
  S('turkish', 'Turkish', 'language', ['turkish', 'turk dili', 'turkce', 'турецк*']),
  S('german', 'German', 'language', ['german', 'alman dili', 'almanca', 'немецк*', 'deutsch']),
  S('french', 'French', 'language', [
    'french',
    'fransiz dili',
    'fransizca',
    'французск*',
    'francais',
  ]),
  S('arabic', 'Arabic', 'language', ['arabic', 'ereb dili', 'ərəb dili', 'арабск*']),
];

interface Entry {
  skill: Skill;
  /** Folded alias, one or more words. */
  alias: string;
  words: string[];
  /**
   * exact: the whole word only. ending: the word with an Azerbaijani or Russian ending ("excelde").
   * prefix: a stem written with a trailing star ("английск*" is "английский", "английском", ...).
   */
  mode: 'exact' | 'ending' | 'prefix';
  /** Written in Cyrillic: Russian case endings may follow. */
  cyr: boolean;
}

/** What the reader works with now: the built-in skills plus the admin-approved ones. */
export let SKILLS: Skill[] = BASE_SKILLS;
let ENTRIES: Entry[] = [];
let BY_ID = new Map<string, Skill>();
/** Single-word aliases, for typo matching. */
let WORD_ALIASES: Entry[] = [];

function rebuild(skills: Skill[]): void {
  SKILLS = skills;
  ENTRIES = skills
    .flatMap((skill) =>
      skill.aliases.map((raw): Entry => {
        const star = raw.endsWith('*');
        const alias = fold(star ? raw.slice(0, -1) : raw);
        const single = !alias.includes(' ');
        return {
          skill,
          alias,
          words: alias.split(' '),
          mode: star ? 'prefix' : single && alias.length >= 5 ? 'ending' : 'exact',
          cyr: /[а-яё]/i.test(raw),
        };
      }),
    )
    .filter((e) => e.alias.length > 0);
  BY_ID = new Map(skills.map((s) => [s.id, s]));
  WORD_ALIASES = ENTRIES.filter((e) => e.mode === 'ending');
}
rebuild(BASE_SKILLS);

export const skillById = (id: string): Skill | undefined => BY_ID.get(id);

/** An entry an administrator approved: a new skill, or more ways to write a built-in one. */
export interface CustomSkill {
  id: string;
  label: string;
  kind: SkillKind;
  aliases: string[];
  /** The id of a built-in skill these aliases belong to; null for a new skill. */
  extends: string | null;
}

/**
 * Replaces the approved extra entries (called at start-up and whenever an administrator decides).
 * A built-in skill is never removed or renamed; an entry that clashes with one is ignored.
 */
export function applyCustomSkills(custom: CustomSkill[]): void {
  const base = new Map(BASE_SKILLS.map((s) => [s.id, s]));
  const extra = new Map<string, string[]>();
  const added: Skill[] = [];
  for (const c of custom) {
    if (c.extends) {
      if (base.has(c.extends))
        extra.set(c.extends, [...(extra.get(c.extends) ?? []), ...c.aliases]);
    } else if (!base.has(c.id) && !added.some((a) => a.id === c.id)) {
      added.push({ id: c.id, label: c.label, kind: c.kind, aliases: c.aliases });
    }
  }
  rebuild([
    ...BASE_SKILLS.map((s) =>
      extra.has(s.id) ? { ...s, aliases: [...s.aliases, ...extra.get(s.id)!] } : s,
    ),
    ...added,
  ]);
}

/** Russian case endings: "питоном", "экселе". Only for Cyrillic aliases. */
const RU_ENDINGS = new Set(
  ['а', 'у', 'ом', 'е', 'ы', 'ов', 'ами', 'ах', 'ем', 'ой', 'ей'].map((x) => fold(x)),
);

/** A skill for one folded word: exact, with an ending, or a typo of a long word. */
export function skillOfWord(w: string): Skill | null {
  const exact = ENTRIES.find((e) => e.words.length === 1 && e.alias === w);
  if (exact) return exact.skill;
  // "pyton": five letters with one missing, the same first two letters as a six-letter alias.
  if (w.length === 5) {
    const miss = WORD_ALIASES.find(
      (e) =>
        e.alias.length === 6 &&
        e.alias.startsWith(w.slice(0, 2)) &&
        editDistance(w, e.alias, 1) === 1 &&
        e.alias.replace(/.$/, '') !== w &&
        /^[a-z]+$/.test(e.alias),
    );
    if (miss) return miss.skill;
  }
  if (w.length >= 5) {
    const pre = ENTRIES.find((e) => e.mode === 'prefix' && w.startsWith(e.alias));
    if (pre) return pre.skill;
    const end = ENTRIES.find(
      (e) =>
        e.mode === 'ending' &&
        w.startsWith(e.alias) &&
        (isEnding(w.slice(e.alias.length)) || (e.cyr && RU_ENDINGS.has(w.slice(e.alias.length)))),
    );
    if (end) return end.skill;
    // A typo of a long word: the nearest alias, or several that are all the same skill.
    // (Shorter words are never guessed: "pilot" is not "pivot".)
    if (w.length < 6) return null;
    const budget = typoBudget(w.length);
    let bd = budget + 1;
    let found = new Set<Skill>();
    for (const e of WORD_ALIASES) {
      if (Math.abs(e.alias.length - w.length) > budget) continue;
      const d = editDistance(w, e.alias, budget);
      if (d < bd) {
        bd = d;
        found = new Set([e.skill]);
      } else if (d === bd) found.add(e.skill);
    }
    if (bd <= budget && found.size === 1) return [...found][0]!;
  }
  return null;
}

export interface SkillHit {
  skill: Skill;
  /** Token indexes the skill was read from. */
  at: number[];
}

/**
 * The skills named in a folded question, as token indexes. Phrases ("ingilis dili", "power bi")
 * win over single words; a word that is part of a phrase is not read twice.
 */
export function skillsInTokens(toks: string[]): SkillHit[] {
  const used = new Set<number>();
  const hits: SkillHit[] = [];
  const phrases = ENTRIES.filter((e) => e.words.length > 1).sort(
    (a, b) => b.words.length - a.words.length,
  );
  for (const e of phrases) {
    for (let i = 0; i + e.words.length <= toks.length; i++) {
      if (e.words.every((w, k) => toks[i + k] === w) && !e.words.some((_, k) => used.has(i + k))) {
        const at = e.words.map((_, k) => i + k);
        at.forEach((x) => used.add(x));
        hits.push({ skill: e.skill, at });
      }
    }
  }
  toks.forEach((t, i) => {
    if (used.has(i) || t.length < 2) return;
    const s = skillOfWord(t);
    if (s) {
      used.add(i);
      hits.push({ skill: s, at: [i] });
    }
  });
  return hits.sort((a, b) => a.at[0]! - b.at[0]!);
}

// ----------------------------------------------------------------------------- reading a resume

export interface Folded {
  /** Folded text: lower case, no diacritics, Cyrillic as Latin, single spaces. */
  text: string;
  /** For each folded character, where it came from in the original. */
  map: number[];
}

function foldChar(ch: string): string {
  const base = ch
    .normalize('NFKC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return fold(base.replace(/ə/g, 'e').replace(/ö/g, 'o').replace(/ü/g, 'u'));
}

/** Folds a resume text and remembers the original position of every character. */
export function foldMapped(raw: string): Folded {
  const out: string[] = [];
  const map: number[] = [];
  const push = (s: string, at: number) => {
    for (const c of s) {
      if (c === ' ') {
        if (!out.length || out[out.length - 1] === ' ') continue;
      }
      out.push(c);
      map.push(at);
    }
  };
  const re = /c\+\+|c#|\.net\b|[\s\S]/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const tok = m[0];
    const prevLetter = m.index > 0 && /[\p{L}\p{N}]/u.test(raw[m.index - 1]!);
    const low = tok.toLowerCase();
    if (!prevLetter && low === 'c++') push(' cpp ', m.index);
    else if (!prevLetter && low === 'c#') push(' csharp ', m.index);
    else if (low === '.net') push(' dotnet ', m.index);
    else if (tok.length === 1) {
      const f = foldChar(tok);
      push(f === '' ? ' ' : f, m.index);
    } else push(' ', m.index);
  }
  while (out.length && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }
  return { text: out.join(''), map };
}

const ENDINGS_RE = [...AZ_ENDINGS].sort((a, b) => b.length - a.length).join('|');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regular expression for all aliases of a skill, over folded text. */
export function skillRegex(skill: Skill, flags = 'g'): RegExp {
  const ends = ENDINGS_RE;
  const parts = ENTRIES.filter((e) => e.skill.id === skill.id).map((e) =>
    e.mode === 'prefix'
      ? `(?<![a-z0-9])${esc(e.alias)}[a-z]{0,6}(?![a-z0-9])`
      : e.mode === 'ending'
        ? `(?<![a-z0-9])${esc(e.alias)}(?:${ends})?(?![a-z0-9])`
        : `(?<![a-z0-9])${esc(e.alias)}(?![a-z0-9])`,
  );
  return new RegExp(parts.join('|'), flags);
}

/** A word the dictionary does not know ("terraform" typed as written): whole word, or with an ending. */
export function phraseRegex(phrase: string, flags = 'g'): RegExp {
  const f = fold(phrase);
  return new RegExp(
    f.length >= 5
      ? `(?<![a-z0-9])${esc(f)}(?:${ENDINGS_RE})?(?![a-z0-9])`
      : `(?<![a-z0-9])${esc(f)}(?![a-z0-9])`,
    flags,
  );
}

export interface Mention {
  /** Original text offsets of the match. */
  start: number;
  end: number;
}

/** Where a skill is mentioned in a folded resume, as offsets into the original text. */
export function mentionsOf(folded: Folded, re: RegExp, raw: string): Mention[] {
  const out: Mention[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(folded.text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = folded.map[m.index] ?? 0;
    let end = (folded.map[m.index + m[0].length - 1] ?? start) + 1;
    while (end < raw.length && /[\p{L}\p{N}]/u.test(raw[end]!)) end++;
    out.push({ start, end });
  }
  return out;
}

/** A readable window of the original text around a mention: its line, shortened to about 200 characters. */
export function windowAround(
  raw: string,
  at: Mention,
  width = 200,
): { start: number; end: number } {
  let ls = raw.lastIndexOf('\n', at.start - 1) + 1;
  let le = raw.indexOf('\n', at.end);
  if (le === -1) le = raw.length;
  if (le - ls > width) {
    const half = Math.floor(width / 2);
    ls = Math.max(ls, at.start - half);
    le = Math.min(le, at.end + half);
    const sp = raw.indexOf(' ', ls);
    if (ls > 0 && sp !== -1 && sp < at.start) ls = sp + 1;
    const lp = raw.lastIndexOf(' ', le);
    if (le < raw.length && lp > at.end) le = lp;
  }
  return { start: ls, end: le };
}

export { editDistance };
