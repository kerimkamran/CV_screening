/**
 * Wording of the deeper SenAI tools (interview kit, consistency mirror, data quality, JD coach,
 * similar vacancies, rediscovery, pushback check, preferences), in three languages. Fixed text with
 * slots, so every number in it is the server's own. Azerbaijani and Russian drafts need a native review.
 */
import type { Lang } from '../pool-assistant';

const W = {
  needVacancy: {
    en: 'Which vacancy? Pick one:',
    az: 'Hansı vakansiya? Birini seçin:',
    ru: 'Какая вакансия? Выберите:',
  },
  // preferences
  prefSaved: {
    en: 'Saved: I will show the top {n} by default. Say "always top 5" to change it.',
    az: 'Yadda saxlandı: standart olaraq ilk {n} namizədi göstərəcəyəm. Dəyişmək üçün "həmişə 5 göstər" deyin.',
    ru: 'Сохранено: по умолчанию буду показывать первых {n}. Чтобы изменить, скажите «всегда 5».',
  },
  // interview kit
  kitHead: {
    en: 'Interview kit for {name}: the same core question for every candidate, and probes from what this resume shows.',
    az: '{name} üçün müsahibə dəsti: hər namizədə eyni əsas sual və bu CV-nin göstərdiklərinə görə dəqiqləşdirici suallar.',
    ru: 'Набор для интервью: {name}. Один и тот же основной вопрос для всех и уточняющие вопросы по этому резюме.',
  },
  kitQuestion: {
    en: 'Tell me about a time you used {req}. What was the situation, what did you do yourself, and what was the result?',
    az: '{req} ilə işlədiyiniz bir hadisəni danışın. Vəziyyət necə idi, özünüz nə etdiniz və nəticə nə oldu?',
    ru: 'Расскажите о случае, когда вы использовали «{req}». Какой была ситуация, что вы сделали сами и каков результат?',
  },
  kitRubric: {
    en: "A real example; their own part (not the team's); a result that can be checked; what they would do differently.",
    az: 'Real nümunə; öz payı (komandanın yox); yoxlanıla bilən nəticə; bu dəfə nəyi fərqli edərdi.',
    ru: 'Реальный пример; его личная роль (не команды); проверяемый результат; что сделал бы иначе.',
  },
  kitProbeMet: {
    en: 'Found in the resume. Ask for the hardest problem they solved with it.',
    az: 'CV-də tapılıb. Bununla həll etdiyi ən çətin məsələni soruşun.',
    ru: 'Найдено в резюме. Спросите о самой сложной задаче, которую решили этим.',
  },
  kitProbePartly: {
    en: 'Only partly found. Ask for the scope, the tools, how long, and their own role.',
    az: 'Yalnız qismən tapılıb. Həcmi, alətləri, müddəti və öz rolunu soruşun.',
    ru: 'Найдено лишь частично. Спросите об объёме, инструментах, сроке и личной роли.',
  },
  kitProbeNone: {
    en: 'Not found in the resume (it may still exist). Ask what related work they have done and how they would get up to speed.',
    az: 'CV-də tapılmayıb (yenə də ola bilər). Əlaqəli hansı işlər görüb və necə öyrənərdi, soruşun.',
    ru: 'В резюме не найдено (это не значит, что нет). Спросите о смежном опыте и как бы быстро вошёл в тему.',
  },
  kitNote: {
    en: 'Job-related questions only, generated from the requirements. Copy it and use it as you like; nothing is saved or sent. Do not ask about age, family, health, origin, religion or looks.',
    az: 'Yalnız işlə bağlı suallar, tələblərdən hazırlanıb. Köçürüb istədiyiniz kimi istifadə edin; heç nə saxlanmır və ya göndərilmir. Yaş, ailə, sağlamlıq, mənşə, din və görünüş barədə soruşmayın.',
    ru: 'Только вопросы по работе, составлены по требованиям. Скопируйте и используйте; ничего не сохраняется и не отправляется. Не спрашивайте о возрасте, семье, здоровье, происхождении, религии и внешности.',
  },
  hQuestion2: { en: 'Core question', az: 'Əsas sual', ru: 'Основной вопрос' },
  hRubric: {
    en: 'A good answer contains',
    az: 'Yaxşı cavabda olmalıdır',
    ru: 'В хорошем ответе есть',
  },
  hProbe: {
    en: 'Probe for this resume',
    az: 'Bu CV üçün dəqiqləşdirmə',
    ru: 'Уточнение по этому резюме',
  },
  // consistency mirror
  consHead: {
    en: '{n} pair(s) with the same must-have evidence and different marks, in {scope}. Look again?',
    az: '{scope} üzrə eyni vacib tələb sübutu olub fərqli qeyd alan {n} cüt var. Yenidən baxaq?',
    ru: 'В «{scope}» пар с одинаковыми доказательствами по обязательным требованиям, но разными отметками: {n}. Посмотреть ещё раз?',
  },
  consNone: {
    en: 'I found no pair with the same must-have evidence and different marks in {scope}.',
    az: '{scope} üzrə eyni vacib tələb sübutu olub fərqli qeyd alan cüt tapmadım.',
    ru: 'В «{scope}» не нашёл пар с одинаковыми доказательствами и разными отметками.',
  },
  consReason: {
    en: 'The reason written for {name} ("{note}") is not one of the requirements. Keep it or edit it?',
    az: '{name} üçün yazılmış səbəb ("{note}") tələblərdən biri deyil. Saxlayaq, yoxsa dəyişək?',
    ru: 'Причина для {name} («{note}») не входит в требования. Оставить или изменить?',
  },
  consOne: {
    en: '{n} Partial candidates are unmarked and miss only one must-have: worth a look.',
    az: 'Qismən səviyyəli {n} namizəd qeydsizdir və yalnız bir vacib tələbi ödəmir: baxmağa dəyər.',
    ru: '{n} кандидатов уровня «Частичное» без отметки не хватает лишь одного обязательного требования: стоит посмотреть.',
  },
  consNote: {
    en: 'Private to you, only your own marks are read. It never changes a mark and is never a verdict.',
    az: 'Yalnız sizə aiddir, yalnız öz qeydləriniz oxunur. Heç vaxt qeydi dəyişmir və hökm deyil.',
    ru: 'Только для вас, читаются лишь ваши отметки. Ничего не меняет и не является вердиктом.',
  },
  hSame: { en: 'Same evidence', az: 'Eyni sübut', ru: 'Одинаковые доказательства' },
  hMarks: { en: 'Marks', az: 'Qeydlər', ru: 'Отметки' },
  // data quality
  qualHead: {
    en: 'Data quality for {scope}: {dups} near-copy pair(s), {thin} thin resume(s), {ru} in Russian.',
    az: '{scope} üzrə məlumat keyfiyyəti: {dups} demək olar ki, eyni cüt, {thin} qısa CV, {ru} rus dilində.',
    ru: 'Качество данных для «{scope}»: почти одинаковых пар — {dups}, коротких резюме — {thin}, на русском — {ru}.',
  },
  qualNone: {
    en: 'Nothing odd found in the resumes of {scope}.',
    az: '{scope} CV-lərində qeyri-adi bir şey tapılmadı.',
    ru: 'В резюме «{scope}» ничего необычного не найдено.',
  },
  qualDup: {
    en: '{a} is a {pct}% copy of {b}',
    az: '{a} və {b} {pct}% eynidir',
    ru: '{a} на {pct}% совпадает с {b}',
  },
  qualThin: {
    en: 'Thin resume: very little text, so the analysis may be unreliable',
    az: 'Qısa CV: mətn çox azdır, təhlil etibarsız ola bilər',
    ru: 'Короткое резюме: мало текста, анализ может быть ненадёжным',
  },
  qualRu: {
    en: 'Written mostly in Russian: read as best effort',
    az: 'Əsasən rus dilindədir: mümkün qədər oxunub',
    ru: 'Написано в основном по-русски: прочитано по мере возможности',
  },
  qualNote: {
    en: 'Counted from the resume text. A copy is not a verdict; it is only a reason to look.',
    az: 'CV mətnindən sayılıb. Eyniliyin özü hökm deyil, yalnız baxmaq üçün səbəbdir.',
    ru: 'Посчитано по тексту резюме. Совпадение — не вердикт, лишь повод посмотреть.',
  },
  hIssue: { en: 'What', az: 'Nə', ru: 'Что' },
  // JD coach
  jdHead: {
    en: 'JD check for {title}: {n} suggestion(s). Nothing was changed.',
    az: '{title} üçün JD yoxlaması: {n} təklif. Heç nə dəyişdirilməyib.',
    ru: 'Проверка описания «{title}»: предложений — {n}. Ничего не изменено.',
  },
  jdClean: {
    en: 'JD check for {title}: nothing to suggest.',
    az: '{title} üçün JD yoxlaması: təklif yoxdur.',
    ru: 'Проверка описания «{title}»: предложений нет.',
  },
  jdMany: {
    en: '{n} must-haves is a lot: few people will meet them all. Move some to nice-to-have?',
    az: '{n} vacib tələb çoxdur: az adam hamısını ödəyər. Bəzilərini arzuolunana keçirək?',
    ru: '{n} обязательных требований — много: мало кто выполнит все. Перенести часть в желательные?',
  },
  jdJunior: {
    en: 'The text says junior or entry level but also asks for {years}+ years. These conflict.',
    az: 'Mətndə junior göstərilib, amma {years}+ il təcrübə də tələb olunur. Bunlar ziddiyyət təşkil edir.',
    ru: 'В тексте указан junior, но требуется ещё и {years}+ лет опыта. Это противоречит друг другу.',
  },
  jdWording: {
    en: '"{w}" can exclude people for reasons that are not about the job. Consider plain wording.',
    az: '"{w}" ifadəsi işlə əlaqəsi olmayan səbəblərə görə insanları kənarlaşdıra bilər. Sadə ifadə düşünün.',
    ru: '«{w}» может исключать людей по причинам, не связанным с работой. Подумайте о нейтральной формулировке.',
  },
  jdNoRange: {
    en: 'No experience range is written. Adding one helps people judge if they fit.',
    az: 'Təcrübə müddəti yazılmayıb. Onu əlavə etmək namizədlərə uyğunluğu qiymətləndirməyə kömək edir.',
    ru: 'Не указан требуемый опыт. Его стоит добавить, чтобы люди могли оценить, подходят ли.',
  },
  jdMissing: {
    en: 'The JD mentions {skill}, but no requirement does. Add it, or is it not needed?',
    az: 'JD-də {skill} qeyd olunub, amma heç bir tələbdə yoxdur. Əlavə edək, yoxsa lazım deyil?',
    ru: 'В описании упомянут {skill}, но ни одного требования про него нет. Добавить или не нужно?',
  },
  jdNoReqs: {
    en: 'This vacancy has no requirements yet, so there is nothing to check against.',
    az: 'Bu vakansiyada hələ tələb yoxdur, yoxlamaq üçün əsas yoxdur.',
    ru: 'У этой вакансии ещё нет требований, сверять не с чем.',
  },
  // similar vacancies
  simHead: {
    en: '{n} vacancies share requirements with {title}.',
    az: '{n} vakansiya {title} ilə ortaq tələblərə malikdir.',
    ru: 'С «{title}» совпадают требования у вакансий: {n}.',
  },
  simNone: {
    en: 'No other vacancy shares at least half of the requirements of {title}.',
    az: 'Başqa heç bir vakansiya {title} tələblərinin ən azı yarısını bölüşmür.',
    ru: 'Нет вакансий, у которых совпадает хотя бы половина требований «{title}».',
  },
  hShared: { en: 'Shared requirements', az: 'Ortaq tələblər', ru: 'Общие требования' },
  hVacancy: { en: 'Vacancy', az: 'Vakansiya', ru: 'Вакансия' },
  // rediscovery
  redOff: {
    en: 'Suggestions from other vacancies are switched off by the administrator.',
    az: 'Başqa vakansiyalardan təkliflər administrator tərəfindən söndürülüb.',
    ru: 'Подсказки из других вакансий отключены администратором.',
  },
  redHead: {
    en: '{n} resume(s) from other vacancies mention most of the skills {title} asks for. They are not scored for it.',
    az: 'Başqa vakansiyaların {n} CV-si {title} üçün tələb olunan bacarıqların çoxunu qeyd edir. Bu vakansiya üçün qiymətləndirilməyib.',
    ru: 'В {n} резюме из других вакансий упомянута большая часть навыков, нужных для «{title}». Для неё они не оценивались.',
  },
  redNone: {
    en: 'No resume of other vacancies mentions most of the skills {title} asks for.',
    az: 'Başqa vakansiyaların heç bir CV-si {title} üçün tələb olunan bacarıqların çoxunu qeyd etmir.',
    ru: 'Ни в одном резюме других вакансий нет большинства навыков, нужных для «{title}».',
  },
  redNoSkills: {
    en: 'I could not find skills I know in the requirements of {title}, so I cannot suggest anyone.',
    az: '{title} tələblərində tanıdığım bacarıq tapa bilmədim, ona görə kimisə təklif edə bilmirəm.',
    ru: 'В требованиях «{title}» я не нашёл знакомых навыков, поэтому никого предложить не могу.',
  },
  redNote: {
    en: 'Mentioned in the resume, not assessed here. A suggestion only; it never ranks anyone and nobody is analyzed for this vacancy automatically.',
    az: 'CV-də qeyd olunub, burada qiymətləndirilməyib. Yalnız təklifdir; heç kimi sıralamır və bu vakansiya üçün heç kim avtomatik təhlil edilmir.',
    ru: 'Упомянуто в резюме, здесь не оценено. Только подсказка: никого не ранжирует и никого автоматически не анализирует для этой вакансии.',
  },
  hMentions: { en: 'Skills mentioned', az: 'Qeyd olunan bacarıqlar', ru: 'Упомянутые навыки' },
  // pushback check
  chlWho: {
    en: 'About which candidate? Say a number from the list or a name.',
    az: 'Hansı namizəd barədə? Siyahıdan nömrə və ya ad deyin.',
    ru: 'О каком кандидате? Назовите номер из списка или имя.',
  },
  chlFound: {
    en: 'You are right that {skill} is written in the resume of {name}. The stored assessment is unchanged; I flagged a possible missed piece of evidence. Re-analyze the resume to update it.',
    az: '{name} CV-sində {skill} həqiqətən yazılıb. Saxlanmış qiymətləndirmə dəyişməyib; mümkün qaçırılmış sübutu qeyd etdim. Yeniləmək üçün CV-ni yenidən təhlil edin.',
    ru: 'Вы правы: в резюме {name} написано {skill}. Сохранённая оценка не изменена; я отметил возможный пропуск доказательства. Проанализируйте резюме заново, чтобы обновить.',
  },
  chlNotFound: {
    en: 'I cannot find {skill} written anywhere in the resume of {name}, so the stored assessment stands. If it is in an image or an attachment, it was not read.',
    az: '{name} CV-sində {skill} heç harada yazılmayıb, ona görə saxlanmış qiymətləndirmə qüvvədə qalır. Şəkildə və ya əlavədə varsa, oxunmayıb.',
    ru: 'Я не нахожу {skill} нигде в резюме {name}, поэтому сохранённая оценка остаётся. Если это в картинке или вложении, оно не читалось.',
  },
  chlNote: {
    en: 'The decision stays yours. Nothing was changed.',
    az: 'Qərar sizindir. Heç nə dəyişdirilməyib.',
    ru: 'Решение за вами. Ничего не изменено.',
  },
  chlReanalyze: {
    en: 'Open {name} to re-analyze',
    az: '{name} üçün yenidən təhlilə keç',
    ru: 'Открыть {name} для повторного анализа',
  },
  // declines
  declineLookup: {
    en: 'I do not look people up on the web, LinkedIn, Facebook, Instagram or Telegram. It would collect what the candidate never gave. I can work with the resume that was uploaded.',
    az: 'İnsanları internetdə, LinkedIn, Facebook, Instagram və ya Telegram-da axtarmıram. Bu, namizədin vermədiyi məlumatı toplamaq olardı. Yüklənmiş CV ilə işləyə bilərəm.',
    ru: 'Я не ищу людей в интернете, LinkedIn, Facebook, Instagram или Telegram: это сбор данных, которые кандидат не давал. Могу работать с загруженным резюме.',
  },
  declinePersonality: {
    en: 'I do not judge personality, culture fit, honesty or the chance someone will leave. Text cannot show that reliably. I can show what the resume says against the requirements.',
    az: 'Şəxsiyyəti, mədəniyyətə uyğunluğu, düzlüyü və ya işdən çıxma ehtimalını qiymətləndirmirəm. Mətn bunu etibarlı göstərə bilməz. CV-nin tələblərə görə nə dediyini göstərə bilərəm.',
    ru: 'Я не оцениваю личность, соответствие культуре, честность или вероятность ухода: по тексту этого не определить. Могу показать, что в резюме сказано относительно требований.',
  },
  declineSalary: {
    en: 'I do not work with salary per candidate: it can lead to unfair pay. I can help with the requirements instead.',
    az: 'Namizəd üzrə maaşla işləmirəm: bu ədalətsiz əmək haqqına gətirə bilər. Əvəzində tələblərlə kömək edə bilərəm.',
    ru: 'Я не работаю с зарплатой по кандидатам: это может привести к несправедливой оплате. Могу помочь с требованиями.',
  },
  declineGaps: {
    en: 'I do not treat career gaps as a negative; they have many reasons. I can state the dates and suggest a neutral question.',
    az: 'Karyera fasilələrini mənfi saymıram; onların çoxlu səbəbi ola bilər. Tarixləri göstərə və neytral sual təklif edə bilərəm.',
    ru: 'Я не считаю перерывы в карьере минусом: причин много. Могу назвать даты и предложить нейтральный вопрос.',
  },
} as const;

export type DKey = keyof typeof W;

export const dsay = (lang: Lang, key: DKey, vars: Record<string, string | number> = {}): string =>
  W[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

// ----------------------------------------------------------------------------- declines

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i');

const uw = (alts: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.replace(/\*/g, '\\p{L}*')})(?![\\p{L}\\p{N}])`, 'iu');

const LOOKUP = [
  uw(
    'linkedin|facebook|instagram|telegram|tiktok|twitter|google (him|her|them|this)|search the web|web search|look (him|her|them) up|social media|sosial|соцсет*|гугл*',
  ),
];
const PERSONALITY = [
  uw(
    'personality|culture fit|cultural fit|honest|honesty|flight risk|will (he|she|they) leave|trustworthy|lying|loyal*|temperament|sadiq*|dürüst|durust|şəxsiyyət|sexsiyyet|личност*|честн*|надежн*|надёжн*|уйд[её]т|лояльн*',
  ),
];
const SALARY = [
  uw(
    'salary|salaries|how much (does|do|would) (he|she|they)|pay expectation|maaş*|maas*|əmək haqq*|emek haqq*|зарплат*|оклад*',
  ),
];
const GAPS = [
  uw('career gap|gap in (the )?(cv|resume|career)|employment gap|fasil[əe]|пробел* в|перерыв* в'),
];

const any = (res: RegExp[], q: string) => res.some((r) => r.test(q) || r.test(fold(q)));

/** A request the plan says SenAI never fulfils (section 5.5), with the wording that explains why. */
export function declineFor(q: string): { key: DKey; flag: string } | null {
  if (any(LOOKUP, q)) return { key: 'declineLookup', flag: 'refused:web_lookup' };
  if (any(PERSONALITY, q)) return { key: 'declinePersonality', flag: 'refused:personality' };
  if (any(SALARY, q)) return { key: 'declineSalary', flag: 'refused:salary' };
  if (any(GAPS, q)) return { key: 'declineGaps', flag: 'refused:career_gap' };
  return null;
}

export { NOT_JOB_RELATED } from '../../pipeline/mirror';
